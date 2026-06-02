"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteTree, updateTreeDevelopmentPlan } from "../../lib/bonsai";

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
  redirect(`/trees/${treeId}?tab=plan`);
}