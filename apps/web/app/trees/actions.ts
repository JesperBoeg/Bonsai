"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRequiredViewer } from "../../lib/auth";
import { deleteTree, updateTreeDevelopmentPlan } from "../../lib/bonsai";
import { retryTargetStateGeneration, startTargetStateGeneration } from "../../lib/studio";

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value.trim();
}

function readOptionalString(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function deleteTreeAction(formData: FormData) {
  const treeId = readRequiredString(formData, "treeId");
  await deleteTree(treeId);
  revalidatePath("/");
  revalidatePath("/capture");
  revalidatePath("/trees");
  revalidatePath(`/trees/${treeId}`);
  redirect("/trees");
}

export async function updateTreePlanAction(formData: FormData) {
  const treeId = readRequiredString(formData, "treeId");
  await updateTreeDevelopmentPlan(treeId, readOptionalString(formData, "developmentPlan"));
  revalidatePath("/trees");
  revalidatePath(`/trees/${treeId}`);
  redirect(`/trees/${treeId}?tab=studio`);
}

export async function createTargetStateAction(formData: FormData) {
  const viewer = await getRequiredViewer();
  const treeId = readRequiredString(formData, "treeId");
  const modeValue = readRequiredString(formData, "mode");
  const brief = readOptionalString(formData, "brief");
  const targetStyleValue = readOptionalString(formData, "targetStyleId");
  const horizonValue = readOptionalString(formData, "horizonYears");

  if (modeValue !== "auto" && modeValue !== "directed") {
    throw new Error("Studio mode is invalid.");
  }

  const targetStyleId = targetStyleValue ? Number.parseInt(targetStyleValue, 10) : null;
  const horizonYears = horizonValue ? Number.parseInt(horizonValue, 10) : null;

  if (targetStyleId !== null && !Number.isInteger(targetStyleId)) {
    throw new Error("Target style is invalid.");
  }

  if (horizonYears !== null && !Number.isInteger(horizonYears)) {
    throw new Error("Time horizon is invalid.");
  }

  const { targetId } = await startTargetStateGeneration(viewer, {
    treeId,
    mode: modeValue,
    brief: modeValue === "directed" ? brief : null,
    targetStyleId: modeValue === "directed" ? targetStyleId : null,
    horizonYears: modeValue === "directed" ? horizonYears : null,
  });

  revalidatePath(`/trees/${treeId}`);
  redirect(`/trees/${treeId}?tab=studio&target=${targetId}`);
}

export async function retryTargetStateAction(formData: FormData) {
  const viewer = await getRequiredViewer();
  const previousTargetId = readRequiredString(formData, "targetId");
  const { targetId, treeId } = await retryTargetStateGeneration(viewer, previousTargetId);

  revalidatePath(`/trees/${treeId}`);
  redirect(`/trees/${treeId}?tab=studio&target=${targetId}`);
}