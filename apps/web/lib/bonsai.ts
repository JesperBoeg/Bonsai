import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequiredViewer, type AuthenticatedViewer } from "./auth";
import { getVisionServiceUrl } from "./env";
import { getSpeciesCareProfileBySlug, type SpeciesCareProfile } from "./species-care-profiles";
import { createSupabaseServerClient } from "./supabase/server";

type CaptureIntent = "existing-tree" | "new-tree";
type CapturePhotoKind = "front" | "leaf";
type SpeciesPredictionSource = "front-photo" | "leaf-reference" | "manual-winter";
type TreeResolutionMode = "automatic" | "manual";
type SpeciesSelectionMode = "automatic" | "manual";
type StyleSelectionMode = "automatic" | "manual";
type CatalogTaxonRank = "species" | "genus" | "group";
type CatalogTier = "core" | "extended";

type StoredTree = {
  id: string;
  speciesId: number | null;
  customSpeciesLabel?: string | null;
  customSpeciesSubtitle?: string | null;
  customSpeciesCareProfile?: SpeciesCareProfile | null;
  styleId: number;
  sequenceNumber: number;
  inventoryName: string;
  createdAt: string;
  developmentPlan?: string | null;
};

type StoredPhoto = {
  id: string;
  treeId: string;
  captureSubmissionId: string;
  storagePath: string;
  capturedAt: string;
  source: "camera" | "upload";
  notes: string | null;
  isReference: boolean;
  kind?: CapturePhotoKind;
  embedding: number[] | null;
  embeddingModel?: string | null;
};

type StoredCaptureSubmission = {
  id: string;
  captureIntent: CaptureIntent;
  treeResolutionMode: TreeResolutionMode | null;
  speciesSelectionMode: SpeciesSelectionMode | null;
  styleSelectionMode: StyleSelectionMode | null;
  frontStoragePath: string;
  leafStoragePath: string | null;
  capturedAt: string;
  leafCapturedAt: string | null;
  source: "camera" | "upload";
  leafSource: "camera" | "upload" | null;
  notes: string | null;
  winterMode: boolean;
  status: "pending" | "confirmed";
  matchedTreeId: string | null;
  matchScore: number | null;
  candidateMatches: CandidateMatch[];
  speciesPredictions: Prediction[];
  speciesPredictionSource: SpeciesPredictionSource | null;
  leafReferenceCount: number | null;
  stylePredictions: Prediction[];
  finalizedTreeId: string | null;
  finalizedPhotoId: string | null;
  embedding: number[];
  embeddingModel?: string | null;
  hostedFallbackRecommended?: boolean;
  fallbackReason?: string | null;
};

type DemoStore = {
  trees: StoredTree[];
  photos: StoredPhoto[];
  captureSubmissions: StoredCaptureSubmission[];
};

type DbTreeRow = {
  id: string;
  species_id: number;
  style_id: number;
  inventory_name: string;
  created_at: string;
  development_plan: string | null;
};

type DbPhotoRow = {
  id: string;
  tree_id: string;
  capture_submission_id: string | null;
  storage_path: string;
  captured_at: string;
  source: "camera" | "upload";
  notes: string | null;
  is_reference: boolean;
  embedding: unknown;
  embedding_model?: string | null;
};

type CreateCaptureSubmissionInput = {
  captureIntent: CaptureIntent;
  treeResolutionMode: TreeResolutionMode | null;
  speciesSelectionMode: SpeciesSelectionMode | null;
  styleSelectionMode: StyleSelectionMode | null;
  frontPhoto: File;
  frontSource: "camera" | "upload";
  leafPhoto: File | null;
  leafSource: "camera" | "upload" | null;
  notes: string | null;
  capturedAt: string;
  leafCapturedAt: string | null;
  frontExtension: string;
  leafExtension: string | null;
  winterMode: boolean;
};

export type NewTreeSpeciesSelection = {
  kind: "catalog";
  speciesId: number;
} | {
  kind: "custom";
  label: string;
  subtitle: string | null;
  copiedProfileSourceSpeciesId: number | null;
};

export type CatalogEntry = {
  id: number;
  label: string;
  slug: string;
  subtitle: string | null;
  aliases?: string[];
  careProfileSlug?: string | null;
  taxonRank?: CatalogTaxonRank | null;
  catalogTier?: CatalogTier | null;
  recognitionEnabled?: boolean;
};

type CatalogEntryInput = Omit<CatalogEntry, "id">;

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
  source: "camera" | "upload";
  notes: string | null;
  isReference: boolean;
  kind: CapturePhotoKind;
  imageUrl: string;
};

export type TreeDetail = TreeSummary & {
  photos: TimelinePhoto[];
  speciesCareProfile: SpeciesCareProfile | null;
  developmentPlan: string | null;
};

export type Prediction = {
  id: number | null;
  label: string;
  subtitle?: string | null;
  confidence: number;
};

export type CandidateMatch = {
  treeId: string;
  photoId: string;
  inventoryName: string;
  speciesId: number | null;
  speciesName: string | null;
  styleId: number | null;
  styleName: string | null;
  score: number;
};

export type ReviewCandidateMatch = CandidateMatch & {
  referenceCapturedAt: string;
  referencePhotoUrl: string;
};

export type RecognitionCandidate = Omit<CandidateMatch, "score"> & {
  embedding: number[];
  embeddingModel: string;
};

type RecognitionCandidatePayload = Pick<RecognitionCandidate, "treeId" | "photoId" | "embedding" | "embeddingModel">;

export type VisionRecognitionResult = {
  embedding: number[];
  embeddingModel: string;
  candidateMatches: CandidateMatch[];
  matchedTreeId: string | null;
  matchScore: number | null;
  speciesPredictions: Prediction[];
  stylePredictions: Prediction[];
  hostedFallbackRecommended: boolean;
  fallbackReason: string | null;
};

export type LeafRecognitionResult = {
  embeddingModel: string;
  speciesPredictions: Prediction[];
  referenceCount: number;
};

export type CaptureReviewData = {
  id: string;
  captureIntent: CaptureIntent;
  treeResolutionMode: TreeResolutionMode | null;
  speciesSelectionMode: SpeciesSelectionMode | null;
  styleSelectionMode: StyleSelectionMode | null;
  frontPhotoUrl: string;
  leafPhotoUrl: string | null;
  capturedAt: string;
  leafCapturedAt: string | null;
  source: "camera" | "upload";
  leafSource: "camera" | "upload" | null;
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

const LEGACY_IDENTITY_EMBEDDING_MODEL = "pixel-rgb-16";

const LEGACY_SPECIES_CATALOG: CatalogEntry[] = [
  {
    id: 1,
    slug: "juniperus-procumbens",
    label: "Japanese garden juniper",
    subtitle: "Juniperus procumbens",
    aliases: ["Dwarf Japanese juniper", "Juniperus procumbens"],
    careProfileSlug: "juniperus-procumbens",
    taxonRank: "species",
    catalogTier: "core",
    recognitionEnabled: true,
  },
  {
    id: 2,
    slug: "ficus-retusa",
    label: "Banyan fig",
    subtitle: "Ficus retusa",
    aliases: ["Ficus retusa", "Banyan fig"],
    careProfileSlug: "ficus-retusa",
    taxonRank: "species",
    catalogTier: "core",
    recognitionEnabled: true,
  },
  {
    id: 3,
    slug: "acer-palmatum",
    label: "Japanese maple",
    subtitle: "Acer palmatum",
    aliases: ["Acer palmatum", "Japanese maple"],
    careProfileSlug: "acer-palmatum",
    taxonRank: "species",
    catalogTier: "core",
    recognitionEnabled: true,
  },
  {
    id: 4,
    slug: "pinus-thunbergii",
    label: "Japanese black pine",
    subtitle: "Pinus thunbergii",
    aliases: ["Pinus thunbergii", "Japanese black pine"],
    careProfileSlug: "pinus-thunbergii",
    taxonRank: "species",
    catalogTier: "core",
    recognitionEnabled: true,
  },
  {
    id: 5,
    slug: "ulmus-parvifolia",
    label: "Chinese elm",
    subtitle: "Ulmus parvifolia",
    aliases: ["Ulmus parvifolia", "Chinese elm"],
    careProfileSlug: "ulmus-parvifolia",
    taxonRank: "species",
    catalogTier: "core",
    recognitionEnabled: true,
  },
];

const SPECIES_CATALOG: CatalogEntry[] = buildSpeciesCatalog();

const STYLE_CATALOG: CatalogEntry[] = [
  { id: 1, slug: "hokidachi", label: "Broom (Hokidachi)", subtitle: null },
  { id: 2, slug: "chokkan", label: "Formal upright (Chokkan)", subtitle: null },
  { id: 3, slug: "moyogi", label: "Informal upright (Moyogi)", subtitle: null },
  { id: 4, slug: "shakan", label: "Slanting (Shakan)", subtitle: null },
  { id: 5, slug: "kengai", label: "Cascade (Kengai)", subtitle: null },
  { id: 6, slug: "han-kengai", label: "Semi-cascade (Han-kengai)", subtitle: null },
  { id: 7, slug: "bunjingi", label: "Literati (Bunjingi)", subtitle: null },
  { id: 8, slug: "fukinagashi", label: "Windswept (Fukinagashi)", subtitle: null },
  { id: 9, slug: "sokan", label: "Double trunk (Sokan)", subtitle: null },
  { id: 10, slug: "kabudachi", label: "Multi-trunk (Kabudachi)", subtitle: null },
  { id: 11, slug: "yose-ue", label: "Forest (Yose-ue)", subtitle: null },
  { id: 12, slug: "seki-joju", label: "Growing on rock (Seki-joju)", subtitle: null },
  { id: 13, slug: "ishisuki", label: "Growing in rock (Ishisuki)", subtitle: null },
  { id: 14, slug: "ikadabuki", label: "Raft (Ikadabuki)", subtitle: null },
  { id: 15, slug: "sharimiki", label: "Shari deadwood (Sharimiki)", subtitle: null },
];

let storeWriteQueue = Promise.resolve();

export async function getViewer(_: unknown = null): Promise<AuthenticatedViewer> {
  return getRequiredViewer();
}

export function formatDisplayDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB");
}

export async function getCatalogs(_: unknown = null) {
  return {
    speciesCatalog: SPECIES_CATALOG,
    styleCatalog: STYLE_CATALOG,
  };
}

type ResolvedTreeSpecies = {
  speciesId: number | null;
  speciesName: string;
  speciesSubtitle: string | null;
  careProfile: SpeciesCareProfile | null;
};

function readTrimmedText(value: string | null | undefined) {
  const trimmedValue = value?.trim() ?? "";
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function cloneSpeciesCareProfile(profile: SpeciesCareProfile | null): SpeciesCareProfile | null {
  if (!profile) {
    return null;
  }

  return {
    label: profile.label,
    scientificName: profile.scientificName,
    careInstructions: profile.careInstructions.map((entry) => ({ ...entry })),
    characteristics: profile.characteristics.map((entry) => ({ ...entry })),
    bonsaiSpecifics: profile.bonsaiSpecifics.map((entry) => ({ ...entry })),
    seasonCalendar: profile.seasonCalendar.map((entry) => ({ ...entry })),
  };
}

function resolveCatalogSpeciesEntry(speciesCatalog: CatalogEntry[], speciesId: number) {
  return speciesCatalog.find((entry) => entry.id === speciesId) ?? null;
}

function resolveStoredTreeSpecies(tree: StoredTree, speciesCatalog: CatalogEntry[]): ResolvedTreeSpecies {
  if (typeof tree.speciesId === "number") {
    const species = resolveCatalogSpeciesEntry(speciesCatalog, tree.speciesId);

    if (!species) {
      throw new Error("Tree catalog references are out of sync.");
    }

    return {
      speciesId: species.id,
      speciesName: species.label,
      speciesSubtitle: species.subtitle ?? null,
      careProfile: getSpeciesCareProfileBySlug(species.careProfileSlug ?? null),
    };
  }

  const customSpeciesLabel = readTrimmedText(tree.customSpeciesLabel);

  if (!customSpeciesLabel) {
    throw new Error("Tree species data is missing.");
  }

  return {
    speciesId: null,
    speciesName: customSpeciesLabel,
    speciesSubtitle: readTrimmedText(tree.customSpeciesSubtitle),
    careProfile: tree.customSpeciesCareProfile ?? null,
  };
}

function treeMatchesSpeciesSelection(tree: StoredTree, speciesSelection: NewTreeSpeciesSelection) {
  if (speciesSelection.kind === "catalog") {
    return tree.speciesId === speciesSelection.speciesId;
  }

  return tree.speciesId === null
    && normalizeLookupKey(tree.customSpeciesLabel ?? "") === normalizeLookupKey(speciesSelection.label)
    && normalizeLookupKey(tree.customSpeciesSubtitle ?? "") === normalizeLookupKey(speciesSelection.subtitle ?? "");
}

function resolveDbTreeSpecies(tree: Pick<DbTreeRow, "species_id">, speciesCatalog: CatalogEntry[]): ResolvedTreeSpecies {
  const species = resolveCatalogSpeciesEntry(speciesCatalog, tree.species_id);

  if (!species) {
    throw new Error("Tree catalog references are out of sync.");
  }

  return {
    speciesId: species.id,
    speciesName: species.label,
    speciesSubtitle: species.subtitle ?? null,
    careProfile: getSpeciesCareProfileBySlug(species.careProfileSlug ?? null),
  };
}

async function listCollectionTreesFromDb(): Promise<DbTreeRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trees")
    .select("id, species_id, style_id, inventory_name, created_at, development_plan")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DbTreeRow[];
}

async function getCollectionTreeFromDb(treeId: string): Promise<DbTreeRow | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("trees")
    .select("id, species_id, style_id, inventory_name, created_at, development_plan")
    .eq("id", treeId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as DbTreeRow | null) ?? null;
}

async function listCollectionPhotosFromDb(): Promise<DbPhotoRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("photos")
    .select("id, tree_id, capture_submission_id, storage_path, captured_at, source, notes, is_reference, embedding")
    .order("captured_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DbPhotoRow[];
}

async function listPhotosForTreeFromDb(treeId: string): Promise<DbPhotoRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("photos")
    .select("id, tree_id, capture_submission_id, storage_path, captured_at, source, notes, is_reference, embedding")
    .eq("tree_id", treeId)
    .order("captured_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DbPhotoRow[];
}

function serializeEmbeddingForVector(embedding: number[] | null | undefined) {
  if (!embedding || embedding.length === 0) {
    return null;
  }

  return `[${embedding.join(",")}]`;
}

async function insertConfirmedSubmissionInDb(input: {
  viewer: Pick<AuthenticatedViewer, "id">;
  submission: StoredCaptureSubmission;
  finalizedTreeId: string;
}) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("capture_submissions")
    .insert({
      id: input.submission.id,
      owner_id: input.viewer.id,
      storage_path: input.submission.frontStoragePath,
      captured_at: input.submission.capturedAt,
      source: input.submission.source,
      notes: input.submission.notes,
      embedding: serializeEmbeddingForVector(input.submission.embedding),
      status: "confirmed",
      matched_tree_id: input.submission.matchedTreeId,
      match_score: input.submission.matchScore,
      candidate_matches: input.submission.candidateMatches,
      species_prediction: input.submission.speciesPredictions,
      style_prediction: input.submission.stylePredictions,
      finalized_tree_id: input.finalizedTreeId,
    });

  if (error) {
    throw new Error(error.message);
  }
}

async function updateConfirmedSubmissionPhotoInDb(submissionId: string, finalizedPhotoId: string) {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("capture_submissions")
    .update({ finalized_photo_id: finalizedPhotoId })
    .eq("id", submissionId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getTreeSummaries(_: unknown = null, __?: string): Promise<TreeSummary[]> {
  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const [trees, photos] = await Promise.all([listCollectionTreesFromDb(), listCollectionPhotosFromDb()]);
  const photoStats = new Map<string, { count: number; lastCapturedAt: string | null; thumbnailPath: string | null }>();

  for (const photo of photos) {
    const current = photoStats.get(photo.tree_id) ?? { count: 0, lastCapturedAt: null, thumbnailPath: null };
    const capturedAt = photo.captured_at;

    current.count += 1;
    if (!current.lastCapturedAt || new Date(capturedAt).valueOf() > new Date(current.lastCapturedAt).valueOf()) {
      current.lastCapturedAt = capturedAt;
      current.thumbnailPath = photo.storage_path;
    }

    photoStats.set(photo.tree_id, current);
  }

  const styleLookup = new Map(styleCatalog.map((entry) => [entry.id, entry]));

  return [...trees]
    .sort((left, right) => new Date(right.created_at).valueOf() - new Date(left.created_at).valueOf())
    .map((tree) => {
      const species = resolveDbTreeSpecies(tree, speciesCatalog);
      const style = styleLookup.get(tree.style_id);

      if (!style) {
        throw new Error("Tree catalog references are out of sync.");
      }

      const stats = photoStats.get(tree.id) ?? { count: 0, lastCapturedAt: null, thumbnailPath: null };

      return {
        id: tree.id,
        inventoryName: tree.inventory_name,
        speciesId: species.speciesId,
        speciesName: species.speciesName,
        speciesSubtitle: species.speciesSubtitle,
        styleId: tree.style_id,
        styleName: style.label,
        createdAt: tree.created_at,
        photoCount: stats.count,
        lastCapturedAt: stats.lastCapturedAt,
        thumbnailUrl: stats.thumbnailPath ? createPhotoUrl(stats.thumbnailPath) : null,
      };
    });
}

export async function getTreeDetail(_: unknown = null, __: string | undefined = undefined, treeId: string): Promise<TreeDetail | null> {
  const { speciesCatalog } = await getCatalogs();
  const [treeRecord, photos] = await Promise.all([getCollectionTreeFromDb(treeId), listPhotosForTreeFromDb(treeId)]);

  if (!treeRecord) {
    return null;
  }

  const species = resolveDbTreeSpecies(treeRecord, speciesCatalog);
  const treeSummary = (await getTreeSummaries()).find((tree) => tree.id === treeId);

  if (!treeSummary) {
    return null;
  }

  const timelinePhotos = photos
    .sort((left, right) => {
      const capturedAtDelta = new Date(left.captured_at).valueOf() - new Date(right.captured_at).valueOf();

      if (capturedAtDelta !== 0) {
        return capturedAtDelta;
      }

      if (left.is_reference !== right.is_reference) {
        return left.is_reference ? -1 : 1;
      }

      return left.id.localeCompare(right.id);
    })
    .map((photo) => ({
      id: photo.id,
      capturedAt: photo.captured_at,
      source: photo.source,
      notes: photo.notes,
      isReference: photo.is_reference,
      kind: "front" as const,
      imageUrl: createPhotoUrl(photo.storage_path),
    }));

  return {
    ...treeSummary,
    photos: timelinePhotos,
    speciesCareProfile: species.careProfile,
    developmentPlan: readTrimmedText(treeRecord.development_plan),
  };
}

export async function getCaptureReviewData(
  _: unknown = null,
  __: string | undefined = undefined,
  submissionId: string,
): Promise<CaptureReviewData | null> {
  const store = await readStore();
  const submission = store.captureSubmissions.find((entry) => entry.id === submissionId);

  if (!submission) {
    return null;
  }

  const { speciesCatalog, styleCatalog } = await getCatalogs();
  const photoLookup = new Map(store.photos.map((photo) => [photo.id, photo]));
  const candidateMatches = submission.candidateMatches.map((match) => {
    const referencePhoto = photoLookup.get(match.photoId);

    if (!referencePhoto) {
      throw new Error("Capture candidate reference photo is missing.");
    }

    return {
      ...match,
      referenceCapturedAt: referencePhoto.capturedAt,
      referencePhotoUrl: createPhotoUrl(referencePhoto.storagePath),
    };
  });

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
    hostedFallbackRecommended: submission.hostedFallbackRecommended ?? false,
    fallbackReason: submission.fallbackReason ?? null,
  };
}

export async function getRecognitionCandidates(_: unknown = null, __?: string): Promise<RecognitionCandidate[]> {
  const trees = await getTreeSummaries();

  if (trees.length === 0) {
    return [];
  }

  const photos = await listCollectionPhotosFromDb();
  const treeLookup = new Map(trees.map((tree) => [tree.id, tree]));
  const candidates: RecognitionCandidate[] = [];

  for (const photo of photos.filter((entry) => entry.is_reference && entry.embedding)) {
    const tree = treeLookup.get(photo.tree_id);
    const embedding = parseEmbedding(photo.embedding);

    if (!tree || !embedding) {
      continue;
    }

    candidates.push({
      treeId: tree.id,
      photoId: photo.id,
      inventoryName: tree.inventoryName,
      speciesId: tree.speciesId,
      speciesName: tree.speciesName,
      styleId: tree.styleId,
      styleName: tree.styleName,
      embedding,
      embeddingModel: photo.embedding_model ?? LEGACY_IDENTITY_EMBEDDING_MODEL,
    });
  }

  return candidates;
}

export async function createLocalCaptureSubmission(input: CreateCaptureSubmissionInput): Promise<{ id: string }> {
  const viewer = await getRequiredViewer();
  const submissionId = crypto.randomUUID();
  const frontStoragePath = `captures/${submissionId}-front.${input.frontExtension}`;
  const frontFilePath = await getAbsolutePhotoPath(frontStoragePath, viewer);
  const frontBuffer = Buffer.from(await input.frontPhoto.arrayBuffer());
  const frontRecognitionFile = new File([frontBuffer], "front-capture", { type: input.frontPhoto.type });
  const leafStoragePath = input.leafPhoto && input.leafExtension ? `captures/${submissionId}-leaf.${input.leafExtension}` : null;
  const leafFilePath = leafStoragePath ? await getAbsolutePhotoPath(leafStoragePath, viewer) : null;
  const leafBuffer = input.leafPhoto ? Buffer.from(await input.leafPhoto.arrayBuffer()) : null;
  const leafRecognitionFile = input.leafPhoto && leafBuffer ? new File([leafBuffer], "leaf-capture", { type: input.leafPhoto.type }) : null;

  await ensureDirectories(viewer);
  await writeFile(frontFilePath, frontBuffer);
  if (leafFilePath && leafBuffer) {
    await writeFile(leafFilePath, leafBuffer);
  }

  try {
    const shouldResolveExistingTree = input.captureIntent === "existing-tree" && input.treeResolutionMode === "automatic";
    const shouldPredictStyle = input.captureIntent === "new-tree" && input.styleSelectionMode === "automatic";
    const shouldPredictLeafSpecies = input.captureIntent === "new-tree" && !input.winterMode && leafRecognitionFile !== null;
    const candidates = shouldResolveExistingTree
      ? await getRecognitionCandidates()
      : [];
    const [frontRecognition, leafRecognition] = await Promise.all([
      recognizeCapture(frontRecognitionFile, candidates, {
        includeIdentityMatches: shouldResolveExistingTree,
        includeStylePredictions: shouldPredictStyle,
      }),
      shouldPredictLeafSpecies
        ? recognizeLeafSpecies(leafRecognitionFile)
        : Promise.resolve(null),
    ]);

    const candidateMatches = shouldResolveExistingTree
      ? frontRecognition.candidateMatches
      : [];
    const matchedTreeId = shouldResolveExistingTree
      ? frontRecognition.matchedTreeId
      : null;
    const matchScore = shouldResolveExistingTree
      ? frontRecognition.matchScore
      : null;
    const stylePredictions = shouldPredictStyle
      ? frontRecognition.stylePredictions
      : [];
    const speciesPredictions = input.captureIntent === "new-tree"
      ? (input.speciesSelectionMode === "automatic" ? (leafRecognition?.speciesPredictions ?? []) : [])
      : [];
    const speciesPredictionSource = input.captureIntent === "new-tree"
      ? (input.winterMode ? "manual-winter" : "leaf-reference")
      : null;
    const leafReferenceCount = input.captureIntent === "new-tree" && input.speciesSelectionMode === "automatic"
      ? (leafRecognition?.referenceCount ?? null)
      : null;
    const hostedFallbackRecommended = shouldResolveExistingTree
      ? frontRecognition.hostedFallbackRecommended
      : false;
    const fallbackReason = shouldResolveExistingTree
      ? frontRecognition.fallbackReason
      : null;

    await withStoreLock(async () => {
      const store = await readStore(viewer);
      store.captureSubmissions.push({
        id: submissionId,
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
        matchedTreeId,
        matchScore,
        candidateMatches,
        speciesPredictions,
        speciesPredictionSource,
        leafReferenceCount,
        stylePredictions,
        finalizedTreeId: null,
        finalizedPhotoId: null,
        embedding: frontRecognition.embedding,
        embeddingModel: frontRecognition.embeddingModel,
        hostedFallbackRecommended,
        fallbackReason,
      });
      await writeStore(store, viewer);
    });

    return { id: submissionId };
  } catch (error) {
    await unlink(frontFilePath).catch(() => undefined);
    if (leafFilePath) {
      await unlink(leafFilePath).catch(() => undefined);
    }
    throw error;
  }
}

export async function finalizeCaptureAsExisting(submissionId: string, treeId: string): Promise<string> {
  const viewer = await getRequiredViewer();
  return withStoreLock(async () => {
    const store = await readStore(viewer);
    const submission = store.captureSubmissions.find((entry) => entry.id === submissionId);
    const tree = await getCollectionTreeFromDb(treeId);

    if (!submission) {
      throw new Error("Capture submission not found.");
    }

    if (!tree) {
      throw new Error("Tree not found.");
    }

    if (submission.captureIntent !== "existing-tree") {
      throw new Error("This capture was started as a new-tree flow.");
    }

    if (submission.status !== "pending") {
      throw new Error("Capture submission has already been finalized.");
    }

    const supabase = await createSupabaseServerClient();
    const { count, error: countError } = await supabase
      .from("photos")
      .select("id", { count: "exact", head: true })
      .eq("tree_id", tree.id);

    if (countError) {
      throw new Error(countError.message);
    }

    const photoId = crypto.randomUUID();
    const hasExistingPhoto = (count ?? 0) > 0;
    const { error: photoError } = await supabase
      .from("photos")
      .insert({
        id: photoId,
        tree_id: tree.id,
        capture_submission_id: submission.id,
        storage_path: submission.frontStoragePath,
        captured_at: submission.capturedAt,
        source: submission.source,
        notes: submission.notes,
        is_reference: !hasExistingPhoto,
        embedding: serializeEmbeddingForVector(submission.embedding),
      });

    if (photoError) {
      throw new Error(photoError.message);
    }

    await insertConfirmedSubmissionInDb({
      viewer,
      submission,
      finalizedTreeId: tree.id,
    });
    await updateConfirmedSubmissionPhotoInDb(submission.id, photoId);

    submission.status = "confirmed";
    submission.finalizedTreeId = tree.id;
    submission.finalizedPhotoId = photoId;

    await writeStore(store, viewer);
    return tree.id;
  });
}

export async function finalizeCaptureAsNewTree(
  submissionId: string,
  speciesSelection: NewTreeSpeciesSelection,
  styleId: number,
  inventoryName: string,
): Promise<string> {
  const viewer = await getRequiredViewer();
  return withStoreLock(async () => {
    const store = await readStore(viewer);
    const submission = store.captureSubmissions.find((entry) => entry.id === submissionId);
    const { speciesCatalog } = await getCatalogs();
    const style = STYLE_CATALOG.find((entry) => entry.id === styleId);
    const trimmedInventoryName = inventoryName.trim();
    let resolvedSpeciesId: number | null = null;

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

    if (speciesSelection.kind === "catalog") {
      const species = resolveCatalogSpeciesEntry(speciesCatalog, speciesSelection.speciesId);

      if (!species) {
        throw new Error("Species not found.");
      }

      resolvedSpeciesId = species.id;
    } else {
      throw new Error("Custom species is not supported in the Supabase-backed collection yet.");
    }

    if (resolvedSpeciesId === null) {
      throw new Error("Species not found.");
    }

    const supabase = await createSupabaseServerClient();
    const { count, error: countError } = await supabase
      .from("trees")
      .select("id", { count: "exact", head: true })
      .eq("species_id", resolvedSpeciesId)
      .eq("style_id", styleId);

    if (countError) {
      throw new Error(countError.message);
    }

    const sequenceNumber = (count ?? 0) + 1;
    const treeId = crypto.randomUUID();
    const photoId = crypto.randomUUID();

    const { error: treeError } = await supabase
      .from("trees")
      .insert({
        id: treeId,
        owner_id: viewer.id,
        species_id: resolvedSpeciesId,
        style_id: styleId,
        sequence_number: sequenceNumber,
        inventory_name: trimmedInventoryName,
        created_at: submission.capturedAt,
        development_plan: null,
      });

    if (treeError) {
      throw new Error(treeError.message);
    }

    await insertConfirmedSubmissionInDb({
      viewer,
      submission,
      finalizedTreeId: treeId,
    });

    const { error: photoError } = await supabase
      .from("photos")
      .insert({
        id: photoId,
        tree_id: treeId,
        capture_submission_id: submission.id,
        storage_path: submission.frontStoragePath,
        captured_at: submission.capturedAt,
        source: submission.source,
        notes: submission.notes,
        is_reference: true,
        embedding: serializeEmbeddingForVector(submission.embedding),
      });

    if (photoError) {
      throw new Error(photoError.message);
    }

    await updateConfirmedSubmissionPhotoInDb(submission.id, photoId);

    submission.status = "confirmed";
    submission.finalizedTreeId = treeId;
    submission.finalizedPhotoId = photoId;

    await writeStore(store, viewer);
    return treeId;
  });
}

export async function updateTreeDevelopmentPlan(treeId: string, developmentPlan: string | null): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("trees")
    .update({ development_plan: readTrimmedText(developmentPlan) })
    .eq("id", treeId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteTree(treeId: string): Promise<void> {
  const viewer = await getRequiredViewer();
  const supabase = await createSupabaseServerClient();
  const { data: photoRows, error: photoError } = await supabase
    .from("photos")
    .select("storage_path, capture_submission_id")
    .eq("tree_id", treeId);

  if (photoError) {
    throw new Error(photoError.message);
  }

  const submissionIds = [...new Set((photoRows ?? []).map((row) => row.capture_submission_id).filter((entry): entry is string => typeof entry === "string"))];
  const storagePaths = [...new Set((photoRows ?? []).map((row) => row.storage_path).filter((entry): entry is string => typeof entry === "string"))];

  if (submissionIds.length > 0) {
    const { error: submissionError } = await supabase
      .from("capture_submissions")
      .delete()
      .in("id", submissionIds);

    if (submissionError) {
      throw new Error(submissionError.message);
    }
  }

  const { error: treeError } = await supabase
    .from("trees")
    .delete()
    .eq("id", treeId);

  if (treeError) {
    throw new Error(treeError.message);
  }

  await Promise.all(storagePaths.map(async (storagePath) => {
    const userScopedPath = await getAbsolutePhotoPath(storagePath, viewer);
    await unlink(userScopedPath).catch(async () => {
      const legacyPath = path.join(getDataDirectory(), "uploads", ...storagePath.split("/"));
      await unlink(legacyPath).catch(() => undefined);
    });
  }));
}

type RecognitionRequestOptions = {
  includeIdentityMatches?: boolean;
  includeStylePredictions?: boolean;
};

export async function recognizeCapture(
  photo: File,
  candidates: RecognitionCandidate[],
  options: RecognitionRequestOptions = {},
): Promise<VisionRecognitionResult> {
  const includeIdentityMatches = options.includeIdentityMatches ?? false;
  const includeStylePredictions = options.includeStylePredictions ?? false;
  const formData = new FormData();
  formData.set("image", photo);
  formData.set("candidates", JSON.stringify(candidates.map(serializeRecognitionCandidate)));
  formData.set("include_identity_matches", String(includeIdentityMatches));
  formData.set("include_style_predictions", String(includeStylePredictions));

  const response = await fetch(`${getVisionServiceUrl()}/recognize`, {
    method: "POST",
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readServiceErrorMessage(response, "Vision service request failed."));
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const embedding = parseEmbedding(payload.embedding);

  if (!embedding) {
    throw new Error("Vision service did not return a valid embedding.");
  }

  return {
    embedding,
    embeddingModel: readOptionalString(payload.embedding_model) ?? LEGACY_IDENTITY_EMBEDDING_MODEL,
    candidateMatches: normalizeCandidateMatches(payload.candidate_matches, candidates),
    matchedTreeId: readOptionalString(payload.matched_tree_id),
    matchScore: readOptionalNumber(payload.match_score),
    speciesPredictions: normalizePredictions(payload.species_predictions, SPECIES_CATALOG),
    stylePredictions: normalizePredictions(payload.style_predictions, STYLE_CATALOG),
    hostedFallbackRecommended: readOptionalBoolean(payload.hosted_fallback_recommended) ?? false,
    fallbackReason: readOptionalString(payload.fallback_reason),
  };
}

export async function recognizeLeafSpecies(photo: File): Promise<LeafRecognitionResult> {
  const formData = new FormData();
  formData.set("image", photo);

  const response = await fetch(`${getVisionServiceUrl()}/recognize-leaf`, {
    method: "POST",
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readServiceErrorMessage(response, "Leaf recognition request failed."));
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return {
    embeddingModel: readOptionalString(payload.embedding_model) ?? "dinov2-base-pooler",
    speciesPredictions: normalizePredictions(payload.species_predictions, SPECIES_CATALOG),
    referenceCount: readOptionalInteger(payload.reference_count) ?? 0,
  };
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

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;

      if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "number")) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function readServiceErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const responseText = await response.text();

  if (!responseText) {
    return fallbackMessage;
  }

  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const detail = payload.detail;
    const message = payload.message;

    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }

    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  } catch {
    return responseText;
  }

  return responseText;
}

function serializeRecognitionCandidate(candidate: RecognitionCandidate): RecognitionCandidatePayload {
  return {
    treeId: candidate.treeId,
    photoId: candidate.photoId,
    embedding: candidate.embedding,
    embeddingModel: candidate.embeddingModel,
  };
}

function normalizeCandidateMatches(value: unknown, candidates: RecognitionCandidate[]): CandidateMatch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidateLookup = new Map(candidates.map((candidate) => [`${candidate.treeId}:${candidate.photoId}`, candidate]));

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const treeId = readOptionalString(record.treeId ?? record.tree_id);
      const photoId = readOptionalString(record.photoId ?? record.photo_id);
      const score = readOptionalNumber(record.score);
      const candidate = treeId && photoId ? candidateLookup.get(`${treeId}:${photoId}`) : null;

      if (!treeId || !photoId || !candidate || score === null) {
        return null;
      }

      return {
        treeId,
        photoId,
        inventoryName: candidate.inventoryName,
        speciesId: candidate.speciesId,
        speciesName: candidate.speciesName,
        styleId: candidate.styleId,
        styleName: candidate.styleName,
        score,
      } satisfies CandidateMatch;
    })
    .filter((entry): entry is CandidateMatch => entry !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function normalizePredictions(value: unknown, catalog: CatalogEntry[]): Prediction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const aggregatedPredictions = new Map<string, Prediction>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const label = readOptionalString(record.label);
    const confidence = readOptionalNumber(record.confidence);

    if (!label || confidence === null) {
      continue;
    }

    const explicitId = readOptionalInteger(record.id);
    const resolvedEntry = explicitId !== null
      ? catalog.find((catalogEntry) => catalogEntry.id === explicitId) ?? resolveCatalogPredictionEntry(label, catalog)
      : resolveCatalogPredictionEntry(label, catalog);
    const normalizedPrediction = {
      id: resolvedEntry?.id ?? explicitId ?? null,
      label: resolvedEntry?.label ?? label,
      subtitle: resolvedEntry?.subtitle ?? null,
      confidence,
    } satisfies Prediction;
    const predictionKey = resolvedEntry
      ? `catalog:${resolvedEntry.id}`
      : `label:${normalizeLookupKey(normalizedPrediction.label)}`;
    const existingPrediction = aggregatedPredictions.get(predictionKey);

    if (existingPrediction) {
      existingPrediction.confidence += normalizedPrediction.confidence;
      if (!existingPrediction.subtitle && normalizedPrediction.subtitle) {
        existingPrediction.subtitle = normalizedPrediction.subtitle;
      }
      continue;
    }

    aggregatedPredictions.set(predictionKey, normalizedPrediction);
  }

  const predictions = [...aggregatedPredictions.values()];
  const totalConfidence = predictions.reduce((sum, prediction) => sum + prediction.confidence, 0);

  return predictions
    .map((prediction) => ({
      ...prediction,
      confidence: totalConfidence > 0 ? prediction.confidence / totalConfidence : 0,
    }))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 3);
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function readOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function readOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function resolveCatalogPredictionEntry(label: string, catalog: CatalogEntry[]) {
  const normalizedLabel = normalizeLookupKey(label);

  for (const entry of catalog) {
    if (buildCatalogLookupKeys(entry).includes(normalizedLabel)) {
      return entry;
    }
  }

  return null;
}

function buildCatalogLookupKeys(entry: Pick<CatalogEntry, "label" | "subtitle" | "aliases">) {
  return [...new Set([entry.label, entry.subtitle ?? "", ...(entry.aliases ?? [])]
    .map((value) => normalizeLookupKey(value))
    .filter((value) => value.length > 0))];
}

function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase();
}

function createPhotoUrl(storagePath: string) {
  return `/api/photos/${storagePath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function getRepoRoot() {
  return path.resolve(process.cwd(), "../..");
}

function buildSpeciesCatalog(): CatalogEntry[] {
  const catalogPath = path.join(getRepoRoot(), "services", "vision", "catalog", "bonsai_reference_catalog.json");
  const rawCatalog = JSON.parse(readFileSync(catalogPath, "utf8")) as Array<{ species_label: string }>;
  const programEntries = readSpeciesProgram();
  const manualEntries = readManualSpeciesCatalog();
  const coreProgramEntries = programEntries.filter((entry) => entry.catalogTier !== "extended");
  const extendedProgramEntries = programEntries.filter((entry) => entry.catalogTier === "extended");
  const knownLabels = new Set(programEntries.flatMap((entry) => buildCatalogLookupKeys(entry)));
  const catalogEntries = [...coreProgramEntries];
  let nextId = getNextCatalogId(programEntries);

  nextId = appendCatalogEntries(catalogEntries, manualEntries, knownLabels, nextId);

  for (const speciesLabel of [...new Set(rawCatalog.map((entry) => entry.species_label))].sort((left, right) => left.localeCompare(right))) {
    if (knownLabels.has(normalizeLookupKey(speciesLabel))) {
      continue;
    }

    const generatedEntry: CatalogEntry = {
      id: nextId,
      slug: slugify(speciesLabel),
      label: speciesLabel,
      subtitle: null,
      aliases: [speciesLabel],
      careProfileSlug: slugify(speciesLabel),
      taxonRank: "group",
      catalogTier: "core",
      recognitionEnabled: true,
    };
    catalogEntries.push(generatedEntry);
    for (const lookupKey of buildCatalogLookupKeys(generatedEntry)) {
      knownLabels.add(lookupKey);
    }
    nextId += 1;
  }

  return [...catalogEntries, ...extendedProgramEntries];
}

function appendCatalogEntries(entries: CatalogEntry[], pendingEntries: CatalogEntryInput[], knownLabels: Set<string>, nextId: number) {
  for (const pendingEntry of pendingEntries) {
    const lookupKeys = buildCatalogLookupKeys(pendingEntry);

    if (lookupKeys.some((lookupKey) => knownLabels.has(lookupKey))) {
      continue;
    }

    entries.push({
      id: nextId,
      ...pendingEntry,
    });

    for (const lookupKey of lookupKeys) {
      knownLabels.add(lookupKey);
    }

    nextId += 1;
  }

  return nextId;
}

function readSpeciesProgram(): CatalogEntry[] {
  const speciesProgramPath = path.join(getRepoRoot(), "services", "vision", "catalog", "species_program.json");

  try {
    const rawProgram = JSON.parse(readFileSync(speciesProgramPath, "utf8")) as unknown;

    if (!Array.isArray(rawProgram)) {
      return LEGACY_SPECIES_CATALOG;
    }

    return rawProgram
      .map((entry) => normalizeCatalogEntry(entry))
      .filter((entry): entry is CatalogEntry => entry !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return LEGACY_SPECIES_CATALOG;
    }

    throw error;
  }
}

function readManualSpeciesCatalog(): CatalogEntryInput[] {
  const manualCatalogDirectory = path.join(getRepoRoot(), "services", "vision", "catalog");
  const manualCatalogFileNames = ["manual_species_catalog.json", "manual_species_extended_catalog.json"];

  return manualCatalogFileNames.flatMap((fileName) => readManualSpeciesCatalogFile(path.join(manualCatalogDirectory, fileName)));
}

function readManualSpeciesCatalogFile(manualSpeciesCatalogPath: string): CatalogEntryInput[] {

  try {
    const rawManualCatalog = JSON.parse(readFileSync(manualSpeciesCatalogPath, "utf8")) as unknown;

    if (!Array.isArray(rawManualCatalog)) {
      return [];
    }

    return rawManualCatalog
      .map((entry) => normalizeManualCatalogEntry(entry))
      .filter((entry): entry is CatalogEntryInput => entry !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function normalizeCatalogEntry(value: unknown): CatalogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = readOptionalInteger(record.id);
  const slug = readOptionalString(record.slug);
  const label = readOptionalString(record.label);
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

  if (id === null || !slug || !label) {
    return null;
  }

  const careProfileSlug = readOptionalString(record.careProfileSlug) ?? slug;

  return {
    id,
    slug,
    label,
    subtitle: readOptionalString(record.subtitle),
    aliases,
    careProfileSlug,
    taxonRank: readCatalogTaxonRank(record.taxonRank),
    catalogTier: readCatalogTier(record.catalogTier),
    recognitionEnabled: readOptionalBoolean(record.recognitionEnabled) ?? true,
  };
}

function normalizeManualCatalogEntry(value: unknown): CatalogEntryInput | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const slug = readOptionalString(record.slug);
  const label = readOptionalString(record.label);
  const aliases = Array.isArray(record.aliases)
    ? record.aliases.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;

  if (!slug || !label) {
    return null;
  }

  const careProfileSlug = readOptionalString(record.careProfileSlug) ?? slug;

  return {
    slug,
    label,
    subtitle: readOptionalString(record.subtitle),
    aliases,
    careProfileSlug,
    taxonRank: readCatalogTaxonRank(record.taxonRank) ?? "species",
    catalogTier: readCatalogTier(record.catalogTier) ?? "extended",
    recognitionEnabled: readOptionalBoolean(record.recognitionEnabled) ?? false,
  };
}

function readCatalogTaxonRank(value: unknown): CatalogTaxonRank | null {
  if (value === "species" || value === "genus" || value === "group") {
    return value;
  }

  return null;
}

function readCatalogTier(value: unknown): CatalogTier | null {
  if (value === "core" || value === "extended") {
    return value;
  }

  return null;
}

function getNextCatalogId(entries: CatalogEntry[]) {
  return entries.reduce((highestId, entry) => Math.max(highestId, entry.id), 0) + 1;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getDataDirectory() {
  return path.join(getRepoRoot(), "data");
}

function getUserDataDirectory(viewer: Pick<AuthenticatedViewer, "id">) {
  return path.join(getDataDirectory(), "users", viewer.id);
}

function getUploadsDirectory(viewer: Pick<AuthenticatedViewer, "id">) {
  return path.join(getUserDataDirectory(viewer), "uploads");
}

function getStorePath(viewer: Pick<AuthenticatedViewer, "id">) {
  return path.join(getUserDataDirectory(viewer), "bonsai-store.json");
}

async function getAbsolutePhotoPath(storagePath: string, viewer?: Pick<AuthenticatedViewer, "id">) {
  const resolvedViewer = viewer ?? await getRequiredViewer();
  return path.join(getUploadsDirectory(resolvedViewer), ...storagePath.split("/"));
}

async function ensureDirectories(viewer?: Pick<AuthenticatedViewer, "id">) {
  const resolvedViewer = viewer ?? await getRequiredViewer();
  await mkdir(getDataDirectory(), { recursive: true });
  await mkdir(getUserDataDirectory(resolvedViewer), { recursive: true });
  await mkdir(getUploadsDirectory(resolvedViewer), { recursive: true });
  await mkdir(path.join(getUploadsDirectory(resolvedViewer), "captures"), { recursive: true });
}

async function readStore(viewer?: Pick<AuthenticatedViewer, "id">): Promise<DemoStore> {
  const resolvedViewer = viewer ?? await getRequiredViewer();
  await ensureDirectories(resolvedViewer);

  try {
    const raw = await readFile(getStorePath(resolvedViewer), "utf8");
    const parsed = JSON.parse(raw) as Partial<DemoStore>;

    return {
      trees: Array.isArray(parsed.trees) ? parsed.trees as StoredTree[] : [],
      photos: Array.isArray(parsed.photos) ? parsed.photos as StoredPhoto[] : [],
      captureSubmissions: Array.isArray(parsed.captureSubmissions) ? parsed.captureSubmissions as StoredCaptureSubmission[] : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const initialStore: DemoStore = {
        trees: [],
        photos: [],
        captureSubmissions: [],
      };

      await writeStore(initialStore, resolvedViewer);
      return initialStore;
    }

    throw error;
  }
}

async function writeStore(store: DemoStore, viewer?: Pick<AuthenticatedViewer, "id">) {
  const resolvedViewer = viewer ?? await getRequiredViewer();
  await ensureDirectories(resolvedViewer);
  const tempPath = `${getStorePath(resolvedViewer)}.tmp`;
  await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tempPath, getStorePath(resolvedViewer));
}

function withStoreLock<T>(callback: () => Promise<T>) {
  const operation = storeWriteQueue.then(callback, callback);
  storeWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
