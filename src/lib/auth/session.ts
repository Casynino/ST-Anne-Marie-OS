import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { RequestMeta } from "./context";

export const SESSION_COOKIE = "sam_session";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // sliding 14 days
const TOUCH_INTERVAL_MS = 2 * 60 * 1000; // also tells the dashboard who is online right now

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a session and returns the raw token (stored hashed; the raw value only ever lives in the cookie). */
export async function createSession(userId: string, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) },
  });
  return { token, expiresAt };
}

/** Returns the userId for a valid, unexpired session of an ACTIVE user; slides expiry at most every two minutes. */
export async function resolveSession(token: string): Promise<{ userId: string; sessionId: string } | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { status: true } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return { userId: session.userId, sessionId: session.id };
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Signs a user out everywhere (password change/reset, suspension). Optionally keep one session. */
export async function destroyAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}
