export const BONSAI_PHOTOS_BUCKET = "bonsai-photos";

function readRequiredEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "NEXT_PUBLIC_SITE_URL" | "VISION_SERVICE_URL") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
}

export function getSupabaseUrl() {
  return readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function getSupabaseAnonKey() {
  return readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export function getSiteUrl() {
  return readRequiredEnv("NEXT_PUBLIC_SITE_URL");
}

export function getVisionServiceUrl() {
  return readRequiredEnv("VISION_SERVICE_URL");
}
