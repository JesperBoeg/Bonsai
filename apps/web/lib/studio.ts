import type { AuthenticatedViewer } from "./auth";
import { designTargetState, getClaudeModelId, isClaudeConfigured } from "./ai/claude";
import { getRenderProviderName, renderTargetImage } from "./ai/render";
import { createPhotoUrl } from "./bonsai";
import { getCatalogs, STYLE_CATALOG } from "./catalog";
import { readPhotoFile, writePhotoFile } from "./storage-paths";
import { getCollectionStore } from "./store";
import type { PhotoRecord, TargetStateMode, TargetStateRecord } from "./store/types";

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
  const targets = await store.listTargetStatesForTree(viewer, treeId);
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

    const sourceBuffer = await readPhotoFile(viewer.id, sourcePhoto.storagePath);
    const sourceMimeType = mimeTypeForPath(sourcePhoto.storagePath);

    // Up to two earlier photos give Claude the tree's development trajectory.
    const allPhotos = await store.listPhotosForTree(viewer, input.treeId);
    const earlierPhotos = allPhotos
      .filter((photo) => photo.kind === "front" && photo.id !== sourcePhoto.id)
      .sort((left, right) => new Date(left.capturedAt).valueOf() - new Date(right.capturedAt).valueOf())
      .slice(0, 2);
    const extraImages = [];

    for (const photo of earlierPhotos) {
      try {
        const buffer = await readPhotoFile(viewer.id, photo.storagePath);
        extraImages.push({ base64: buffer.toString("base64"), mimeType: mimeTypeForPath(photo.storagePath) });
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
        await writePhotoFile(viewer.id, imagePath, Buffer.from(render.imageBase64, "base64"));
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

function mimeTypeForPath(storagePath: string): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  const lower = storagePath.toLowerCase();

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  if (lower.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/jpeg";
}
