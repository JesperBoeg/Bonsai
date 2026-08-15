import { redirect } from "next/navigation";
import { isLocalBackend } from "./backend";
import { createSupabaseServerClient } from "./supabase/server";

const DEFAULT_ADMIN_EMAILS = [
  "jesper@agileupgrade.com",
  "uc@adraet.dk",
];

// Fixed identity used when the app runs with the local data backend (no
// Supabase project). Everything is stored under this user's data directory.
export const LOCAL_VIEWER = {
  id: "local-demo-user",
  email: "demo@bonsai.local",
  isAdmin: true,
} as const;

export type AuthenticatedViewer = {
  id: string;
  email: string;
  isAdmin: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function readAdminEmails(): Set<string> {
  const configured = process.env.BONSAI_ADMIN_EMAILS;
  const emails = configured
    ? configured.split(",").map(normalizeEmail).filter((entry) => entry.length > 0)
    : DEFAULT_ADMIN_EMAILS;

  return new Set(emails.map(normalizeEmail));
}

export function isAdminEmail(email: string) {
  return readAdminEmails().has(normalizeEmail(email));
}

export async function getOptionalViewer(): Promise<AuthenticatedViewer | null> {
  if (isLocalBackend()) {
    return { ...LOCAL_VIEWER };
  }

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
