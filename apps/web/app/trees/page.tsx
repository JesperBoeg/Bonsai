import Link from "next/link";
import { CollectionBrowser } from "../../components/collection-browser";
import { deleteTreeAction } from "./actions";
import { getRequiredViewer } from "../../lib/auth";
import { formatDisplayDate, getTreeSummaries } from "../../lib/bonsai";

export const dynamic = "force-dynamic";

export default async function TreesPage() {
  await getRequiredViewer("/trees");
  const trees = await getTreeSummaries();

  return (
    <div className="page-stack">
      <section className="section-heading">
        <p className="eyebrow">Collection</p>
        <h1>Your trees, all in one place.</h1>
        <p className="lede">
          Each tree keeps its own photo history, so you can return to the same bonsai and see how it changes over time.
        </p>
      </section>

      {trees.length === 0 ? (
        <section className="feature-card">
          <h2>No trees yet</h2>
          <p>Your first confirmed capture will add the first tree to this collection.</p>
          <Link className="button button-solid" href="/capture">
            Capture the first tree
          </Link>
        </section>
      ) : (
        <CollectionBrowser
          deleteTreeAction={deleteTreeAction}
          trees={trees.map((tree) => ({
            id: tree.id,
            inventoryName: tree.inventoryName,
            speciesName: tree.speciesName,
            speciesSubtitle: tree.speciesSubtitle,
            styleName: tree.styleName,
            photoCount: tree.photoCount,
            lastCapturedAt: tree.lastCapturedAt,
            lastCapturedAtLabel: tree.lastCapturedAt ? formatDisplayDate(tree.lastCapturedAt) : null,
            thumbnailUrl: tree.thumbnailUrl,
            createdAt: tree.createdAt,
          }))}
        />
      )}
    </div>
  );
}
