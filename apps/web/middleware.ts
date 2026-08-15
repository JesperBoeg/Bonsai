import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

// Pages under these prefixes render without a session; API routes enforce
// auth themselves (they must return status codes, not redirects).
const PUBLIC_PREFIXES = [
  "/_next",
  "/auth",
  "/sign-in",
  "/favicon",
  "/manifest.webmanifest",
  "/icons",
  "/sw.js",
  "/offline.html",
  "/api",
];

export async function middleware(request: NextRequest) {
  const backend = process.env.BONSAI_DATA_BACKEND?.trim().toLowerCase();
  const isLocal = backend === "local" || (backend !== "supabase" && !process.env.NEXT_PUBLIC_SUPABASE_URL);

  if (isLocal) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const { response, user } = await updateSession(request);

  if (!user && !isPublic) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!.*\\..*|_next/static|_next/image).*)"],
};
