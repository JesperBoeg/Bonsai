"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { isLocalBackend } from "../../lib/backend";
import {
  createConfirmedAccount,
  getSignupMode,
  isSignupAllowed,
  SIGNUP_CLOSED_MESSAGE,
} from "../../lib/signup";
import { createSupabaseServerClient } from "../../lib/supabase/server";

function readNextPath(formData: FormData) {
  const nextValue = formData.get("next");

  if (typeof nextValue === "string" && nextValue.startsWith("/")) {
    return nextValue as Route;
  }

  return "/capture" as Route;
}

function readRequiredEmail(formData: FormData) {
  const emailValue = formData.get("email");

  if (typeof emailValue !== "string" || emailValue.trim().length === 0) {
    throw new Error("Email is required.");
  }

  return emailValue.trim();
}

function readRequiredPassword(formData: FormData) {
  const passwordValue = formData.get("password");

  if (typeof passwordValue !== "string" || passwordValue.length === 0) {
    throw new Error("Password is required.");
  }

  return passwordValue;
}

function readOptionalPasswordConfirmation(formData: FormData) {
  const confirmPasswordValue = formData.get("confirmPassword");

  if (typeof confirmPasswordValue !== "string") {
    return "";
  }

  return confirmPasswordValue;
}

export async function signInWithPasswordAction(formData: FormData) {
  const email = readRequiredEmail(formData);
  const password = readRequiredPassword(formData);

  const nextPath = readNextPath(formData);
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(nextPath)}`);
  }

  redirect(nextPath);
}

export async function createPasswordAccountAction(formData: FormData) {
  const email = readRequiredEmail(formData);
  const password = readRequiredPassword(formData);
  const confirmPassword = readOptionalPasswordConfirmation(formData);
  const nextPath = readNextPath(formData);
  // Typed routes: the query string makes these plain strings, so they need the cast.
  const signInFailed = (message: string) =>
    `/sign-in?error=${encodeURIComponent(message)}&next=${encodeURIComponent(nextPath)}&signup=1` as Route;

  if (password.length < 8) {
    redirect(signInFailed("Password must be at least 8 characters."));
  }

  if (password !== confirmPassword) {
    redirect(signInFailed("Passwords do not match."));
  }

  if (!isSignupAllowed(email)) {
    redirect(signInFailed(SIGNUP_CLOSED_MESSAGE));
  }

  const supabase = await createSupabaseServerClient();

  // Allowlisted addresses get an account straight away: created through the admin
  // API as already-confirmed, then signed in with the password just chosen. No
  // confirmation email, and no dependency on the public sign-up API — which is
  // switched off at the project level while sign-ups are closed.
  if (getSignupMode() === "closed") {
    const result = await createConfirmedAccount(email, password);

    if (result.kind === "unavailable") {
      redirect(signInFailed(result.reason));
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      redirect(signInFailed(
        result.kind === "exists"
          ? "That address already has an account. Use the sign-in form with its existing password."
          : signInError.message,
      ));
    }

    redirect(nextPath);
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    redirect(signInFailed(error.message));
  }

  if (data.session) {
    redirect(nextPath);
  }

  redirect(`/sign-in?created=1&next=${encodeURIComponent(nextPath)}` as Route);
}

export async function signOutAction() {
  if (isLocalBackend()) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }

  redirect("/");
}
