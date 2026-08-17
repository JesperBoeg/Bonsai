import { NextResponse } from "next/server";
import { getViewer, resolvePhotoPathFromSegments } from "../../../../lib/bonsai";
import {
  createPhotoSignedUrl,
  getPhotoCacheControlHeader,
  getSignedRedirectCacheControlHeader,
  photoContentType,
  readPhoto,
} from "../../../../lib/photo-storage";

type PhotoRouteProps = {
  params: Promise<{
    segments: string[];
  }>;
};

export async function GET(_: Request, { params }: PhotoRouteProps) {
  const { segments } = await params;
  const storagePath = resolvePhotoPathFromSegments(segments);

  if (!storagePath) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const viewer = await getViewer();

    // In supabase mode the bytes live in Storage: hand the browser a
    // short-lived signed URL so the CDN serves them, instead of proxying every
    // image through the app. Local mode (and the `stream` escape hatch) falls
    // through to streaming below.
    const signedUrl = await createPhotoSignedUrl(viewer.id, storagePath);

    if (signedUrl) {
      return NextResponse.redirect(signedUrl, {
        status: 307,
        headers: { "cache-control": getSignedRedirectCacheControlHeader() },
      });
    }

    const buffer = await readPhoto(viewer.id, storagePath);
    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
      headers: {
        "content-type": photoContentType(storagePath),
        // Capture files never change once written; let the browser cache them.
        "cache-control": getPhotoCacheControlHeader(),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
