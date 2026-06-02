import { getTreeSummaries } from "../../lib/bonsai";
import { CaptureLab } from "../../components/capture-lab";
import { createCaptureSubmissionAction } from "./actions";
import { getRequiredViewer } from "../../lib/auth";

export const dynamic = "force-dynamic";

type CapturePageProps = {
  searchParams?: Promise<{
    error?: string | string[];
  }>;
};

export default async function CapturePage({ searchParams }: CapturePageProps) {
  const viewer = await getRequiredViewer("/capture");
  const treeCount = (await getTreeSummaries()).length;
  const params = searchParams ? await searchParams : undefined;
  const errorMessage = typeof params?.error === "string" ? params.error : null;

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">Capture</p>
        <h1>Add a tree or a new photo.</h1>
        <p className="lede">
          Work one step at a time: decide whether the photo belongs to a tree you already keep or to one you are adding, confirm each photo, then review the tree details before saving.
        </p>
      </section>
      <CaptureLab action={createCaptureSubmissionAction} errorMessage={errorMessage} treeCount={treeCount} userEmail={viewer.email} />
    </div>
  );
}
