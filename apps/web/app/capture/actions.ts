"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createLocalCaptureSubmission,
  finalizeCaptureAsExisting,
  finalizeCaptureAsNewTree,
  type NewTreeSpeciesSelection,
} from "../../lib/bonsai";

function readActionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Capture failed. Retake the photo and try again.";
}

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function readBooleanFlag(formData: FormData, key: string) {
  return readRequiredString(formData, key) === "true";
}

function resolvePhotoSelection(formData: FormData, cameraKey: string, uploadedKey: string, required: boolean) {
  const cameraPhoto = formData.get(cameraKey);
  const uploadedPhoto = formData.get(uploadedKey);

  const selectedCameraPhoto = cameraPhoto instanceof File && cameraPhoto.size > 0 ? cameraPhoto : null;
  const selectedUploadedPhoto = uploadedPhoto instanceof File && uploadedPhoto.size > 0 ? uploadedPhoto : null;

  if (selectedCameraPhoto && selectedUploadedPhoto) {
    throw new Error("Choose either a camera photo or an uploaded image, not both.");
  }

  if (!selectedCameraPhoto && !selectedUploadedPhoto) {
    if (required) {
      throw new Error("A photo is required.");
    }

    return null;
  }

  return (selectedCameraPhoto ?? selectedUploadedPhoto) as File;
}

function assertImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image uploads are supported.");
  }

  return file;
}

function fileExtensionFromUpload(file: File) {
  const extensionFromName = file.name.split(".").pop()?.toLowerCase();

  if (extensionFromName) {
    return extensionFromName;
  }

  throw new Error("The uploaded file must include a file extension.");
}

function readOptionalNotes(formData: FormData) {
  const value = formData.get("notes");

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readOptionalString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function createCaptureSubmissionFromForm(formData: FormData) {
  const captureIntent = readRequiredString(formData, "captureIntent");
  const frontPhoto = assertImageFile(resolvePhotoSelection(formData, "frontCameraPhoto", "frontUploadedPhoto", true) as File);
  const frontSource = readRequiredString(formData, "frontSource");
  const capturedAt = new Date(readRequiredString(formData, "capturedAt"));

  if (captureIntent !== "existing-tree" && captureIntent !== "new-tree") {
    throw new Error("Invalid capture intent.");
  }

  if (frontSource !== "camera" && frontSource !== "upload") {
    throw new Error("Invalid photo source.");
  }

  if (Number.isNaN(capturedAt.valueOf())) {
    throw new Error("Captured timestamp is invalid.");
  }

  const treeResolutionMode = captureIntent === "existing-tree" ? readRequiredString(formData, "treeResolutionMode") : null;
  const speciesSelectionMode = captureIntent === "new-tree" ? readRequiredString(formData, "speciesSelectionMode") : null;
  const styleSelectionMode = captureIntent === "new-tree" ? readRequiredString(formData, "styleSelectionMode") : null;

  if (treeResolutionMode !== null && treeResolutionMode !== "automatic" && treeResolutionMode !== "manual") {
    throw new Error("Tree selection mode is invalid.");
  }

  if (speciesSelectionMode !== null && speciesSelectionMode !== "automatic" && speciesSelectionMode !== "manual") {
    throw new Error("Species selection mode is invalid.");
  }

  if (styleSelectionMode !== null && styleSelectionMode !== "automatic" && styleSelectionMode !== "manual") {
    throw new Error("Style selection mode is invalid.");
  }

  const winterMode = captureIntent === "new-tree" && speciesSelectionMode === "manual";

  let leafPhoto: File | null = null;
  let leafSource: "camera" | "upload" | null = null;
  let leafCapturedAt: string | null = null;

  if (captureIntent === "new-tree" && !winterMode) {
    const selectedLeafPhoto = resolvePhotoSelection(formData, "leafCameraPhoto", "leafUploadedPhoto", true);
    leafPhoto = assertImageFile(selectedLeafPhoto as File);
    const nextLeafSource = readRequiredString(formData, "leafSource");
    const parsedLeafCapturedAt = new Date(readRequiredString(formData, "leafCapturedAt"));

    if (nextLeafSource !== "camera" && nextLeafSource !== "upload") {
      throw new Error("Invalid leaf photo source.");
    }

    if (Number.isNaN(parsedLeafCapturedAt.valueOf())) {
      throw new Error("Leaf captured timestamp is invalid.");
    }

    leafSource = nextLeafSource;
    leafCapturedAt = parsedLeafCapturedAt.toISOString();
  }

  const notes = readOptionalNotes(formData);
  return createLocalCaptureSubmission({
    captureIntent,
    treeResolutionMode,
    speciesSelectionMode,
    styleSelectionMode,
    capturedAt: capturedAt.toISOString(),
    frontExtension: fileExtensionFromUpload(frontPhoto),
    frontPhoto,
    frontSource,
    leafCapturedAt,
    leafExtension: leafPhoto ? fileExtensionFromUpload(leafPhoto) : null,
    leafPhoto,
    leafSource,
    notes,
    winterMode,
  });
}

export async function createCaptureSubmissionAction(formData: FormData) {
  const submission = await (async () => {
    try {
      return await createCaptureSubmissionFromForm(formData);
    } catch (error) {
      redirect(`/capture?error=${encodeURIComponent(readActionErrorMessage(error))}`);
    }
  })();

  revalidatePath("/capture");
  revalidatePath("/trees");
  redirect(`/captures/${submission.id}`);
}

export async function confirmExistingTreeAction(formData: FormData) {
  const submissionId = readRequiredString(formData, "submissionId");
  const treeId = readRequiredString(formData, "treeId");
  const resolvedTreeId = await finalizeCaptureAsExisting(submissionId, treeId);
  revalidatePath("/trees");
  revalidatePath(`/trees/${resolvedTreeId}`);
  revalidatePath(`/captures/${submissionId}`);
  redirect(`/trees/${resolvedTreeId}`);
}

export async function createTreeFromCaptureAction(formData: FormData) {
  const submissionId = readRequiredString(formData, "submissionId");
  const styleId = Number.parseInt(readRequiredString(formData, "styleId"), 10);
  const speciesEntryMode = readRequiredString(formData, "speciesEntryMode");
  const inventoryName = readRequiredString(formData, "inventoryName");
  let speciesSelection: NewTreeSpeciesSelection;

  if (!Number.isInteger(styleId)) {
    throw new Error("Style is required.");
  }

  if (speciesEntryMode === "catalog") {
    const speciesId = Number.parseInt(readRequiredString(formData, "speciesId"), 10);

    if (!Number.isInteger(speciesId)) {
      throw new Error("Species is required.");
    }

    speciesSelection = {
      kind: "catalog",
      speciesId,
    };
  } else if (speciesEntryMode === "custom") {
    const copiedProfileSourceId = readOptionalString(formData, "copySpeciesProfileFromId");
    const parsedCopiedProfileSourceId = copiedProfileSourceId === null
      ? null
      : Number.parseInt(copiedProfileSourceId, 10);

    if (parsedCopiedProfileSourceId !== null && !Number.isInteger(parsedCopiedProfileSourceId)) {
      throw new Error("Source species is invalid.");
    }

    speciesSelection = {
      kind: "custom",
      label: readRequiredString(formData, "customSpeciesLabel"),
      subtitle: readOptionalString(formData, "customSpeciesScientificName"),
      copiedProfileSourceSpeciesId: parsedCopiedProfileSourceId,
    };
  } else {
    throw new Error("Species entry mode is invalid.");
  }

  const resolvedTreeId = await finalizeCaptureAsNewTree(submissionId, speciesSelection, styleId, inventoryName);
  revalidatePath("/trees");
  revalidatePath(`/trees/${resolvedTreeId}`);
  revalidatePath(`/captures/${submissionId}`);
  redirect(`/trees/${resolvedTreeId}`);
}
