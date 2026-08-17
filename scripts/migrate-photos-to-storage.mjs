#!/usr/bin/env node
// One-time migration: move photo bytes off the app server's disk into the
// Supabase Storage bucket `bonsai-photos`.
//
// Run once per environment that has photos on disk (Stage A of
// docs/future-state-plan.md). It is idempotent: an object that already exists
// with the same sha256 is skipped, so re-running after a partial run is safe.
// Every upload is verified by downloading the object back and comparing hashes —
// nothing on disk is deleted, so the disk copy stays as a fallback until you are
// satisfied and remove it yourself.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/migrate-photos-to-storage.mjs [--dry-run] [--user <uid>] [--legacy-owner <uid>]
//
// Env:
//   SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL   project URL
//   SUPABASE_SERVICE_ROLE_KEY                 service-role key — uploads on behalf of
//                                             every user, bypassing RLS
//   or, to migrate a single owner's photos without touching the service key:
//   SUPABASE_USER_JWT + NEXT_PUBLIC_SUPABASE_ANON_KEY
//                                             that user's access token; RLS then
//                                             restricts writes to their own folder
//   BONSAI_DATA_DIR                           override the data directory (default <repo>/data)
//
// Flags:
//   --dry-run             report what would happen, upload nothing
//   --user <uid>          migrate only this owner id
//   --legacy-owner <uid>  also migrate pre-per-user files in data/uploads/** and
//                         attribute them to <uid> (the legacy single-user layout)

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "bonsai-photos";
const IMMUTABLE_CACHE_SECONDS = 31_536_000;
const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const dataDirectory = process.env.BONSAI_DATA_DIR?.trim()
  ? path.resolve(process.env.BONSAI_DATA_DIR.trim())
  : path.join(repoRoot, "data");

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const userJwt = (process.env.SUPABASE_USER_JWT ?? "").trim();
const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();

if (!supabaseUrl) {
  fail("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL).");
}

if (!serviceRoleKey && !(userJwt && anonKey)) {
  fail("Set SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_USER_JWT + NEXT_PUBLIC_SUPABASE_ANON_KEY to migrate one owner's photos.");
}

// With a user JWT the bucket's RLS policies apply, so uploads land only under
// that user's own folder — the same path the app takes.
const supabase = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { authorization: `Bearer ${userJwt}` } },
    });

const summary = { uploaded: 0, skipped: 0, verified: 0, failed: 0, files: 0 };

await main();

async function main() {
  const jobs = [...(await collectPerUserJobs()), ...(await collectLegacyJobs())];

  if (jobs.length === 0) {
    console.log(`No photo files found under ${dataDirectory}. Nothing to migrate.`);
    return;
  }

  console.log(`Migrating ${jobs.length} file(s) from ${dataDirectory} into ${BUCKET}${args.dryRun ? " (dry run)" : ""}.`);

  for (const job of jobs) {
    summary.files += 1;
    await migrateFile(job);
  }

  console.log(
    `\nDone. ${summary.uploaded} uploaded, ${summary.skipped} already present, ` +
    `${summary.verified} hash-verified, ${summary.failed} failed (of ${summary.files} files).`,
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function migrateFile({ absolutePath, ownerId, storagePath }) {
  const objectKey = `${ownerId}/${storagePath}`;
  const buffer = await readFile(absolutePath);
  const localHash = sha256(buffer);
  const existing = await download(objectKey);

  if (existing && sha256(existing) === localHash) {
    summary.skipped += 1;
    summary.verified += 1;
    console.log(`  = ${objectKey} (already present, hash matches)`);
    return;
  }

  if (args.dryRun) {
    summary.uploaded += 1;
    console.log(`  + ${objectKey} (${formatBytes(buffer.byteLength)}) — would upload`);
    return;
  }

  const { error } = await supabase.storage.from(BUCKET).upload(objectKey, buffer, {
    contentType: CONTENT_TYPES[path.extname(absolutePath).toLowerCase()] ?? "application/octet-stream",
    cacheControl: String(IMMUTABLE_CACHE_SECONDS),
    upsert: true,
  });

  if (error) {
    summary.failed += 1;
    console.error(`  ! ${objectKey} — upload failed: ${error.message}`);
    return;
  }

  // A byte-for-byte read-back is the only proof the object landed intact.
  const roundTrip = await download(objectKey);

  if (!roundTrip || sha256(roundTrip) !== localHash) {
    summary.failed += 1;
    console.error(`  ! ${objectKey} — verification failed (uploaded bytes do not match the disk file)`);
    return;
  }

  summary.uploaded += 1;
  summary.verified += 1;
  console.log(`  + ${objectKey} (${formatBytes(buffer.byteLength)}) verified`);
}

async function download(objectKey) {
  const { data, error } = await supabase.storage.from(BUCKET).download(objectKey);

  if (error || !data) {
    return null;
  }

  return Buffer.from(await data.arrayBuffer());
}

// data/users/<uid>/uploads/<captures|studio>/<file>
async function collectPerUserJobs() {
  const usersDirectory = path.join(dataDirectory, "users");

  if (!existsSync(usersDirectory)) {
    return [];
  }

  const jobs = [];

  for (const entry of await readdir(usersDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (args.user && entry.name !== args.user) {
      continue;
    }

    const uploadsDirectory = path.join(usersDirectory, entry.name, "uploads");

    for (const relativePath of await listFilesRecursively(uploadsDirectory)) {
      jobs.push({
        absolutePath: path.join(uploadsDirectory, relativePath),
        ownerId: entry.name,
        storagePath: relativePath.split(path.sep).join("/"),
      });
    }
  }

  return jobs;
}

// data/uploads/** — the pre-per-user layout, still read as a fallback by the
// local backend. Only migrated when an owner is named explicitly.
async function collectLegacyJobs() {
  if (!args.legacyOwner) {
    const legacyDirectory = path.join(dataDirectory, "uploads");
    const legacyFiles = await listFilesRecursively(legacyDirectory);

    if (legacyFiles.length > 0) {
      console.log(
        `Note: ${legacyFiles.length} file(s) in ${legacyDirectory} belong to the pre-per-user layout. ` +
        "Pass --legacy-owner <uid> to migrate them under that owner.",
      );
    }

    return [];
  }

  if (args.user && args.user !== args.legacyOwner) {
    return [];
  }

  const legacyDirectory = path.join(dataDirectory, "uploads");

  return (await listFilesRecursively(legacyDirectory)).map((relativePath) => ({
    absolutePath: path.join(legacyDirectory, relativePath),
    ownerId: args.legacyOwner,
    storagePath: relativePath.split(path.sep).join("/"),
  }));
}

async function listFilesRecursively(directory, prefix = "") {
  if (!existsSync(directory)) {
    return [];
  }

  const found = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await listFilesRecursively(absolutePath, relativePath)));
      continue;
    }

    if (!(await stat(absolutePath)).isFile()) {
      continue;
    }

    if (CONTENT_TYPES[path.extname(entry.name).toLowerCase()]) {
      found.push(relativePath);
    }
  }

  return found;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function formatBytes(value) {
  return value > 1024 * 1024 ? `${(value / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
}

function parseArgs(argv) {
  const parsed = { dryRun: false, user: null, legacyOwner: null };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--user") {
      parsed.user = argv[index += 1] ?? null;
    } else if (arg === "--legacy-owner") {
      parsed.legacyOwner = argv[index += 1] ?? null;
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
