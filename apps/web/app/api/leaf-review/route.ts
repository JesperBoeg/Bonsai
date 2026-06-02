import { NextResponse } from "next/server";
import { applyLeafReviewDecision, getLeafReviewData, saveLeafReviewSpeciesNote } from "../../../lib/leaf-review";
import { getOptionalViewer } from "../../../lib/auth";

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Leaf review update failed.";
}

export async function POST(request: Request) {
  try {
    const viewer = await getOptionalViewer();

    if (!viewer?.isAdmin) {
      return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    }

    const payload = await request.json() as {
      action?: unknown;
      slug?: unknown;
      sourceName?: unknown;
      externalId?: unknown;
      cropBox?: unknown;
      note?: unknown;
    };

    if (payload.action !== "reject-source" && payload.action !== "accept-crop" && payload.action !== "save-species-note") {
      return NextResponse.json({ message: "Invalid leaf review action." }, { status: 400 });
    }

    if (payload.action === "save-species-note") {
      if (typeof payload.slug !== "string" || typeof payload.note !== "string") {
        return NextResponse.json({ message: "The selected species note is incomplete." }, { status: 400 });
      }

      const result = await saveLeafReviewSpeciesNote({
        slug: payload.slug,
        note: payload.note,
      });

      const message = result.note.length > 0 ? "Species note saved." : "Species note cleared.";
      const pageData = await getLeafReviewData(result.slug);

      return NextResponse.json({
        message,
        slug: result.slug,
        note: result.note,
        pageData,
      });
    }

    if (typeof payload.slug !== "string" || typeof payload.sourceName !== "string" || typeof payload.externalId !== "string") {
      return NextResponse.json({ message: "The selected source image is incomplete." }, { status: 400 });
    }

    const result = await applyLeafReviewDecision({
      action: payload.action,
      slug: payload.slug,
      sourceName: payload.sourceName,
      externalId: payload.externalId,
      cropBox: payload.cropBox as [number, number, number, number] | undefined,
    });

    const message = payload.action === "reject-source"
      ? "Source rejected and the species manifest was refreshed."
      : "Crop accepted and the species manifest was refreshed.";
    const pageData = await getLeafReviewData(payload.slug);

    return NextResponse.json({
      message,
      refreshSummary: result.refreshSummary,
      sourceAssetId: result.sourceAssetId,
      pageData,
    });
  } catch (error) {
    return NextResponse.json({ message: readErrorMessage(error) }, { status: 400 });
  }
}