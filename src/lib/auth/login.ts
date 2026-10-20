import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normalizeIdentifier } from "@/lib/phone";
import { DUMMY_HASH, verifyPassword } from "./password";
import type { RequestMeta } from "./context";
import { createSession } from "./session";
import { writeAudit } from "@/server/audit";

const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_IDENTIFIER = 5;
export const MAX_FAILURES_PER_IP = 30;
const GENERIC_FAILURE = "Incorrect email/phone or password.";

export type LoginResult = { token: string; expiresAt: Date; userId: string; userType: "STAFF" | "GUARDIAN" | "STUDENT"; mustChangePassword: boolean };

/**
 * Verifies credentials with DB-backed rate limiting (no Redis needed).
 * Failure messages never reveal whether the account exists.
 */
export async function authenticate(identifierInput: string, password: string, meta: RequestMeta): Promise<LoginResult> {
  const identifier = normalizeIdentifier(identifierInput);
  const key = identifier ?? identifierInput.trim().toLowerCase().slice(0, 100);
  const since = new Date(Date.now() - WINDOW_MS);

  const [identFailures, ipFailures] = await Promise.all([
    db.loginAttempt.count({ where: { identifier: key, success: false, createdAt: { gte: since } } }),
    meta.ip ? db.loginAttempt.count({ where: { ip: meta.ip, success: false, createdAt: { gte: since } } }) : 0,
  ]);
  if (identFailures >= MAX_FAILURES_PER_IDENTIFIER || ipFailures >= MAX_FAILURES_PER_IP) {
    throw new AppError("RATE_LIMITED", "Too many failed attempts. Please wait 15 minutes and try again.");
  }

  const user = identifier
    ? await db.user.findFirst({
        where: identifier.includes("@") ? { email: identifier } : { phone: identifier },
      })
    : null;

  const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  const ok = !!user && passwordOk && user.status === "ACTIVE";

  if (!ok) {
    await db.loginAttempt.create({ data: { identifier: key, ip: meta.ip, success: false } });
    if (user) {
      await writeAudit(db, { schoolId: user.schoolId, actorId: user.id, actorName: user.fullName, meta }, {
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        summary: user.status === "ACTIVE" ? "Wrong password" : "Login blocked: account suspended",
      });
    }
    throw new AppError("UNAUTHENTICATED", GENERIC_FAILURE);
  }

  await db.loginAttempt.deleteMany({ where: { identifier: key } });
  // Opportunistic cleanup keeps the table small without a scheduler.
  await db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const session = await createSession(user.id, meta);
  await writeAudit(db, { schoolId: user.schoolId, actorId: user.id, actorName: user.fullName, meta }, {
    action: "auth.login",
    entityType: "User",
    entityId: user.id,
    summary: user.fullName,
  });
  return { ...session, userId: user.id, userType: user.type, mustChangePassword: user.mustChangePassword };
}
