export type DataBackend = "supabase" | "local";

// One authoritative data backend per deployment. "supabase" is the hosted
// production mode (Postgres + RLS); "local" is a self-contained file-backed mode
// for development, demos, and offline use — no Supabase project required.
export function getDataBackend(): DataBackend {
  const configured = process.env.BONSAI_DATA_BACKEND?.trim().toLowerCase();

  if (configured === "local" || configured === "supabase") {
    return configured;
  }

  return process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local";
}

export function isLocalBackend() {
  return getDataBackend() === "local";
}
