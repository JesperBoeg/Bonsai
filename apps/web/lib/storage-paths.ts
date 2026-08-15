import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// All photo bytes live on the app server's disk under <repo>/data. On Render this
// resolves to the persistent disk mounted at /app/data; locally it is the repo's
// data directory. Every module that touches photo files MUST go through these
// helpers — hardcoded absolute paths are what broke the photo route in production.

let cachedRepoRoot: string | null = null;

// Resolve the repository root by walking up from the working directory looking
// for a known marker, instead of assuming a fixed depth. `next dev apps/web`
// and `npm run dev --workspace bonsai-web` have different working directories,
// and a fixed "../.." silently resolves outside the repo in one of them.
export function getRepoRoot() {
  if (cachedRepoRoot) {
    return cachedRepoRoot;
  }

  const override = process.env.BONSAI_REPO_ROOT?.trim();

  if (override) {
    cachedRepoRoot = path.resolve(override);
    return cachedRepoRoot;
  }

  let directory = process.cwd();

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(directory, "services", "vision", "catalog"))) {
      cachedRepoRoot = directory;
      return cachedRepoRoot;
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      break;
    }

    directory = parent;
  }

  // Fall back to the historical layout assumption (cwd = apps/web).
  cachedRepoRoot = path.resolve(process.cwd(), "../..");
  return cachedRepoRoot;
}

export function getDataDirectory() {
  return path.join(getRepoRoot(), "data");
}

export function getUserDataDirectory(userId: string) {
  return path.join(getDataDirectory(), "users", userId);
}

export function getUploadsDirectory(userId: string) {
  return path.join(getUserDataDirectory(userId), "uploads");
}

export function getAbsolutePhotoPath(userId: string, storagePath: string) {
  return path.join(getUploadsDirectory(userId), ...storagePath.split("/"));
}

export function getLegacyPhotoPath(storagePath: string) {
  return path.join(getDataDirectory(), "uploads", ...storagePath.split("/"));
}

export async function ensureUploadDirectories(userId: string) {
  await mkdir(path.join(getUploadsDirectory(userId), "captures"), { recursive: true });
  await mkdir(path.join(getUploadsDirectory(userId), "studio"), { recursive: true });
}

export async function writePhotoFile(userId: string, storagePath: string, buffer: Buffer) {
  await ensureUploadDirectories(userId);
  await writeFile(getAbsolutePhotoPath(userId, storagePath), buffer);
}

export async function readPhotoFile(userId: string, storagePath: string): Promise<Buffer> {
  try {
    return await readFile(getAbsolutePhotoPath(userId, storagePath));
  } catch {
    return await readFile(getLegacyPhotoPath(storagePath));
  }
}

export async function deletePhotoFile(userId: string, storagePath: string) {
  await unlink(getAbsolutePhotoPath(userId, storagePath)).catch(async () => {
    await unlink(getLegacyPhotoPath(storagePath)).catch(() => undefined);
  });
}
