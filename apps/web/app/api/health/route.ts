import { NextResponse } from "next/server";
import { getDataBackend } from "../../../lib/backend";
import { getSupabaseAnonKey, getSupabaseUrl } from "../../../lib/env";

// Liveness + dependency probe. Two consumers:
//
//   1. The keep-alive cron (.github/workflows/keep-alive.yml) — its request
//      reaches Postgres, which is what makes the free plan's 7-day-idle pause
//      impossible. It reads `database` and fails the run when it is not "ok".
//   2. The host's health check (fly.toml) — a liveness probe only, so a Supabase
//      hiccup must never take the machine out of rotation. This route therefore
//      answers 200 with status "degraded" instead of 5xx when the database check
//      fails; add ?strict=1 for a 503 in that case.

export const dynamic = "force-dynamic";

type DependencyState = "ok" | "error" | "skipped";

export async function GET(request: Request) {
  const backend = getDataBackend();
  const database = backend === "supabase" ? await checkDatabase() : { state: "skipped" as DependencyState, detail: "local backend" };
  const strict = new URL(request.url).searchParams.get("strict") === "1";
  const healthy = database.state !== "error";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      backend,
      database: database.state,
      databaseDetail: database.detail,
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy || !strict ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function checkDatabase(): Promise<{ state: DependencyState; detail: string | null }> {
  try {
    // A real round trip through PostgREST to Postgres, with no session and no
    // cookies: RLS returns no rows to an anonymous caller, which is fine — the
    // point is that Postgres answered.
    const response = await fetch(`${getSupabaseUrl()}/rest/v1/species?select=id&limit=1`, {
      headers: {
        apikey: getSupabaseAnonKey(),
        authorization: `Bearer ${getSupabaseAnonKey()}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return { state: "error", detail: `postgrest ${response.status}` };
    }

    return { state: "ok", detail: null };
  } catch (error) {
    return { state: "error", detail: (error as Error).message };
  }
}
