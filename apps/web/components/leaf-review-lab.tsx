"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { LeafCropBox, LeafReviewPageData, LeafReviewSourceEntry } from "../lib/leaf-review";

type LeafReviewLabProps = {
  initialData: LeafReviewPageData;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
};

export function LeafReviewLab({ initialData }: LeafReviewLabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pageData, setPageData] = useState(initialData);
  const pageDataRef = useRef(initialData);
  const [busySourceAssetIds, setBusySourceAssetIds] = useState<Record<string, true>>({});
  const [isSavingSpeciesNote, setIsSavingSpeciesNote] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(initialData.statusMessage);
  const [speciesNoteDraft, setSpeciesNoteDraft] = useState(initialData.selectedSpeciesNote);
  const [draftCropBoxes, setDraftCropBoxes] = useState<Record<string, LeafCropBox | null>>(() => buildDraftCropBoxes(initialData.sourceEntries));

  useEffect(() => {
    pageDataRef.current = initialData;
    setPageData(initialData);
    setDraftCropBoxes(buildDraftCropBoxes(initialData.sourceEntries));
  }, [initialData]);

  useEffect(() => {
    pageDataRef.current = pageData;
  }, [pageData]);

  useEffect(() => {
    setStatusMessage(initialData.statusMessage);
  }, [initialData.statusMessage]);

  useEffect(() => {
    setSpeciesNoteDraft(pageData.selectedSpeciesNote);
  }, [pageData.selectedSlug, pageData.selectedSpeciesNote]);

  const selectedSpeciesLabel = pageData.selectedSpecies
    ? `${pageData.selectedSpecies.label}${pageData.selectedSpecies.subtitle ? ` / ${pageData.selectedSpecies.subtitle}` : ""}`
    : "No species selected";
  const hasBusySourceMutations = Object.keys(busySourceAssetIds).length > 0;
  const speciesSelectDisabled = isPending;
  const noteControlsDisabled = isPending || hasBusySourceMutations || isSavingSpeciesNote;
  const saveNoteDisabled = noteControlsDisabled || !pageData.selectedSlug || speciesNoteDraft === pageData.selectedSpeciesNote;

  function markSourceBusy(sourceAssetId: string, isBusy: boolean) {
    setBusySourceAssetIds((currentValue) => {
      if (isBusy) {
        if (currentValue[sourceAssetId]) {
          return currentValue;
        }

        return {
          ...currentValue,
          [sourceAssetId]: true,
        };
      }

      if (!currentValue[sourceAssetId]) {
        return currentValue;
      }

      const nextValue = { ...currentValue };
      delete nextValue[sourceAssetId];
      return nextValue;
    });
  }

  function applyRefreshedPageData(nextPageData: LeafReviewPageData) {
    const previousPageData = pageDataRef.current;

    if (nextPageData.selectedSlug !== previousPageData.selectedSlug) {
      const mergedPageData = {
        ...previousPageData,
        species: nextPageData.species,
        selectedSpecies: nextPageData.species.find((entry) => entry.slug === previousPageData.selectedSlug) ?? previousPageData.selectedSpecies,
      };

      pageDataRef.current = mergedPageData;
      setPageData(mergedPageData);
      return false;
    }

    setDraftCropBoxes((currentValue) => mergeDraftCropBoxes(currentValue, previousPageData.sourceEntries, nextPageData.sourceEntries));
    pageDataRef.current = nextPageData;
    setPageData(nextPageData);
    return true;
  }

  async function postLeafReviewDecision(payload: {
    action: "reject-source" | "accept-crop";
    slug: string;
    sourceName: string;
    externalId: string;
    cropBox?: LeafCropBox;
  }): Promise<{ message?: string; pageData: LeafReviewPageData }> {
    const response = await fetch("/api/leaf-review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responsePayload = await response.json() as { message?: string; pageData?: LeafReviewPageData };
    if (!response.ok) {
      throw new Error(typeof responsePayload.message === "string" && responsePayload.message.length > 0 ? responsePayload.message : "Leaf review update failed.");
    }
    if (!responsePayload.pageData) {
      throw new Error("Leaf review update did not return refreshed data.");
    }

    return {
      message: responsePayload.message,
      pageData: responsePayload.pageData,
    };
  }

  async function postSpeciesNote(slug: string, note: string): Promise<{ message?: string; pageData: LeafReviewPageData }> {
    const response = await fetch("/api/leaf-review", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "save-species-note",
        slug,
        note,
      }),
    });

    const responsePayload = await response.json() as { message?: string; pageData?: LeafReviewPageData };
    if (!response.ok) {
      throw new Error(typeof responsePayload.message === "string" && responsePayload.message.length > 0 ? responsePayload.message : "Leaf review update failed.");
    }
    if (!responsePayload.pageData) {
      throw new Error("Leaf review update did not return refreshed data.");
    }

    return {
      message: responsePayload.message,
      pageData: responsePayload.pageData,
    };
  }

  async function handleRejectSource(entry: LeafReviewSourceEntry) {
    markSourceBusy(entry.sourceAssetId, true);
    setStatusMessage(null);

    try {
      const responsePayload = await postLeafReviewDecision({
        action: "reject-source",
        slug: entry.slug,
        sourceName: entry.sourceName,
        externalId: entry.externalId,
      });
      const stayedOnSameSpecies = applyRefreshedPageData(responsePayload.pageData);
      if (stayedOnSameSpecies) {
        setStatusMessage(responsePayload.message ?? "Source rejected.");
      }
    } catch (error) {
      setStatusMessage(readClientErrorMessage(error));
    } finally {
      markSourceBusy(entry.sourceAssetId, false);
    }
  }

  async function handleAcceptCrop(entry: LeafReviewSourceEntry) {
    const cropBox = draftCropBoxes[entry.sourceAssetId] ?? null;
    if (!cropBox) {
      setStatusMessage("Draw a crop box before accepting the source image.");
      return;
    }

    markSourceBusy(entry.sourceAssetId, true);
    setStatusMessage(null);

    try {
      const responsePayload = await postLeafReviewDecision({
        action: "accept-crop",
        slug: entry.slug,
        sourceName: entry.sourceName,
        externalId: entry.externalId,
        cropBox,
      });
      const stayedOnSameSpecies = applyRefreshedPageData(responsePayload.pageData);
      if (stayedOnSameSpecies) {
        setStatusMessage(responsePayload.message ?? "Crop accepted.");
      }
    } catch (error) {
      setStatusMessage(readClientErrorMessage(error));
    } finally {
      markSourceBusy(entry.sourceAssetId, false);
    }
  }

  async function handleSaveSpeciesNote() {
    if (!pageData.selectedSlug) {
      setStatusMessage("Choose a species before saving a note.");
      return;
    }

    const selectedSlug = pageData.selectedSlug;

    setIsSavingSpeciesNote(true);
    setStatusMessage(null);

    try {
      const responsePayload = await postSpeciesNote(selectedSlug, speciesNoteDraft);
      const stayedOnSameSpecies = applyRefreshedPageData(responsePayload.pageData);
      if (stayedOnSameSpecies) {
        setStatusMessage(responsePayload.message ?? (speciesNoteDraft.trim().length > 0 ? "Species note saved." : "Species note cleared."));
      }
    } catch (error) {
      setStatusMessage(readClientErrorMessage(error));
    } finally {
      setIsSavingSpeciesNote(false);
    }
  }

  function handleSpeciesChange(nextSlug: string) {
    startTransition(() => {
      router.push(`/leaf-review?slug=${encodeURIComponent(nextSlug)}`);
    });
  }

  function updateDraftCropBox(sourceAssetId: string, cropBox: LeafCropBox | null) {
    setDraftCropBoxes((currentValue) => ({
      ...currentValue,
      [sourceAssetId]: cropBox,
    }));
  }

  return (
    <div className="leaf-review-shell">
      <section className="feature-card leaf-review-toolbar">
        <div>
          <p className="eyebrow">Selected species</p>
          <h2>{selectedSpeciesLabel}</h2>
          <p>Review one species at a time. Each action updates the override files and refreshes just that species in the leaf manifests.</p>
        </div>
        <div className="leaf-review-toolbar-controls">
          <label className="leaf-review-select-block">
            <span>Species</span>
            <select
              disabled={speciesSelectDisabled}
              onChange={(event) => {
                handleSpeciesChange(event.target.value);
              }}
              value={pageData.selectedSlug ?? ""}
            >
              {pageData.species.map((speciesEntry) => (
                <option key={speciesEntry.slug} value={speciesEntry.slug}>
                  {formatSpeciesOptionLabel(speciesEntry)}
                </option>
              ))}
            </select>
          </label>
          <label className="leaf-review-note-block">
            <span>Species note</span>
            <textarea
              disabled={noteControlsDisabled || !pageData.selectedSlug}
              onChange={(event) => {
                setSpeciesNoteDraft(event.target.value);
              }}
              placeholder="Add a species-wide note, for example: only flower photos, no usable leaf closeups, or the species is underrepresented."
              rows={5}
              value={speciesNoteDraft}
            />
          </label>
          <div className="leaf-review-note-actions">
            <button
              className="button button-solid"
              disabled={saveNoteDisabled}
              onClick={() => {
                void handleSaveSpeciesNote();
              }}
              type="button"
            >
              {isSavingSpeciesNote ? "Saving…" : speciesNoteDraft.trim().length > 0 ? "Save note" : "Clear saved note"}
            </button>
            <button
              className="button button-ghost"
              disabled={noteControlsDisabled || speciesNoteDraft === pageData.selectedSpeciesNote}
              onClick={() => {
                setSpeciesNoteDraft(pageData.selectedSpeciesNote);
              }}
              type="button"
            >
              Reset note
            </button>
          </div>
          <p className="support-text">Use this for species-wide gaps or problems. Saving an empty note clears the stored comment.</p>
        </div>
      </section>

      {statusMessage ? (
        <section className="feature-card">
          <p className="status-strip">{statusMessage}</p>
        </section>
      ) : null}

      {pageData.selectedSpecies ? (
        <section className="leaf-review-summary-grid">
          <article className="feature-card">
            <span className="formula-card-label">Source photos</span>
            <strong>{pageData.selectedSpecies.sourcePhotoCount}</strong>
          </article>
          <article className="feature-card">
            <span className="formula-card-label">Candidate patches</span>
            <strong>{pageData.selectedSpecies.candidateCount}</strong>
          </article>
          <article className="feature-card">
            <span className="formula-card-label">Runtime patches</span>
            <strong>{pageData.selectedSpecies.runtimeCount}</strong>
          </article>
          <article className="feature-card">
            <span className="formula-card-label">Pending</span>
            <strong>{pageData.selectedSpecies.pendingCount}</strong>
          </article>
          <article className="feature-card">
            <span className="formula-card-label">Rejected sources</span>
            <strong>{pageData.selectedSpecies.excludedCount}</strong>
          </article>
          <article className="feature-card">
            <span className="formula-card-label">Manual crops</span>
            <strong>{pageData.selectedSpecies.manualCropCount}</strong>
          </article>
        </section>
      ) : null}

      {pageData.sourceEntries.length === 0 ? (
        <section className="feature-card">
          <h2>No source photos for this species</h2>
          <p>There is nothing to review yet for this species.</p>
        </section>
      ) : (
        <section className="leaf-review-grid">
          {pageData.sourceEntries.map((entry) => (
            <LeafSourceReviewCard
              busy={Boolean(busySourceAssetIds[entry.sourceAssetId])}
              draftCropBox={draftCropBoxes[entry.sourceAssetId] ?? null}
              entry={entry}
              key={entry.sourceAssetId}
              onAcceptCrop={handleAcceptCrop}
              onRejectSource={handleRejectSource}
              onUpdateDraftCrop={updateDraftCropBox}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function LeafSourceReviewCard({
  entry,
  draftCropBox,
  onUpdateDraftCrop,
  onAcceptCrop,
  onRejectSource,
  busy,
}: {
  entry: LeafReviewSourceEntry;
  draftCropBox: LeafCropBox | null;
  onUpdateDraftCrop: (sourceAssetId: string, cropBox: LeafCropBox | null) => void;
  onAcceptCrop: (entry: LeafReviewSourceEntry) => Promise<void>;
  onRejectSource: (entry: LeafReviewSourceEntry) => Promise<void>;
  busy: boolean;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const cropAspectRatio = useMemo(() => readCropAspectRatio(entry), [entry]);

  useEffect(() => {
    const frameElement = frameRef.current;
    if (!frameElement) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const nextEntry = entries[0];
      if (!nextEntry) {
        return;
      }
      setDisplaySize({
        width: nextEntry.contentRect.width,
        height: nextEntry.contentRect.height,
      });
    });

    observer.observe(frameElement);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!imageElement) {
      setNaturalSize(null);
      return undefined;
    }

    const currentImageElement = imageElement;

    function syncNaturalSize() {
      if (currentImageElement.naturalWidth > 0 && currentImageElement.naturalHeight > 0) {
        setNaturalSize({
          width: currentImageElement.naturalWidth,
          height: currentImageElement.naturalHeight,
        });
      }
    }

    setNaturalSize(null);
    syncNaturalSize();
    currentImageElement.addEventListener("load", syncNaturalSize);

    return () => {
      currentImageElement.removeEventListener("load", syncNaturalSize);
    };
  }, [entry.sourceImageUrl]);

  useEffect(() => {
    const frameElement = frameRef.current;
    if (!frameElement) {
      return undefined;
    }

    const currentFrameElement = frameElement;

    function handlePointerDown(event: PointerEvent) {
      if (!naturalSize) {
        return;
      }

      event.preventDefault();
      const frameRect = currentFrameElement.getBoundingClientRect();
      const startX = clamp(event.clientX - frameRect.left, 0, frameRect.width);
      const startY = clamp(event.clientY - frameRect.top, 0, frameRect.height);
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX,
        startY,
      };
      currentFrameElement.setPointerCapture(event.pointerId);
      onUpdateDraftCrop(entry.sourceAssetId, buildNaturalCropBox(startX, startY, startX, startY, frameRect, naturalSize, cropAspectRatio));
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current;
      if (!naturalSize || !dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const frameRect = currentFrameElement.getBoundingClientRect();
      const nextX = clamp(event.clientX - frameRect.left, 0, frameRect.width);
      const nextY = clamp(event.clientY - frameRect.top, 0, frameRect.height);
      onUpdateDraftCrop(entry.sourceAssetId, buildNaturalCropBox(dragState.startX, dragState.startY, nextX, nextY, frameRect, naturalSize, cropAspectRatio));
    }

    function clearPointerDrag(event: PointerEvent) {
      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      dragStateRef.current = null;
      if (currentFrameElement.hasPointerCapture(event.pointerId)) {
        currentFrameElement.releasePointerCapture(event.pointerId);
      }
    }

    currentFrameElement.addEventListener("pointerdown", handlePointerDown);
    currentFrameElement.addEventListener("pointermove", handlePointerMove);
    currentFrameElement.addEventListener("pointerup", clearPointerDrag);
    currentFrameElement.addEventListener("pointercancel", clearPointerDrag);

    return () => {
      currentFrameElement.removeEventListener("pointerdown", handlePointerDown);
      currentFrameElement.removeEventListener("pointermove", handlePointerMove);
      currentFrameElement.removeEventListener("pointerup", clearPointerDrag);
      currentFrameElement.removeEventListener("pointercancel", clearPointerDrag);
    };
  }, [cropAspectRatio, entry.sourceAssetId, naturalSize, onUpdateDraftCrop]);

  const renderedCropBox = useMemo(() => {
    if (!draftCropBox || !naturalSize || !displaySize) {
      return null;
    }

    return projectCropBoxToDisplay(draftCropBox, naturalSize, displaySize);
  }, [displaySize, draftCropBox, naturalSize]);

  const statusBadges = buildStatusBadges(entry);

  return (
    <article className={`source-review-card${entry.excluded ? " source-review-card-excluded" : ""}`}>
      <div className="source-review-card-head">
        <div>
          <p className="eyebrow">{entry.sourceName}</p>
          <h2>{entry.externalId}</h2>
          <p className="support-text">{entry.licenseCode ? `License: ${entry.licenseCode}` : "License not recorded."}</p>
        </div>
        <div className="badge-row">
          {statusBadges.map((badge) => (
            <span className={`status-badge ${badge.tone}`} key={badge.label}>{badge.label}</span>
          ))}
        </div>
      </div>

      <div className="source-review-media-grid">
        <div>
          <div className="source-preview-frame" ref={frameRef}>
            <img
              alt={`${entry.label} source ${entry.externalId}`}
              draggable={false}
              onDragStart={(event) => {
                event.preventDefault();
              }}
              ref={imageRef}
              src={entry.sourceImageUrl}
            />
            {renderedCropBox ? <div className="crop-box-overlay" style={renderedCropBox} /> : null}
          </div>
          <p className="helper-text">Drag on the source image to draw the crop box in the exact area you want to keep.</p>
        </div>

        <div className="source-review-inspector">
          <div className="patch-preview-panel">
            <strong>Current patch</strong>
            {entry.candidatePatchUrl ? (
              <img alt={`${entry.label} patch ${entry.externalId}`} className="patch-preview-image" src={buildPatchPreviewUrl(entry)} />
            ) : (
              <div className="preview-empty">No patch is currently generated for this source image.</div>
            )}
          </div>

          <div className="source-review-meta">
            <p><strong>Source image path:</strong> {entry.sourceImagePath ?? "Remote only"}</p>
            <p><strong>Current crop source:</strong> {entry.currentCropBoxSource ?? "none"}</p>
            <p><strong>Crop box:</strong> {formatCropBox(draftCropBox)}</p>
            <p><strong>Crop score:</strong> {entry.cropScore !== null ? entry.cropScore.toFixed(3) : "n/a"}</p>
            {entry.reviewReasons.length > 0 ? <p><strong>Review reasons:</strong> {entry.reviewReasons.join(", ")}</p> : null}
            <div className="inline-link-row">
              {entry.recordUrl ? <a href={entry.recordUrl} rel="noreferrer" target="_blank">Open source record</a> : null}
              {entry.remoteUrl ? <a href={entry.remoteUrl} rel="noreferrer" target="_blank">Open remote image</a> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="action-row">
        <button
          className="button button-solid"
          disabled={!draftCropBox || busy}
          onClick={() => {
            void onAcceptCrop(entry);
          }}
          type="button"
        >
          {busy ? "Refreshing…" : "Accept crop"}
        </button>
        <button
          className="button button-ghost"
          disabled={busy}
          onClick={() => {
            void onRejectSource(entry);
          }}
          type="button"
        >
          Reject source
        </button>
        <button
          className="button button-ghost"
          disabled={busy}
          onClick={() => {
            onUpdateDraftCrop(entry.sourceAssetId, entry.currentCropBox);
          }}
          type="button"
        >
          Reset draft
        </button>
        <button
          className="button button-ghost"
          disabled={busy}
          onClick={() => {
            onUpdateDraftCrop(entry.sourceAssetId, null);
          }}
          type="button"
        >
          Clear draft
        </button>
      </div>
    </article>
  );
}

function buildDraftCropBoxes(sourceEntries: LeafReviewSourceEntry[]) {
  return Object.fromEntries(sourceEntries.map((entry) => [entry.sourceAssetId, entry.currentCropBox]));
}

function mergeDraftCropBoxes(
  currentDraftCropBoxes: Record<string, LeafCropBox | null>,
  previousSourceEntries: LeafReviewSourceEntry[],
  nextSourceEntries: LeafReviewSourceEntry[],
) {
  const previousCropBoxes = new Map(previousSourceEntries.map((entry) => [entry.sourceAssetId, entry.currentCropBox ?? null]));

  return Object.fromEntries(nextSourceEntries.map((entry) => {
    const currentDraftCropBox = currentDraftCropBoxes[entry.sourceAssetId] ?? null;
    const previousCropBox = previousCropBoxes.get(entry.sourceAssetId) ?? null;

    return [
      entry.sourceAssetId,
      cropBoxesEqual(currentDraftCropBox, previousCropBox) ? entry.currentCropBox : currentDraftCropBox,
    ];
  }));
}

function formatSpeciesOptionLabel(speciesEntry: LeafReviewPageData["species"][number]) {
  return `${speciesEntry.label} · ${speciesEntry.pendingCount} pending · ${speciesEntry.excludedCount} rejected`;
}

function buildStatusBadges(entry: LeafReviewSourceEntry) {
  const badges: Array<{ label: string; tone: string }> = [];
  if (entry.approved) {
    badges.push({ label: "Runtime approved", tone: "tone-good" });
  } else if (entry.pending) {
    badges.push({ label: "Pending review", tone: "tone-warn" });
  }

  if (entry.rejected) {
    badges.push({ label: "Patch rejected", tone: "tone-bad" });
  }
  if (entry.excluded) {
    badges.push({ label: "Source rejected", tone: "tone-bad" });
  }
  if (entry.currentCropBoxSource === "manual") {
    badges.push({ label: "Manual crop", tone: "tone-neutral" });
  }
  if (entry.manualCropApplied) {
    badges.push({ label: "Manual patch live", tone: "tone-neutral" });
  }

  return badges;
}

function buildNaturalCropBox(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  frameRect: DOMRect,
  naturalSize: { width: number; height: number },
  aspectRatio: number,
): LeafCropBox | null {
  const constrainedPoint = constrainDisplayPointToAspectRatio(startX, startY, endX, endY, frameRect, aspectRatio);
  const left = Math.min(startX, constrainedPoint.x);
  const right = Math.max(startX, constrainedPoint.x);
  const top = Math.min(startY, constrainedPoint.y);
  const bottom = Math.max(startY, constrainedPoint.y);

  if (right - left < 2 || bottom - top < 2) {
    return null;
  }

  const scaleX = naturalSize.width / Math.max(frameRect.width, 1);
  const scaleY = naturalSize.height / Math.max(frameRect.height, 1);
  return [
    Math.round(left * scaleX),
    Math.round(top * scaleY),
    Math.round(right * scaleX),
    Math.round(bottom * scaleY),
  ];
}

function constrainDisplayPointToAspectRatio(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  frameRect: DOMRect,
  aspectRatio: number,
) {
  const directionX = endX >= startX ? 1 : -1;
  const directionY = endY >= startY ? 1 : -1;
  const requestedWidth = Math.abs(endX - startX);
  const requestedHeight = Math.abs(endY - startY);

  let constrainedWidth = requestedWidth;
  let constrainedHeight = requestedHeight;
  if (requestedWidth > 0 || requestedHeight > 0) {
    if (requestedHeight <= 0 || requestedWidth / requestedHeight >= aspectRatio) {
      constrainedHeight = requestedWidth / aspectRatio;
    } else {
      constrainedWidth = requestedHeight * aspectRatio;
    }
  }

  const maxWidth = directionX > 0 ? frameRect.width - startX : startX;
  const maxHeight = directionY > 0 ? frameRect.height - startY : startY;
  const widthScale = constrainedWidth > 0 ? maxWidth / constrainedWidth : Number.POSITIVE_INFINITY;
  const heightScale = constrainedHeight > 0 ? maxHeight / constrainedHeight : Number.POSITIVE_INFINITY;
  const scale = Math.min(widthScale, heightScale, 1);

  return {
    x: clamp(startX + (directionX * constrainedWidth * scale), 0, frameRect.width),
    y: clamp(startY + (directionY * constrainedHeight * scale), 0, frameRect.height),
  };
}

function projectCropBoxToDisplay(
  cropBox: LeafCropBox,
  naturalSize: { width: number; height: number },
  displaySize: { width: number; height: number },
): CSSProperties {
  const scaleX = displaySize.width / Math.max(naturalSize.width, 1);
  const scaleY = displaySize.height / Math.max(naturalSize.height, 1);

  return {
    left: `${cropBox[0] * scaleX}px`,
    top: `${cropBox[1] * scaleY}px`,
    width: `${(cropBox[2] - cropBox[0]) * scaleX}px`,
    height: `${(cropBox[3] - cropBox[1]) * scaleY}px`,
  };
}

function formatCropBox(cropBox: LeafCropBox | null) {
  return cropBox ? `[${cropBox.join(", ")}]` : "none";
}

function cropBoxesEqual(leftCropBox: LeafCropBox | null | undefined, rightCropBox: LeafCropBox | null | undefined) {
  if (!leftCropBox || !rightCropBox) {
    return leftCropBox === rightCropBox || (!leftCropBox && !rightCropBox);
  }

  return leftCropBox[0] === rightCropBox[0]
    && leftCropBox[1] === rightCropBox[1]
    && leftCropBox[2] === rightCropBox[2]
    && leftCropBox[3] === rightCropBox[3];
}

function readCropAspectRatio(entry: LeafReviewSourceEntry) {
  const cropBox = entry.currentCropBox;
  if (!cropBox) {
    return 1;
  }

  const width = cropBox[2] - cropBox[0];
  const height = cropBox[3] - cropBox[1];
  if (width <= 0 || height <= 0) {
    return 1;
  }

  return width / height;
}

function buildPatchPreviewUrl(entry: LeafReviewSourceEntry) {
  if (!entry.candidatePatchUrl) {
    return undefined;
  }

  const cropVersion = entry.currentCropBox ? entry.currentCropBox.join("-") : "none";
  const separator = entry.candidatePatchUrl.includes("?") ? "&" : "?";
  return `${entry.candidatePatchUrl}${separator}crop=${encodeURIComponent(cropVersion)}&source=${entry.currentCropBoxSource ?? "none"}`;
}

function clamp(value: number, minValue: number, maxValue: number) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function readClientErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Leaf review update failed.";
}