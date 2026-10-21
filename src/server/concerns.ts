import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { actorOf, writeAudit } from "@/server/audit";
import { studentScope } from "@/server/students";
import { closeTasks, openTask } from "@/server/workflow";
import { optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Academic concerns: a teacher flags a student who may need support; the Academic Office follows it up to a recorded outcome. A concern is a
 * record with a status and a log of what was done, not just an alert. The notes are restricted; the family sees nothing unless the Academic
 * Office writes a message for them and chooses to share it.
 */

const CATEGORIES = ["ABSENCE", "LOW_MARKS", "MISSING_WORK", "DECLINE", "BEHAVIOUR", "OTHER"] as const;

const flagSchema = z.object({ studentId: uuid(), category: z.enum(CATEGORIES), summary: text(200), notes: optText(2000), subjectId: optUuid() });

/** A teacher flags a student they teach (the student must be visible to them). Staff who manage concerns can flag any student. */
export async function flagConcern(ctx: AuthContext, input: unknown) {
  requireAnyPermission(ctx, ["concern.flag", "concern.manage"]);
  const d = parse(flagSchema, input);
  const scope = await studentScope(ctx);
  const student = await db.student.findFirst({ where: { AND: [scope, { id: d.studentId, schoolId: ctx.schoolId }] }, select: { id: true, firstName: true, lastName: true, admissionNo: true, enrollments: { where: { status: "ACTIVE" }, take: 1, select: { classId: true } } } });
  if (!student) throw notFound("Student"); // someone else's class does not exist for this teacher
  return db.$transaction(async (tx) => {
    const c = await tx.academicConcern.create({ data: { schoolId: ctx.schoolId, studentId: d.studentId, category: d.category, summary: d.summary, notes: d.notes ?? null, subjectId: d.subjectId ?? null, classId: student.enrollments[0]?.classId ?? null, flaggedById: ctx.userId } });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "CONCERN_FOLLOWUP", relatedType: "AcademicConcern", relatedId: c.id, relatedLabel: `${student.firstName} ${student.lastName} (${student.admissionNo}) · ${d.category}`, sourceEvent: "concern.flagged", createdById: ctx.userId });
    await writeAudit(tx, actorOf(ctx), { action: "concern.flag", entityType: "AcademicConcern", entityId: c.id, summary: `${student.firstName} ${student.lastName} (${student.admissionNo})`, changes: { category: d.category } });
    return c;
  });
}

export type ConcernRow = {
  id: string; studentId: string; studentName: string; admissionNo: string; category: string; summary: string; notes: string | null; status: string; flaggedBy: string; flaggedAt: Date;
  assignedToId: string | null; assignedTo: string | null; shareWithParent: boolean; parentMessage: string | null; resolution: string | null; resolvedAt: Date | null; className: string | null;
};

async function rows(ctx: AuthContext, where: object): Promise<ConcernRow[]> {
  const list = await db.academicConcern.findMany({ where: { schoolId: ctx.schoolId, ...where }, orderBy: [{ status: "asc" }, { flaggedAt: "desc" }], take: 200 });
  const [students, users, classes] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(list.map((c) => c.studentId))] } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(list.flatMap((c) => [c.flaggedById, c.assignedToId].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: list.flatMap((c) => (c.classId ? [c.classId] : [])) } }, select: { id: true, name: true } }),
  ]);
  const notes = ctx.permissions.has("concern.notes");
  return list.map((c) => {
    const s = students.find((x) => x.id === c.studentId);
    return {
      id: c.id, studentId: c.studentId, studentName: s ? `${s.firstName} ${s.lastName}` : "", admissionNo: s?.admissionNo ?? "", category: c.category, summary: c.summary,
      notes: notes || c.flaggedById === ctx.userId ? c.notes : null, status: c.status, flaggedBy: users.find((u) => u.id === c.flaggedById)?.fullName ?? "", flaggedAt: c.flaggedAt,
      assignedToId: c.assignedToId, assignedTo: users.find((u) => u.id === c.assignedToId)?.fullName ?? null, shareWithParent: c.shareWithParent, parentMessage: c.parentMessage,
      resolution: c.resolution, resolvedAt: c.resolvedAt, className: classes.find((x) => x.id === c.classId)?.name ?? null,
    };
  });
}

/** Everyone with concern.manage sees every concern; a teacher sees only the ones they flagged. */
export async function listConcerns(ctx: AuthContext, opts: { status?: "open" | "closed" | "all"; studentId?: string } = {}) {
  requireAnyPermission(ctx, ["concern.manage", "concern.flag"]);
  const manage = ctx.permissions.has("concern.manage");
  const status = opts.status === "closed" ? { in: ["RESOLVED", "DISMISSED"] } : opts.status === "all" ? undefined : { in: ["OPEN", "IN_PROGRESS"] };
  return rows(ctx, { ...(status ? { status } : {}), ...(opts.studentId ? { studentId: opts.studentId } : {}), ...(manage ? {} : { flaggedById: ctx.userId }) });
}

export async function getConcern(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["concern.manage", "concern.flag"]);
  const manage = ctx.permissions.has("concern.manage");
  const [c] = await rows(ctx, { id, ...(manage ? {} : { flaggedById: ctx.userId }) });
  if (!c) throw notFound("Concern");
  const actions = await db.concernAction.findMany({ where: { schoolId: ctx.schoolId, concernId: id }, orderBy: { createdAt: "asc" } });
  const users = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(actions.map((a) => a.byUserId))] } }, select: { id: true, fullName: true } });
  return { concern: c, actions: actions.map((a) => ({ ...a, by: users.find((u) => u.id === a.byUserId)?.fullName ?? "" })) };
}

const actionSchema = z.object({ kind: z.enum(["NOTE", "MEETING", "PARENT_CONTACT", "SUPPORT_PLAN"]).default("NOTE"), note: text(1000) });

/** Records a step taken. The first step moves an open concern to In progress and assigns it to the person who took it when nobody was assigned. */
export async function addConcernAction(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "concern.manage");
  const d = parse(actionSchema, input);
  await db.$transaction(async (tx) => {
    const rows_ = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM academic_concerns WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows_.length) throw notFound("Concern");
    const c = await tx.academicConcern.findUniqueOrThrow({ where: { id } });
    if (c.status === "RESOLVED" || c.status === "DISMISSED") throw conflict("This concern is closed.");
    await tx.concernAction.create({ data: { schoolId: ctx.schoolId, concernId: id, kind: d.kind, note: d.note, byUserId: ctx.userId } });
    if (c.status === "OPEN") {
      await tx.academicConcern.update({ where: { id }, data: { status: "IN_PROGRESS", assignedToId: c.assignedToId ?? ctx.userId } });
      await tx.workflowTask.updateMany({ where: { schoolId: ctx.schoolId, relatedType: "AcademicConcern", relatedId: id, status: "PENDING" }, data: { status: "IN_PROGRESS", startedAt: new Date(), assignedToId: ctx.userId } });
    }
    await writeAudit(tx, actorOf(ctx), { action: "concern.action", entityType: "AcademicConcern", entityId: id, changes: { kind: d.kind } });
  });
}

export async function assignConcern(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "concern.manage");
  const { userId } = parse(z.object({ userId: optUuid() }), input);
  await db.$transaction(async (tx) => {
    const c = await tx.academicConcern.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Concern");
    if (c.status === "RESOLVED" || c.status === "DISMISSED") throw conflict("This concern is closed.");
    if (userId && !(await tx.user.findFirst({ where: { id: userId, schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, select: { id: true } }))) throw notFound("User");
    await tx.academicConcern.update({ where: { id }, data: { assignedToId: userId ?? null } });
    await tx.workflowTask.updateMany({ where: { schoolId: ctx.schoolId, relatedType: "AcademicConcern", relatedId: id, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { assignedToId: userId ?? null } });
    await writeAudit(tx, actorOf(ctx), { action: "concern.assign", entityType: "AcademicConcern", entityId: id, changes: { from: c.assignedToId, to: userId ?? null } });
  });
}

const resolveSchema = z.object({ outcome: z.enum(["RESOLVED", "DISMISSED"]), resolution: text(600) });

export async function resolveConcern(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "concern.manage");
  const d = parse(resolveSchema, input);
  await db.$transaction(async (tx) => {
    const c = await tx.academicConcern.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Concern");
    if (c.status === "RESOLVED" || c.status === "DISMISSED") throw conflict("This concern is already closed.");
    await tx.academicConcern.update({ where: { id }, data: { status: d.outcome, resolution: d.resolution, resolvedById: ctx.userId, resolvedAt: new Date() } });
    await tx.concernAction.create({ data: { schoolId: ctx.schoolId, concernId: id, kind: "STATUS", note: `${d.outcome}: ${d.resolution}`, byUserId: ctx.userId } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "AcademicConcern", relatedId: id, by: ctx.userId, note: d.resolution });
    await writeAudit(tx, actorOf(ctx), { action: "concern.resolve", entityType: "AcademicConcern", entityId: id, changes: { outcome: d.outcome }, reason: d.resolution });
  });
}

/** Writes the message the family will see and shares it. Nothing else about the concern is ever shown to them. */
export async function shareConcernWithParent(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "concern.manage");
  const { message } = parse(z.object({ message: text(600) }), input);
  await db.$transaction(async (tx) => {
    const c = await tx.academicConcern.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!c) throw notFound("Concern");
    await tx.academicConcern.update({ where: { id }, data: { shareWithParent: true, parentMessage: message } });
    await tx.concernAction.create({ data: { schoolId: ctx.schoolId, concernId: id, kind: "PARENT_CONTACT", note: `Shared with the family: ${message}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "concern.share", entityType: "AcademicConcern", entityId: id });
  });
}

export async function openConcernCount(ctx: AuthContext): Promise<number> {
  requirePermission(ctx, "concern.manage");
  return db.academicConcern.count({ where: { schoolId: ctx.schoolId, status: { in: ["OPEN", "IN_PROGRESS"] } } });
}
