import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildAuthContext, type AuthContext, type RequestMeta } from "./context";
import { resolveSession, SESSION_COOKIE } from "./session";
import { isLocale, LOCALE_COOKIE, makeT, type Locale, type Translate } from "@/lib/i18n";
import type { PermissionKey } from "@/lib/rbac/permissions";

export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
});

export const getSessionInfo = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? resolveSession(token) : null;
});

/** The signed-in user's context, or null. Permissions are re-read from the database on every request. */
export const getContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getSessionInfo();
  if (!session) return null;
  try {
    return await buildAuthContext(session.userId, await getRequestMeta());
  } catch {
    return null;
  }
});

export async function requireContext(opts: { allowMustChangePassword?: boolean } = {}): Promise<AuthContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (ctx.mustChangePassword && !opts.allowMustChangePassword) redirect("/change-password");
  return ctx;
}

export const getLocale = cache(async (): Promise<Locale> => {
  const ctx = await getContext();
  if (ctx) return ctx.locale;
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(fromCookie) ? fromCookie : "EN";
});

export async function getT(): Promise<Translate> {
  return makeT(await getLocale());
}

export const hasAny = (ctx: AuthContext, perms: readonly PermissionKey[]) => perms.some((p) => ctx.permissions.has(p));
