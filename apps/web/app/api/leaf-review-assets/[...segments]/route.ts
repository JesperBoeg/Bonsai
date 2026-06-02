import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveLeafReviewAssetPathFromSegments } from "../../../../lib/leaf-review";

type LeafReviewAssetRouteProps = {
  params: Promise<{
    segments: string[];
  }>;
};

export async function GET(_: Request, { params }: LeafReviewAssetRouteProps) {
  const { segments } = await params;
  const filePath = resolveLeafReviewAssetPathFromSegments(segments);

  if (!filePath) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const buffer = await readFile(filePath);
    return new NextResponse(buffer, {
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