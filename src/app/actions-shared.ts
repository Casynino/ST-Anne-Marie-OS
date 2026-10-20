"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n";
import { getContext, getSessionInfo } from "@/lib/auth/next";
import { SESSION_COOKIE, destroySession } from "@/lib/auth/session";
import { actorOf, writeAudit } from "@/server/audit";

export async function setLocaleAction(form: FormData) {
  const value = String(form.get("locale") ?? "");
  if (!isLocale(value)) return;
  (await cookies()).set(LOCALE_COOKIE, value, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const ctx = await getContext();
  if (ctx) await db.user.update({ where: { id: ctx.userId }, data: { locale: value } });
  revalidatePath("/", "layout");
}

export async function signOutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const ctx = await getContext();
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
  if (ctx) await writeAudit(db, actorOf(ctx), { action: "auth.logout", entityType: "User", entityId: ctx.userId, summary: ctx.fullName });
  await getSessionInfo(); // keep request cache consistent
  redirect("/login");
}
