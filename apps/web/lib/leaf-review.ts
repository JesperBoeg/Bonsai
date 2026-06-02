import { execFile } from "node:child_process";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LEAF_REVIEW_REFRESH_TIMEOUT_MS = 120_000;
let leafReviewMutationQueue: Promise<void> = Promise.resolve();

function enqueueLeafReviewMutation<T>(operation: () => Promise<T>) {
  const run = leafReviewMutationQueue.then(operation, operation);
  leafReviewMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

type CatalogTier = "core" | "extended";

type SpeciesProgramEntry = {
  slug: string;
  label: string;
  subtitle: string | null;
  catalogTier: CatalogTier | null;
  recognitionEnabled: boolean;
};

type SourceManifestPhoto = {
  photoId?: number | string;
  mediaId?: number | string;
  observationId?: number | string;
  occurrenceId?: number | string;
  imageUrl?: string;
  photoUrl?: string;
  observationUrl?: string;
  occurrenceUrl?: string;
  attribution?: string;
  licenseCode?: string;
  photoLicenseCode?: string;
};

type SourceManifestEntry = {
  slug: string;
  candidatePhotos?: SourceManifestPhoto[];
};

type SourceOverrideEntry = {
  sourceName: string;
  slug: string;
  externalId: string;
  reason?: string;
};

type ManualCropOverrideEntry = SourceOverrideEntry & {
  cropBox: number[];
};

type SpeciesNoteOverrideEntry = {
  slug: string;
  note: string;
  updatedAt?: string;
};

type SourceOverridesFile = {
  notes: string[];
  speciesNotes: SpeciesNoteOverrideEntry[];
  excludedSourceImages: SourceOverrideEntry[];
  manualCropBoxes: ManualCropOverrideEntry[];
};

type ReviewOverridesFile = {
  approved: string[];
  rejected: string[];
};

type LeafCandidateEntry = {
  id: string;
  slug: string;
  sourceName: string;
  remoteUrl?: string;
  localPath?: string;
  sourceAssetId?: string;
  sourceImagePath?: string;
  cropBox?: number[];
  cropScore?: number;
  reviewStatus?: string;
  reviewReasons?: string[];
  manualCropApplied?: boolean;
};

type LeafRuntimeEntry = {
  id: string;
  slug: string;
};

export type LeafCropBox = [number, number, number, number];

export type LeafReviewSpeciesSummary = {
  slug: string;
  label: string;
  subtitle: string | null;
  sourcePhotoCount: number;
  candidateCount: number;
  runtimeCount: number;
  pendingCount: number;
  excludedCount: number;
  manualCropCount: number;
};

export type LeafReviewSourceEntry = {
  sourceAssetId: string;
  sourceName: string;
  slug: string;
  label: string;
  subtitle: string | null;
  externalId: string;
  sourceImageUrl: string;
  sourceImagePath: string | null;
  remoteUrl: string | null;
  recordUrl: string | null;
  attribution: string | null;
  licenseCode: string | null;
  excluded: boolean;
  manualCropBox: LeafCropBox | null;
  candidateId: string | null;
  candidatePatchUrl: string | null;
  candidateCropBox: LeafCropBox | null;
  currentCropBox: LeafCropBox | null;
  currentCropBoxSource: "manual" | "auto" | null;
  pending: boolean;
  approved: boolean;
  rejected: boolean;
  manualCropApplied: boolean;
  reviewReasons: string[];
  cropScore: number | null;
};

export type LeafReviewPageData = {
  selectedSlug: string | null;
  selectedSpeciesNote: string;
  species: LeafReviewSpeciesSummary[];
  selectedSpecies: LeafReviewSpeciesSummary | null;
  sourceEntries: LeafReviewSourceEntry[];
  statusMessage: string | null;
};

export type LeafReviewDecisionInput = {
  action: "reject-source" | "accept-crop";
  slug: string;
  sourceName: string;
  externalId: string;
  cropBox?: LeafCropBox;
};

export type LeafReviewSpeciesNoteInput = {
  slug: string;
  note: string;
};

type SourceRankingEntry = {
  source: string;
};

const SOURCE_OVERRIDE_NOTES = [
  "Use excludedSourceImages to blacklist bad source photos before patch generation.",
  "Use manualCropBoxes to force a source-image crop when the auto-crop misses the usable leaf area.",
  "cropBox uses source-image pixel coordinates in the form [left, top, right, bottom].",
];

export async function getLeafReviewData(requestedSlug?: string | null, statusMessage: string | null = null): Promise<LeafReviewPageData> {
  const [speciesProgram, sourceRanking, sourceManifests, sourceOverrides, reviewOverrides, candidateEntries, runtimeEntries] = await Promise.all([
    readSpeciesProgram(),
    readSourceRanking(),
    readSourceManifests(),
    readSourceOverrides(),
    readReviewOverrides(),
    readLeafCandidateEntries(),
    readLeafRuntimeEntries(),
  ]);

  const approvedIds = new Set(reviewOverrides.approved);
  const rejectedIds = new Set(reviewOverrides.rejected);
  const runtimeIds = new Set(runtimeEntries.map((entry) => entry.id));

  const species = speciesProgram
    .map((entry) => buildSpeciesSummary(entry, sourceManifests, sourceOverrides, candidateEntries, runtimeEntries, approvedIds, rejectedIds, runtimeIds))
    .sort((left, right) => {
      if (right.pendingCount !== left.pendingCount) {
        return right.pendingCount - left.pendingCount;
      }
      if (right.excludedCount !== left.excludedCount) {
        return right.excludedCount - left.excludedCount;
      }
      return left.label.localeCompare(right.label);
    });

  const selectedSpecies = selectLeafReviewSpecies(species, requestedSlug);
  if (!selectedSpecies) {
    return {
      selectedSlug: null,
      selectedSpeciesNote: "",
      species,
      selectedSpecies: null,
      sourceEntries: [],
      statusMessage,
    };
  }

  const selectedSourceEntries = await buildLeafReviewSourceEntries({
    selectedSpecies,
    sourceRanking,
    sourceManifests,
    sourceOverrides,
    candidateEntries,
    approvedIds,
    rejectedIds,
    runtimeIds,
  });

  return {
    selectedSlug: selectedSpecies.slug,
    selectedSpeciesNote: sourceOverrides.speciesNotes.find((entry) => entry.slug === selectedSpecies.slug)?.note ?? "",
    species,
    selectedSpecies,
    sourceEntries: selectedSourceEntries,
    statusMessage,
  };
}

export async function applyLeafReviewDecision(input: LeafReviewDecisionInput) {
  return enqueueLeafReviewMutation(async () => {
    const sourceName = input.sourceName.trim();
    const slug = input.slug.trim();
    const externalId = input.externalId.trim();
    const sourceAssetId = buildSourceAssetId(sourceName, slug, externalId);

    if (sourceName.length === 0 || slug.length === 0 || externalId.length === 0) {
      throw new Error("Source selection is incomplete.");
    }

    if (input.action === "accept-crop") {
      const cropBox = normalizeCropBox(input.cropBox);
      if (!cropBox) {
        throw new Error("Draw a crop box before accepting the source image.");
      }
    }

    const [sourceManifests, sourceOverrides, reviewOverrides] = await Promise.all([
      readSourceManifests(),
      readSourceOverrides(),
      readReviewOverrides(),
    ]);

    assertLeafReviewSourceExists(sourceManifests, sourceName, slug, externalId);

    const nextSourceOverrides = updateSourceOverrides(sourceOverrides, input);
    const nextReviewOverrides = updateReviewOverrides(reviewOverrides, input, sourceAssetId);

    await Promise.all([
      writeJsonAtomic(getSourceOverridesPath(), nextSourceOverrides),
      writeJsonAtomic(getReviewOverridesPath(), nextReviewOverrides),
    ]);

    const refreshSummary = await refreshLeafReviewSlug(slug);
    return {
      sourceAssetId,
      refreshSummary,
    };
  });
}

export async function saveLeafReviewSpeciesNote(input: LeafReviewSpeciesNoteInput) {
  return enqueueLeafReviewMutation(async () => {
    const slug = input.slug.trim();
    if (slug.length === 0) {
      throw new Error("Species selection is incomplete.");
    }

    const [speciesProgram, sourceOverrides] = await Promise.all([
      readSpeciesProgram(),
      readSourceOverrides(),
    ]);

    if (!speciesProgram.some((entry) => entry.slug === slug)) {
      throw new Error("The selected species is not available in the leaf review tool.");
    }

    const note = input.note.trim();
    const nextSourceOverrides = updateSpeciesNotes(sourceOverrides, slug, note);
    await writeJsonAtomic(getSourceOverridesPath(), nextSourceOverrides);
    return {
      slug,
      note,
    };
  });
}

export function resolveLeafReviewAssetPathFromSegments(segments: string[]) {
  if (segments.length < 2) {
    return null;
  }

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes("\\"))) {
    return null;
  }

  const [kind, ...rest] = segments;
  const basePath = kind === "source"
    ? getCatalogSourceImageDirectory()
    : kind === "patch"
      ? getCatalogLeafPatchDirectory()
      : null;
  if (!basePath) {
    return null;
  }

  const resolvedPath = path.join(basePath, ...rest);
  const relativePath = path.relative(basePath, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return resolvedPath;
}

function buildSpeciesSummary(
  entry: SpeciesProgramEntry,
  sourceManifests: Map<string, Map<string, SourceManifestEntry>>,
  sourceOverrides: SourceOverridesFile,
  candidateEntries: LeafCandidateEntry[],
  runtimeEntries: LeafRuntimeEntry[],
  approvedIds: Set<string>,
  rejectedIds: Set<string>,
  runtimeIds: Set<string>,
): LeafReviewSpeciesSummary {
  const sourcePhotoCount = countSourcePhotosForSlug(entry.slug, sourceManifests);
  const slugCandidateEntries = candidateEntries.filter((candidate) => candidate.slug === entry.slug);
  const slugRuntimeEntries = runtimeEntries.filter((runtimeEntry) => runtimeEntry.slug === entry.slug);
  const excludedSourceAssetIds = new Set(
    sourceOverrides.excludedSourceImages
      .filter((overrideEntry) => overrideEntry.slug === entry.slug)
      .map((overrideEntry) => buildSourceAssetId(overrideEntry.sourceName, overrideEntry.slug, overrideEntry.externalId)),
  );
  const pendingCount = slugCandidateEntries.filter((candidate) => {
    const candidateId = candidate.id;
    const sourceAssetId = readCandidateSourceAssetId(candidate);
    if ((sourceAssetId && excludedSourceAssetIds.has(sourceAssetId)) || runtimeIds.has(candidateId) || approvedIds.has(candidateId) || rejectedIds.has(candidateId)) {
      return false;
    }

    return (candidate.reviewStatus ?? "pending") !== "auto-approved";
  }).length;

  return {
    slug: entry.slug,
    label: entry.label,
    subtitle: entry.subtitle,
    sourcePhotoCount,
    candidateCount: slugCandidateEntries.length,
    runtimeCount: slugRuntimeEntries.length,
    pendingCount,
    excludedCount: excludedSourceAssetIds.size,
    manualCropCount: sourceOverrides.manualCropBoxes.filter((overrideEntry) => overrideEntry.slug === entry.slug).length,
  };
}

function selectLeafReviewSpecies(species: LeafReviewSpeciesSummary[], requestedSlug?: string | null) {
  if (requestedSlug) {
    const selected = species.find((entry) => entry.slug === requestedSlug);
    if (selected) {
      return selected;
    }
  }

  return species[0] ?? null;
}

async function buildLeafReviewSourceEntries({
  selectedSpecies,
  sourceRanking,
  sourceManifests,
  sourceOverrides,
  candidateEntries,
  approvedIds,
  rejectedIds,
  runtimeIds,
}: {
  selectedSpecies: LeafReviewSpeciesSummary;
  sourceRanking: SourceRankingEntry[];
  sourceManifests: Map<string, Map<string, SourceManifestEntry>>;
  sourceOverrides: SourceOverridesFile;
  candidateEntries: LeafCandidateEntry[];
  approvedIds: Set<string>;
  rejectedIds: Set<string>;
  runtimeIds: Set<string>;
}) {
  const excludedSourceAssetIds = new Set(
    sourceOverrides.excludedSourceImages
      .filter((entry) => entry.slug === selectedSpecies.slug)
      .map((entry) => buildSourceAssetId(entry.sourceName, entry.slug, entry.externalId)),
  );
  const candidateEntriesBySourceAssetId = new Map<string, LeafCandidateEntry>();
  for (const candidate of candidateEntries) {
    if (candidate.slug !== selectedSpecies.slug) {
      continue;
    }

    const sourceAssetId = readCandidateSourceAssetId(candidate);
    if (!sourceAssetId || candidateEntriesBySourceAssetId.has(sourceAssetId)) {
      continue;
    }
    candidateEntriesBySourceAssetId.set(sourceAssetId, candidate);
  }

  const sourceEntries: LeafReviewSourceEntry[] = [];
  for (const sourceRankingEntry of sourceRanking) {
    const sourceName = sourceRankingEntry.source;
    const manifestEntry = sourceManifests.get(sourceName)?.get(selectedSpecies.slug);
    if (!manifestEntry) {
      continue;
    }

    for (const candidatePhoto of manifestEntry.candidatePhotos ?? []) {
      const externalId = readCandidateExternalId(candidatePhoto);
      const remoteUrl = readCandidateImageUrl(candidatePhoto);
      if (!externalId || !remoteUrl) {
        continue;
      }

      const sourceAssetId = buildSourceAssetId(sourceName, selectedSpecies.slug, externalId);
      const manualCropEntry = sourceOverrides.manualCropBoxes.find((entry) => buildSourceAssetId(entry.sourceName, entry.slug, entry.externalId) === sourceAssetId) ?? null;
      const excluded = excludedSourceAssetIds.has(sourceAssetId);
      const candidateEntry = candidateEntriesBySourceAssetId.get(sourceAssetId) ?? null;
      const localSourceImagePath = await resolveSourceImageRelativePath(sourceName, selectedSpecies.slug, externalId, remoteUrl);
      const candidatePatchPath = typeof candidateEntry?.localPath === "string" && candidateEntry.localPath.startsWith("open_license_leaf_patches/")
        ? candidateEntry.localPath
        : null;
      const candidateId = candidateEntry?.id ?? null;
      const approved = candidateId ? runtimeIds.has(candidateId) || approvedIds.has(candidateId) : false;
      const rejected = candidateId ? rejectedIds.has(candidateId) : false;
      const pending = Boolean(candidateId && !excluded && !approved && !rejected);
      const candidateCropBox = normalizeCropBox(candidateEntry?.cropBox ?? null);
      const manualCropBox = normalizeCropBox(manualCropEntry?.cropBox ?? null);
      const currentCropBox = manualCropBox ?? candidateCropBox;
      sourceEntries.push({
        sourceAssetId,
        sourceName,
        slug: selectedSpecies.slug,
        label: selectedSpecies.label,
        subtitle: selectedSpecies.subtitle,
        externalId,
        sourceImageUrl: localSourceImagePath
          ? buildLeafReviewAssetUrl("source", localSourceImagePath.replace(/^open_license_source_images\//, ""))
          : remoteUrl,
        sourceImagePath: localSourceImagePath,
        remoteUrl,
        recordUrl: readOptionalString(candidatePhoto.observationUrl) ?? readOptionalString(candidatePhoto.occurrenceUrl),
        attribution: readOptionalString(candidatePhoto.attribution),
        licenseCode: readOptionalString(candidatePhoto.licenseCode) ?? readOptionalString(candidatePhoto.photoLicenseCode),
        excluded,
        manualCropBox,
        candidateId,
        candidatePatchUrl: candidatePatchPath ? buildLeafReviewAssetUrl("patch", candidatePatchPath.replace(/^open_license_leaf_patches\//, "")) : null,
        candidateCropBox,
        currentCropBox,
        currentCropBoxSource: manualCropBox ? "manual" : candidateCropBox ? "auto" : null,
        pending,
        approved,
        rejected,
        manualCropApplied: Boolean(candidateEntry?.manualCropApplied),
        reviewReasons: Array.isArray(candidateEntry?.reviewReasons)
          ? candidateEntry.reviewReasons.filter((reason): reason is string => typeof reason === "string")
          : [],
        cropScore: typeof candidateEntry?.cropScore === "number" ? candidateEntry.cropScore : null,
      });
    }
  }

  return sourceEntries;
}

async function resolveSourceImageRelativePath(sourceName: string, slug: string, externalId: string, remoteUrl: string) {
  const relativePath = path.posix.join(
    "open_license_source_images",
    sourceName,
    slug,
    `${sanitizeAssetId(externalId)}${determineRemoteSuffix(remoteUrl)}`,
  );

  return await fileExists(path.join(getCatalogDirectory(), relativePath)) ? relativePath : null;
}

function countSourcePhotosForSlug(slug: string, sourceManifests: Map<string, Map<string, SourceManifestEntry>>) {
  let count = 0;
  for (const manifestBySlug of sourceManifests.values()) {
    count += (manifestBySlug.get(slug)?.candidatePhotos ?? []).length;
  }
  return count;
}

async function refreshLeafReviewSlug(slug: string) {
  const pythonPath = getWorkspacePythonPath();
  const pythonWorkingDirectory = path.join(getRepoRoot(), "services", "vision");

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(
      pythonPath,
      ["-m", "scripts.refresh_open_license_leaf_slug", "--slug", slug],
      {
        cwd: pythonWorkingDirectory,
        timeout: LEAF_REVIEW_REFRESH_TIMEOUT_MS,
      },
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
      signal?: NodeJS.Signals | null;
      killed?: boolean;
    };
    const failedOutput = [commandError.stderr, commandError.stdout]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join("\n")
      .trim();

    if (commandError.killed || commandError.signal === "SIGTERM") {
      throw new Error(`Leaf review refresh timed out after ${LEAF_REVIEW_REFRESH_TIMEOUT_MS / 1000} seconds.`);
    }

    if (failedOutput) {
      throw new Error(failedOutput);
    }

    throw error;
  }

  const output = stdout.trim() || stderr.trim();
  if (!output) {
    return { slug };
  }

  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    return {
      slug,
      output,
    };
  }
}

function updateSourceOverrides(current: SourceOverridesFile, input: LeafReviewDecisionInput): SourceOverridesFile {
  const excludedSourceImages = [...current.excludedSourceImages];
  const manualCropBoxes = [...current.manualCropBoxes];
  const sourceAssetId = buildSourceAssetId(input.sourceName, input.slug, input.externalId);

  const nextExcludedSourceImages = excludedSourceImages.filter((entry) => buildSourceAssetId(entry.sourceName, entry.slug, entry.externalId) !== sourceAssetId);
  const nextManualCropBoxes = manualCropBoxes.filter((entry) => buildSourceAssetId(entry.sourceName, entry.slug, entry.externalId) !== sourceAssetId);

  if (input.action === "reject-source") {
    nextExcludedSourceImages.push({
      sourceName: input.sourceName,
      slug: input.slug,
      externalId: input.externalId,
      reason: "Rejected in the local leaf review tool.",
    });
  }

  if (input.action === "accept-crop") {
    const cropBox = normalizeCropBox(input.cropBox);
    if (!cropBox) {
      throw new Error("Draw a crop box before accepting the source image.");
    }

    nextManualCropBoxes.push({
      sourceName: input.sourceName,
      slug: input.slug,
      externalId: input.externalId,
      cropBox,
      reason: "Accepted in the local leaf review tool.",
    });
  }

  return {
    notes: [...SOURCE_OVERRIDE_NOTES],
    speciesNotes: [...current.speciesNotes].sort(compareSpeciesNoteOverrideEntry),
    excludedSourceImages: nextExcludedSourceImages.sort(compareSourceOverrideEntry),
    manualCropBoxes: nextManualCropBoxes.sort(compareManualCropOverrideEntry),
  };
}

function updateSpeciesNotes(current: SourceOverridesFile, slug: string, note: string): SourceOverridesFile {
  const speciesNotes = current.speciesNotes.filter((entry) => entry.slug !== slug);
  if (note.length > 0) {
    speciesNotes.push({
      slug,
      note,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    notes: [...SOURCE_OVERRIDE_NOTES],
    speciesNotes: speciesNotes.sort(compareSpeciesNoteOverrideEntry),
    excludedSourceImages: [...current.excludedSourceImages].sort(compareSourceOverrideEntry),
    manualCropBoxes: [...current.manualCropBoxes].sort(compareManualCropOverrideEntry),
  };
}

function updateReviewOverrides(current: ReviewOverridesFile, input: LeafReviewDecisionInput, sourceAssetId: string): ReviewOverridesFile {
  const sourcePrefix = `${sourceAssetId}:`;
  const approved = current.approved.filter((entry) => !entry.startsWith(sourcePrefix));
  const rejected = current.rejected.filter((entry) => !entry.startsWith(sourcePrefix));

  if (input.action === "accept-crop") {
    approved.push(`${sourceAssetId}:crop-01`);
  }

  return {
    approved: [...new Set(approved)].sort(),
    rejected: [...new Set(rejected)].sort(),
  };
}

function assertLeafReviewSourceExists(
  sourceManifests: Map<string, Map<string, SourceManifestEntry>>,
  sourceName: string,
  slug: string,
  externalId: string,
) {
  const manifestEntry = sourceManifests.get(sourceName)?.get(slug);
  if (!manifestEntry) {
    throw new Error("The requested source image is not present in the source manifest.");
  }

  const match = (manifestEntry.candidatePhotos ?? []).some((candidatePhoto) => readCandidateExternalId(candidatePhoto) === externalId);
  if (!match) {
    throw new Error("The requested source image is not present in the source manifest.");
  }
}

async function readSpeciesProgram() {
  const rawValue = await readJsonFile<unknown>(getSpeciesProgramPath());
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((entry) => normalizeSpeciesProgramEntry(entry))
    .filter((entry): entry is SpeciesProgramEntry => entry !== null)
    .filter((entry) => entry.recognitionEnabled && entry.catalogTier !== "extended");
}

async function readSourceRanking() {
  const rawValue = await readJsonFile<unknown>(getSourceRankingPath());
  if (!Array.isArray(rawValue)) {
    return [] as SourceRankingEntry[];
  }

  return rawValue
    .map((entry) => (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).source === "string"
      ? { source: (entry as Record<string, string>).source }
      : null))
    .filter((entry): entry is SourceRankingEntry => entry !== null);
}

async function readSourceManifests() {
  const manifests = new Map<string, Map<string, SourceManifestEntry>>();

  for (const [sourceName, manifestPath] of [["inaturalist", getInaturalistManifestPath()], ["gbif", getGbifManifestPath()]] as const) {
    const rawValue = await readJsonFile<unknown>(manifestPath, { entries: [] });
    const rawEntries = rawValue && typeof rawValue === "object" ? (rawValue as { entries?: unknown }).entries : null;
    const manifestEntries = new Map<string, SourceManifestEntry>();

    if (Array.isArray(rawEntries)) {
      for (const rawEntry of rawEntries) {
        if (!rawEntry || typeof rawEntry !== "object") {
          continue;
        }
        const record = rawEntry as Record<string, unknown>;
        const slug = readOptionalString(record.slug);
        if (!slug) {
          continue;
        }
        manifestEntries.set(slug, {
          slug,
          candidatePhotos: Array.isArray(record.candidatePhotos)
            ? record.candidatePhotos.filter((photo): photo is SourceManifestPhoto => Boolean(photo && typeof photo === "object"))
            : [],
        });
      }
    }

    manifests.set(sourceName, manifestEntries);
  }

  return manifests;
}

async function readSourceOverrides(): Promise<SourceOverridesFile> {
  const rawValue = await readJsonFile<unknown>(getSourceOverridesPath(), {
    notes: SOURCE_OVERRIDE_NOTES,
    speciesNotes: [],
    excludedSourceImages: [],
    manualCropBoxes: [],
  });
  if (!rawValue || typeof rawValue !== "object") {
    return {
      notes: [...SOURCE_OVERRIDE_NOTES],
      speciesNotes: [],
      excludedSourceImages: [],
      manualCropBoxes: [],
    } satisfies SourceOverridesFile;
  }

  const record = rawValue as Record<string, unknown>;
  const speciesNotes: SpeciesNoteOverrideEntry[] = [];
  if (Array.isArray(record.speciesNotes)) {
    for (const entry of record.speciesNotes) {
      const normalizedEntry = normalizeSpeciesNoteOverrideEntry(entry);
      if (normalizedEntry) {
        speciesNotes.push(normalizedEntry);
      }
    }
  }

  const excludedSourceImages: SourceOverrideEntry[] = [];
  if (Array.isArray(record.excludedSourceImages)) {
    for (const entry of record.excludedSourceImages) {
      const normalizedEntry = normalizeSourceOverrideEntry(entry);
      if (normalizedEntry) {
        excludedSourceImages.push(normalizedEntry);
      }
    }
  }

  const manualCropBoxes: ManualCropOverrideEntry[] = [];
  if (Array.isArray(record.manualCropBoxes)) {
    for (const entry of record.manualCropBoxes) {
      const normalizedEntry = normalizeManualCropOverrideEntry(entry);
      if (normalizedEntry) {
        manualCropBoxes.push(normalizedEntry);
      }
    }
  }

  return {
    notes: Array.isArray(record.notes) ? record.notes.filter((entry): entry is string => typeof entry === "string") : [...SOURCE_OVERRIDE_NOTES],
    speciesNotes,
    excludedSourceImages,
    manualCropBoxes,
  };
}

async function readReviewOverrides() {
  const rawValue = await readJsonFile<unknown>(getReviewOverridesPath(), { approved: [], rejected: [] });
  if (!rawValue || typeof rawValue !== "object") {
    return {
      approved: [],
      rejected: [],
    } satisfies ReviewOverridesFile;
  }

  const record = rawValue as Record<string, unknown>;
  return {
    approved: Array.isArray(record.approved) ? record.approved.filter((entry): entry is string => typeof entry === "string") : [],
    rejected: Array.isArray(record.rejected) ? record.rejected.filter((entry): entry is string => typeof entry === "string") : [],
  } satisfies ReviewOverridesFile;
}

async function readLeafCandidateEntries() {
  const rawValue = await readJsonFile<unknown>(getLeafCandidateManifestPath(), { entries: [] });
  const record = rawValue && typeof rawValue === "object" ? (rawValue as { entries?: unknown }) : null;
  return Array.isArray(record?.entries)
    ? record.entries.filter((entry): entry is LeafCandidateEntry => Boolean(entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string" && typeof (entry as Record<string, unknown>).slug === "string"))
    : [];
}

async function readLeafRuntimeEntries() {
  const rawValue = await readJsonFile<unknown>(getLeafRuntimeManifestPath(), { entries: [] });
  const record = rawValue && typeof rawValue === "object" ? (rawValue as { entries?: unknown }) : null;
  return Array.isArray(record?.entries)
    ? record.entries.filter((entry): entry is LeafRuntimeEntry => Boolean(entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string" && typeof (entry as Record<string, unknown>).slug === "string"))
    : [];
}

async function readJsonFile<T>(filePath: string, fallback?: T): Promise<T> {
  try {
    const rawText = await readFile(filePath, "utf8");
    return JSON.parse(rawText) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && fallback !== undefined) {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeSpeciesProgramEntry(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const slug = readOptionalString(record.slug);
  const label = readOptionalString(record.label);
  if (!slug || !label) {
    return null;
  }

  return {
    slug,
    label,
    subtitle: readOptionalString(record.subtitle),
    catalogTier: (record.catalogTier === "core" || record.catalogTier === "extended") ? record.catalogTier : null,
    recognitionEnabled: typeof record.recognitionEnabled === "boolean" ? record.recognitionEnabled : true,
  } satisfies SpeciesProgramEntry;
}

function normalizeSourceOverrideEntry(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sourceName = readOptionalString(record.sourceName);
  const slug = readOptionalString(record.slug);
  const externalId = readOptionalString(record.externalId);
  if (!sourceName || !slug || !externalId) {
    return null;
  }

  return {
    sourceName,
    slug,
    externalId,
    reason: readOptionalString(record.reason) ?? undefined,
  } satisfies SourceOverrideEntry;
}

function normalizeManualCropOverrideEntry(value: unknown) {
  const normalizedEntry = normalizeSourceOverrideEntry(value);
  if (!normalizedEntry || !value || typeof value !== "object") {
    return null;
  }

  const cropBox = normalizeCropBox((value as Record<string, unknown>).cropBox);
  if (!cropBox) {
    return null;
  }

  return {
    ...normalizedEntry,
    cropBox,
  } satisfies ManualCropOverrideEntry;
}

function normalizeSpeciesNoteOverrideEntry(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const slug = readOptionalString(record.slug);
  const note = readOptionalString(record.note);
  if (!slug || !note) {
    return null;
  }

  return {
    slug,
    note,
    updatedAt: readOptionalString(record.updatedAt) ?? undefined,
  } satisfies SpeciesNoteOverrideEntry;
}

function normalizeCropBox(value: unknown): LeafCropBox | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const normalized = value.map((entry) => typeof entry === "number" ? Math.round(entry) : Number.NaN);
  if (normalized.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  const [left, top, right, bottom] = normalized;
  if (right <= left || bottom <= top) {
    return null;
  }

  return [left, top, right, bottom];
}

function compareSourceOverrideEntry(left: SourceOverrideEntry, right: SourceOverrideEntry) {
  return buildSourceAssetId(left.sourceName, left.slug, left.externalId).localeCompare(buildSourceAssetId(right.sourceName, right.slug, right.externalId));
}

function compareManualCropOverrideEntry(left: ManualCropOverrideEntry, right: ManualCropOverrideEntry) {
  return compareSourceOverrideEntry(left, right);
}

function compareSpeciesNoteOverrideEntry(left: SpeciesNoteOverrideEntry, right: SpeciesNoteOverrideEntry) {
  return left.slug.localeCompare(right.slug);
}

function readCandidateSourceAssetId(candidateEntry: LeafCandidateEntry) {
  if (typeof candidateEntry.sourceAssetId === "string" && candidateEntry.sourceAssetId.length > 0) {
    return candidateEntry.sourceAssetId;
  }

  const cropMarkerIndex = candidateEntry.id.lastIndexOf(":crop-");
  return cropMarkerIndex >= 0 ? candidateEntry.id.slice(0, cropMarkerIndex) : null;
}

function readCandidateExternalId(candidatePhoto: SourceManifestPhoto) {
  const rawValue = candidatePhoto.photoId ?? candidatePhoto.mediaId ?? candidatePhoto.observationId ?? candidatePhoto.occurrenceId;
  return rawValue === undefined || rawValue === null ? null : String(rawValue).trim() || null;
}

function readCandidateImageUrl(candidatePhoto: SourceManifestPhoto) {
  const imageUrl = readOptionalString(candidatePhoto.imageUrl);
  if (imageUrl) {
    return imageUrl;
  }

  return readOptionalString(candidatePhoto.photoUrl);
}

function buildLeafReviewAssetUrl(kind: "source" | "patch", relativePath: string) {
  const encodedSegments = relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `/api/leaf-review-assets/${kind}/${encodedSegments}`;
}

function sanitizeAssetId(rawValue: unknown) {
  const value = String(rawValue ?? "asset").trim();
  if (value.length === 0) {
    return "asset";
  }

  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return sanitized.slice(0, 120) || "asset";
}

function determineRemoteSuffix(remoteUrl: string) {
  const parsedUrl = new URL(remoteUrl);
  const extension = path.posix.extname(parsedUrl.pathname).toLowerCase();
  return extension.length > 0 ? extension : ".jpg";
}

function buildSourceAssetId(sourceName: string, slug: string, externalId: string) {
  return `${sourceName}:${slug}:${sanitizeAssetId(externalId)}`;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getRepoRoot() {
  return path.resolve(process.cwd(), "../..");
}

function getCatalogDirectory() {
  return path.join(getRepoRoot(), "services", "vision", "catalog");
}

function getCatalogSourceImageDirectory() {
  return path.join(getCatalogDirectory(), "open_license_source_images");
}

function getCatalogLeafPatchDirectory() {
  return path.join(getCatalogDirectory(), "open_license_leaf_patches");
}

function getSpeciesProgramPath() {
  return path.join(getCatalogDirectory(), "species_program.json");
}

function getSourceRankingPath() {
  return path.join(getCatalogDirectory(), "open_license_source_ranking.json");
}

function getInaturalistManifestPath() {
  return path.join(getCatalogDirectory(), "inaturalist_reference_candidates.json");
}

function getGbifManifestPath() {
  return path.join(getCatalogDirectory(), "gbif_reference_candidates.json");
}

function getLeafCandidateManifestPath() {
  return path.join(getCatalogDirectory(), "open_license_leaf_candidates.json");
}

function getLeafRuntimeManifestPath() {
  return path.join(getCatalogDirectory(), "open_license_leaf_index.json");
}

function getSourceOverridesPath() {
  return path.join(getCatalogDirectory(), "open_license_leaf_source_overrides.json");
}

function getReviewOverridesPath() {
  return path.join(getCatalogDirectory(), "open_license_leaf_review_overrides.json");
}

function getWorkspacePythonPath() {
  const repoRoot = getRepoRoot();
  return process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
}