"use client";

import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "./submit-button";

const MAX_IMAGE_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;

function resizeImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}

type CaptureLabProps = {
  action: (formData: FormData) => Promise<void>;
  errorMessage?: string | null;
  treeCount: number;
  userEmail: string;
};

type CaptureSource = "camera" | "upload";
type CaptureIntent = "existing-tree" | "new-tree";
type CaptureStep = "intent" | "front" | "existing-resolution" | "leaf" | "review";
type TreeResolutionMode = "automatic" | "manual";
type SpeciesSelectionMode = "automatic" | "manual";
type StyleSelectionMode = "automatic" | "manual";

type CaptureErrorContent = {
  title: string;
  message: string;
  steps: string[];
};

function readCaptureErrorContent(errorMessage: string): CaptureErrorContent {
  const normalized = errorMessage.toLowerCase();

  if (normalized.includes("background")) {
    return {
      title: "Photo needs a cleaner background",
      message: "Bonsai could not separate the tree clearly from the background in this photo.",
      steps: [
        "Place a plain board, cloth, or wall behind the tree.",
        "Keep the whole tree inside the frame with some empty space around it.",
        "Retake the front photo and try again.",
      ],
    };
  }

  return {
    title: "Capture could not continue",
    message: errorMessage,
    steps: ["Check the photo, then try again."],
  };
}

export function CaptureLab({ action, errorMessage = null, treeCount, userEmail }: CaptureLabProps) {
  const [currentStep, setCurrentStep] = useState<CaptureStep>("intent");
  const [captureIntent, setCaptureIntent] = useState<CaptureIntent | "">("");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontImageUrl, setFrontImageUrl] = useState<string | null>(null);
  const [frontSource, setFrontSource] = useState<CaptureSource | "">("");
  const [capturedAt, setCapturedAt] = useState<string>("");
  const [frontAccepted, setFrontAccepted] = useState(false);
  const [leafFile, setLeafFile] = useState<File | null>(null);
  const [leafImageUrl, setLeafImageUrl] = useState<string | null>(null);
  const [leafSource, setLeafSource] = useState<CaptureSource | "">("");
  const [leafCapturedAt, setLeafCapturedAt] = useState<string>("");
  const [leafAccepted, setLeafAccepted] = useState(false);
  const [treeResolutionMode, setTreeResolutionMode] = useState<TreeResolutionMode | "">("");
  const [speciesSelectionMode, setSpeciesSelectionMode] = useState<SpeciesSelectionMode | "">("");
  const [styleSelectionMode, setStyleSelectionMode] = useState<StyleSelectionMode | "">("");
  const [notes, setNotes] = useState("");
  const [winterMode, setWinterMode] = useState(false);
  const frontCameraInputRef = useRef<HTMLInputElement | null>(null);
  const frontUploadInputRef = useRef<HTMLInputElement | null>(null);
  const leafCameraInputRef = useRef<HTMLInputElement | null>(null);
  const leafUploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!frontFile) {
      setFrontImageUrl(null);
      return;
    }

    const nextImageUrl = URL.createObjectURL(frontFile);
    setFrontImageUrl(nextImageUrl);

    return () => {
      URL.revokeObjectURL(nextImageUrl);
    };
  }, [frontFile]);

  useEffect(() => {
    if (!leafFile) {
      setLeafImageUrl(null);
      return;
    }

    const nextImageUrl = URL.createObjectURL(leafFile);
    setLeafImageUrl(nextImageUrl);

    return () => {
      URL.revokeObjectURL(nextImageUrl);
    };
  }, [leafFile]);

  function resetFrontInputValues() {
    if (frontCameraInputRef.current) {
      frontCameraInputRef.current.value = "";
    }

    if (frontUploadInputRef.current) {
      frontUploadInputRef.current.value = "";
    }
  }

  function resetLeafInputValues() {
    if (leafCameraInputRef.current) {
      leafCameraInputRef.current.value = "";
    }

    if (leafUploadInputRef.current) {
      leafUploadInputRef.current.value = "";
    }
  }

  async function selectFrontFile(fileList: FileList | null, nextSource: CaptureSource) {
    const raw = fileList?.[0] ?? null;
    const file = raw ? await resizeImage(raw) : null;

    if (nextSource === "camera" && frontUploadInputRef.current) {
      frontUploadInputRef.current.value = "";
    }

    if (nextSource === "upload" && frontCameraInputRef.current) {
      frontCameraInputRef.current.value = "";
    }

    setFrontFile(file);
    setFrontSource(file ? nextSource : "");
    setCapturedAt(file ? new Date().toISOString() : "");
    setFrontAccepted(false);
    setTreeResolutionMode("");
    setSpeciesSelectionMode("");
    setStyleSelectionMode("");
    setWinterMode(false);
    resetLeafSelection();
  }

  async function selectLeafFile(fileList: FileList | null, nextSource: CaptureSource) {
    const raw = fileList?.[0] ?? null;
    const file = raw ? await resizeImage(raw) : null;

    if (nextSource === "camera" && leafUploadInputRef.current) {
      leafUploadInputRef.current.value = "";
    }

    if (nextSource === "upload" && leafCameraInputRef.current) {
      leafCameraInputRef.current.value = "";
    }

    setLeafFile(file);
    setLeafSource(file ? nextSource : "");
    setLeafCapturedAt(file ? new Date().toISOString() : "");
    setLeafAccepted(false);
    setSpeciesSelectionMode(file ? "automatic" : "");
  }

  function resetLeafSelection() {
    resetLeafInputValues();
    setLeafFile(null);
    setLeafSource("");
    setLeafCapturedAt("");
    setLeafAccepted(false);
    setSpeciesSelectionMode("");
  }

  function resetFrontSelection() {
    resetFrontInputValues();
    setFrontFile(null);
    setFrontSource("");
    setCapturedAt("");
    setFrontAccepted(false);
    setTreeResolutionMode("");
    setStyleSelectionMode("");
    setWinterMode(false);
    resetLeafSelection();
  }

  function handleIntentChange(nextIntent: CaptureIntent) {
    setCaptureIntent(nextIntent);
    setCurrentStep("front");
    resetFrontSelection();
    setTreeResolutionMode("");
    setSpeciesSelectionMode("");
    setStyleSelectionMode("");
    setNotes("");
  }

  const requiresLeafPhoto = captureIntent === "new-tree" && speciesSelectionMode !== "manual";
  const isReadyForExistingSubmit = captureIntent === "existing-tree" && frontAccepted && treeResolutionMode.length > 0;
  const isReadyForNewSubmit = captureIntent === "new-tree"
    && frontAccepted
    && styleSelectionMode.length > 0
    && ((speciesSelectionMode === "manual" && winterMode) || (speciesSelectionMode === "automatic" && leafAccepted));
  const totalSteps = captureIntent === "new-tree" ? 4 : 3;
  const captureError = errorMessage ? readCaptureErrorContent(errorMessage) : null;

  function acceptFrontPhoto() {
    if (!frontFile) {
      return;
    }

    setFrontAccepted(true);
    setCurrentStep(captureIntent === "existing-tree" ? "existing-resolution" : "leaf");
  }

  function acceptLeafPhoto() {
    if (!leafFile) {
      return;
    }

    setLeafAccepted(true);
    setWinterMode(false);
    setSpeciesSelectionMode("automatic");
    setStyleSelectionMode("automatic");
    setCurrentStep("review");
  }

  function chooseManualSpecies() {
    setWinterMode(true);
    resetLeafSelection();
    setSpeciesSelectionMode("manual");
    setStyleSelectionMode("automatic");
    setCurrentStep("review");
  }

  function openFrontReview() {
    if (!frontFile) {
      return;
    }

    setFrontAccepted(false);
    setCurrentStep("front");
  }

  function openLeafReview() {
    setStyleSelectionMode("");

    if (speciesSelectionMode === "manual") {
      setCurrentStep("leaf");
      return;
    }

    if (!leafFile) {
      return;
    }

    setLeafAccepted(false);
    setCurrentStep("leaf");
  }

  function readCurrentStepNumber() {
    if (currentStep === "intent") {
      return 1;
    }

    if (currentStep === "front") {
      return 2;
    }

    if (currentStep === "existing-resolution") {
      return 3;
    }

    if (currentStep === "leaf") {
      return 3;
    }

    return 4;
  }

  function readCurrentStepTitle() {
    if (currentStep === "intent") {
      return "What are you working on?";
    }

    if (currentStep === "front") {
      return "Add the front photo";
    }

    if (currentStep === "existing-resolution") {
      return "How should we find the tree?";
    }

    if (currentStep === "leaf") {
      return "Add a leaf close-up";
    }

    return "Review species first";
  }

  function readPrimarySubmitLabel() {
    if (captureIntent === "existing-tree") {
      return treeResolutionMode === "automatic" ? "Find the tree" : "Choose the tree";
    }

    if (speciesSelectionMode === "automatic") {
      return "Review the species";
    }

    return "Choose the species";
  }

  function readPendingLabel() {
    if (captureIntent === "existing-tree") {
      return treeResolutionMode === "automatic" ? "Looking through the collection..." : "Saving the photo...";
    }

    if (speciesSelectionMode === "automatic") {
      return "Opening the species review...";
    }

    return "Opening the species step...";
  }

  function isActiveStep(step: CaptureStep) {
    return currentStep === step;
  }

  async function handleFormAction(formData: FormData) {
    if (frontFile) {
      formData.delete("frontCameraPhoto");
      formData.delete("frontUploadedPhoto");
      formData.append(frontSource === "camera" ? "frontCameraPhoto" : "frontUploadedPhoto", frontFile);
    }

    if (leafFile) {
      formData.delete("leafCameraPhoto");
      formData.delete("leafUploadedPhoto");
      formData.append(leafSource === "camera" ? "leafCameraPhoto" : "leafUploadedPhoto", leafFile);
    }

    await action(formData);
  }

  return (
    <form action={handleFormAction} className="capture-wizard-shell">
      <div aria-hidden="true" className="capture-file-source-stack">
        <input
          accept="image/*"
          capture="environment"
          name="frontCameraPhoto"
          onChange={(event) => {
            selectFrontFile(event.target.files, "camera");
          }}
          ref={frontCameraInputRef}
          tabIndex={-1}
          type="file"
        />
        <input
          accept="image/*"
          name="frontUploadedPhoto"
          onChange={(event) => {
            selectFrontFile(event.target.files, "upload");
          }}
          ref={frontUploadInputRef}
          tabIndex={-1}
          type="file"
        />
        <input
          accept="image/*"
          capture="environment"
          name="leafCameraPhoto"
          onChange={(event) => {
            selectLeafFile(event.target.files, "camera");
          }}
          ref={leafCameraInputRef}
          tabIndex={-1}
          type="file"
        />
        <input
          accept="image/*"
          name="leafUploadedPhoto"
          onChange={(event) => {
            selectLeafFile(event.target.files, "upload");
          }}
          ref={leafUploadInputRef}
          tabIndex={-1}
          type="file"
        />
      </div>

      <input name="captureIntent" type="hidden" value={captureIntent} />
      <input name="frontSource" type="hidden" value={frontSource} />
      <input name="capturedAt" type="hidden" value={capturedAt} />
      <input name="leafSource" type="hidden" value={leafSource} />
      <input name="leafCapturedAt" type="hidden" value={leafCapturedAt} />
      <input name="treeResolutionMode" type="hidden" value={treeResolutionMode} />
      <input name="speciesSelectionMode" type="hidden" value={speciesSelectionMode} />
      <input name="styleSelectionMode" type="hidden" value={styleSelectionMode} />
      <input name="winterMode" type="hidden" value={winterMode ? "true" : "false"} />

      {captureError ? (
        <section className="feature-card error-card" role="alert" aria-live="assertive">
          <p className="eyebrow error-eyebrow">Capture error</p>
          <h2>{captureError.title}</h2>
          <p>{captureError.message}</p>
          <ul className="error-step-list">
            {captureError.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="capture-card accent-card capture-wizard-frame">
        <div className="capture-wizard-progress">
          <span className="capture-step-pill">Step {readCurrentStepNumber()} of {totalSteps}</span>
          <p className="helper-text">Using {userEmail}. Move one step at a time and confirm each photo before you continue.</p>
        </div>
        <h2>{readCurrentStepTitle()}</h2>
      </section>

      <section aria-hidden={!isActiveStep("intent")} className="capture-card capture-wizard-step" hidden={!isActiveStep("intent")}>
        <h2>What is this photo for?</h2>
        <p>Choose whether this photo belongs to a tree already in your collection or to a tree you are adding for the first time.</p>
        <div className="capture-choice-grid">
          <button
            className={`capture-choice-card${captureIntent === "existing-tree" ? " is-selected" : ""}`}
            disabled={treeCount === 0}
            onClick={() => {
              handleIntentChange("existing-tree");
            }}
            type="button"
          >
            <strong>Existing tree</strong>
            <span>Take one clear front photo, then choose the tree yourself or review the closest match.</span>
          </button>
          <button
            className={`capture-choice-card${captureIntent === "new-tree" ? " is-selected" : ""}`}
            onClick={() => {
              handleIntentChange("new-tree");
            }}
            type="button"
          >
            <strong>New tree</strong>
            <span>Take a front photo, optionally add a leaf close-up, then finish the tree details before saving it.</span>
          </button>
        </div>
        {treeCount === 0 ? <p className="helper-text">Add your first tree to the collection before using the existing-tree path.</p> : null}
      </section>

      <section aria-hidden={!isActiveStep("front")} className="capture-card capture-wizard-step" hidden={!isActiveStep("front")}>
        <h2>Front photo</h2>
        <p>Use a clear front view with a plain background behind the bonsai. This photo helps identify the tree and its style.</p>
        {!frontFile ? (
          <div className="capture-input-grid">
            <button
              className="file-input"
              onClick={() => {
                frontCameraInputRef.current?.click();
              }}
              type="button"
            >
              <span>Take photo</span>
              <span>Open the phone camera and confirm the front view.</span>
            </button>
            <button
              className="file-input"
              onClick={() => {
                frontUploadInputRef.current?.click();
              }}
              type="button"
            >
              <span>Choose from gallery</span>
              <span>Pick an existing photo from the device.</span>
            </button>
          </div>
        ) : (
          <div className="capture-preview-stack">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Selected bonsai front preview" className="preview-image" src={frontImageUrl ?? undefined} />
            <p className="support-text">The front photo is ready from the {frontSource === "camera" ? "camera" : "gallery"}.</p>
            <div className="capture-step-actions">
              <button className="button button-ghost" onClick={resetFrontSelection} type="button">
                Choose another photo
              </button>
              <button className="button button-solid" onClick={acceptFrontPhoto} type="button">
                Use this photo
              </button>
            </div>
          </div>
        )}
        <div className="capture-step-actions">
          <button className="button button-ghost" onClick={() => {
            setCurrentStep("intent");
          }} type="button">
            Back
          </button>
        </div>
      </section>

      <section aria-hidden={!isActiveStep("existing-resolution")} className="capture-card capture-wizard-step" hidden={!isActiveStep("existing-resolution")}>
        <h2>How should we find the tree?</h2>
        <p>You can choose the tree yourself, or let Bonsai show the closest match first.</p>
        <div className="capture-choice-grid">
          <button
            className={`capture-choice-card${treeResolutionMode === "manual" ? " is-selected" : ""}`}
            onClick={() => {
              setTreeResolutionMode("manual");
            }}
            type="button"
          >
            <strong>I&apos;ll choose the tree</strong>
            <span>Go straight to the tree list.</span>
          </button>
          <button
            className={`capture-choice-card${treeResolutionMode === "automatic" ? " is-selected" : ""}`}
            onClick={() => {
              setTreeResolutionMode("automatic");
            }}
            type="button"
          >
            <strong>Show the closest match</strong>
            <span>We will compare this photo with the trees already in your collection.</span>
          </button>
        </div>
        <div className="capture-step-actions">
          <button className="button button-ghost" onClick={openFrontReview} type="button">
            Back
          </button>
          <SubmitButton className="button button-solid" disabled={!isReadyForExistingSubmit} pendingLabel={readPendingLabel()}>
            {readPrimarySubmitLabel()}
          </SubmitButton>
        </div>
      </section>

      {captureIntent === "new-tree" ? (
        <section aria-hidden={!isActiveStep("leaf")} className="capture-card capture-wizard-step" hidden={!isActiveStep("leaf")}>
          <h2>Leaf close-up</h2>
          <p>Add a close-up of a leaf or needle if you want help with the species. This photo is only used for species identification and will not be added to the tree gallery.</p>
          {!leafFile ? (
            <>
              <div className="capture-input-grid">
                <button
                  className="file-input"
                  onClick={() => {
                    leafCameraInputRef.current?.click();
                  }}
                  type="button"
                >
                  <span>Take leaf close-up</span>
                  <span>Capture the leaf or needle detail now.</span>
                </button>
                <button
                  className="file-input"
                  onClick={() => {
                    leafUploadInputRef.current?.click();
                  }}
                  type="button"
                >
                  <span>Choose from gallery</span>
                  <span>Use a leaf close-up you already took.</span>
                </button>
              </div>
              <button className="button button-ghost" onClick={chooseManualSpecies} type="button">
                I&apos;ll choose the species later
              </button>
            </>
          ) : (
            <div className="capture-preview-stack">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Selected bonsai leaf preview" className="preview-image" src={leafImageUrl ?? undefined} />
              <p className="support-text">The leaf photo is ready from the {leafSource === "camera" ? "camera" : "gallery"}.</p>
              <div className="capture-step-actions">
                <button className="button button-ghost" onClick={resetLeafSelection} type="button">
                  Choose another photo
                </button>
                <button className="button button-solid" onClick={acceptLeafPhoto} type="button">
                  Use this leaf photo
                </button>
              </div>
            </div>
          )}
          <div className="capture-step-actions">
            <button className="button button-ghost" onClick={openFrontReview} type="button">
              Back
            </button>
          </div>
        </section>
      ) : null}

      {captureIntent === "new-tree" ? (
        <section aria-hidden={!isActiveStep("review")} className="capture-card capture-wizard-step" hidden={!isActiveStep("review")}>
          <h2>Review species first</h2>
          <p>
            {speciesSelectionMode === "manual"
              ? "The front photo is ready. Next you will choose the species, then review the style from the front photo."
              : "The front photo and leaf close-up are ready. Next you will review the species from the leaf photo, then confirm the style from the front photo."}
          </p>
          <label className="field-block">
            <span>Notes</span>
            <textarea
              name="notes"
              onChange={(event) => {
                setNotes(event.target.value);
              }}
              placeholder="Optional notes about the tree or how the photos were taken."
              rows={3}
              value={notes}
            />
          </label>
          <div className="capture-step-actions">
            <button className="button button-ghost" onClick={openLeafReview} type="button">
              Back
            </button>
            <SubmitButton className="button button-solid" disabled={!isReadyForNewSubmit} pendingLabel={readPendingLabel()}>
              {readPrimarySubmitLabel()}
            </SubmitButton>
          </div>
        </section>
      ) : null}
    </form>
  );
}
