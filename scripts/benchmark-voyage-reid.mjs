#!/usr/bin/env node
// Stage B1 gate (docs/future-state-plan.md §4.1): does Voyage
// `voyage-multimodal-3` re-identify the same tree at least as well as the
// DINOv2 embeddings served by the Python vision service?
//
// Cutover rule: Voyage must be >= DINOv2 on BOTH top-1 and top-3 same-tree
// re-identification. Anything less and the Python service stays; this script
// prints the verdict so the decision is data, not vibes.
//
// Both models are scored by the SAME ranking code (cosine over one gallery
// embedding per tree), so the only variable is the embedding space.
//
// Usage:
//   VOYAGE_API_KEY=... VISION_SERVICE_URL=http://127.0.0.1:8001 \
//     node scripts/benchmark-voyage-reid.mjs [options]
//
// Options:
//   --manifest <file>   JSON array of {path, treeId, isReference?} to use as the
//                       labelled set instead of auto-discovery
//   --no-distractors    skip the 55 catalog reference images as gallery distractors
//   --leaf-sample <n>   leaf-index spot-check size (default 30, 0 disables)
//   --model <id>        Voyage model (default voyage-multimodal-3)
//   --out <file>        write the full result JSON here
//
// Labelled set discovery, when --manifest is absent:
//   data/users/<uid>/bonsai-store.json  →  every front photo, labelled by treeId
// A tree needs >= 2 photos to produce a query, so the gate needs a collection
// with repeat captures. Point --manifest at your own labels if the local store is
// not where your ground truth lives.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const CONFIDENT_MATCH_THRESHOLD = 0.94; // BONSAI_IDENTITY_CONFIDENT_MATCH_THRESHOLD in the vision service
const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/multimodalembeddings";
const VOYAGE_BATCH_SIZE = 8;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const voyageApiKey = (process.env.VOYAGE_API_KEY ?? "").trim();
const visionServiceUrl = (process.env.VISION_SERVICE_URL ?? "").trim().replace(/\/$/, "");

if (!voyageApiKey) {
  fail("Set VOYAGE_API_KEY (owner-provided; this is the gate that unblocks Stage B).");
}

if (!visionServiceUrl) {
  fail("Set VISION_SERVICE_URL to a running vision service — DINOv2 is the baseline being matched.");
}

await main();

async function main() {
  const labelled = args.manifest ? await readManifest(args.manifest) : await discoverLabelledPhotos();
  const { gallery, queries } = buildReIdSplit(labelled);

  if (queries.length === 0) {
    fail(
      "No same-tree query photos found: the re-ID gate needs at least one tree with two or more photos. " +
      "Capture a repeat photo of an existing tree, or pass --manifest with your own labels.",
    );
  }

  const distractors = args.distractors ? await loadCatalogDistractors() : [];
  const galleryItems = [...gallery, ...distractors];

  console.log(
    `Re-ID set: ${queries.length} query photo(s) across ${new Set(queries.map((entry) => entry.treeId)).size} tree(s), ` +
    `gallery of ${galleryItems.length} (${distractors.length} catalog distractor(s)).`,
  );

  const dinov2 = await scoreModel("dinov2", galleryItems, queries, embedWithVisionService);
  const voyage = await scoreModel(args.model, galleryItems, queries, embedWithVoyage);
  const leaf = args.leafSample > 0 ? await runLeafSpotCheck(args.leafSample) : null;
  const verdict = decideVerdict(dinov2, voyage);

  report({ dinov2, voyage, leaf, verdict });

  const payload = {
    model: args.model,
    threshold: CONFIDENT_MATCH_THRESHOLD,
    querySize: queries.length,
    gallerySize: galleryItems.length,
    dinov2,
    voyage,
    leaf,
    verdict,
  };

  if (args.out) {
    await writeFile(args.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`\nFull results written to ${args.out}`);
  }

  // Exit 2 on a failed gate so a CI or scripted run can act on the verdict.
  process.exitCode = verdict.cutoverAllowed ? 0 : 2;
}

// --- scoring -----------------------------------------------------------------

async function scoreModel(label, galleryItems, queries, embed) {
  console.log(`\nEmbedding with ${label}...`);
  const galleryEmbeddings = await embed(galleryItems.map((item) => item.absolutePath), "document");
  const queryEmbeddings = await embed(queries.map((item) => item.absolutePath), "query");

  let top1 = 0;
  let top3 = 0;
  let autoMatched = 0;
  let correctAutoMatched = 0;
  const perQuery = [];

  for (const [index, query] of queries.entries()) {
    const ranked = galleryItems
      .map((item, galleryIndex) => ({
        treeId: item.treeId,
        id: item.id,
        score: cosine(queryEmbeddings[index], galleryEmbeddings[galleryIndex]),
      }))
      .sort((left, right) => right.score - left.score);

    const rank = ranked.findIndex((entry) => entry.treeId === query.treeId) + 1;
    const isTop1 = rank === 1;
    const isTop3 = rank >= 1 && rank <= 3;
    const passesThreshold = ranked[0].score >= CONFIDENT_MATCH_THRESHOLD;

    if (isTop1) top1 += 1;
    if (isTop3) top3 += 1;
    if (passesThreshold) {
      autoMatched += 1;
      if (isTop1) correctAutoMatched += 1;
    }

    perQuery.push({
      query: query.id,
      trueTreeId: query.treeId,
      rank: rank === 0 ? null : rank,
      topScore: round(ranked[0].score),
      topTreeId: ranked[0].treeId,
    });
  }

  return {
    label,
    queries: queries.length,
    top1: rate(top1, queries.length),
    top3: rate(top3, queries.length),
    // The 0.94 auto-match threshold was tuned in DINOv2's space; a different
    // space needs it recalibrated, so this is reported, never compared.
    autoMatchRateAtThreshold: rate(autoMatched, queries.length),
    autoMatchPrecision: autoMatched > 0 ? rate(correctAutoMatched, autoMatched) : null,
    perQuery,
  };
}

function decideVerdict(dinov2, voyage) {
  const top1Delta = round(voyage.top1 - dinov2.top1);
  const top3Delta = round(voyage.top3 - dinov2.top3);
  const cutoverAllowed = voyage.top1 >= dinov2.top1 && voyage.top3 >= dinov2.top3;

  return {
    cutoverAllowed,
    top1Delta,
    top3Delta,
    reason: cutoverAllowed
      ? "Voyage matches or beats DINOv2 on top-1 and top-3 — Stage B2 may proceed."
      : "Voyage is behind DINOv2 — the gate fails. Keep the Python vision service and shelve Stage B.",
  };
}

// --- embeddings --------------------------------------------------------------

async function embedWithVisionService(absolutePaths) {
  const embeddings = [];

  for (const absolutePath of absolutePaths) {
    const formData = new FormData();
    formData.set("image", new Blob([await readFile(absolutePath)]), path.basename(absolutePath));
    formData.set("candidates", "[]");
    formData.set("include_identity_matches", "false");
    formData.set("include_style_predictions", "false");

    const response = await fetch(`${visionServiceUrl}/recognize`, { method: "POST", body: formData });

    if (!response.ok) {
      fail(`Vision service returned ${response.status} for ${absolutePath}: ${await response.text()}`);
    }

    const payload = await response.json();

    if (!Array.isArray(payload.embedding)) {
      fail(`Vision service returned no embedding for ${absolutePath}.`);
    }

    embeddings.push(payload.embedding);
    process.stdout.write(".");
  }

  process.stdout.write("\n");
  return embeddings;
}

async function embedWithVoyage(absolutePaths, inputType) {
  const embeddings = [];

  for (let start = 0; start < absolutePaths.length; start += VOYAGE_BATCH_SIZE) {
    const batch = absolutePaths.slice(start, start + VOYAGE_BATCH_SIZE);
    const inputs = await Promise.all(batch.map(async (absolutePath) => ({
      content: [{
        type: "image_base64",
        image_base64: `data:${contentTypeFor(absolutePath)};base64,${(await readFile(absolutePath)).toString("base64")}`,
      }],
    })));

    const response = await fetch(VOYAGE_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${voyageApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: args.model, inputs, input_type: inputType }),
    });

    if (!response.ok) {
      fail(`Voyage returned ${response.status}: ${await response.text()}`);
    }

    const payload = await response.json();
    const ordered = [...(payload.data ?? [])].sort((left, right) => left.index - right.index);

    if (ordered.length !== batch.length) {
      fail(`Voyage returned ${ordered.length} embedding(s) for ${batch.length} image(s).`);
    }

    embeddings.push(...ordered.map((entry) => entry.embedding));
    process.stdout.write(".");
  }

  process.stdout.write("\n");
  return embeddings;
}

// --- leaf-species index spot-check ------------------------------------------

// Voyage would take over the leaf index too (plan §4.2), so check it does not
// regress species suggestions. Voyage is scored leave-one-out over the 217-entry
// index; the vision service is scored through its own /recognize-leaf endpoint,
// whose index CONTAINS the query patch — that is optimistic for DINOv2, which
// keeps the comparison conservative in the direction that matters.
async function runLeafSpotCheck(sampleSize) {
  const indexPath = path.join(repoRoot, "services", "vision", "catalog", "open_license_leaf_index.json");

  if (!existsSync(indexPath)) {
    console.log("\nLeaf spot-check skipped: open_license_leaf_index.json is missing.");
    return null;
  }

  const entries = (JSON.parse(await readFile(indexPath, "utf8")).entries ?? []).filter((entry) => {
    return existsSync(path.join(repoRoot, "services", "vision", "catalog", entry.localPath));
  });

  if (entries.length === 0) {
    console.log("\nLeaf spot-check skipped: no leaf patch files on disk.");
    return null;
  }

  // Deterministic, spread-out sample so repeat runs are comparable.
  const step = Math.max(1, Math.floor(entries.length / sampleSize));
  const sample = entries.filter((_, index) => index % step === 0).slice(0, sampleSize);
  const absolutePathFor = (entry) => path.join(repoRoot, "services", "vision", "catalog", entry.localPath);

  console.log(`\nLeaf spot-check: ${sample.length} query patch(es) against ${entries.length} index entries.`);
  const indexEmbeddings = await embedWithVoyage(entries.map(absolutePathFor), "document");
  const sampleEmbeddings = await embedWithVoyage(sample.map(absolutePathFor), "query");

  let voyageTop1 = 0;
  let voyageTop3 = 0;

  for (const [index, entry] of sample.entries()) {
    const ranked = entries
      .map((candidate, candidateIndex) => ({
        slug: candidate.slug,
        score: candidate.id === entry.id ? -Infinity : cosine(sampleEmbeddings[index], indexEmbeddings[candidateIndex]),
      }))
      .sort((left, right) => right.score - left.score);
    const slugs = dedupe(ranked.map((candidate) => candidate.slug));

    if (slugs[0] === entry.slug) voyageTop1 += 1;
    if (slugs.slice(0, 3).includes(entry.slug)) voyageTop3 += 1;
  }

  let visionTop1 = 0;
  let visionTop3 = 0;

  for (const entry of sample) {
    const formData = new FormData();
    formData.set("image", new Blob([await readFile(absolutePathFor(entry))]), path.basename(entry.localPath));
    const response = await fetch(`${visionServiceUrl}/recognize-leaf`, { method: "POST", body: formData });

    if (!response.ok) {
      fail(`Vision service /recognize-leaf returned ${response.status}: ${await response.text()}`);
    }

    const predictions = (await response.json()).species_predictions ?? [];
    const labels = predictions.map((prediction) => normalizeLabel(prediction.label));
    const expected = normalizeLabel(entry.speciesLabel);

    if (labels[0] === expected) visionTop1 += 1;
    if (labels.slice(0, 3).includes(expected)) visionTop3 += 1;
    process.stdout.write(".");
  }

  process.stdout.write("\n");

  return {
    sampleSize: sample.length,
    indexSize: entries.length,
    voyage: { top1: rate(voyageTop1, sample.length), top3: rate(voyageTop3, sample.length) },
    visionService: {
      top1: rate(visionTop1, sample.length),
      top3: rate(visionTop3, sample.length),
      note: "scored with the query patch present in its own index (optimistic)",
    },
  };
}

// --- labelled set ------------------------------------------------------------

async function readManifest(manifestPath) {
  const parsed = JSON.parse(await readFile(manifestPath, "utf8"));

  if (!Array.isArray(parsed)) {
    fail("The manifest must be a JSON array of {path, treeId, isReference?} entries.");
  }

  return parsed.map((entry, index) => {
    const absolutePath = path.resolve(repoRoot, entry.path);

    if (!existsSync(absolutePath)) {
      fail(`Manifest entry ${index} points at a missing file: ${entry.path}`);
    }

    return {
      id: entry.id ?? path.basename(entry.path),
      absolutePath,
      treeId: String(entry.treeId),
      isReference: entry.isReference === true,
    };
  });
}

async function discoverLabelledPhotos() {
  const usersDirectory = path.join(repoRoot, "data", "users");

  if (!existsSync(usersDirectory)) {
    fail(`No labelled photos found: ${usersDirectory} does not exist. Pass --manifest instead.`);
  }

  const found = [];

  for (const entry of await readdir(usersDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const storePath = path.join(usersDirectory, entry.name, "bonsai-store.json");

    if (!existsSync(storePath)) {
      continue;
    }

    const document = JSON.parse(await readFile(storePath, "utf8"));

    for (const photo of document.photos ?? []) {
      if (photo.kind !== "front") {
        continue;
      }

      const candidates = [
        path.join(usersDirectory, entry.name, "uploads", ...photo.storagePath.split("/")),
        path.join(repoRoot, "data", "uploads", ...photo.storagePath.split("/")),
      ];
      const absolutePath = candidates.find((candidate) => existsSync(candidate));

      if (absolutePath) {
        found.push({ id: photo.id, absolutePath, treeId: photo.treeId, isReference: photo.isReference === true });
      }
    }
  }

  if (found.length === 0) {
    fail("No labelled photos found in any local store. Pass --manifest instead.");
  }

  return found;
}

// One gallery entry per tree (its reference photo), every other photo of that
// tree becomes a query — the same shape as capture-time identity matching.
function buildReIdSplit(labelled) {
  const byTree = new Map();

  for (const entry of labelled) {
    const bucket = byTree.get(entry.treeId) ?? [];
    bucket.push(entry);
    byTree.set(entry.treeId, bucket);
  }

  const gallery = [];
  const queries = [];

  for (const [treeId, photos] of byTree) {
    if (photos.length < 2) {
      continue;
    }

    const reference = photos.find((photo) => photo.isReference) ?? photos[0];
    gallery.push({ ...reference, treeId });
    queries.push(...photos.filter((photo) => photo.id !== reference.id).map((photo) => ({ ...photo, treeId })));
  }

  return { gallery, queries };
}

// The 55 curated catalog trees stand in for "someone else's tree that looks a
// bit like yours" — without them, top-1 is trivially easy.
async function loadCatalogDistractors() {
  const catalogPath = path.join(repoRoot, "services", "vision", "catalog", "bonsai_reference_catalog.json");

  if (!existsSync(catalogPath)) {
    return [];
  }

  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

  return catalog
    .map((entry) => ({
      id: `catalog:${entry.id}`,
      absolutePath: path.join(repoRoot, "services", "vision", "catalog", ...entry.local_path.split("/")),
      treeId: `catalog:${entry.id}`,
      isReference: true,
    }))
    .filter((entry) => existsSync(entry.absolutePath));
}

// --- reporting ---------------------------------------------------------------

function report({ dinov2, voyage, leaf, verdict }) {
  const line = (label, value) => `  ${label.padEnd(28)} ${value}`;

  console.log("\n=== Same-tree re-identification ===");
  console.log(line("metric", `${"DINOv2".padStart(9)} ${"Voyage".padStart(9)}`));
  console.log(line("top-1", `${percent(dinov2.top1)} ${percent(voyage.top1)}`));
  console.log(line("top-3", `${percent(dinov2.top3)} ${percent(voyage.top3)}`));
  console.log(line(`auto-match @ ${CONFIDENT_MATCH_THRESHOLD}`, `${percent(dinov2.autoMatchRateAtThreshold)} ${percent(voyage.autoMatchRateAtThreshold)}`));
  console.log("  (auto-match rate is FYI only — the 0.94 threshold needs recalibrating per embedding space.)");

  if (leaf) {
    console.log("\n=== Leaf-species index spot-check ===");
    console.log(line("top-1", `${percent(leaf.visionService.top1)} ${percent(leaf.voyage.top1)}`));
    console.log(line("top-3", `${percent(leaf.visionService.top3)} ${percent(leaf.voyage.top3)}`));
    console.log(`  (vision service ${leaf.visionService.note}.)`);
  }

  console.log(`\n=== Gate: ${verdict.cutoverAllowed ? "PASS" : "FAIL"} ===`);
  console.log(`  ${verdict.reason}`);
  console.log(`  top-1 delta ${signed(verdict.top1Delta)}, top-3 delta ${signed(verdict.top3Delta)}`);
}

// --- helpers -----------------------------------------------------------------

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function dedupe(values) {
  return [...new Set(values)];
}

function normalizeLabel(value) {
  return String(value ?? "").trim().toLowerCase();
}

function contentTypeFor(absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  return extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
}

function rate(count, total) {
  return total === 0 ? 0 : round(count / total);
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`.padStart(9);
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} pt`;
}

function parseArgs(argv) {
  const parsed = { manifest: null, distractors: true, leafSample: 30, model: "voyage-multimodal-3", out: null };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifest") {
      parsed.manifest = argv[index += 1] ?? null;
    } else if (arg === "--no-distractors") {
      parsed.distractors = false;
    } else if (arg === "--leaf-sample") {
      parsed.leafSample = Number.parseInt(argv[index += 1] ?? "", 10);

      if (!Number.isFinite(parsed.leafSample) || parsed.leafSample < 0) {
        fail("--leaf-sample takes a non-negative integer.");
      }
    } else if (arg === "--model") {
      parsed.model = argv[index += 1] ?? parsed.model;
    } else if (arg === "--out") {
      parsed.out = argv[index += 1] ?? null;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
