import Link from "next/link";
import { ConfirmSubmitButton } from "../../components/confirm-submit-button";
import { deleteTreeAction } from "./actions";
import { formatDisplayDate, getTreeSummaries } from "../../lib/bonsai";

export const dynamic = "force-dynamic";

export default async function TreesPage() {
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
        <section className="collection-grid">
          {trees.map((tree) => (
            <article className="collection-card" key={tree.id}>
              <div className="collection-thumb-frame">
                {tree.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={`Latest photo of ${tree.inventoryName}`} className="collection-thumb-image" src={tree.thumbnailUrl} />
                ) : (
                  <div className="collection-thumb-empty">No photo yet</div>
                )}
              </div>
              <p className="eyebrow">{formatSpeciesDisplayLabel(tree.speciesName, tree.speciesSubtitle)}</p>
              <h2>{tree.inventoryName}</h2>
              <p>{tree.styleName}</p>
              <p className="stat-line">{tree.photoCount} photo{tree.photoCount === 1 ? "" : "s"}</p>
              <p className="support-text">
                {tree.lastCapturedAt
                  ? `Last photo ${formatDisplayDate(tree.lastCapturedAt)}`
                  : "No photos yet."}
              </p>
              <div className="capture-step-actions">
                <Link className="button button-solid" href={`/trees/${tree.id}`}>
                  Open tree
                </Link>
                <form action={deleteTreeAction}>
                  <input name="treeId" type="hidden" value={tree.id} />
                  <ConfirmSubmitButton
                    className="button button-ghost"
                    confirmationMessage={`Delete ${tree.inventoryName}? This cannot be undone.`}
                    pendingLabel="Deleting the tree..."
                  >
                    Delete tree
                  </ConfirmSubmitButton>
                </form>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function formatSpeciesDisplayLabel(label: string, subtitle: string | null) {
  return subtitle ? `${label} (${subtitle})` : label;
}
