export const BONSAI_PHOTOS_BUCKET = "bonsai-photos";

function readRequiredEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
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

// Optional: identity matching degrades gracefully when the vision service is
// not configured or unreachable.
export function getVisionServiceUrl(): string | null {
  return process.env.VISION_SERVICE_URL?.trim() || null;
}

export function getAnthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export type ImageProviderName = "gemini" | "mock" | "none";

export function getImageProviderName(): ImageProviderName {
  const configured = process.env.BONSAI_IMAGE_PROVIDER?.trim().toLowerCase();

  if (configured === "gemini" || configured === "mock" || configured === "none") {
    return configured;
  }

  return getGeminiApiKey() ? "gemini" : "none";
}
