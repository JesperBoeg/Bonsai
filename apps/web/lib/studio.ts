import type { AuthenticatedViewer } from "./auth";
import { designTargetState, getClaudeModelId, isClaudeConfigured } from "./ai/claude";
import { getRenderProviderName, renderTargetImage } from "./ai/render";
import { createPhotoUrl } from "./bonsai";
import { getCatalogs, STYLE_CATALOG } from "./catalog";
import { photoContentType, readPhoto, writePhoto } from "./photo-storage";
import { getCollectionStore } from "./store";
import type { PhotoRecord, TargetStateMode, TargetStateRecord, TargetStateStatus } from "./store/types";

// The Design Studio pipeline: Claude designs the target state (assessment,
// staged plan, and a constrained photo-edit instruction), then an image-editing
// model renders that instruction against the tree's current photo. The two
// stages write their progress to the target-state record so the UI can follow
// along and survive refreshes.

export type StudioTargetView = Omit<TargetStateRecord, "imagePath"> & {
  imageUrl: string | null;
  sourcePhotoUrl: string | null;
};

export type StudioData = {
  targets: StudioTargetView[];
  activeTarget: StudioTargetView | null;
  aiConfigured: boolean;
  renderProvider: string;
  claudeModel: string;
};

const runningPipelines = new Set<string>();

// A design is an in-process background job, so it dies with the process: a
// deploy, a crash, or a machine restart mid-design leaves a target stuck at
// "analyzing" forever. Anything in progress for longer than this — and not
// running in *this* process — is therefore an orphan, and gets swept into
// "failed" so the card offers a retry instead of a spinner that never resolves.
const STALE_IN_PROGRESS_MS = 10 * 60 * 1000;
const IN_PROGRESS_STATUSES: TargetStateStatus[] = ["pending", "analyzing", "rendering"];
const INTERRUPTED_MESSAGE = "This design was interrupted by a server restart. Design again to pick up from the current photos.";

function toView(record: TargetStateRecord, sourcePhoto: PhotoRecord | null): StudioTargetView {
  const { imagePath, ...rest } = record;

  return {
    ...rest,
    imageUrl: imagePath ? createPhotoUrl(imagePath) : null,
    sourcePhotoUrl: sourcePhoto ? createPhotoUrl(sourcePhoto.storagePath) : null,
  };
}

export async function getStudioData(viewer: AuthenticatedViewer, treeId: string): Promise<StudioData> {
  const store = getCollectionStore();
  const targets = await sweepInterruptedTargets(viewer, await store.listTargetStatesForTree(viewer, treeId));
  const views: StudioTargetView[] = [];

  for (const target of targets) {
    const sourcePhoto = target.sourcePhotoId ? await store.getPhoto(viewer, target.sourcePhotoId) : null;
    views.push(toView(target, sourcePhoto));
  }

  const activeTarget = views.find((target) => target.isActive && target.status === "ready")
    ?? views.find((target) => target.status === "ready")
    ?? null;

  return {
    targets: views,
    activeTarget,
    aiConfigured: isClaudeConfigured(),
    renderProvider: getRenderProviderName(),
    claudeModel: getClaudeModelId(),
  };
}

export async function sweepInterruptedTargets(
  viewer: AuthenticatedViewer,
  targets: TargetStateRecord[],
): Promise<TargetStateRecord[]> {
  const store = getCollectionStore();
  const staleBefore = Date.now() - STALE_IN_PROGRESS_MS;
  const swept: TargetStateRecord[] = [];

  for (const target of targets) {
    const isStale = IN_PROGRESS_STATUSES.includes(target.status)
      && new Date(target.createdAt).valueOf() < staleBefore
      && !runningPipelines.has(target.id);

    if (!isStale) {
      swept.push(target);
      continue;
    }

    const failed: TargetStateRecord = { ...target, status: "failed", errorMessage: INTERRUPTED_MESSAGE };

    try {
      await store.updateTargetState(viewer, target.id, {
        status: failed.status,
        errorMessage: failed.errorMessage,
      });
      console.warn(`[studio] swept interrupted target ${target.id} (was ${target.status})`);
    } catch (error) {
      console.warn(`[studio] could not sweep interrupted target ${target.id}: ${(error as Error).message}`);
    }

    swept.push(failed);
  }

  return swept;
}

/**
 * Re-runs a target design from scratch, reusing the original brief (and, when the
 * first attempt got far enough to produce a plan, its style and horizon).
 */
export async function retryTargetStateGeneration(
  viewer: AuthenticatedViewer,
  targetId: string,
): Promise<{ targetId: string; treeId: string }> {
  const store = getCollectionStore();
  const previous = await store.getTargetState(viewer, targetId);

  if (!previous) {
    throw new Error("That design is no longer available.");
  }

  const previousStyleSlug = previous.plan?.target.styleSlug ?? null;
  const started = await startTargetStateGeneration(viewer, {
    treeId: previous.treeId,
    mode: previous.mode,
    brief: previous.brief,
    targetStyleId: previousStyleSlug
      ? STYLE_CATALOG.find((entry) => entry.slug === previousStyleSlug)?.id ?? null
      : null,
    horizonYears: previous.plan?.target.horizonYears ?? null,
  });

  return { targetId: started.targetId, treeId: previous.treeId };
}

export type StartTargetStateInput = {
  treeId: string;
  mode: TargetStateMode;
  brief: string | null;
  targetStyleId: number | null;
  horizonYears: number | null;
};

export async function startTargetStateGeneration(
  viewer: AuthenticatedViewer,
  input: StartTargetStateInput,
): Promise<{ targetId: string }> {
  if (!isClaudeConfigured()) {
    throw new Error("The Design Studio needs an Anthropic API key. Set ANTHROPIC_API_KEY and restart the app.");
  }

  const store = getCollectionStore();
  const tree = await store.getTree(viewer, input.treeId);

  if (!tree) {
    throw new Error("Tree not found.");
  }

  const photos = await store.listPhotosForTree(viewer, input.treeId);
  const frontPhotos = photos
    .filter((photo) => photo.kind === "front")
    .sort((left, right) => new Date(right.capturedAt).valueOf() - new Date(left.capturedAt).valueOf());

  if (frontPhotos.length === 0) {
    throw new Error("Add at least one photo of this tree before designing a target state.");
  }

  const targetId = crypto.randomUUID();
  const record: TargetStateRecord = {
    id: targetId,
    treeId: input.treeId,
    ownerId: viewer.id,
    mode: input.mode,
    brief: input.brief,
    status: "pending",
    plan: null,
    editInstruction: null,
    sourcePhotoId: frontPhotos[0].id,
    imagePath: null,
    renderProvider: null,
    modelVersions: null,
    isActive: false,
    errorMessage: null,
    createdAt: new Date().toISOString(),
  };

  await store.createTargetState(viewer, record);

  // Fire and forget: the pipeline reports progress through the record's status,
  // and the Studio UI polls it. The app runs in a long-lived Node process
  // (Render container / next dev), so the work survives the action returning.
  void runTargetStatePipeline(viewer, targetId, input).catch((error) => {
    console.error(`[studio] pipeline crashed for ${targetId}:`, error);
  });

  return { targetId };
}

async function runTargetStatePipeline(
  viewer: AuthenticatedViewer,
  targetId: string,
  input: StartTargetStateInput,
): Promise<void> {
  if (runningPipelines.has(targetId)) {
    return;
  }

  runningPipelines.add(targetId);
  const store = getCollectionStore();

  try {
    const tree = await store.getTree(viewer, input.treeId);
    const target = await store.getTargetState(viewer, targetId);

    if (!tree || !target || !target.sourcePhotoId) {
      throw new Error("Target state is missing its tree or source photo.");
    }

    const sourcePhoto = await store.getPhoto(viewer, target.sourcePhotoId);

    if (!sourcePhoto) {
      throw new Error("Source photo not found.");
    }

    await store.updateTargetState(viewer, targetId, { status: "analyzing" });

    const { speciesCatalog, styleCatalog } = await getCatalogs();
    const species = speciesCatalog.find((entry) => entry.id === tree.speciesId);
    const currentStyle = styleCatalog.find((entry) => entry.id === tree.styleId);
    const targetStyle = input.targetStyleId !== null
      ? STYLE_CATALOG.find((entry) => entry.id === input.targetStyleId) ?? null
      : null;

    const sourceBuffer = await readPhoto(viewer.id, sourcePhoto.storagePath);
    const sourceMimeType = photoContentType(sourcePhoto.storagePath);

    // Up to two earlier photos give Claude the tree's development trajectory.
    const allPhotos = await store.listPhotosForTree(viewer, input.treeId);
    const earlierPhotos = allPhotos
      .filter((photo) => photo.kind === "front" && photo.id !== sourcePhoto.id)
      .sort((left, right) => new Date(left.capturedAt).valueOf() - new Date(right.capturedAt).valueOf())
      .slice(0, 2);
    const extraImages = [];

    for (const photo of earlierPhotos) {
      try {
        const buffer = await readPhoto(viewer.id, photo.storagePath);
        extraImages.push({ base64: buffer.toString("base64"), mimeType: photoContentType(photo.storagePath) });
      } catch {
        // Missing historical file — skip it.
      }
    }

    const design = await designTargetState({
      frontImage: { base64: sourceBuffer.toString("base64"), mimeType: sourceMimeType },
      extraImages,
      speciesLabel: species?.label ?? `Species #${tree.speciesId}`,
      speciesLatin: species?.subtitle ?? null,
      currentStyleLabel: currentStyle?.label ?? `Style #${tree.styleId}`,
      developmentPlan: tree.developmentPlan,
      styleCatalog: STYLE_CATALOG,
      designBrief: {
        mode: input.mode,
        brief: input.brief,
        targetStyleLabel: targetStyle?.label ?? null,
        horizonYears: input.horizonYears,
      },
    });

    await store.updateTargetState(viewer, targetId, {
      status: "rendering",
      plan: design.plan,
      editInstruction: design.editInstruction,
      modelVersions: { design: getClaudeModelId() },
    });

    let imagePath: string | null = null;
    let renderProvider: string | null = null;
    let renderError: string | null = null;

    try {
      const render = await renderTargetImage({
        sourceBase64: sourceBuffer.toString("base64"),
        sourceMimeType,
        instruction: design.editInstruction,
      });

      if (render) {
        const extension = render.mimeType === "image/jpeg" ? "jpg" : render.mimeType === "image/webp" ? "webp" : "png";
        imagePath = `studio/${targetId}.${extension}`;
        renderProvider = render.provider;
        await writePhoto(viewer.id, imagePath, Buffer.from(render.imageBase64, "base64"));
      }
    } catch (error) {
      // The design plan is valuable on its own; deliver it and note why the
      // render is missing.
      renderError = `The photoreal render failed: ${(error as Error).message}`;
      console.warn(`[studio] render failed for ${targetId}: ${(error as Error).message}`);
    }

    await store.updateTargetState(viewer, targetId, {
      status: "ready",
      imagePath,
      renderProvider,
      errorMessage: renderError,
      modelVersions: {
        design: getClaudeModelId(),
        ...(renderProvider ? { render: renderProvider } : {}),
      },
    });
    await store.setActiveTargetState(viewer, input.treeId, targetId);
  } catch (error) {
    console.error(`[studio] pipeline failed for ${targetId}:`, error);
    await store
      .updateTargetState(viewer, targetId, {
        status: "failed",
        errorMessage: (error as Error).message,
      })
      .catch(() => undefined);
  } finally {
    runningPipelines.delete(targetId);
  }
}

