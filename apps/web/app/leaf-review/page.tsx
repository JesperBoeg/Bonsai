import { LeafReviewLab } from "../../components/leaf-review-lab";
import { requireAdmin } from "../../lib/auth";
import { getLeafReviewData } from "../../lib/leaf-review";

export const dynamic = "force-dynamic";

type LeafReviewPageProps = {
  searchParams: Promise<{
    slug?: string;
  }>;
};

export default async function LeafReviewPage({ searchParams }: LeafReviewPageProps) {
  await requireAdmin("/leaf-review");
  const { slug } = await searchParams;
  const data = await getLeafReviewData(slug);

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">Leaf source review</p>
        <h1>Reject bad source photos or draw the exact crop box you want to keep.</h1>
        <p className="lede">
          This local tool edits the leaf source overrides, refreshes the selected species only, and rebuilds the runtime leaf index from that narrower change.
        </p>
      </section>

      <LeafReviewLab initialData={data} />
    </div>
  );
}