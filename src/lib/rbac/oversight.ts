import type { AuthContext } from "@/lib/auth/context";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "./permissions";

/**
 * The owner oversees; the departments do the work (Nino, 2026-11-16: "each department with its works"; the owner does not place students
 * in classes, register them, record payments or enter marks).
 *
 * A signed-in owner (the Super Admin role and nothing else) gets only what is below, enforced on the server for every page, action and
 * download. Everything the owner may VIEW stays; so do the owner's own powers (staff and roles, settings, audit, backups, approval limits,
 * what is reserved for him). Any daily-work permission (place, register, record, verify, enter, approve results, take attendance...) is
 * left out. To do one of those in an emergency the owner must "step in": a stated reason, 30 minutes, a banner on every page and an audit
 * entry at the start and the end.
 */
export const STEP_IN_COOKIE = "sam_stepin";
export const STEP_IN_MINUTES = 30;

// Anything that only looks: reading, reading everything, reading assigned, overseeing, analytics and reports.
const VIEW = /\.(read|read_all|read_assigned|oversee|analytics|reports)$/;
// Sensitive reads that stay with the people who need them.
const NOT_VIEW = new Set<string>(["student.medical.read", "library.access_staff"]);
// The owner's own powers: governance, settings and what is reserved for him.
const OWNER_OWN: readonly PermissionKey[] = [
  "executive.read", "school.settings.update", "user.create", "user.update", "user.suspend", "user.reset_password", "role.manage",
  "website.manage", "library.manage", "library.audit", "schoolid.manage", "grading.manage", "staff.onboard", "staff.recruit.decide", "tasks.admin",
  "expense.approve_high", "refund.approve_high", "admission.override", "class.capacity_override", "fees.discount",
];

export const OVERSIGHT_ALLOWED: ReadonlySet<PermissionKey> = new Set<PermissionKey>([
  ...ALL_PERMISSION_KEYS.filter((k) => VIEW.test(k) && !NOT_VIEW.has(k)),
  ...OWNER_OWN,
]);

/** The owner is someone whose only staff role is Super Admin (an owner who was also given a department's role keeps that role's work). */
export const isOwnerOnly = (ctx: Pick<AuthContext, "userType" | "roleKeys">) => ctx.userType === "STAFF" && ctx.roleKeys.includes("super_admin") && ctx.roleKeys.every((r) => r === "super_admin");

/** Returns the context the request should run with: the owner's view-and-govern set, or the full set while he is stepping in. */
export function applyOversight(ctx: AuthContext, stepInUntil: number | null, now = Date.now()): AuthContext {
  if (!isOwnerOnly(ctx)) return ctx;
  if (stepInUntil !== null && stepInUntil > now) return { ...ctx, oversight: false, stepInUntil };
  return { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => OVERSIGHT_ALLOWED.has(p))), oversight: true, stepInUntil: null };
}
