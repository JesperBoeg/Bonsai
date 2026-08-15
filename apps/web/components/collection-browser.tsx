"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ConfirmSubmitButton } from "./confirm-submit-button";

type CollectionTree = {
  id: string;
  inventoryName: string;
  speciesName: string;
  speciesSubtitle: string | null;
  styleName: string;
  photoCount: number;
  lastCapturedAt: string | null;
  lastCapturedAtLabel: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
};

type SortMode = "newest" | "name" | "recent-photo" | "photos";

type CollectionBrowserProps = {
  trees: CollectionTree[];
  deleteTreeAction: (formData: FormData) => void | Promise<void>;
};

export function CollectionBrowser({ trees, deleteTreeAction }: CollectionBrowserProps) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const visibleTrees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery.length === 0
      ? trees
      : trees.filter((tree) =>
          [tree.inventoryName, tree.speciesName, tree.speciesSubtitle ?? "", tree.styleName]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery),
        );

    return [...filtered].sort((left, right) => {
      switch (sortMode) {
        case "name":
          return left.inventoryName.localeCompare(right.inventoryName);
        case "photos":
          return right.photoCount - left.photoCount;
        case "recent-photo":
          return (right.lastCapturedAt ? new Date(right.lastCapturedAt).valueOf() : 0)
            - (left.lastCapturedAt ? new Date(left.lastCapturedAt).valueOf() : 0);
        default:
          return new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf();
      }
    });
  }, [trees, query, sortMode]);

  return (
    <>
      <section className="collection-toolbar">
        <label className="field-block collection-search">
          <span className="visually-hidden">Search the collection</span>
          <input
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search by name, species, or style..."
            type="search"
            value={query}
          />
        </label>
        <label className="field-block collection-sort">
          <span className="visually-hidden">Sort trees</span>
          <select
            onChange={(event) => {
              setSortMode(event.target.value as SortMode);
            }}
            value={sortMode}
          >
            <option value="newest">Newest trees first</option>
            <option value="name">Name A to Z</option>
            <option value="recent-photo">Recently photographed</option>
            <option value="photos">Most photos</option>
          </select>
        </label>
      </section>

      {visibleTrees.length === 0 ? (
        <section className="feature-card">
          <h2>No trees match</h2>
          <p>Try a different search, or clear the search box to see the whole collection.</p>
        </section>
      ) : (
        <section className="collection-grid">
          {visibleTrees.map((tree) => (
            <article className="collection-card" key={tree.id}>
              <div className="collection-thumb-frame">
                {tree.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={`Latest photo of ${tree.inventoryName}`} className="collection-thumb-image" src={tree.thumbnailUrl} />
                ) : (
                  <div className="collection-thumb-empty">No photo yet</div>
                )}
              </div>
              <p className="eyebrow">
                {tree.speciesSubtitle ? `${tree.speciesName} (${tree.speciesSubtitle})` : tree.speciesName}
              </p>
              <h2>{tree.inventoryName}</h2>
              <p>{tree.styleName}</p>
              <p className="stat-line">{tree.photoCount} photo{tree.photoCount === 1 ? "" : "s"}</p>
              <p className="support-text">
                {tree.lastCapturedAtLabel ? `Last photo ${tree.lastCapturedAtLabel}` : "No photos yet."}
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
    </>
  );
}
