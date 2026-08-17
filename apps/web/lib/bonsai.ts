import { getRequiredViewer, type AuthenticatedViewer } from "./auth";
import {
  getCatalogs,
  getSpeciesCatalogSync,
  normalizeLookupKey,
  resolveCatalogPredictionEntry,
  resolveCatalogSpeciesEntry,
  STYLE_CATALOG,
  type CatalogEntry,
} from "./catalog";
import { isClaudeConfigured, suggestSpeciesAndStyle } from "./ai/claude";
import { getSpeciesCareProfileBySlug, type SpeciesCareProfile } from "./species-care-profiles";
import { deletePhotos, writePhoto } from "./photo-storage";
import { getCollectionStore } from "./store";
import type {
  CandidateMatch,
  CaptureIntent,
  CaptureSource,
  PhotoRecord,
  Prediction,
  SelectionMode,
  SpeciesPredictionSource,
  SubmissionRecord,
  TreeRecord,
  TreeResolutionMode,
} from "./store/types";
import {
  recognizeCapture,
  recognizeLeafSpecies,
  type RawPrediction,
  type RecognitionCandidate,
} from "./vision";

export { getCatalogs } from "./catalog";
export type { CatalogEntry } from "./catalog";
export type { CandidateMatch, Prediction } from "./store/types";

export const LEGACY_IDENTITY_EMBEDDING_MODEL = "pixel-rgb-16";

export type NewTreeSpeciesSelection = {
  kind: "catalog";
  speciesId: number;
} | {
  kind: "custom";
  label: string;
  subtitle: string | null;
  copiedProfileSourceSpeciesId: number | null;
};

export type TreeSummary = {
  id: string;
  inventoryName: string;
  speciesId: number | null;
  speciesName: string;
  speciesSubtitle: string | null;
  styleId: number;
  styleName: string;
  createdAt: string;
  photoCount: number;
  lastCapturedAt: string | null;
  thumbnailUrl: string | null;
};

export type TimelinePhoto = {
  id: string;
  capturedAt: string;
  source: CaptureSource;
  notes: string | null;
  isReference: boolean;
  imageUrl: string;
};

export type TreeDetail = TreeSummary & {
  photos: TimelinePhoto[];
  speciesCareProfile: SpeciesCareProfile | null;
  developmentPlan: string | null;
};

export type ReviewCandidateMatch = CandidateMatch & {
  referenceCapturedAt: string;
  referencePhotoUrl: string;
};

export type CaptureReviewData = {
  id: string;
  captureIntent: CaptureIntent;
  treeResolutionMode: TreeResolutionMode | null;
  speciesSelectionMode: SelectionMode | null;
  styleSelectionMode: SelectionMode | null;
  frontPhotoUrl: string;
  leafPhotoUrl: string | null;
  capturedAt: string;
  leafCapturedAt: string | null;
  source: CaptureSource;
  leafSource: CaptureSource | null;
  notes: string | null;
  winterMode: boolean;
  status: string;
  matchedTreeId: string | null;
  matchScore: number | null;
  candidateMatches: ReviewCandidateMatch[];
  speciesPredictions: Prediction[];
  speciesPredictionSource: SpeciesPredictionSource | null;
  leafReferenceCount: number | null;
  stylePredictions: Prediction[];
  finalizedTreeId: string | null;
  trees: TreeSummary[];
  speciesCatalog: CatalogEntry[];
  styleCatalog: CatalogEntry[];
  hostedFallbackRecommended: boolean;
  fallbackReason: string | null;
};

type CreateCaptureSubmissionInput = {
  captureIntent: CaptureIntent;
  treeResolutionMode: TreeResolutionMode | null;
  speciesSelectionMode: SelectionMode | null;
  styleSelectionMode: SelectionMode | null;
  frontPhoto: File;
  frontSource: CaptureSource;
  leafPhoto: File | null;
  leafSource: CaptureSource | null;
  notes: string | null;
  capturedAt: string;
  leafCapturedAt: string | null;
  frontExtension: string;
  leafExtension: string | null;
  winterMode: boolean;
};

export async function getViewer(_: unknown = null): Promise<AuthenticatedViewer> {
  return getRequiredViewer();
}

export function formatDisplayDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB");
}

type ResolvedSpeciesDisplay = {
  speciesId: number | null;
  speciesName: string;
  speciesSubtitle: string | null;
  careProfile: SpeciesCareProfile | null;
};

function resolveSpeciesDisplay(speciesId: number, speciesCatalog: CatalogEntry[]): ResolvedSpeciesDisplay {
  const species = resolveCatalogSpeciesEntry(speciesCatalog, speciesId);

  if (!species) {
    // A database row can reference a species the local catalog files no longer
    // contain. Render it degraded instead of crashing the whole page.
    return {
      speciesId,
      speciesName: `Species #${speciesId}`,
      speciesSubtitle: null,
      careProfile: null,
    };
  }

  return {
    speciesId: species.id,
    speciesName: species.label,
    speciesSubtitle: species.subtitle ?? null,
    careProfile: getSpeciesCareProfileBySlug(species.careProfileSlug ?? null),
  };
}

function isTimelinePhoto(photo: PhotoRecord) {
  return photo.kind === "front";
}

function buildTreeSummary(
  tree: TreeRecord,
  photos: PhotoRecord[],
  speciesCatalog: CatalogEntry[],
  styleLookup: Map<number, CatalogEntry>,
): TreeSummary {
  const species = resolveSpeciesDisplay(tree.speciesId, speciesCatalog);
  const style = styleLookup.get(tree.styleId);
  const timelinePhotos = photos.filter((photo) => photo.treeId === tree.id && isTimelinePhoto(photo));
  const latest = timelinePhotos.reduce<PhotoRecord | null>(
    (current, photo) =>
      !current || new Date(photo.capturedAt).valueOf() > new Date(current.capturedAt).valueOf() ? photo : current,
    null,
  );

  return {
    id: tree.id,
    inventoryName: tree.inventoryName,
    speciesId: species.speciesId,
    speciesName: species.speciesName,
    speciesSubtitle: species.speciesSubtitle,
    styleId: tree.styleId,
    styleName: style?.label ?? `Style #${tree.styleId}`,
    createdAt: tree.createdAt,
    photoCount: timelinePhotos.length,
    lastCapturedAt: latest?.capturedAt ?? null,
    thumbnailUrl: latest ? createPhotoUrl(latest.storagePath) : null,
  };
}

export async function getTreeSummaries(_: unknown = null, __?: string): Promise<TreeSummary[]> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const [trees, photos] = await Promise.all([store.listTrees(viewer), store.listPhotos(viewer)]);
  const styleLookup = new Map(styleCatalog.map((entry) => [entry.id, entry]));

  return [...trees]
    .sort((left, right) => new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf())
    .map((tree) => buildTreeSummary(tree, photos, speciesCatalog, styleLookup));
}

export async function getTreeDetail(
  _: unknown = null,
  __: string | undefined = undefined,
  treeId: string,
): Promise<TreeDetail | null> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const [tree, photos] = await Promise.all([store.getTree(viewer, treeId), store.listPhotosForTree(viewer, treeId)]);

  if (!tree) {
    return null;
  }

  const styleLookup = new Map(styleCatalog.map((entry) => [entry.id, entry]));
  const summary = buildTreeSummary(tree, photos, speciesCatalog, styleLookup);
  const species = resolveSpeciesDisplay(tree.speciesId, speciesCatalog);

  const timelinePhotos = photos
    .filter(isTimelinePhoto)
    .sort((left, right) => {
      const capturedAtDelta = new Date(left.capturedAt).valueOf() - new Date(right.capturedAt).valueOf();

      if (capturedAtDelta !== 0) {
        return capturedAtDelta;
      }

      if (left.isReference !== right.isReference) {
        return left.isReference ? -1 : 1;
      }

      return left.id.localeCompare(right.id);
    })
    .map((photo) => ({
      id: photo.id,
      capturedAt: photo.capturedAt,
      source: photo.source,
      notes: photo.notes,
      isReference: photo.isReference,
      imageUrl: createPhotoUrl(photo.storagePath),
    }));

  return {
    ...summary,
    photos: timelinePhotos,
    speciesCareProfile: species.careProfile,
    developmentPlan: tree.developmentPlan,
  };
}

export async function getCaptureReviewData(
  _: unknown = null,
  __: string | undefined = undefined,
  submissionId: string,
): Promise<CaptureReviewData | null> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const submission = await store.getSubmission(viewer, submissionId);

  if (!submission) {
    return null;
  }

  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const candidateMatches: ReviewCandidateMatch[] = [];

  for (const match of submission.candidateMatches) {
    // Reference photos live in the collection store; a candidate whose photo
    // has since been deleted is silently dropped instead of crashing review.
    const referencePhoto = await store.getPhoto(viewer, match.photoId);

    if (!referencePhoto) {
      continue;
    }

    candidateMatches.push({
      ...match,
      referenceCapturedAt: referencePhoto.capturedAt,
      referencePhotoUrl: createPhotoUrl(referencePhoto.storagePath),
    });
  }

  return {
    id: submission.id,
    captureIntent: submission.captureIntent,
    treeResolutionMode: submission.treeResolutionMode,
    speciesSelectionMode: submission.speciesSelectionMode,
    styleSelectionMode: submission.styleSelectionMode,
    frontPhotoUrl: createPhotoUrl(submission.frontStoragePath),
    leafPhotoUrl: submission.leafStoragePath ? createPhotoUrl(submission.leafStoragePath) : null,
    capturedAt: submission.capturedAt,
    leafCapturedAt: submission.leafCapturedAt,
    source: submission.source,
    leafSource: submission.leafSource,
    notes: submission.notes,
    winterMode: submission.winterMode,
    status: submission.status,
    matchedTreeId: submission.matchedTreeId,
    matchScore: submission.matchScore,
    candidateMatches,
    speciesPredictions: submission.speciesPredictions,
    speciesPredictionSource: submission.speciesPredictionSource,
    leafReferenceCount: submission.leafReferenceCount,
    stylePredictions: submission.stylePredictions,
    finalizedTreeId: submission.finalizedTreeId,
    trees: await getTreeSummaries(),
    speciesCatalog,
    styleCatalog,
    hostedFallbackRecommended: submission.hostedFallbackRecommended,
    fallbackReason: submission.fallbackReason,
  };
}

async function getRecognitionCandidates(viewer: AuthenticatedViewer): Promise<RecognitionCandidate[]> {
  const store = getCollectionStore();
  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const [trees, photos] = await Promise.all([store.listTrees(viewer), store.listPhotos(viewer)]);

  if (trees.length === 0) {
    return [];
  }

  const treeLookup = new Map(trees.map((tree) => [tree.id, tree]));
  const styleLookup = new Map(styleCatalog.map((entry) => [entry.id, entry]));
  const candidates: RecognitionCandidate[] = [];

  for (const photo of photos.filter((entry) => entry.isReference && entry.embedding && entry.embedding.length > 0)) {
    const tree = treeLookup.get(photo.treeId);

    if (!tree || !photo.embedding) {
      continue;
    }

    const species = resolveSpeciesDisplay(tree.speciesId, speciesCatalog);

    candidates.push({
      treeId: tree.id,
      photoId: photo.id,
      inventoryName: tree.inventoryName,
      speciesId: species.speciesId,
      speciesName: species.speciesName,
      styleId: tree.styleId,
      styleName: styleLookup.get(tree.styleId)?.label ?? null,
      embedding: photo.embedding,
      embeddingModel: photo.embeddingModel ?? LEGACY_IDENTITY_EMBEDDING_MODEL,
    });
  }

  return candidates;
}

function normalizeVisionPredictions(rawPredictions: RawPrediction[], catalog: CatalogEntry[]): Prediction[] {
  const aggregated = new Map<string, Prediction>();

  for (const raw of rawPredictions) {
    const resolvedEntry = raw.id !== null
      ? catalog.find((entry) => entry.id === raw.id) ?? resolveCatalogPredictionEntry(raw.label, catalog)
      : resolveCatalogPredictionEntry(raw.label, catalog);
    const prediction: Prediction = {
      id: resolvedEntry?.id ?? raw.id ?? null,
      label: resolvedEntry?.label ?? raw.label,
      subtitle: resolvedEntry?.subtitle ?? null,
      confidence: raw.confidence,
    };
    const key = resolvedEntry ? `catalog:${resolvedEntry.id}` : `label:${normalizeLookupKey(prediction.label)}`;
    const existing = aggregated.get(key);

    if (existing) {
      existing.confidence += prediction.confidence;
      if (!existing.subtitle && prediction.subtitle) {
        existing.subtitle = prediction.subtitle;
      }
      continue;
    }

    aggregated.set(key, prediction);
  }

  const predictions = [...aggregated.values()];
  const totalConfidence = predictions.reduce((sum, prediction) => sum + prediction.confidence, 0);

  return predictions
    .map((prediction) => ({
      ...prediction,
      confidence: totalConfidence > 0 ? prediction.confidence / totalConfidence : 0,
    }))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

function clampConfidence(value: number) {
  return Math.min(1, Math.max(0, value));
}

function mapClaudeSpecies(
  suggestions: Array<{ slug: string | null; label: string; confidence: number }>,
  speciesCatalog: CatalogEntry[],
): Prediction[] {
  return suggestions
    .map((suggestion) => {
      const entry = suggestion.slug
        ? speciesCatalog.find((candidate) => candidate.slug === suggestion.slug) ?? resolveCatalogPredictionEntry(suggestion.label, speciesCatalog)
        : resolveCatalogPredictionEntry(suggestion.label, speciesCatalog);

      return {
        id: entry?.id ?? null,
        label: entry?.label ?? suggestion.label,
        subtitle: entry?.subtitle ?? null,
        confidence: clampConfidence(suggestion.confidence),
      };
    })
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

function mapClaudeStyles(
  suggestions: Array<{ slug: string; label: string; confidence: number }>,
): Prediction[] {
  const predictions: Prediction[] = [];

  for (const suggestion of suggestions) {
    const entry = STYLE_CATALOG.find((candidate) => candidate.slug === suggestion.slug)
      ?? resolveCatalogPredictionEntry(suggestion.label, STYLE_CATALOG);

    if (!entry) {
      continue;
    }

    predictions.push({
      id: entry.id,
      label: entry.label,
      subtitle: null,
      confidence: clampConfidence(suggestion.confidence),
    });
  }

  return predictions
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

async function fileToImageInput(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif"
    ? file.type
    : "image/jpeg";

  return { base64: buffer.toString("base64"), mimeType } as const;
}

export async function createLocalCaptureSubmission(input: CreateCaptureSubmissionInput): Promise<{ id: string }> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const submissionId = crypto.randomUUID();
  const frontStoragePath = `captures/${submissionId}-front.${input.frontExtension}`;
  const frontBuffer = Buffer.from(await input.frontPhoto.arrayBuffer());
  const leafStoragePath = input.leafPhoto && input.leafExtension ? `captures/${submissionId}-leaf.${input.leafExtension}` : null;
  const leafBuffer = input.leafPhoto ? Buffer.from(await input.leafPhoto.arrayBuffer()) : null;
  const frontRecognitionFile = new File([new Uint8Array(frontBuffer)], "front-capture", { type: input.frontPhoto.type });
  const leafRecognitionFile = input.leafPhoto && leafBuffer
    ? new File([new Uint8Array(leafBuffer)], "leaf-capture", { type: input.leafPhoto.type })
    : null;

  await writePhoto(viewer.id, frontStoragePath, frontBuffer);
  if (leafStoragePath && leafBuffer) {
    await writePhoto(viewer.id, leafStoragePath, leafBuffer);
  }

  try {
    const shouldResolveExistingTree = input.captureIntent === "existing-tree" && input.treeResolutionMode === "automatic";
    const shouldPredictStyle = input.captureIntent === "new-tree" && input.styleSelectionMode === "automatic";
    const shouldPredictSpecies = input.captureIntent === "new-tree" && input.speciesSelectionMode === "automatic";
    const useClaude = isClaudeConfigured() && (shouldPredictSpecies || shouldPredictStyle);
    const candidates = shouldResolveExistingTree ? await getRecognitionCandidates(viewer) : [];

    const [frontRecognition, claudeSuggestions, leafRecognition] = await Promise.all([
      recognizeCapture(frontRecognitionFile, candidates, {
        includeIdentityMatches: shouldResolveExistingTree,
        // Style prediction now comes from Claude; only ask the vision service
        // when Claude is unavailable so its background gate never blocks capture.
        includeStylePredictions: shouldPredictStyle && !useClaude,
      }),
      useClaude
        ? (async () => {
            try {
              return await suggestSpeciesAndStyle({
                frontImage: await fileToImageInput(input.frontPhoto),
                leafImage: leafRecognitionFile ? await fileToImageInput(input.leafPhoto as File) : null,
                speciesCatalog,
                styleCatalog,
                wantSpecies: shouldPredictSpecies,
                wantStyles: shouldPredictStyle,
              });
            } catch (error) {
              console.warn(`[claude] suggestion failed, falling back to vision service: ${(error as Error).message}`);
              return null;
            }
          })()
        : Promise.resolve(null),
      shouldPredictSpecies && !input.winterMode && leafRecognitionFile && !useClaude
        ? recognizeLeafSpecies(leafRecognitionFile)
        : Promise.resolve(null),
    ]);

    // Claude was configured but failed at runtime (rate limit, billing, outage):
    // fall back to the vision service's leaf index so species suggestions
    // still appear.
    const effectiveLeafRecognition = leafRecognition
      ?? (useClaude && !claudeSuggestions && shouldPredictSpecies && !input.winterMode && leafRecognitionFile
        ? await recognizeLeafSpecies(leafRecognitionFile)
        : null);

    const candidateLookup = new Map(candidates.map((candidate) => [`${candidate.treeId}:${candidate.photoId}`, candidate]));
    const candidateMatches: CandidateMatch[] = frontRecognition.rawCandidateMatches
      .map((raw) => {
        const candidate = candidateLookup.get(`${raw.treeId}:${raw.photoId}`);

        if (!candidate) {
          return null;
        }

        return {
          treeId: raw.treeId,
          photoId: raw.photoId,
          inventoryName: candidate.inventoryName,
          speciesId: candidate.speciesId,
          speciesName: candidate.speciesName,
          styleId: candidate.styleId,
          styleName: candidate.styleName,
          score: raw.score,
        };
      })
      .filter((entry): entry is CandidateMatch => entry !== null)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);

    const speciesPredictions = shouldPredictSpecies
      ? (claudeSuggestions
        ? mapClaudeSpecies(claudeSuggestions.species, speciesCatalog)
        : normalizeVisionPredictions(effectiveLeafRecognition?.rawSpeciesPredictions ?? [], speciesCatalog))
      : [];
    const stylePredictions = shouldPredictStyle
      ? (claudeSuggestions
        ? mapClaudeStyles(claudeSuggestions.styles)
        : normalizeVisionPredictions(frontRecognition.rawStylePredictions, styleCatalog))
      : [];

    const submission: SubmissionRecord = {
      id: submissionId,
      ownerId: viewer.id,
      captureIntent: input.captureIntent,
      treeResolutionMode: input.treeResolutionMode,
      speciesSelectionMode: input.speciesSelectionMode,
      styleSelectionMode: input.styleSelectionMode,
      frontStoragePath,
      leafStoragePath,
      capturedAt: input.capturedAt,
      leafCapturedAt: input.leafCapturedAt,
      source: input.frontSource,
      leafSource: input.leafSource,
      notes: input.notes,
      winterMode: input.winterMode,
      status: "pending",
      matchedTreeId: shouldResolveExistingTree ? frontRecognition.matchedTreeId : null,
      matchScore: shouldResolveExistingTree ? frontRecognition.matchScore : null,
      candidateMatches,
      speciesPredictions,
      speciesPredictionSource: input.captureIntent === "new-tree"
        ? (input.winterMode ? "manual-winter" : (leafStoragePath ? "leaf-reference" : "front-photo"))
        : null,
      leafReferenceCount: effectiveLeafRecognition?.referenceCount ?? null,
      stylePredictions,
      finalizedTreeId: null,
      finalizedPhotoId: null,
      embedding: frontRecognition.embedding,
      embeddingModel: frontRecognition.embeddingModel,
      hostedFallbackRecommended: shouldResolveExistingTree ? frontRecognition.hostedFallbackRecommended : false,
      fallbackReason: shouldResolveExistingTree ? frontRecognition.fallbackReason : null,
    };

    await store.createSubmission(viewer, submission);
    return { id: submissionId };
  } catch (error) {
    await deletePhotos(viewer.id, leafStoragePath ? [frontStoragePath, leafStoragePath] : [frontStoragePath]);
    throw error;
  }
}

export async function finalizeCaptureAsExisting(submissionId: string, treeId: string): Promise<string> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const submission = await store.getSubmission(viewer, submissionId);

  if (!submission) {
    throw new Error("Capture submission not found.");
  }

  if (submission.captureIntent !== "existing-tree") {
    throw new Error("This capture was started as a new-tree flow.");
  }

  if (submission.status !== "pending") {
    throw new Error("Capture submission has already been finalized.");
  }

  const tree = await store.getTree(viewer, treeId);

  if (!tree) {
    throw new Error("Tree not found.");
  }

  const hasExistingPhoto = await store.hasPhotosForTree(viewer, tree.id);
  const photoId = crypto.randomUUID();

  await store.createPhoto(viewer, {
    id: photoId,
    treeId: tree.id,
    captureSubmissionId: submission.id,
    storagePath: submission.frontStoragePath,
    capturedAt: submission.capturedAt,
    source: submission.source,
    notes: submission.notes,
    isReference: !hasExistingPhoto,
    kind: "front",
    embedding: submission.embedding,
    embeddingModel: submission.embeddingModel,
  });
  await store.markSubmissionConfirmed(viewer, submission.id, { treeId: tree.id, photoId });

  return tree.id;
}

export async function finalizeCaptureAsNewTree(
  submissionId: string,
  speciesSelection: NewTreeSpeciesSelection,
  styleId: number,
  inventoryName: string,
): Promise<string> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const submission = await store.getSubmission(viewer, submissionId);
  const speciesCatalog = getSpeciesCatalogSync();
  const style = STYLE_CATALOG.find((entry) => entry.id === styleId);
  const trimmedInventoryName = inventoryName.trim();

  if (!submission) {
    throw new Error("Capture submission not found.");
  }

  if (!style) {
    throw new Error("Style not found.");
  }

  if (submission.captureIntent !== "new-tree") {
    throw new Error("This capture was started as an existing-tree flow.");
  }

  if (submission.status !== "pending") {
    throw new Error("Capture submission has already been finalized.");
  }

  if (trimmedInventoryName.length === 0) {
    throw new Error("Tree name is required.");
  }

  if (speciesSelection.kind !== "catalog") {
    throw new Error("Choose the closest species from the catalog — custom species entries are not supported yet.");
  }

  const species = resolveCatalogSpeciesEntry(speciesCatalog, speciesSelection.speciesId);

  if (!species) {
    throw new Error("Species not found.");
  }

  const tree = await store.createTree(viewer, {
    speciesId: species.id,
    styleId,
    inventoryName: trimmedInventoryName,
    createdAt: submission.capturedAt,
  });

  const photoId = crypto.randomUUID();
  await store.createPhoto(viewer, {
    id: photoId,
    treeId: tree.id,
    captureSubmissionId: submission.id,
    storagePath: submission.frontStoragePath,
    capturedAt: submission.capturedAt,
    source: submission.source,
    notes: submission.notes,
    isReference: true,
    kind: "front",
    embedding: submission.embedding,
    embeddingModel: submission.embeddingModel,
  });
  await store.markSubmissionConfirmed(viewer, submission.id, { treeId: tree.id, photoId });

  return tree.id;
}

export async function updateTreeDevelopmentPlan(treeId: string, developmentPlan: string | null): Promise<void> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const trimmed = developmentPlan?.trim() ?? "";
  await store.updateTreePlan(viewer, treeId, trimmed.length > 0 ? trimmed : null);
}

export async function deleteTree(treeId: string): Promise<void> {
  const viewer = await getRequiredViewer();
  const store = getCollectionStore();
  const storagePaths = await store.deleteTree(viewer, treeId);

  // Photos, leaf files, and Studio renders all come back from the store; remove
  // every byte so a deleted tree leaves nothing behind in Storage or on disk.
  await deletePhotos(viewer.id, storagePaths);
}

export function resolvePhotoPathFromSegments(segments: string[]) {
  if (segments.length === 0) {
    return null;
  }

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes("\\"))) {
    return null;
  }

  return segments.join("/");
}

export function createPhotoUrl(storagePath: string) {
  return `/api/photos/${storagePath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}
