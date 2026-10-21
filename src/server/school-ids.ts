import { db, type Tx } from "@/lib/db";
import { conflict } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { getStaffIdSettings } from "@/server/settings";
import { formatAdmissionNo } from "@/server/students";

/*
 * School IDs. A student's school ID is the admission number given when the school officially enrols them (see `allocateAdmissionNo`: atomic,
 * configurable, never reused, never changed). A teacher's or staff member's school ID is `Staff.staffNo`, given when they are registered and
 * kept for life: changing class, subject, department or role never changes it. Both come from a locked counter row, not from counting records,
 * so two registrations at the same moment cannot receive the same number and a deleted or archived record's number is never handed out again.
 */

/** The year used in new numbers: the school's current year (its own time zone). */
export async function schoolYear(client: Pick<Tx, "school">, schoolId: string): Promise<number> {
  const school = await client.school.findUnique({ where: { id: schoolId }, select: { timezone: true } });
  return Number(todayInTimezone(school?.timezone ?? "Africa/Dar_es_Salaam").slice(0, 4));
}

/** Atomically allocates the next staff ID. Numbers already used by any staff member, or by a student's admission number, are skipped. */
export async function allocateStaffNo(tx: Tx, schoolId: string, year: number): Promise<string> {
  const settings = await getStaffIdSettings(tx, schoolId);
  const scope = `STF:${settings.resetYearly ? year : "ALL"}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO admission_counters ("schoolId", "scope", "lastValue")
      VALUES (${schoolId}::uuid, ${scope}, 1)
      ON CONFLICT ("schoolId", "scope") DO UPDATE SET "lastValue" = admission_counters."lastValue" + 1
      RETURNING "lastValue"`;
    const staffNo = formatAdmissionNo(settings, year, rows[0]!.lastValue);
    const [staff, student] = await Promise.all([
      tx.staff.findUnique({ where: { schoolId_staffNo: { schoolId, staffNo } }, select: { id: true } }),
      tx.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo: staffNo } }, select: { id: true } }),
    ]);
    if (!staff && !student) return staffNo;
  }
  throw conflict("Could not allocate a staff ID. Please check the staff ID format in the settings.");
}

/** What the school needs to know about its IDs: who has one and who does not. */
export async function schoolIdReport(ctx: AuthContext) {
  requirePermission(ctx, "schoolid.manage");
  const [staffTotal, staffMissing, students] = await Promise.all([
    db.staff.count({ where: { schoolId: ctx.schoolId } }),
    db.staff.count({ where: { schoolId: ctx.schoolId, staffNo: null } }),
    db.student.count({ where: { schoolId: ctx.schoolId } }),
  ]);
  return { staffTotal, staffWithId: staffTotal - staffMissing, staffMissing, students };
}

/**
 * Gives an ID to every staff member who has none, oldest first. Safe to run again: members who already have one keep it untouched, nothing
 * is duplicated, and each assignment is written to the audit log. Returns how many were assigned.
 */
export async function assignMissingStaffIds(ctx: AuthContext) {
  requirePermission(ctx, "schoolid.manage");
  const missing = await db.staff.findMany({ where: { schoolId: ctx.schoolId, staffNo: null }, orderBy: { createdAt: "asc" }, select: { id: true, user: { select: { fullName: true } } } });
  let assigned = 0;
  for (const s of missing) {
    await db.$transaction(async (tx) => {
      const fresh = await tx.staff.findUnique({ where: { id: s.id }, select: { staffNo: true } });
      if (fresh?.staffNo) return; // someone gave it one in the meantime
      const staffNo = await allocateStaffNo(tx, ctx.schoolId, await schoolYear(tx, ctx.schoolId));
      await tx.staff.update({ where: { id: s.id }, data: { staffNo } });
      await writeAudit(tx, actorOf(ctx), { action: "staff.assign_id", entityType: "Staff", entityId: s.id, summary: `${s.user.fullName}: ${staffNo}`, changes: { staffNo } });
      assigned++;
    });
  }
  if (assigned > 0) await writeAudit(db, actorOf(ctx), { action: "staff.assign_ids_batch", entityType: "School", entityId: ctx.schoolId, summary: `${assigned} staff ID(s) assigned` });
  return { assigned, alreadyHad: (await db.staff.count({ where: { schoolId: ctx.schoolId, staffNo: { not: null } } })) - assigned };
}

/** Tidies what a person typed into the shape stored on records (upper case, no spaces). Returns null when it cannot be an ID. */
export function normaliseSchoolId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9][A-Z0-9/_.-]{2,39}$/.test(v) ? v : null;
}

/** Finds the one student or staff member with this school ID. An ID that matches nobody, or more than one record, returns null. */
export async function findBySchoolId(schoolId: string, id: string): Promise<{ kind: "STUDENT"; studentId: string } | { kind: "STAFF"; staffId: string } | null> {
  const [student, staff] = await Promise.all([
    db.student.findUnique({ where: { schoolId_admissionNo: { schoolId, admissionNo: id } }, select: { id: true } }),
    db.staff.findUnique({ where: { schoolId_staffNo: { schoolId, staffNo: id } }, select: { id: true } }),
  ]);
  if (student && staff) return null;
  if (student) return { kind: "STUDENT", studentId: student.id };
  if (staff) return { kind: "STAFF", staffId: staff.id };
  return null;
}
