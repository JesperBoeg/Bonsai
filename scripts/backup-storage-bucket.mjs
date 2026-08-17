#!/usr/bin/env node
// Storage half of the DIY backup guardrail (docs/GUARDRAILS.md): walks the
// `bonsai-photos` bucket, reports its total size, and optionally downloads every
// object plus a manifest so the bytes exist somewhere that is not Supabase.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/backup-storage-bucket.mjs --out backup/storage [--usage-only]
//
// Flags:
//   --out <dir>        download destination (required unless --usage-only)
//   --usage-only       measure the bucket, download nothing
//   --watermark <mb>   usage threshold in MB (default 800, the Pro-upgrade trigger)
//
// Output: a human-readable summary on stdout, plus machine-readable
// `total_bytes=`, `object_count=` and `watermark_exceeded=` lines appended to
// $GITHUB_OUTPUT when running in Actions.

import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "bonsai-photos";
const args = parseArgs(process.argv.slice(2));
const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

if (!supabaseUrl || !serviceRoleKey) {
  fail("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
}

if (!args.usageOnly && !args.out) {
  fail("Pass --out <dir> (or --usage-only to just measure the bucket).");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const objects = await listBucket("");
const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
const watermarkBytes = args.watermarkMb * 1024 * 1024;
const watermarkExceeded = totalBytes > watermarkBytes;

console.log(`Bucket ${BUCKET}: ${objects.length} object(s), ${formatBytes(totalBytes)}.`);
console.log(`Watermark: ${args.watermarkMb} MB — ${watermarkExceeded ? "EXCEEDED" : "ok"}.`);

if (!args.usageOnly) {
  const manifest = [];

  for (const object of objects) {
    const { data, error } = await supabase.storage.from(BUCKET).download(object.name);

    if (error || !data) {
      fail(`Downloading ${object.name} failed: ${error?.message ?? "no data"}`);
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const destination = path.join(args.out, ...object.name.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, buffer);
    manifest.push({
      name: object.name,
      bytes: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      updatedAt: object.updatedAt,
    });
  }

  await writeFile(
    path.join(args.out, "manifest.json"),
    `${JSON.stringify({ bucket: BUCKET, objectCount: manifest.length, totalBytes, objects: manifest }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Downloaded ${manifest.length} object(s) to ${args.out} (manifest.json written).`);
}

await writeStepOutput();

async function listBucket(prefix) {
  const found = [];
  const pageSize = 100;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) {
      fail(`Listing ${prefix || "/"} failed: ${error.message}`);
    }

    for (const entry of data ?? []) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Folders come back as rows with no id and no metadata.
      if (!entry.id) {
        found.push(...(await listBucket(name)));
        continue;
      }

      found.push({
        name,
        size: typeof entry.metadata?.size === "number" ? entry.metadata.size : 0,
        updatedAt: entry.updated_at ?? null,
      });
    }

    if ((data ?? []).length < pageSize) {
      return found;
    }
  }
}

async function writeStepOutput() {
  const outputFile = process.env.GITHUB_OUTPUT;

  if (!outputFile) {
    return;
  }

  await appendFile(
    outputFile,
    `total_bytes=${totalBytes}\nobject_count=${objects.length}\nwatermark_exceeded=${watermarkExceeded}\n`,
    "utf8",
  );
}

function formatBytes(value) {
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function parseArgs(argv) {
  const parsed = { out: null, usageOnly: false, watermarkMb: 800 };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--usage-only") {
      parsed.usageOnly = true;
    } else if (arg === "--out") {
      parsed.out = argv[index += 1] ?? null;
    } else if (arg === "--watermark") {
      parsed.watermarkMb = Number.parseInt(argv[index += 1] ?? "", 10);

      if (!Number.isFinite(parsed.watermarkMb) || parsed.watermarkMb <= 0) {
        fail("--watermark takes a positive number of megabytes.");
      }
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
