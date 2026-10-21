import { z } from "zod";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { placeStudentTx } from "@/server/students";
import { closeTasks, openTask } from "@/server/workflow";
import { checkbox, optDateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

/*
 * Class transfers and promotions. One person asks, a different person decides, and the move is applied on its effective date by the same
 * placement code used everywhere else: the old enrolment is closed (never erased), a new one opens, capacity is checked, and the audit entry
 * records both classes, the date, the reason and who approved. Attendance and mark sheets follow the enrolment dates, so earlier results stay
 * with the class they were taken in.
 */

const label = (s: { firstName: string; lastName: string; admissionNo: string }) => `${s.firstName} ${s.lastName} (${s.admissionNo})`;
const schoolToday = async (client: Tx | typeof db, schoolId: string) => {
  const s = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return parseDateOnly(todayInTimezone(s.timezone)) as Date;
};

const requestSchema = z.object({
  studentId: uuid(),
  kind: z.enum(["TRANSFER", "PROMOTION"]).default("TRANSFER"),
  toClassId: uuid(),
  toStreamId: optUuid(),
  academicYearId: optUuid(),
  effectiveOn: optDateOnly(),
  reason: optText(400),
}).refine((v) => v.kind === "PROMOTION" || !!v.reason, { path: ["reason"], message: "Give the reason for the transfer" });

async function createRequestTx(tx: Tx, ctx: AuthContext, d: z.output<typeof requestSchema>, today: Date) {
  const student = await tx.student.findFirst({ where: { id: d.studentId, schoolId: ctx.schoolId } });
  if (!student) throw notFound("Student");
  if (student.status !== "ENROLLED") throw conflict("Only students with status Enrolled can be moved.");
  const cls = await tx.schoolClass.findFirst({ where: { id: d.toClassId, schoolId: ctx.schoolId, isActive: true } });
  if (!cls) throw invalid("Please correct the highlighted fields.", { toClassId: "Choose an active class" });
  if (d.toStreamId) {
    if (!(await tx.stream.findFirst({ where: { id: d.toStreamId, schoolId: ctx.schoolId, classId: d.toClassId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { toStreamId: "That stream does not belong to the class" });
  } else if (await tx.stream.count({ where: { classId: d.toClassId } })) throw invalid("Please correct the highlighted fields.", { toStreamId: "Choose a stream for this class" });
  const current = await tx.studentEnrollment.findFirst({ where: { studentId: d.studentId, status: "ACTIVE" }, orderBy: { startedOn: "desc" } });
  if (!current) throw conflict("This student is not in a class yet. Place the student in a class instead.");
  const year = d.academicYearId
    ? await tx.academicYear.findFirst({ where: { id: d.academicYearId, schoolId: ctx.schoolId } })
    : d.kind === "PROMOTION" ? await tx.academicYear.findFirst({ where: { schoolId: ctx.schoolId, startsOn: { gt: (await tx.academicYear.findUniqueOrThrow({ where: { id: current.academicYearId } })).startsOn } }, orderBy: { startsOn: "asc" } }) : await tx.academicYear.findFirst({ where: { id: current.academicYearId, schoolId: ctx.schoolId } });
  if (!year) throw invalid("Please correct the highlighted fields.", { academicYearId: d.kind === "PROMOTION" ? "Set up the next academic year first" : "Choose an academic year" });
  if (d.kind === "TRANSFER" && year.id === current.academicYearId && current.classId === d.toClassId && (current.streamId ?? null) === (d.toStreamId ?? null)) throw conflict("The student is already in this class.");
  if (d.kind === "PROMOTION" && year.id === current.academicYearId) throw invalid("Please correct the highlighted fields.", { academicYearId: "A promotion goes to a later academic year" });
  const effectiveOn = d.effectiveOn ?? (d.kind === "PROMOTION" ? year.startsOn : today);
  if (effectiveOn < today) throw invalid("Please correct the highlighted fields.", { effectiveOn: "The date cannot be in the past" });
  const t = await tx.classTransfer.create({
    data: {
      schoolId: ctx.schoolId, studentId: d.studentId, kind: d.kind, academicYearId: year.id, fromEnrollmentId: current.id, fromClassId: current.classId, fromStreamId: current.streamId, toClassId: d.toClassId, toStreamId: d.toStreamId ?? null,
      effectiveOn, reason: d.reason ?? null, requestedById: ctx.userId,
    },
  });
  await openTask(tx, { schoolId: ctx.schoolId, kind: "TRANSFER_REVIEW", relatedType: "ClassTransfer", relatedId: t.id, relatedLabel: `${label(student)} → ${cls.name}`, sourceEvent: d.kind === "PROMOTION" ? "promotion.requested" : "transfer.requested", createdById: ctx.userId });
  await writeAudit(tx, actorOf(ctx), { action: d.kind === "PROMOTION" ? "promotion.request" : "transfer.request", entityType: "ClassTransfer", entityId: t.id, summary: `${label(student)} → ${cls.name}`, changes: { fromClassId: current.classId, toClassId: d.toClassId, effectiveOn: formatDateOnly(effectiveOn) }, reason: d.reason });
  return t;
}

export async function requestTransfer(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "transfer.request");
  const d = parse(requestSchema, input);
  const today = await schoolToday(db, ctx.schoolId);
  try {
    return await db.$transaction((tx) => createRequestTx(tx, ctx, d, today));
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002" || /duplicate key|unique constraint/i.test((e as Error)?.message ?? "")) throw conflict("This student already has a transfer or promotion waiting.");
    throw e;
  }
}

const bulkSchema = z.object({ fromClassId: uuid(), toClassId: uuid(), toStreamId: optUuid(), academicYearId: uuid(), effectiveOn: optDateOnly() });

/** Asks for the promotion of every student of a class to a class of a later year. Students who already have a request waiting are skipped. */
export async function proposePromotions(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "transfer.request");
  const d = parse(bulkSchema, input);
  const today = await schoolToday(db, ctx.schoolId);
  const current = await db.academicYear.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!current) throw invalid("There is no current academic year.");
  const students = await db.studentEnrollment.findMany({ where: { schoolId: ctx.schoolId, academicYearId: current.id, classId: d.fromClassId, status: "ACTIVE", student: { status: "ENROLLED" } }, select: { studentId: true } });
  let created = 0, skipped = 0;
  for (const s of students) {
    try {
      await db.$transaction((tx) => createRequestTx(tx, ctx, parse(requestSchema, { studentId: s.studentId, kind: "PROMOTION", toClassId: d.toClassId, toStreamId: d.toStreamId, academicYearId: d.academicYearId, effectiveOn: d.effectiveOn ? formatDateOnly(d.effectiveOn) : undefined }), today));
      created++;
    } catch { skipped++; }
  }
  return { created, skipped };
}

const decideSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: optText(400), overrideCapacity: checkbox().default(false), overrideReason: optText(300) });

/** The approver (never the requester) decides. An approved move whose date has come is applied at once; otherwise it is applied on that date. */
export async function decideTransfer(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "transfer.approve");
  const d = parse(decideSchema, input);
  if (d.decision === "REJECT" && !d.note) throw invalid("Say why the request is rejected.", { note: "Required" });
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM class_transfers WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Transfer");
    const t = await tx.classTransfer.findUniqueOrThrow({ where: { id } });
    if (t.status !== "REQUESTED") throw conflict("This request has already been decided.");
    if (t.requestedById === ctx.userId) throw conflict("A request must be decided by someone other than the person who made it.");
    const student = await tx.student.findUniqueOrThrow({ where: { id: t.studentId } });
    if (d.decision === "REJECT") {
      await tx.classTransfer.update({ where: { id }, data: { status: "REJECTED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: d.note } });
    } else {
      await tx.classTransfer.update({ where: { id }, data: { status: "APPROVED", decidedById: ctx.userId, decidedAt: new Date(), decisionNote: d.note ?? null } });
    }
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "ClassTransfer", relatedId: id, by: ctx.userId, note: d.decision === "APPROVE" ? "Approved" : "Rejected" });
    await writeAudit(tx, actorOf(ctx), { action: d.decision === "APPROVE" ? "transfer.approve" : "transfer.reject", entityType: "ClassTransfer", entityId: id, summary: label(student), changes: { kind: t.kind }, reason: d.note });
    if (d.decision === "APPROVE" && t.effectiveOn <= (await schoolToday(tx, ctx.schoolId))) await applyTx(tx, ctx, id, { overrideCapacity: d.overrideCapacity, overrideReason: d.overrideReason });
  });
}

async function applyTx(tx: Tx, ctx: AuthContext, id: string, o: { overrideCapacity: boolean; overrideReason?: string }) {
  const t = await tx.classTransfer.findUniqueOrThrow({ where: { id } });
  if (t.status !== "APPROVED") throw conflict("Only an approved request can be applied.");
  const r = await placeStudentTx(tx, ctx, t.studentId, { academicYearId: t.academicYearId, classId: t.toClassId, streamId: t.toStreamId ?? undefined, overrideCapacity: o.overrideCapacity, overrideReason: o.overrideReason }, { effectiveOn: t.effectiveOn, extraAudit: { transferId: id, kind: t.kind, approvedBy: t.decidedById, reason: t.reason } });
  await tx.classTransfer.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date(), appliedEnrollmentId: r.created.id, overrideNote: o.overrideReason ?? null } });
}

/** Applies an approved request whose effective date has come (for example a promotion approved ahead of the new year). */
export async function applyTransfer(ctx: AuthContext, id: string, input: unknown = {}) {
  requirePermission(ctx, "transfer.approve");
  const d = parse(z.object({ overrideCapacity: checkbox().default(false), overrideReason: optText(300) }), input);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM class_transfers WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Transfer");
    const t = await tx.classTransfer.findUniqueOrThrow({ where: { id } });
    if (t.effectiveOn > (await schoolToday(tx, ctx.schoolId))) throw conflict(`This move takes effect on ${formatDateOnly(t.effectiveOn)}.`);
    await applyTx(tx, ctx, id, d);
  });
}

export async function cancelTransfer(ctx: AuthContext, id: string, input: unknown) {
  requireAnyPermission(ctx, ["transfer.request", "transfer.approve"]);
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const t = await tx.classTransfer.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!t) throw notFound("Transfer");
    if (t.status !== "REQUESTED" && t.status !== "APPROVED") throw conflict("Only a request that is still waiting can be cancelled.");
    if (t.requestedById !== ctx.userId && !ctx.permissions.has("transfer.approve")) throw conflict("Only the person who asked, or an approver, can cancel it.");
    await tx.classTransfer.update({ where: { id }, data: { status: "CANCELLED", decisionNote: reason } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "ClassTransfer", relatedId: id, status: "CANCELLED", by: ctx.userId, note: reason });
    await writeAudit(tx, actorOf(ctx), { action: "transfer.cancel", entityType: "ClassTransfer", entityId: id, reason });
  });
}

export async function listTransfers(ctx: AuthContext, opts: { status?: string } = {}) {
  requireAnyPermission(ctx, ["transfer.request", "transfer.approve", "academic.office"]);
  const rows = await db.classTransfer.findMany({
    where: { schoolId: ctx.schoolId, ...(opts.status && ["REQUESTED", "APPROVED", "REJECTED", "APPLIED", "CANCELLED"].includes(opts.status) ? { status: opts.status as never } : {}) },
    orderBy: { requestedAt: "desc" }, take: 200,
  });
  const [students, classes, users, years] = await Promise.all([
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.map((r) => r.studentId))] } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } }, select: { id: true, fullName: true } }),
    db.academicYear.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } }),
  ]);
  const streams = await db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } });
  const cn = (id: string | null) => classes.find((c) => c.id === id)?.name ?? "";
  const sn = (id: string | null) => streams.find((s) => s.id === id)?.name ?? "";
  return rows.map((r) => {
    const s = students.find((x) => x.id === r.studentId);
    return {
      ...r, studentName: s ? `${s.firstName} ${s.lastName}` : "", admissionNo: s?.admissionNo ?? "",
      from: [cn(r.fromClassId), sn(r.fromStreamId)].filter(Boolean).join(" "), to: [cn(r.toClassId), sn(r.toStreamId)].filter(Boolean).join(" "),
      requestedBy: users.find((u) => u.id === r.requestedById)?.fullName ?? "", decidedBy: users.find((u) => u.id === r.decidedById)?.fullName ?? null, yearName: years.find((y) => y.id === r.academicYearId)?.name ?? "",
    };
  });
}
