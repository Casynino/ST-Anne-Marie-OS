/*
 * Which "portal" (home page) a signed-in person gets. Everybody signs in on the same page; what they see first depends on who they are.
 * Staff are told apart by their roles (a person with several roles gets the highest of: admin, head teacher, accountant, registrar,
 * teacher); a staff member with a custom role gets the general staff overview, whose panels follow their permissions. This only picks the
 * landing page: what a person may actually read or do is always checked on the server by permission.
 */

export type PortalKind = "admin" | "head" | "accountant" | "registrar" | "teacher" | "staff" | "parent" | "student";

type WhoAmI = { userType: "STAFF" | "GUARDIAN" | "STUDENT"; roleKeys: readonly string[]; permissions?: ReadonlySet<string> };

export function portalOf(who: WhoAmI): PortalKind {
  if (who.userType === "GUARDIAN") return "parent";
  if (who.userType === "STUDENT") return "student";
  const r = new Set(who.roleKeys);
  if (r.has("super_admin")) return "admin";
  if (r.has("head_teacher")) return "head";
  if (r.has("accountant")) return "accountant";
  if (r.has("registrar")) return "registrar";
  if (r.has("class_teacher") || r.has("subject_teacher")) return "teacher";
  // A custom role that only teaches (no school-wide student access) still gets the teacher's day.
  const p = who.permissions;
  if (p && !p.has("student.read") && (p.has("attendance.take") || p.has("marks.enter") || p.has("assignments.manage"))) return "teacher";
  return "staff";
}

/** Translation key of the portal's name, shown above the greeting. */
export const portalLabelKey = (k: PortalKind) => `portal.${k}` as const;
