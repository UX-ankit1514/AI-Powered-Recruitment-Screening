"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

const schema = z.object({ email: z.email().max(320), next: z.string().optional() });

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), next: formData.get("next") ?? undefined });
  if (!parsed.success) return { status: "error", message: "Enter a valid work email." };

  const h = await headers();
  // Prefer configured origins over the Host header (Supabase also checks the redirect allowlist).
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  const origin = (process.env.APP_BASE_URL || prod || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`).replace(/\/$/, "");
  const next = safeNext(parsed.data.next);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false, // invite-only: accounts are created by an admin
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}`,
    },
  });

  // Same answer whether or not the email has an account (no user enumeration).
  if (error && error.status === 429) {
    return { status: "error", message: "Too many attempts. Wait a minute and try again." };
  }
  return { status: "sent", message: "If this email has access to Pingo, a sign-in link is on its way." };
}
