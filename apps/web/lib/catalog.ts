import { readFileSync } from "node:fs";
import path from "node:path";
import { getRepoRoot } from "./storage-paths";

export type CatalogTaxonRank = "species" | "genus" | "group";
export type CatalogTier = "core" | "extended";

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

export const STYLE_CATALOG: CatalogEntry[] = [
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

let cachedSpeciesCatalog: CatalogEntry[] | null = null;

export function getSpeciesCatalogSync(): CatalogEntry[] {
  if (!cachedSpeciesCatalog) {
    cachedSpeciesCatalog = buildSpeciesCatalog();
  }

  return cachedSpeciesCatalog;
}

export async function getCatalogs(_: unknown = null) {
  return {
    speciesCatalog: getSpeciesCatalogSync(),
    styleCatalog: STYLE_CATALOG,
  };
}

export function resolveCatalogSpeciesEntry(speciesCatalog: CatalogEntry[], speciesId: number) {
  return speciesCatalog.find((entry) => entry.id === speciesId) ?? null;
}

export function resolveCatalogPredictionEntry(label: string, catalog: CatalogEntry[]) {
  const normalizedLabel = normalizeLookupKey(label);

  for (const entry of catalog) {
    if (buildCatalogLookupKeys(entry).includes(normalizedLabel)) {
      return entry;
    }
  }

  return null;
}

export function buildCatalogLookupKeys(entry: Pick<CatalogEntry, "label" | "subtitle" | "aliases">) {
  return [...new Set([entry.label, entry.subtitle ?? "", ...(entry.aliases ?? [])]
    .map((value) => normalizeLookupKey(value))
    .filter((value) => value.length > 0))];
}

export function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase();
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getCatalogDirectory() {
  return path.join(getRepoRoot(), "services", "vision", "catalog");
}

function readPinnedSpeciesIds(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(path.join(getCatalogDirectory(), "species_ids.json"), "utf8")) as unknown;

    if (!raw || typeof raw !== "object") {
      return {};
    }

    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isInteger(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function buildSpeciesCatalog(): CatalogEntry[] {
  const rawCatalog = JSON.parse(
    readFileSync(path.join(getCatalogDirectory(), "bonsai_reference_catalog.json"), "utf8"),
  ) as Array<{ species_label: string }>;
  const programEntries = readSpeciesProgram();
  const manualEntries = readManualSpeciesCatalog();
  const pinnedIds = readPinnedSpeciesIds();
  const coreProgramEntries = programEntries.filter((entry) => entry.catalogTier !== "extended");
  const extendedProgramEntries = programEntries.filter((entry) => entry.catalogTier === "extended");
  const knownLabels = new Set(programEntries.flatMap((entry) => buildCatalogLookupKeys(entry)));
  const knownSlugs = new Set(programEntries.map((entry) => entry.slug));
  const catalogEntries = [...coreProgramEntries];
  let nextUnpinnedId = Math.max(
    ...programEntries.map((entry) => entry.id),
    ...Object.values(pinnedIds),
    0,
  ) + 1;

  const resolvePinnedId = (slug: string) => {
    const pinnedId = pinnedIds[slug];

    if (typeof pinnedId === "number") {
      return pinnedId;
    }

    // Not yet pinned: assign above every known id and warn — run
    // scripts/generate-species-sync.mjs to pin it and sync the database.
    console.warn(`[catalog] species slug "${slug}" has no pinned id; run node scripts/generate-species-sync.mjs`);
    const assignedId = nextUnpinnedId;
    nextUnpinnedId += 1;
    return assignedId;
  };

  const appendEntry = (entry: CatalogEntryInput) => {
    if (knownSlugs.has(entry.slug)) {
      return;
    }

    catalogEntries.push({ id: resolvePinnedId(entry.slug), ...entry });

    for (const lookupKey of buildCatalogLookupKeys(entry)) {
      knownLabels.add(lookupKey);
    }

    knownSlugs.add(entry.slug);
  };

  for (const pendingEntry of manualEntries) {
    if (buildCatalogLookupKeys(pendingEntry).some((lookupKey) => knownLabels.has(lookupKey))) {
      continue;
    }

    appendEntry(pendingEntry);
  }

  for (const speciesLabel of [...new Set(rawCatalog.map((entry) => entry.species_label))].sort((left, right) => left.localeCompare(right))) {
    if (knownLabels.has(normalizeLookupKey(speciesLabel))) {
      continue;
    }

    appendEntry({
      slug: slugify(speciesLabel),
      label: speciesLabel,
      subtitle: null,
      aliases: [speciesLabel],
      careProfileSlug: slugify(speciesLabel),
      taxonRank: "group",
      catalogTier: "core",
      recognitionEnabled: true,
    });
  }

  return [...catalogEntries, ...extendedProgramEntries];
}

function readSpeciesProgram(): CatalogEntry[] {
  const speciesProgramPath = path.join(getCatalogDirectory(), "species_program.json");

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
  const manualCatalogFileNames = ["manual_species_catalog.json", "manual_species_extended_catalog.json"];

  return manualCatalogFileNames.flatMap((fileName) => readManualSpeciesCatalogFile(path.join(getCatalogDirectory(), fileName)));
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

  return {
    id,
    slug,
    label,
    subtitle: readOptionalString(record.subtitle),
    aliases,
    careProfileSlug: readOptionalString(record.careProfileSlug) ?? slug,
    taxonRank: readCatalogTaxonRank(record.taxonRank),
    catalogTier: readCatalogTier(record.catalogTier),
    recognitionEnabled: typeof record.recognitionEnabled === "boolean" ? record.recognitionEnabled : true,
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

  return {
    slug,
    label,
    subtitle: readOptionalString(record.subtitle),
    aliases,
    careProfileSlug: readOptionalString(record.careProfileSlug) ?? slug,
    taxonRank: readCatalogTaxonRank(record.taxonRank) ?? "species",
    catalogTier: readCatalogTier(record.catalogTier) ?? "extended",
    recognitionEnabled: typeof record.recognitionEnabled === "boolean" ? record.recognitionEnabled : false,
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

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
