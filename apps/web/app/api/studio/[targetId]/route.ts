import { NextResponse } from "next/server";
import { getOptionalViewer } from "../../../../lib/auth";
import { getCollectionStore } from "../../../../lib/store";

type StudioRouteProps = {
  params: Promise<{
    targetId: string;
  }>;
};

// Polled by the Studio UI while a target-state generation is running.
export async function GET(_: Request, { params }: StudioRouteProps) {
  const { targetId } = await params;
  const viewer = await getOptionalViewer();

  if (!viewer) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const store = getCollectionStore();
  const target = await store.getTargetState(viewer, targetId);

  if (!target) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: target.id,
    status: target.status,
    errorMessage: target.errorMessage,
    hasImage: target.imagePath !== null,
  });
}
