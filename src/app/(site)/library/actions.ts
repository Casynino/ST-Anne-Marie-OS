"use server";

import { cookies } from "next/headers";
import { publicRun, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/auth/next";
import { getPublicSchool } from "@/server/website";
import { endLibrarySession, LIBRARY_COOKIE, verifySchoolId } from "@/server/library-identity";

/** Only paths inside the library are accepted as the place to go next, so the form can never send anyone elsewhere. */
const safeNext = (v: unknown) => (typeof v === "string" && /^\/library(\/[A-Za-z0-9\-_/?=&%.]*)?$/.test(v) && !v.includes("//") ? v : "/library");

/** A student or teacher enters their school ID and PIN (or password). On success a library session starts and they go on to what they wanted. */
export async function verifyLibraryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    const { token, expiresAt } = await verifySchoolId(school.id, { schoolId: input.schoolId, secret: input.secret }, await getRequestMeta());
    (await cookies()).set(LIBRARY_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
    return { redirectTo: safeNext(input.next) };
  });
}

/** Ends the library session and forgets this browser. */
export async function leaveLibraryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async () => {
    const jar = await cookies();
    await endLibrarySession(jar.get(LIBRARY_COOKIE)?.value);
    jar.delete(LIBRARY_COOKIE);
    return { redirectTo: "/library" };
  });
}
