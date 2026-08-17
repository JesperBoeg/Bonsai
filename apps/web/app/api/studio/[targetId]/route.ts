import { NextResponse } from "next/server";
import { getOptionalViewer } from "../../../../lib/auth";
import { getCollectionStore } from "../../../../lib/store";
import { sweepInterruptedTargets } from "../../../../lib/studio";

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
  const record = await store.getTargetState(viewer, targetId);

  if (!record) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // The poller is the first thing to notice a design whose process died, so it
  // sweeps too — otherwise the UI spins on a job that no longer exists.
  const [target] = await sweepInterruptedTargets(viewer, [record]);

  return NextResponse.json({
    id: target.id,
    status: target.status,
    errorMessage: target.errorMessage,
    hasImage: target.imagePath !== null,
  }, { headers: { "cache-control": "no-store" } });
}
