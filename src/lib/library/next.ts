import { cookies } from "next/headers";
import { getContext } from "@/lib/auth/next";
import type { AuthContext } from "@/lib/auth/context";
import type { Viewer } from "@/lib/library/access";
import { LIBRARY_COOKIE, viewerForAccount, viewerForToken } from "@/server/library-identity";

export type LibraryViewer = {
  viewer: Viewer;
  /** The school the identity belongs to (null for a visitor). A resource of another school is never opened with it. */
  schoolId: string | null;
  /** The signed-in school account, if any (staff who manage the library may preview unpublished resources with it). */
  account: AuthContext | null;
  source: "session" | "account" | "visitor";
};

/**
 * Who is asking, for every library page and file request: a verified school ID (library session cookie), else a signed-in school account,
 * else a visitor. A visitor can only ever be given public material.
 */
export async function getLibraryViewer(): Promise<LibraryViewer> {
  const [account, jar] = await Promise.all([getContext(), cookies()]);
  const session = await viewerForToken(jar.get(LIBRARY_COOKIE)?.value);
  if (session) return { viewer: session.viewer, schoolId: session.schoolId, account, source: "session" };
  if (account) return { viewer: await viewerForAccount(account), schoolId: account.schoolId, account, source: "account" };
  return { viewer: { kind: "VISITOR" }, schoolId: null, account: null, source: "visitor" };
}
