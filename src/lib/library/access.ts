/*
 * Who may find and open a library resource. Pure rules, kept apart from the database so they can be tested exhaustively; the same rules are
 * turned into a database filter (`visibilityWhere` in the library service) and an integration test checks the two always agree.
 *
 * A viewer is a person the school has recognised, never a free-text claim:
 *  - VISITOR: nobody has been verified; GUARDIAN: a parent's account (public material only).
 *  - STUDENT: an enrolled student, with the class they are in this year and the subjects of that class.
 *  - STAFF: a staff member with the classes and subjects they teach this year and what their account may do.
 * `level` ID_ONLY means only the school ID was given (no PIN or password); it opens only what the school marked as open to the ID alone.
 */

export type Level = "FULL" | "ID_ONLY";

export type Viewer =
  | { kind: "VISITOR" }
  | { kind: "GUARDIAN" }
  | { kind: "STUDENT"; studentId: string; classId: string | null; subjectIds: string[]; level: Level }
  | { kind: "STAFF"; staffId: string; classIds: string[]; subjectIds: string[]; canReadStaffMaterial: boolean; manager: boolean; level: Level };

export type Audience = "PUBLIC" | "STUDENTS" | "STAFF" | "CLASSES" | "SUBJECTS" | "RESTRICTED";

export type ResourceRule = {
  status: string;
  audience: Audience;
  availableFrom: Date | null;
  idOnly: boolean;
  classIds: string[];
  subjectIds: string[];
  staffIds: string[];
};

export type Decision =
  | { ok: true }
  | { ok: false; reason: "UNAVAILABLE" | "VERIFY" | "PIN_NEEDED" | "NOT_FOR_YOU" };

export const isLive = (r: Pick<ResourceRule, "status" | "availableFrom">, now: Date) => r.status === "PUBLISHED" && (!r.availableFrom || r.availableFrom <= now);

const overlaps = (a: string[], b: string[]) => a.some((x) => b.includes(x));

/** Does the viewer's identity satisfy the audience of the resource (ignoring how strongly they were verified)? */
function audienceAllows(v: Viewer, r: ResourceRule): boolean {
  if (r.audience === "PUBLIC") return true;
  if (v.kind === "STUDENT") {
    if (r.audience === "STUDENTS") return true;
    if (r.audience === "CLASSES") return v.classId !== null && r.classIds.includes(v.classId);
    if (r.audience === "SUBJECTS") return overlaps(r.subjectIds, v.subjectIds);
    return false; // STAFF and RESTRICTED material is never for students
  }
  if (v.kind === "STAFF") {
    if (v.manager) return true;
    if (r.audience === "RESTRICTED") return r.staffIds.includes(v.staffId);
    if (!v.canReadStaffMaterial) return false;
    if (r.audience === "STUDENTS" || r.audience === "STAFF") return true;
    if (r.audience === "CLASSES") return overlaps(r.classIds, v.classIds);
    if (r.audience === "SUBJECTS") return overlaps(r.subjectIds, v.subjectIds);
  }
  return false;
}

/** Can this viewer open the file now? The reason says what to tell them. */
export function canAccess(v: Viewer, r: ResourceRule, o: { now: Date; allowIdOnly: boolean }): Decision {
  if (!isLive(r, o.now)) return { ok: false, reason: "UNAVAILABLE" };
  if (r.audience === "PUBLIC") return { ok: true };
  if (v.kind === "VISITOR") return { ok: false, reason: r.audience === "STAFF" || r.audience === "RESTRICTED" ? "UNAVAILABLE" : "VERIFY" };
  if (v.kind === "GUARDIAN") return { ok: false, reason: r.audience === "STAFF" || r.audience === "RESTRICTED" ? "UNAVAILABLE" : "NOT_FOR_YOU" };
  if (!audienceAllows(v, r)) return { ok: false, reason: r.audience === "STAFF" || r.audience === "RESTRICTED" ? "UNAVAILABLE" : "NOT_FOR_YOU" };
  if (v.level === "ID_ONLY") {
    const openToId = o.allowIdOnly && r.idOnly && (r.audience === "STUDENTS" || r.audience === "CLASSES" || r.audience === "SUBJECTS") && v.kind === "STUDENT";
    if (!openToId) return { ok: false, reason: "PIN_NEEDED" };
  }
  return { ok: true };
}

/**
 * Can this viewer even see the resource in lists and search? Material meant for students is listed for everyone (so a student can find a
 * book before verifying); staff-only and restricted material is listed only to people allowed to open it; a verified student or teacher
 * sees only what is theirs.
 */
export function canDiscover(v: Viewer, r: ResourceRule, now: Date): boolean {
  if (!isLive(r, now)) return false;
  if (r.audience === "PUBLIC") return true;
  if (v.kind === "VISITOR" || v.kind === "GUARDIAN") return r.audience === "STUDENTS" || r.audience === "CLASSES" || r.audience === "SUBJECTS";
  return audienceAllows(v, r);
}
