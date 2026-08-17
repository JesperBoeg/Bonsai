import { BONSAI_PHOTOS_BUCKET } from "./env";
import { getDataBackend } from "./backend";
import { createSupabaseServerClient } from "./supabase/server";
import { deletePhotoFile, readPhotoFile, writePhotoFile } from "./storage-paths";

// The single door to photo bytes. Which side it opens depends on the data
// backend, and nothing above this module needs to know which:
//
//   supabase → Supabase Storage (bucket `bonsai-photos`), so no byte ever
//              depends on a container's disk and the app stays stateless.
//   local    → the app server's disk under <repo>/data, which is the whole
//              point of the local backend.
//
// Storage keys are `<owner id>/<storage path>`: the bucket's RLS policies scope
// objects by their first path folder (`(storage.foldername(name))[1] =
// auth.uid()`), while the database keeps storing the owner-free relative path
// (`captures/...`, `studio/...`) exactly as before.

export type PhotoContentType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

// Photo objects never change once written, so they are stored with a one-year
// cache lifetime and streamed with `immutable`. Signed URLs are the exception:
// Supabase answers them with an `expires` header matching the signature, so a
// client re-fetches at most once per TTL. That is fine — the bytes behind the
// signature are still immutable — but it is why the redirect must expire first.
const IMMUTABLE_CACHE_SECONDS = 31_536_000;
const SIGNED_URL_TTL_SECONDS = 3_600;

export function buildStorageObjectKey(userId: string, storagePath: string) {
  return `${userId}/${storagePath}`;
}

export function photoContentType(storagePath: string): PhotoContentType {
  const lower = storagePath.toLowerCase();

  if (lower.endsWith(".png")) {
    return "image/png";
  }

  if (lower.endsWith(".webp")) {
    return "image/webp";
  }

  if (lower.endsWith(".gif")) {
    return "image/gif";
  }

  return "image/jpeg";
}

export async function writePhoto(userId: string, storagePath: string, buffer: Buffer): Promise<void> {
  if (getDataBackend() === "local") {
    await writePhotoFile(userId, storagePath, buffer);
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(BONSAI_PHOTOS_BUCKET)
    .upload(buildStorageObjectKey(userId, storagePath), new Uint8Array(buffer), {
      contentType: photoContentType(storagePath),
      cacheControl: String(IMMUTABLE_CACHE_SECONDS),
      upsert: true,
    });

  if (error) {
    throw new Error(`Storage upload failed for ${storagePath}: ${error.message}`);
  }
}

export async function readPhoto(userId: string, storagePath: string): Promise<Buffer> {
  if (getDataBackend() === "local") {
    return readPhotoFile(userId, storagePath);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(BONSAI_PHOTOS_BUCKET)
    .download(buildStorageObjectKey(userId, storagePath));

  if (error || !data) {
    throw new Error(`Storage download failed for ${storagePath}: ${error?.message ?? "no data"}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

/**
 * Short-lived signed URL for a photo, or null when the caller should stream the
 * bytes through the app instead (local backend, or signed URLs disabled).
 */
export async function createPhotoSignedUrl(userId: string, storagePath: string): Promise<string | null> {
  if (getDataBackend() === "local" || !isSignedPhotoServingEnabled()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(BONSAI_PHOTOS_BUCKET)
    .createSignedUrl(buildStorageObjectKey(userId, storagePath), SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function deletePhotos(userId: string, storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) {
    return;
  }

  if (getDataBackend() === "local") {
    await Promise.all(storagePaths.map((storagePath) => deletePhotoFile(userId, storagePath)));
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.storage
    .from(BONSAI_PHOTOS_BUCKET)
    .remove(storagePaths.map((storagePath) => buildStorageObjectKey(userId, storagePath)));

  if (error) {
    // Orphaned objects cost storage but must never fail the user's delete.
    console.warn(`[storage] removing ${storagePaths.length} object(s) failed: ${error.message}`);
  }
}

// Escape hatch for the photo route: if signed-URL redirects ever misbehave in a
// client (service worker, embedded webview), set BONSAI_PHOTO_SERVING=stream to
// pipe the bytes through the app again — same URLs, same cache headers.
export function isSignedPhotoServingEnabled() {
  return process.env.BONSAI_PHOTO_SERVING?.trim().toLowerCase() !== "stream";
}

export function getPhotoCacheControlHeader() {
  return `private, max-age=${IMMUTABLE_CACHE_SECONDS}, immutable`;
}

// The redirect itself must expire before the signed URL it points at, or a
// cached redirect outlives its token.
export function getSignedRedirectCacheControlHeader() {
  return `private, max-age=${Math.floor(SIGNED_URL_TTL_SECONDS / 2)}`;
}
