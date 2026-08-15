"use client";

import { useEffect, useMemo, useState } from "react";
import type { CaptureReviewData } from "../lib/bonsai";
import { SpeciesSearchPicker } from "./species-search-picker";
import { SubmitButton } from "./submit-button";

type CaptureReviewWizardProps = {
  review: CaptureReviewData;
  confirmExistingTreeAction: (formData: FormData) => void | Promise<void>;
  createTreeFromCaptureAction: (formData: FormData) => void | Promise<void>;
};

type ReviewStep = "tree-match" | "tree-manual" | "species-auto" | "species-manual" | "style-auto" | "style-manual" | "name";

export function CaptureReviewWizard({ review, confirmExistingTreeAction, createTreeFromCaptureAction }: CaptureReviewWizardProps) {
  const suggestedTreeMatch = review.candidateMatches[0] ?? null;
  const suggestedSpecies = typeof review.speciesPredictions[0]?.id === "number" ? review.speciesPredictions[0] : null;
  const suggestedStyle = typeof review.stylePredictions[0]?.id === "number" ? review.stylePredictions[0] : null;
  const [currentStep, setCurrentStep] = useState<ReviewStep>(() => {
    if (review.captureIntent === "existing-tree") {
      return suggestedTreeMatch ? "tree-match" : "tree-manual";
    }

    if (review.speciesSelectionMode === "automatic" && suggestedSpecies) {
      return "species-auto";
    }

    return "species-manual";
  });
  const [selectedTreeId, setSelectedTreeId] = useState(review.matchedTreeId ?? suggestedTreeMatch?.treeId ?? "");
  const [selectedSpeciesId, setSelectedSpeciesId] = useState(suggestedSpecies ? String(suggestedSpecies.id) : "");
  const [selectedStyleId, setSelectedStyleId] = useState(suggestedStyle ? String(suggestedStyle.id) : "");
  const [inventoryName, setInventoryName] = useState("");
  const [hasEditedInventoryName, setHasEditedInventoryName] = useState(false);

  const selectedSpecies = useMemo(
    () => review.speciesCatalog.find((entry) => String(entry.id) === selectedSpeciesId) ?? null,
    [review.speciesCatalog, selectedSpeciesId],
  );
  const selectedStyle = useMemo(
    () => review.styleCatalog.find((entry) => String(entry.id) === selectedStyleId) ?? null,
    [review.styleCatalog, selectedStyleId],
  );
  const selectedSpeciesLabel = selectedSpecies?.label ?? null;
  const selectedSpeciesDisplayLabel = selectedSpecies
    ? formatCatalogDisplayLabel(selectedSpecies.label, selectedSpecies.subtitle ?? null)
    : null;
  const totalSteps = review.captureIntent === "existing-tree" ? 1 : 3;

  useEffect(() => {
    if (hasEditedInventoryName) {
      return;
    }

    setInventoryName(buildInventoryName(selectedSpeciesLabel, selectedStyle?.label ?? null));
  }, [hasEditedInventoryName, selectedSpeciesLabel, selectedStyle?.label]);

  function goToStyleStep() {
    if (review.styleSelectionMode === "automatic" && suggestedStyle) {
      setCurrentStep("style-auto");
      return;
    }

    setCurrentStep("style-manual");
  }

  function returnToSpeciesStep() {
    if (review.speciesSelectionMode === "automatic" && suggestedSpecies && selectedSpeciesId === String(suggestedSpecies.id)) {
      setCurrentStep("species-auto");
      return;
    }

    setCurrentStep("species-manual");
  }

  function showSuggestedSpeciesAgain() {
    if (review.speciesSelectionMode === "automatic" && suggestedSpecies) {
      setCurrentStep("species-auto");
    }
  }

  function returnToStyleStep() {
    if (review.styleSelectionMode === "automatic" && suggestedStyle) {
      setCurrentStep("style-auto");
      return;
    }

    setCurrentStep("style-manual");
  }

  function continueAfterStyleSelection() {
    setCurrentStep("name");
  }

  function readStepNumber() {
    if (review.captureIntent === "existing-tree") {
      return 1;
    }

    if (currentStep === "species-auto" || currentStep === "species-manual") {
      return 1;
    }

    if (currentStep === "style-auto" || currentStep === "style-manual") {
      return 2;
    }

    return 3;
  }

  function readStepTitle() {
    if (review.captureIntent === "existing-tree") {
      return currentStep === "tree-match" ? "Is this the right tree?" : "Choose the tree";
    }

    if (currentStep === "species-auto") {
      return "Is this the right species?";
    }

    if (currentStep === "species-manual") {
      return "Choose the species";
    }

    if (currentStep === "style-auto") {
      return "Is this the right style?";
    }

    if (currentStep === "style-manual") {
      return "Choose the style";
    }

    return "Name the bonsai";
  }

  return (
    <div className="capture-wizard-shell">
      <section className="capture-card accent-card capture-wizard-frame">
        <div className="capture-wizard-progress">
          <span className="capture-step-pill">Step {readStepNumber()} of {totalSteps}</span>
          <p className="helper-text">
            {review.captureIntent === "existing-tree"
              ? "Check that this photo is going onto the right tree."
              : "Move one step at a time, change anything that looks off, then save the tree to your collection."}
          </p>
        </div>
        <h2>{readStepTitle()}</h2>
      </section>

      {review.captureIntent === "existing-tree" ? (
        currentStep === "tree-match" && suggestedTreeMatch ? (
          <section className="capture-card capture-wizard-step">
            <div className="capture-review-comparison">
              <article className="capture-review-media">
                <h2>New photo</h2>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="Front capture awaiting confirmation" className="preview-image" src={review.frontPhotoUrl} />
                <p className="support-text">Taken {formatReviewDate(review.capturedAt)}.</p>
                {review.notes ? <p className="helper-text">{review.notes}</p> : null}
              </article>

              <article className="capture-review-media capture-review-highlight">
                <h2>Closest match</h2>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={`${suggestedTreeMatch.inventoryName} reference capture`} className="preview-image" src={suggestedTreeMatch.referencePhotoUrl} />
                <strong>{suggestedTreeMatch.inventoryName}</strong>
                <p className="support-text">
                  {suggestedTreeMatch.speciesName ?? "Species not set"} / {suggestedTreeMatch.styleName ?? "Style not set"}
                  {" · "}{Math.round(suggestedTreeMatch.score * 100)}% similar
                </p>
                <p className="helper-text">
                  This is the closest tree we found. Reference photo from {formatReviewDate(suggestedTreeMatch.referenceCapturedAt)}.
                </p>
              </article>
            </div>

            {review.hostedFallbackRecommended ? (
              <div className="status-strip">
                <strong>This one needs a careful look.</strong>
                <p>{review.fallbackReason ?? "We could not find a strong match from this photo alone."}</p>
              </div>
            ) : null}

            <div className="capture-step-actions">
              <button
                className="button button-ghost"
                onClick={() => {
                  setSelectedTreeId("");
                  setCurrentStep("tree-manual");
                }}
                type="button"
              >
                I&apos;ll choose the tree
              </button>
              <form action={confirmExistingTreeAction} className="capture-inline-action">
                <input name="submissionId" type="hidden" value={review.id} />
                <input name="treeId" type="hidden" value={suggestedTreeMatch.treeId} />
                <SubmitButton className="button button-solid" pendingLabel="Adding the photo...">
                  Yes, this is the tree
                </SubmitButton>
              </form>
            </div>
          </section>
        ) : (
          <section className="capture-card capture-wizard-step">
            <h2>Choose the tree</h2>
            <p>Pick the tree that should receive this photo.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Front capture awaiting manual tree selection" className="preview-image" src={review.frontPhotoUrl} />
            {review.trees.length === 0 ? (
              <p>There are no trees available for this photo yet.</p>
            ) : (
              <form action={confirmExistingTreeAction} className="inline-form">
                <input name="submissionId" type="hidden" value={review.id} />
                <label className="field-block">
                  <span>Tree</span>
                  <select
                    name="treeId"
                    onChange={(event) => {
                      setSelectedTreeId(event.target.value);
                    }}
                    required
                    value={selectedTreeId}
                  >
                    <option disabled value="">
                      Choose a tree
                    </option>
                    {review.trees.map((tree) => (
                      <option key={tree.id} value={tree.id}>
                        {tree.inventoryName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="capture-step-actions">
                  {suggestedTreeMatch ? (
                    <button
                      className="button button-ghost"
                      onClick={() => {
                        setCurrentStep("tree-match");
                      }}
                      type="button"
                    >
                      Show closest match again
                    </button>
                  ) : null}
                  <SubmitButton className="button button-solid" disabled={!selectedTreeId} pendingLabel="Adding the photo...">
                    Add this photo to the tree
                  </SubmitButton>
                </div>
              </form>
            )}
          </section>
        )
      ) : null}

      {review.captureIntent === "new-tree" && currentStep === "species-auto" && suggestedSpecies ? (
        <section className="capture-card capture-wizard-step">
          <div className="capture-review-comparison">
            <article className="capture-review-media">
              <h2>Leaf close-up</h2>
              {review.leafPhotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="Leaf close-up awaiting species confirmation" className="preview-image" src={review.leafPhotoUrl} />
              ) : (
                <div className="preview-empty">No leaf image is available for this step.</div>
              )}
              {review.leafCapturedAt && review.leafSource ? (
                <p className="support-text">Taken {formatReviewDate(review.leafCapturedAt)}.</p>
              ) : null}
            </article>

            <article className="capture-review-media capture-review-highlight">
              <h2>Closest species</h2>
              <strong>{formatCatalogDisplayLabel(suggestedSpecies.label, suggestedSpecies.subtitle ?? null)}</strong>
              <p className="support-text">This is our best read from the leaf photo.</p>
              <p className="helper-text">
                If it does not look right, you can choose the species yourself.
              </p>
            </article>
          </div>
          <div className="capture-step-actions">
            <button
              className="button button-ghost"
              onClick={() => {
                setSelectedSpeciesId("");
                setCurrentStep("species-manual");
              }}
              type="button"
            >
              I&apos;ll choose the species
            </button>
            <button
              className="button button-solid"
              onClick={() => {
                setSelectedSpeciesId(String(suggestedSpecies.id));
                goToStyleStep();
              }}
              type="button"
            >
              Yes, this looks right
            </button>
          </div>
        </section>
      ) : null}

      {review.captureIntent === "new-tree" && currentStep === "species-manual" ? (
        <section className="capture-card capture-wizard-step">
          <h2>Choose the species</h2>
          {review.winterMode ? (
            <p className="helper-text">
              No leaf photo was taken for this capture, so pick the species yourself. If you are unsure,
              choose the closest genus — you can capture a leaf photo in the growing season.
            </p>
          ) : (
            <p>Choose the species from the list. If the exact species is missing, pick the closest genus match.</p>
          )}
          <SpeciesSearchPicker
            defaultSpeciesId={selectedSpeciesId}
            inputName="speciesId"
            onSelectedSpeciesIdChange={setSelectedSpeciesId}
            selectedSpeciesId={selectedSpeciesId}
            speciesCatalog={review.speciesCatalog}
          />
          <div className="capture-step-actions">
            {review.speciesSelectionMode === "automatic" && suggestedSpecies ? (
              <button className="button button-ghost" onClick={showSuggestedSpeciesAgain} type="button">
                Show species suggestion again
              </button>
            ) : null}
            <button
              className="button button-solid"
              disabled={!selectedSpeciesId}
              onClick={goToStyleStep}
              type="button"
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {review.captureIntent === "new-tree" && currentStep === "style-auto" && suggestedStyle ? (
        <section className="capture-card capture-wizard-step">
          <div className="capture-review-comparison">
            <article className="capture-review-media">
              <h2>Front photo</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Front capture awaiting style confirmation" className="preview-image" src={review.frontPhotoUrl} />
              <p className="support-text">Taken {formatReviewDate(review.capturedAt)}.</p>
            </article>

            <article className="capture-review-media capture-review-highlight">
              <h2>Closest style</h2>
              <strong>{suggestedStyle.label}</strong>
              <p className="support-text">This is the closest style we found from the front view.</p>
              <p className="helper-text">If it does not look right, you can choose the style yourself.</p>
            </article>
          </div>
          <div className="capture-step-actions">
            <button className="button button-ghost" onClick={returnToSpeciesStep} type="button">
              Back
            </button>
            <button
              className="button button-ghost"
              onClick={() => {
                setSelectedStyleId("");
                setCurrentStep("style-manual");
              }}
              type="button"
            >
              I&apos;ll choose the style
            </button>
            <button
              className="button button-solid"
              onClick={() => {
                setSelectedStyleId(String(suggestedStyle.id));
                continueAfterStyleSelection();
              }}
              type="button"
            >
              Yes, this looks right
            </button>
          </div>
        </section>
      ) : null}

      {review.captureIntent === "new-tree" && currentStep === "style-manual" ? (
        <section className="capture-card capture-wizard-step">
          <h2>Choose the style</h2>
          <p>Pick the style that best fits the front photo.</p>
          <label className="field-block">
            <span>Style</span>
            <select
              onChange={(event) => {
                setSelectedStyleId(event.target.value);
              }}
              value={selectedStyleId}
            >
              <option disabled value="">
                Choose style
              </option>
              {review.styleCatalog.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.label}
                </option>
              ))}
            </select>
          </label>
          <div className="capture-step-actions">
            <button className="button button-ghost" onClick={returnToSpeciesStep} type="button">
              Back
            </button>
            {review.styleSelectionMode === "automatic" && suggestedStyle ? (
              <button className="button button-ghost" onClick={returnToStyleStep} type="button">
                Show style suggestion again
              </button>
            ) : null}
            <button
              className="button button-solid"
              disabled={!selectedStyleId}
              onClick={() => {
                continueAfterStyleSelection();
              }}
              type="button"
            >
              Continue
            </button>
          </div>
        </section>
      ) : null}

      {review.captureIntent === "new-tree" && currentStep === "name" ? (
        <section className="capture-card capture-wizard-step">
          <p className="helper-text">Check the tree details below, then give the bonsai its name.</p>
          <div className="capture-review-summary">
            <div>
              <span className="eyebrow">Species</span>
              <strong>{selectedSpeciesDisplayLabel ?? "Choose a species"}</strong>
            </div>
            <div>
              <span className="eyebrow">Style</span>
              <strong>{selectedStyle ? selectedStyle.label : "Choose a style"}</strong>
            </div>
          </div>
          <form action={createTreeFromCaptureAction} className="inline-form">
            <input name="submissionId" type="hidden" value={review.id} />
            <input name="speciesEntryMode" type="hidden" value="catalog" />
            <input name="speciesId" type="hidden" value={selectedSpeciesId} />
            <input name="styleId" type="hidden" value={selectedStyleId} />
            <label className="field-block">
              <span>Bonsai name</span>
              <input
                name="inventoryName"
                onChange={(event) => {
                  setHasEditedInventoryName(true);
                  setInventoryName(event.target.value);
                }}
                placeholder="Japanese Maple - Informal Upright"
                required
                value={inventoryName}
              />
            </label>
            <p className="helper-text">Adjust the suggested name if you want something more specific.</p>
            <div className="capture-step-actions">
              <button className="button button-ghost" onClick={returnToStyleStep} type="button">
                Back
              </button>
              <SubmitButton
                className="button button-solid"
                disabled={!selectedSpeciesDisplayLabel || !selectedStyleId || inventoryName.trim().length === 0}
                pendingLabel="Saving the tree..."
              >
                Add to collection
              </SubmitButton>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function buildInventoryName(speciesLabel: string | null, styleLabel: string | null) {
  if (!speciesLabel || !styleLabel) {
    return "";
  }

  return `${speciesLabel} - ${styleLabel}`;
}

function formatCatalogDisplayLabel(label: string, subtitle: string | null) {
  return subtitle ? `${label} (${subtitle})` : label;
}

function formatReviewDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value));
}