import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";

const PUBLIC_PATH_PREFIXES = ["/_next", "/auth", "/sign-in", "/favicon", "/manifest.webmanifest"];
const PUBLIC_API_PREFIXES = ["/api/photos"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const { response } = await updateSession(request);
    return response;
  }

  const { response } = await updateSession(request);
  return response;
}

export const config = {
  matcher: ["/((?!.*\\..*|_next/static|_next/image).*)"],
};

