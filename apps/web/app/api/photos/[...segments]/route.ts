import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getViewer, resolvePhotoPathFromSegments } from "../../../../lib/bonsai";

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
    const userScopedPath = path.join("C:/Users/agile/VSCode projects/Bonsai/data/users", viewer.id, "uploads", ...storagePath.split("/"));
    const legacyPath = path.join("C:/Users/agile/VSCode projects/Bonsai/data/uploads", ...storagePath.split("/"));
    let filePath = userScopedPath;
    let buffer: Buffer;

    try {
      buffer = await readFile(userScopedPath);
    } catch {
      filePath = legacyPath;
      buffer = await readFile(legacyPath);
    }

    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
      headers: {
        "content-type": contentTypeForExtension(path.extname(filePath).toLowerCase()),
        "cache-control": "no-store",
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
