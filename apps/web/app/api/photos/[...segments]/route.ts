import path from "node:path";
import { NextResponse } from "next/server";
import { getViewer, resolvePhotoPathFromSegments } from "../../../../lib/bonsai";
import { readPhotoFile } from "../../../../lib/storage-paths";

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
    const buffer = await readPhotoFile(viewer.id, storagePath);
    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
      headers: {
        "content-type": contentTypeForExtension(path.extname(storagePath).toLowerCase()),
        // Capture files never change once written; let the browser cache them.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

function contentTypeForExtension(extension: string) {
  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
