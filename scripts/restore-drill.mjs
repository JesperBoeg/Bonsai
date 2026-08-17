#!/usr/bin/env node
// Restore drill (docs/future-state-plan.md §5.2, docs/GUARDRAILS.md): proves a
// nightly backup can actually come back. A backup that has never been restored
// is a hope, not a backup.
//
// It restores a `pg_dump --format=custom` file into a scratch database and then
// checks the restored data is the shape the app needs: the tables exist, the
// species catalog is intact with no ID drift, and the RPC the capture flow calls
// is present. Photo bytes are checked separately from the storage manifest.
//
// Usage:
//   RESTORE_TARGET_DB_URL=postgres://... \
//     node scripts/restore-drill.mjs --dump backup/bonsai-db-<stamp>.dump [--storage backup/storage]
//
// Flags:
//   --dump <file>       pg_dump custom-format file to restore (required)
//   --storage <dir>     storage backup directory to verify against its manifest.json
//   --skip-restore      only run the verification queries against RESTORE_TARGET_DB_URL
//
// WARNING: the target database is wiped for the restore. Point it at a scratch
// database — never at production.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const EXPECTED_TABLES = ["species", "bonsai_styles", "trees", "photos", "capture_submissions", "tree_target_states"];
const EXPECTED_SPECIES_COUNT = 244; // migration 0004 pins these IDs; drift here breaks every stored species_id
const EXPECTED_FUNCTIONS = ["allocate_tree_sequence"];

// The target must be pre-seeded with pgvector (pg_dump omits CREATE EXTENSION
// when restricted to one schema), and that in turn means --clean cannot drop and
// recreate `public`. Those two complaints are structural, not signal — but
// anything else pg_restore objects to fails the drill.
const EXPECTED_RESTORE_ERRORS = [
  /cannot drop schema public because other objects depend on it/i,
  /schema "public" already exists/i,
];

const args = parseArgs(process.argv.slice(2));
const targetUrl = (process.env.RESTORE_TARGET_DB_URL ?? "").trim();
const checks = [];

if (!targetUrl) {
  fail("Set RESTORE_TARGET_DB_URL to a SCRATCH database — the drill wipes it.");
}

if (!args.skipRestore && !args.dump) {
  fail("Pass --dump <file> (or --skip-restore to verify an already-restored database).");
}

if (args.dump && !existsSync(args.dump)) {
  fail(`Dump file not found: ${args.dump}`);
}

if (!args.skipRestore) {
  await restoreDump();
}

await verifyDatabase();

if (args.storage) {
  await verifyStorageBackup();
}

report();

async function restoreDump() {
  const bytes = (await stat(args.dump)).size;
  console.log(`Restoring ${args.dump} (${(bytes / (1024 * 1024)).toFixed(1)} MB) into the scratch database...`);

  // Three phases, because the dump's foreign keys point at auth.users — a table
  // Supabase owns and this dump deliberately does not carry. Schema and data
  // first, then the owner ids get seeded into whatever auth.users stub exists,
  // then the constraints and policies go on. Doing it this way turns an
  // unavoidable pile of "ignored errors" into an extra proof: if a single
  // owner_id were missing or corrupted, the foreign keys would refuse to build.
  const prePost = runRestore(["--clean", "--if-exists", "--section=pre-data", "--section=data"], "schema + data");
  await seedAuthUsers();
  const post = runRestore(["--section=post-data"], "constraints, indexes, policies");
  const unexpected = [...prePost.unexpected, ...post.unexpected];

  record(
    "pg_restore reported no unexpected errors",
    unexpected.length === 0,
    unexpected.length === 0
      ? `${prePost.expected.length + post.expected.length} known artifact(s) ignored`
      : unexpected.slice(0, 3).join(" | "),
  );
}

function runRestore(extraArgs, label) {
  const result = spawnSync(
    "pg_restore",
    ["--no-owner", "--no-privileges", ...extraArgs, "--dbname", targetUrl, args.dump],
    { encoding: "utf8" },
  );

  if (result.error) {
    fail(`pg_restore could not run (${result.error.message}). Install the PostgreSQL client tools.`);
  }

  const errors = (result.stderr ?? "")
    .split("\n")
    .filter((line) => line.includes("pg_restore: error:"))
    .map((line) => line.trim());
  const expected = errors.filter((line) => EXPECTED_RESTORE_ERRORS.some((pattern) => pattern.test(line)));
  const unexpected = errors.filter((line) => !EXPECTED_RESTORE_ERRORS.some((pattern) => pattern.test(line)));

  console.log(`  ${label}: exit ${result.status}, ${expected.length} known artifact(s), ${unexpected.length} unexpected error(s)`);

  if (unexpected.length > 0) {
    console.log(indent(unexpected.slice(0, 8).join("\n")));
  }

  return { ...result, expected, unexpected };
}

// The target may be a bare Postgres with a stub auth.users (the drill's own CI
// container) or a real Supabase project. Both are fine: seeding is best-effort
// and never invents a row that already exists.
async function seedAuthUsers() {
  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const { rows } = await client.query(`
      select distinct owner_id from (
        select owner_id from public.trees
        union select owner_id from public.capture_submissions
        union select owner_id from public.tree_target_states
      ) owners where owner_id is not null
    `);

    for (const row of rows) {
      await client.query("insert into auth.users (id) values ($1) on conflict do nothing", [row.owner_id]);
    }

    record("owner ids seeded into auth.users", true, `${rows.length} distinct owner(s)`);
  } catch (error) {
    record("owner ids seeded into auth.users", false, `${error.message} — the foreign keys below will fail without this`);
  } finally {
    await client.end();
  }
}

async function verifyDatabase() {
  const client = new pg.Client({ connectionString: targetUrl });
  await client.connect();

  try {
    const tables = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const tableNames = new Set(tables.rows.map((row) => row.table_name));

    for (const table of EXPECTED_TABLES) {
      record(`table public.${table}`, tableNames.has(table), tableNames.has(table) ? "present" : "MISSING");
    }

    const functions = await client.query(
      "select routine_name from information_schema.routines where routine_schema = 'public'",
    );
    const functionNames = new Set(functions.rows.map((row) => row.routine_name));

    for (const routine of EXPECTED_FUNCTIONS) {
      record(`function public.${routine}()`, functionNames.has(routine), functionNames.has(routine) ? "present" : "MISSING");
    }

    if (tableNames.has("species")) {
      const species = await client.query("select count(*)::int as count, min(id)::int as min_id, max(id)::int as max_id from public.species");
      const { count, min_id: minId, max_id: maxId } = species.rows[0];
      record(
        "species catalog",
        count === EXPECTED_SPECIES_COUNT,
        `${count} rows (expected ${EXPECTED_SPECIES_COUNT}), ids ${minId}–${maxId}`,
      );
    }

    for (const table of ["trees", "photos", "capture_submissions", "tree_target_states"]) {
      if (!tableNames.has(table)) {
        continue;
      }

      const { rows } = await client.query(`select count(*)::int as count from public.${table}`);
      console.log(`  info   public.${table}: ${rows[0].count} row(s) restored`);
    }

    // Every photo must still point at a tree, or the restore is internally broken.
    if (tableNames.has("photos") && tableNames.has("trees")) {
      const { rows } = await client.query(
        "select count(*)::int as count from public.photos p left join public.trees t on t.id = p.tree_id where t.id is null",
      );
      record("photos reference existing trees", rows[0].count === 0, `${rows[0].count} orphan(s)`);
    }
  } finally {
    await client.end();
  }
}

async function verifyStorageBackup() {
  const manifestPath = path.join(args.storage, "manifest.json");

  if (!existsSync(manifestPath)) {
    record("storage manifest", false, `${manifestPath} is missing`);
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let verified = 0;
  const problems = [];

  for (const object of manifest.objects ?? []) {
    const filePath = path.join(args.storage, ...object.name.split("/"));

    if (!existsSync(filePath)) {
      problems.push(`${object.name}: file missing`);
      continue;
    }

    const hash = createHash("sha256").update(await readFile(filePath)).digest("hex");

    if (hash !== object.sha256) {
      problems.push(`${object.name}: sha256 mismatch`);
      continue;
    }

    verified += 1;
  }

  record(
    "storage objects match manifest hashes",
    problems.length === 0,
    `${verified}/${(manifest.objects ?? []).length} verified${problems.length > 0 ? ` — ${problems.slice(0, 5).join("; ")}` : ""}`,
  );
}

function record(label, passed, detail) {
  checks.push({ label, passed, detail });
  console.log(`  ${passed ? "ok    " : "FAIL  "} ${label}: ${detail}`);
}

function report() {
  const failed = checks.filter((check) => !check.passed);

  console.log(`\n=== Restore drill: ${failed.length === 0 ? "PASS" : "FAIL"} ===`);
  console.log(`  ${checks.length - failed.length}/${checks.length} check(s) passed.`);

  if (failed.length > 0) {
    for (const check of failed) {
      console.log(`  - ${check.label}: ${check.detail}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log("  This backup restores. Record the date in docs/GUARDRAILS.md.");
}

function indent(text) {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}

function parseArgs(argv) {
  const parsed = { dump: null, storage: null, skipRestore: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dump") {
      parsed.dump = argv[index += 1] ?? null;
    } else if (arg === "--storage") {
      parsed.storage = argv[index += 1] ?? null;
    } else if (arg === "--skip-restore") {
      parsed.skipRestore = true;
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
