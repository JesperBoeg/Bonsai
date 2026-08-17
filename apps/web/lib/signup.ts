import { getServiceRoleKey, getSupabaseAnonKey, getSupabaseUrl } from "./env";

// Who is allowed to create an account, and how.
//
// The app-level gate here is deliberately not the only one: Supabase's project
// config also has `disable_signup = true`, which blocks the public auth API that
// anyone can reach with the (publishable) anon key. This module is what keeps the
// UI honest and what lets allowlisted addresses through — a closed beta where the
// owner can still make their own account without waiting for email.

export type SignupMode = "open" | "closed";

export function getSignupMode(): SignupMode {
  return process.env.BONSAI_SIGNUP_MODE?.trim().toLowerCase() === "open" ? "open" : "closed";
}

/**
 * Addresses that may create an account even while sign-ups are closed.
 * Comma-separated in `BONSAI_SIGNUP_ALLOWLIST`.
 */
export function getSignupAllowlist(): string[] {
  return (process.env.BONSAI_SIGNUP_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter((entry) => entry.length > 0);
}

// `owner+test@gmail.com` is the same mailbox as `owner@gmail.com`, and the owner
// uses those aliases for testing — so match on the base address.
export function normalizeEmail(email: string) {
  const trimmed = email.trim().toLowerCase();
  const [localPart, domain] = trimmed.split("@");

  if (!domain) {
    return trimmed;
  }

  return `${localPart.split("+")[0]}@${domain}`;
}

export function isSignupAllowed(email: string) {
  if (getSignupMode() === "open") {
    return true;
  }

  return getSignupAllowlist().includes(normalizeEmail(email));
}

export const SIGNUP_CLOSED_MESSAGE =
  "Sign-ups are closed while Bonsai is in private testing. Ask the owner for an invite.";

export type AllowlistedAccountResult =
  | { kind: "created" }
  | { kind: "exists" }
  | { kind: "unavailable"; reason: string };

/**
 * Creates an already-confirmed account for an allowlisted address, using the
 * admin API — which is the only way in while the public sign-up API is disabled,
 * and which skips the confirmation email entirely. The caller signs the user in
 * afterwards with the password they just chose.
 */
export async function createConfirmedAccount(email: string, password: string): Promise<AllowlistedAccountResult> {
  const serviceRoleKey = getServiceRoleKey();

  if (!serviceRoleKey) {
    return {
      kind: "unavailable",
      reason: "Account creation needs SUPABASE_SERVICE_ROLE_KEY in the server environment.",
    };
  }

  const response = await fetch(`${getSupabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
    cache: "no-store",
  });

  if (response.ok) {
    return { kind: "created" };
  }

  const detail = await response.text();

  // Already registered: let the caller fall through to a normal sign-in attempt.
  if (response.status === 422 || /already been registered|already exists/i.test(detail)) {
    return { kind: "exists" };
  }

  return { kind: "unavailable", reason: `Supabase refused the account (${response.status}).` };
}

/** True when the anon key is present, i.e. the auth UI has something to talk to. */
export function isAuthConfigured() {
  try {
    getSupabaseUrl();
    getSupabaseAnonKey();
    return true;
  } catch {
    return false;
  }
}
