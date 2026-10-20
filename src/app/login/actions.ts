"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { authenticate } from "@/lib/auth/login";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { getRequestMeta } from "@/lib/auth/next";
import type { ActionState } from "@/lib/action";

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const identifier = String(form.get("identifier") ?? "");
  const password = String(form.get("password") ?? "");
  let result: Awaited<ReturnType<typeof authenticate>>;
  try {
    result = await authenticate(identifier, password, await getRequestMeta());
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, values: { identifier } };
    console.error(JSON.stringify({ level: "error", msg: "login_failed_unexpected", error: e instanceof Error ? e.message : String(e) }));
    return { ok: false, error: "Something went wrong. Please try again.", values: { identifier } };
  }
  (await cookies()).set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  redirect(result.mustChangePassword ? "/change-password" : "/dashboard");
}
