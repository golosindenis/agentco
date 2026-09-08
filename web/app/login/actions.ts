"use server";

import { getSupabaseAuthClient } from "../lib/supabaseServer";
import { isAllowedEmail } from "../lib/allowlist";

export type LoginResult = { ok: true; sent: boolean } | { ok: false; error: string };

export async function sendCode(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "");

  // Checked here and not only in the form, because a form is not a gate.
  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL ?? "")) {
    return { ok: false, error: "That address cannot sign in." };
  }

  const supabase = await getSupabaseAuthClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sent: true };
}

export async function verifyCode(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "");
  const token = String(formData.get("token") ?? "").trim();

  if (!isAllowedEmail(email, process.env.ALLOWED_EMAIL ?? "")) {
    return { ok: false, error: "That address cannot sign in." };
  }
  if (!token) return { ok: false, error: "Enter the code from your email." };

  const supabase = await getSupabaseAuthClient();
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token,
    type: "email",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sent: true };
}
