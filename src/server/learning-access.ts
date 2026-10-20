import { db, type Db, type Tx } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { teachingScope } from "@/server/academics";
import { teachingRows, teaches } from "@/server/marks";

/** Who may do what in the learning hub. Teachers act only where they teach; school-wide readers (student.read) see everything. */

export async function currentYearId(client: Db | Tx, schoolId: string): Promise<string | null> {
  return (await client.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } }))?.id ?? null;
}

export const schoolWide = (ctx: AuthContext) => ctx.userType === "STAFF" && ctx.permissions.has("student.read");

/** The class teacher of a class/stream may act for every subject there; a subject teacher only for their subject. */
export async function teachesUnit(ctx: AuthContext, academicYearId: string, u: { classId: string; streamId: string | null; subjectId: string }): Promise<boolean> {
  if (!ctx.staffId) return false;
  return teaches(await teachingRows(db, ctx, academicYearId), u);
}

export async function requireTeachesUnit(ctx: AuthContext, academicYearId: string, u: { classId: string; streamId: string | null; subjectId: string }) {
  if (!(await teachesUnit(ctx, academicYearId, u))) throw forbidden("You can do this only for classes and subjects you teach.");
}

/** Does this teacher teach this subject in any stream of the class (a scheme of work is written for the class as a whole)? */
export async function requireTeachesClassSubject(ctx: AuthContext, academicYearId: string, u: { classId: string; subjectId: string }) {
  const rows = ctx.staffId ? await teachingRows(db, ctx, academicYearId) : [];
  if (!rows.some((r) => r.classId === u.classId && (r.subjectId === null || r.subjectId === u.subjectId))) throw forbidden("You can do this only for classes and subjects you teach.");
}

/** Does this staff member teach the student's class (and stream) in the current year, in any subject? */
export async function teachesStudent(ctx: AuthContext, studentId: string): Promise<boolean> {
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId || !ctx.staffId) return false;
  const en = await db.studentEnrollment.findFirst({ where: { schoolId: ctx.schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true, streamId: true } });
  if (!en) return false;
  const scope = await teachingScope(ctx.staffId, yearId);
  return scope.some((s) => s.classId === en.classId && (s.streamId === null || s.streamId === en.streamId));
}

/** The student's current class and stream, for portal views. */
export async function currentPlacement(client: Db | Tx, schoolId: string, studentId: string) {
  const yearId = await currentYearId(client, schoolId);
  if (!yearId) return null;
  const en = await client.studentEnrollment.findFirst({ where: { schoolId, studentId, academicYearId: yearId, status: "ACTIVE" }, select: { classId: true, streamId: true, academicYearId: true } });
  return en;
}

export const personName = (p: { firstName: string; middleName: string | null; lastName: string }) => [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");

/** In-app notice for the portal accounts of these students and their linked guardians. Nobody without an account is notified. */
export async function notifyFamilies(tx: Tx, schoolId: string, studentIds: string[], title: string, body: string, linkFor: (studentId: string) => string) {
  if (!studentIds.length) return;
  const [students, links] = await Promise.all([
    tx.student.findMany({ where: { schoolId, id: { in: studentIds }, userId: { not: null } }, select: { id: true, userId: true } }),
    tx.studentGuardian.findMany({ where: { schoolId, studentId: { in: studentIds }, guardian: { userId: { not: null } } }, select: { studentId: true, guardian: { select: { userId: true } } } }),
  ]);
  const rows: { schoolId: string; userId: string; title: string; body: string; link: string }[] = [];
  const seen = new Set<string>();
  const add = (userId: string | null | undefined, studentId: string) => {
    if (!userId || seen.has(`${userId}:${studentId}`)) return;
    seen.add(`${userId}:${studentId}`);
    rows.push({ schoolId, userId, title, body: body.slice(0, 160), link: linkFor(studentId) });
  };
  for (const s of students) add(s.userId, s.id);
  for (const l of links) add(l.guardian.userId, l.studentId);
  if (rows.length) await tx.inAppNotification.createMany({ data: rows });
}

/** Ids of the students in classes/streams this teacher teaches in the current year. */
export async function teachingStudentIds(ctx: AuthContext): Promise<string[]> {
  const yearId = await currentYearId(db, ctx.schoolId);
  if (!yearId || !ctx.staffId) return [];
  const scope = await teachingScope(ctx.staffId, yearId);
  if (!scope.length) return [];
  const rows = await db.studentEnrollment.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: yearId, status: "ACTIVE", OR: scope.map((s) => ({ classId: s.classId, ...(s.streamId ? { streamId: s.streamId } : {}) })) },
    select: { studentId: true },
  });
  return rows.map((r) => r.studentId);
}

/** May this staff member see/write learning records (portfolio, behaviour) for this student? */
export async function canActForStudent(ctx: AuthContext, studentId: string): Promise<boolean> {
  if (ctx.userType !== "STAFF") return false;
  if (!(await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { id: true } }))) return false;
  return schoolWide(ctx) || (await teachesStudent(ctx, studentId));
}

export async function schoolTimezone(schoolId: string): Promise<string> {
  return (await db.school.findUnique({ where: { id: schoolId }, select: { timezone: true } }))?.timezone ?? "Africa/Dar_es_Salaam";
}

/** Students this staff member may work with (their classes, or everyone for school-wide readers), optionally filtered by a name/number search. */
export async function searchMyStudents(ctx: AuthContext, q: string) {
  const ids = schoolWide(ctx) ? undefined : await teachingStudentIds(ctx);
  if (ids && !ids.length) return [];
  const term = q.trim();
  const rows = await db.student.findMany({
    where: { schoolId: ctx.schoolId, status: "ENROLLED", ...(ids ? { id: { in: ids } } : {}), ...(term ? { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { admissionNo: { contains: term, mode: "insensitive" } }] } : {}) },
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true }, orderBy: [{ firstName: "asc" }, { lastName: "asc" }], take: 40,
  });
  return rows.map((r) => ({ id: r.id, name: personName(r), admissionNo: r.admissionNo }));
}
