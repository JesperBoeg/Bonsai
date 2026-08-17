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

  const result = spawnSync(
    "pg_restore",
    ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", targetUrl, args.dump],
    { encoding: "utf8" },
  );

  if (result.error) {
    fail(`pg_restore could not run (${result.error.message}). Install the PostgreSQL client tools.`);
  }

  // pg_restore warns about objects it cannot drop on a fresh database; those are
  // noise, and the verification below is what decides whether the restore worked.
  if (result.stderr?.trim()) {
    console.log(indent(result.stderr.trim().split("\n").slice(-10).join("\n")));
  }

  record("pg_restore exit code", result.status === 0, `exit ${result.status}`);
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
