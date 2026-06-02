"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
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

  if (password.length < 8) {
    redirect(`/sign-in?error=${encodeURIComponent("Password must be at least 8 characters.")}&next=${encodeURIComponent(nextPath)}`);
  }

  if (password !== confirmPassword) {
    redirect(`/sign-in?error=${encodeURIComponent("Passwords do not match.")}&next=${encodeURIComponent(nextPath)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(nextPath)}`);
  }

  if (data.session) {
    redirect(nextPath);
  }

  redirect(`/sign-in?created=1&next=${encodeURIComponent(nextPath)}`);
}

export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }

  redirect("/");
}
