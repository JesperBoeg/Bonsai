import Link from "next/link";
import { notFound } from "next/navigation";
import { CaptureReviewWizard } from "../../../components/capture-review-wizard";
import { getCaptureReviewData } from "../../../lib/bonsai";
import { confirmExistingTreeAction, createTreeFromCaptureAction } from "../../capture/actions";

type CaptureReviewPageProps = {
  params: Promise<{
    submissionId: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function CaptureReviewPage({ params }: CaptureReviewPageProps) {
  const { submissionId } = await params;
  const review = await getCaptureReviewData(undefined, undefined, submissionId);

  if (!review) {
    notFound();
  }

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">Review</p>
        <h1>{review.captureIntent === "existing-tree" ? "Confirm where this photo belongs." : "Finish adding this tree."}</h1>
        <p className="lede">
          {review.captureIntent === "existing-tree"
            ? "If the suggested tree looks right, confirm it. Otherwise choose the tree yourself."
            : "Move one step at a time, change anything that looks off, then give the tree its name before saving it to your collection."}
        </p>
      </section>

      {review.status === "confirmed" && review.finalizedTreeId ? (
        <section className="feature-card">
          <h2>Already finalized</h2>
          <p>This capture has already been confirmed onto a tree timeline.</p>
          <Link className="button button-solid" href={`/trees/${review.finalizedTreeId}`}>
            Open tree timeline
          </Link>
        </section>
      ) : (
        <CaptureReviewWizard
          confirmExistingTreeAction={confirmExistingTreeAction}
          createTreeFromCaptureAction={createTreeFromCaptureAction}
          review={review}
        />
      )}
    </div>
  );
}
