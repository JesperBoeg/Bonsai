import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";

const ADMIN_EMAILS = new Set([
  "jesper@agileupgrade.com",
  "uc@adraet.dk",
]);

export type AuthenticatedViewer = {
  id: string;
  email: string;
  isAdmin: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isAdminEmail(email: string) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

export async function getOptionalViewer(): Promise<AuthenticatedViewer | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user?.email) {
    return null;
  }

  return {
    id: data.user.id,
    email: data.user.email,
    isAdmin: isAdminEmail(data.user.email),
  };
}

export async function getRequiredViewer(nextPath = "/capture"): Promise<AuthenticatedViewer> {
  const viewer = await getOptionalViewer();

  if (!viewer) {
    redirect(`/sign-in?next=${encodeURIComponent(nextPath)}`);
  }

  return viewer;
}

export async function requireAdmin(nextPath = "/") {
  const viewer = await getRequiredViewer(nextPath);

  if (!viewer.isAdmin) {
    redirect("/");
  }

  return viewer;
}