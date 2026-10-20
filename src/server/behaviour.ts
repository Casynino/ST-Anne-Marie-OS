import { z } from "zod";
import type { BehaviourType, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { parseDateOnly, todayInTimezone } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { canActForStudent, personName, schoolWide, teachingStudentIds } from "@/server/learning-access";
import { childOrThrow } from "@/server/portal";
import { dateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Behaviour records (positive notes, concerns, incidents). They are never edited or deleted (a DB trigger enforces it): a wrong
 * record is voided with a reason and entered again. Teachers see and write records for students they teach; behaviour.read_all
 * sees everyone. A record reaches the family only when someone explicitly shares it; parents then see it, and a student account
 * sees shared POSITIVE records only.
 */

const recordSchema = z.object({
  studentId: uuid(), occurredOn: dateOnly(), type: z.enum(["POSITIVE", "CONCERN", "INCIDENT"]),
  category: text(60), description: text(1500), action: optText(600),
  share: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()),
});

export async function recordBehaviour(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "behaviour.record");
  const d = parse(recordSchema, input);
  if (!(await canActForStudent(ctx, d.studentId))) throw notFound("Student");
  const school = await db.school.findUnique({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = parseDateOnly(todayInTimezone(school?.timezone ?? "Africa/Dar_es_Salaam")) as Date;
  if (d.occurredOn.getTime() > today.getTime()) throw invalid("Please correct the highlighted fields.", { occurredOn: "The date cannot be in the future" });
  return db.$transaction(async (tx) => {
    const r = await tx.behaviourRecord.create({ data: { schoolId: ctx.schoolId, studentId: d.studentId, occurredOn: d.occurredOn, type: d.type, category: d.category, description: d.description, action: d.action ?? null, sharedWithFamily: d.share, recordedById: ctx.userId } });
    // the description itself is not copied into the audit log
    await writeAudit(tx, actorOf(ctx), { action: "behaviour.record", entityType: "BehaviourRecord", entityId: r.id, summary: `${d.type} ${d.category}`, changes: { studentId: d.studentId, shared: d.share } });
    return r;
  });
}

async function loadEditable(ctx: AuthContext, id: string) {
  requirePermission(ctx, "behaviour.record");
  const r = await db.behaviourRecord.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!r) throw notFound("Behaviour record");
  const own = r.recordedById === ctx.userId;
  if (!own && !ctx.permissions.has("behaviour.read_all")) throw notFound("Behaviour record");
  return r;
}

export async function setBehaviourShared(ctx: AuthContext, id: string, share: boolean) {
  const r = await loadEditable(ctx, id);
  if (r.voidedAt) throw conflict("This record has been voided.");
  if (r.sharedWithFamily === share) return;
  await db.$transaction(async (tx) => {
    await tx.behaviourRecord.update({ where: { id }, data: { sharedWithFamily: share } });
    await writeAudit(tx, actorOf(ctx), { action: share ? "behaviour.share" : "behaviour.unshare", entityType: "BehaviourRecord", entityId: id, summary: `${r.type} ${r.category}`, changes: { studentId: r.studentId } });
  });
}

export async function voidBehaviour(ctx: AuthContext, id: string, reason: unknown) {
  const r = await loadEditable(ctx, id);
  const why = parse(text(300), reason);
  if (r.voidedAt) throw conflict("Already voided.");
  await db.$transaction(async (tx) => {
    await tx.behaviourRecord.update({ where: { id }, data: { voidedAt: new Date(), voidedById: ctx.userId, voidReason: why, sharedWithFamily: false } });
    await writeAudit(tx, actorOf(ctx), { action: "behaviour.void", entityType: "BehaviourRecord", entityId: id, summary: `${r.type} ${r.category}`, reason: why, changes: { studentId: r.studentId } });
  });
}

export type BehaviourFilter = { studentId?: string; type?: string; classId?: string; from?: Date; to?: Date; includeVoided?: boolean };

async function readableStudents(ctx: AuthContext): Promise<string[] | null> {
  if (ctx.permissions.has("behaviour.read_all")) return null;
  return teachingStudentIds(ctx);
}

export async function listBehaviour(ctx: AuthContext, f: BehaviourFilter = {}) {
  requireAnyPermission(ctx, ["behaviour.record", "behaviour.read_all"]);
  if (ctx.userType !== "STAFF") throw forbidden("Staff only.");
  const scope = await readableStudents(ctx);
  const where: Prisma.BehaviourRecordWhereInput = { schoolId: ctx.schoolId };
  const and: Prisma.BehaviourRecordWhereInput[] = [];
  if (scope) and.push({ OR: [{ studentId: { in: scope } }, { recordedById: ctx.userId }] });
  if (f.studentId) and.push({ studentId: f.studentId });
  if (f.type) and.push({ type: f.type as BehaviourType });
  if (f.from || f.to) and.push({ occurredOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } });
  if (!f.includeVoided) and.push({ voidedAt: null });
  if (f.classId) {
    const year = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
    const ids = year ? (await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: year.id, status: "ACTIVE", classId: f.classId }, select: { studentId: true } })).map((e) => e.studentId) : [];
    and.push({ studentId: { in: ids } });
  }
  const rows = await db.behaviourRecord.findMany({ where: { ...where, AND: and }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }], take: 300 });
  const [students, users] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.map((r) => r.recordedById))] } }, select: { id: true, fullName: true } }),
  ]);
  return rows.map((r) => {
    const s = students.find((x) => x.id === r.studentId);
    return { id: r.id, studentId: r.studentId, studentName: s ? personName(s) : "—", admissionNo: s?.admissionNo ?? "", occurredOn: r.occurredOn, type: r.type, category: r.category, description: r.description, action: r.action, shared: r.sharedWithFamily, recordedBy: users.find((u) => u.id === r.recordedById)?.fullName ?? "—", mine: r.recordedById === ctx.userId, voided: !!r.voidedAt, voidReason: r.voidReason };
  });
}

/** Students the user may record behaviour for (used by the form). */
export async function behaviourStudents(ctx: AuthContext, q: string) {
  requirePermission(ctx, "behaviour.record");
  const ids = schoolWide(ctx) ? undefined : await teachingStudentIds(ctx);
  if (ids && !ids.length) return [];
  const term = q.trim();
  const rows = await db.student.findMany({
    where: { schoolId: ctx.schoolId, status: "ENROLLED", ...(ids ? { id: { in: ids } } : {}), ...(term ? { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { admissionNo: { contains: term, mode: "insensitive" } }] } : {}) },
    select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true }, orderBy: { firstName: "asc" }, take: 30,
  });
  return rows.map((r) => ({ id: r.id, name: personName(r), admissionNo: r.admissionNo }));
}

/** Portal: only records somebody chose to share. A student account sees shared POSITIVE records only. */
export async function childBehaviour(ctx: AuthContext, studentId: string) {
  await childOrThrow(ctx, studentId);
  const rows = await db.behaviourRecord.findMany({
    where: { schoolId: ctx.schoolId, studentId, sharedWithFamily: true, voidedAt: null, ...(ctx.userType === "STUDENT" ? { type: "POSITIVE" } : {}) },
    orderBy: [{ occurredOn: "desc" }], take: 200,
    select: { id: true, occurredOn: true, type: true, category: true, description: true, action: true },
  });
  return rows;
}
