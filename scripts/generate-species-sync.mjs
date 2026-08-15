// Generates two artifacts from the species catalog JSON files:
//
//   1. services/vision/catalog/species_ids.json — a pinned slug -> id map. Once a
//      slug has an id here it never changes, so adding or reordering catalog JSON
//      entries can no longer silently re-point existing database rows.
//   2. supabase/migrations/0004_sync_species_catalog.sql — upserts every catalog
//      entry into public.species so tree creation works for the full catalog.
//
// Run after ANY change to species_program.json, manual_species_catalog.json,
// manual_species_extended_catalog.json, or bonsai_reference_catalog.json:
//
//   node scripts/generate-species-sync.mjs
//
// The merge order below deliberately mirrors buildSpeciesCatalog in
// apps/web/lib/catalog.ts — the web app resolves ids through the same pin file,
// so the two can never drift.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = path.join(repoRoot, "services", "vision", "catalog");
const pinPath = path.join(catalogDir, "species_ids.json");
const migrationPath = path.join(repoRoot, "supabase", "migrations", "0004_sync_species_catalog.sql");

// These rows already exist in deployed databases (0001 seed + 0002 backfill).
// The generated ids MUST keep matching them or existing trees re-point.
const DB_SEED_ASSERTIONS = {
  1: "juniperus-procumbens",
  2: "ficus-retusa",
  3: "acer-palmatum",
  4: "pinus-thunbergii",
  5: "ulmus-parvifolia",
  13: "chamaecyparis-pisifera",
  15: "picea-jezoensis",
};

function readJson(fileName) {
  const filePath = path.join(catalogDir, fileName);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeLookupKey(value) {
  return value.trim().toLowerCase();
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function lookupKeys(entry) {
  return [...new Set([entry.label, entry.subtitle ?? "", ...(entry.aliases ?? [])]
    .map(normalizeLookupKey)
    .filter((value) => value.length > 0))];
}

const program = (readJson("species_program.json") ?? []).map((entry) => ({
  id: entry.id,
  slug: entry.slug,
  label: entry.label,
  subtitle: entry.subtitle ?? null,
  aliases: entry.aliases ?? [],
  careProfileSlug: entry.careProfileSlug ?? entry.slug,
  taxonRank: entry.taxonRank ?? null,
  catalogTier: entry.catalogTier ?? null,
  recognitionEnabled: entry.recognitionEnabled ?? true,
}));

const manualEntries = ["manual_species_catalog.json", "manual_species_extended_catalog.json"]
  .flatMap((fileName) => readJson(fileName) ?? [])
  .map((entry) => ({
    slug: entry.slug,
    label: entry.label,
    subtitle: entry.subtitle ?? null,
    aliases: entry.aliases ?? [],
    careProfileSlug: entry.careProfileSlug ?? entry.slug,
    taxonRank: entry.taxonRank ?? "species",
    catalogTier: entry.catalogTier ?? "extended",
    recognitionEnabled: entry.recognitionEnabled ?? false,
  }));

const referenceLabels = [...new Set((readJson("bonsai_reference_catalog.json") ?? []).map((entry) => entry.species_label))]
  .sort((left, right) => left.localeCompare(right));

// --- merge, mirroring apps/web/lib/catalog.ts ---
const coreProgram = program.filter((entry) => entry.catalogTier !== "extended");
const extendedProgram = program.filter((entry) => entry.catalogTier === "extended");
const knownLabels = new Set(program.flatMap(lookupKeys));
const knownSlugs = new Set(program.map((entry) => entry.slug));
const merged = [...coreProgram];

const existingPins = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, "utf8")) : {};
let nextId = Math.max(
  ...program.map((entry) => entry.id),
  ...Object.values(existingPins),
  0,
) + 1;

function resolveId(slug) {
  if (typeof existingPins[slug] === "number") {
    return existingPins[slug];
  }
  const id = nextId;
  nextId += 1;
  return id;
}

for (const entry of manualEntries) {
  const keys = lookupKeys(entry);
  if (keys.some((key) => knownLabels.has(key)) || knownSlugs.has(entry.slug)) {
    continue;
  }
  merged.push({ ...entry, id: resolveId(entry.slug) });
  keys.forEach((key) => knownLabels.add(key));
  knownSlugs.add(entry.slug);
}

for (const label of referenceLabels) {
  const slug = slugify(label);
  if (knownLabels.has(normalizeLookupKey(label)) || knownSlugs.has(slug)) {
    continue;
  }
  merged.push({
    id: resolveId(slug),
    slug,
    label,
    subtitle: null,
    aliases: [label],
    careProfileSlug: slug,
    taxonRank: "group",
    catalogTier: "core",
    recognitionEnabled: true,
  });
  knownLabels.add(normalizeLookupKey(label));
  knownSlugs.add(slug);
}

const allEntries = [...merged, ...extendedProgram];

// --- validation ---
const slugSeen = new Map();
const idSeen = new Map();
for (const entry of allEntries) {
  if (slugSeen.has(entry.slug)) {
    throw new Error(`Duplicate slug in catalog: ${entry.slug}`);
  }
  if (idSeen.has(entry.id)) {
    throw new Error(`Duplicate id in catalog: ${entry.id} (${idSeen.get(entry.id)} vs ${entry.slug})`);
  }
  slugSeen.set(entry.slug, entry.id);
  idSeen.set(entry.id, entry.slug);
}
for (const [id, slug] of Object.entries(DB_SEED_ASSERTIONS)) {
  if (slugSeen.get(slug) !== Number(id)) {
    throw new Error(`Seed drift: expected ${slug} to have id ${id}, got ${slugSeen.get(slug)}`);
  }
}

// --- pin file ---
const pins = Object.fromEntries(
  allEntries
    .map((entry) => [entry.slug, entry.id])
    .sort((left, right) => left[1] - right[1]),
);
writeFileSync(pinPath, `${JSON.stringify(pins, null, 2)}\n`, "utf8");

// --- migration ---
function sqlText(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJsonArray(values) {
  return `${sqlText(JSON.stringify(values))}::jsonb`;
}

const rows = allEntries
  .slice()
  .sort((left, right) => left.id - right.id)
  .map((entry) => `    (${entry.id}, ${sqlText(entry.slug)}, ${sqlText(entry.subtitle ?? entry.label)}, ${sqlText(entry.label)}, ${sqlJsonArray(entry.aliases)}, ${sqlText(entry.careProfileSlug)}, ${sqlText(entry.taxonRank)}, ${sqlText(entry.catalogTier)}, ${entry.recognitionEnabled})`)
  .join(",\n");

const migration = `-- Generated by scripts/generate-species-sync.mjs — do not edit by hand.
-- Syncs the full runtime species catalog (${allEntries.length} entries) into public.species
-- so tree creation is valid for every catalog species, keyed by pinned stable ids.

alter table public.species
    add column if not exists aliases jsonb,
    add column if not exists care_profile_slug text,
    add column if not exists taxon_rank text,
    add column if not exists catalog_tier text,
    add column if not exists recognition_enabled boolean not null default true;

insert into public.species (id, slug, latin_name, common_name, aliases, care_profile_slug, taxon_rank, catalog_tier, recognition_enabled)
overriding system value
values
${rows}
on conflict (id) do update
set slug = excluded.slug,
    latin_name = excluded.latin_name,
    common_name = excluded.common_name,
    aliases = excluded.aliases,
    care_profile_slug = excluded.care_profile_slug,
    taxon_rank = excluded.taxon_rank,
    catalog_tier = excluded.catalog_tier,
    recognition_enabled = excluded.recognition_enabled;

select setval(pg_get_serial_sequence('public.species', 'id'), greatest((select max(id) from public.species), 1), true);
`;

writeFileSync(migrationPath, migration, "utf8");

console.log(`Catalog entries: ${allEntries.length}`);
console.log(`Pinned ids written to ${path.relative(repoRoot, pinPath)}`);
console.log(`Migration written to ${path.relative(repoRoot, migrationPath)}`);
