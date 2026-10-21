import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { ApplicationStatus } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { actorOf, diffFields, writeAudit } from "@/server/audit";
import { guardianLinkSchema, type GuardianLinkInput } from "@/server/guardians";
import { createStudentInTx, prepareStudent } from "@/server/students";
import { enrolmentReadiness, issueOffer } from "@/server/admission-offers";
import { closeTasks, openTask } from "@/server/workflow";
import { STAGES, stageIds, type Stage } from "@/server/admission-queues";
import { admissionAccount } from "@/lib/admissions/rules";
import { centsOf } from "@/lib/finance/money";
import { checkbox, dateOnly, optDateOnly, optText, optUuid, parse, text } from "@/lib/validation";

/*
 * Admissions workflow: Applied → (Interview) → Accepted → Enrolled, plus Rejected / Withdrawn (reason required, audited).
 * Interviews are scheduled in `interviews.ts` (which moves an application to INTERVIEW), and ACCEPTED is only reached by issuing an
 * offer in `admission-offers.ts`. ACCEPTED is not ENROLLED: the Student record and admission number exist only after the enrol step,
 * which needs `enrolmentReadiness` to pass (offer live, admission payment verified or excepted, papers verified or excepted) and then
 * runs the same registration rules as direct student registration.
 */

export const OPEN_STATUSES = ["APPLIED", "INTERVIEW", "ACCEPTED"] as const satisfies readonly ApplicationStatus[];
const isOpen = (s: ApplicationStatus) => (OPEN_STATUSES as readonly string[]).includes(s);

const shape = {
  firstName: text(60),
  middleName: optText(60),
  lastName: text(60),
  dateOfBirth: dateOnly(),
  gender: z.enum(["MALE", "FEMALE"]),
  intakeYearId: optUuid(),
  classAppliedId: optUuid(),
  nationality: optText(60),
  religion: optText(60),
  birthCertificateNo: optText(40),
  previousSchool: optText(150),
  address: optText(300),
  assessmentNotes: optText(1000),
  guardians: z.array(guardianLinkSchema).min(1, "Add at least one guardian").max(3),
};
const createSchema = z.object({ ...shape, submittedOn: optDateOnly(), confirmDuplicate: checkbox().default(false) });
const updateSchema = z.object({ ...shape, guardians: shape.guardians.optional(), confirmDuplicate: checkbox().default(false) });

const isUniqueViolation = (e: unknown) => {
  const x = e as { code?: string; message?: string; cause?: { code?: string } } | null;
  return x?.code === "P2002" || x?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(x?.message ?? "");
};

export function formatApplicationNo(year: number, seq: number) {
  return `APP/${year}/${String(seq).padStart(4, "0")}`;
}

/** Concurrency-safe application number (counter row locked until the transaction commits; never reused). */
export async function allocateApplicationNo(tx: Tx, schoolId: string, year: number): Promise<string> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO admission_counters ("schoolId", "scope", "lastValue")
    VALUES (${schoolId}::uuid, ${`APP:${year}`}, 1)
    ON CONFLICT ("schoolId", "scope") DO UPDATE SET "lastValue" = admission_counters."lastValue" + 1
    RETURNING "lastValue"`;
  return formatApplicationNo(year, rows[0]!.lastValue);
}

async function assertRefs(client: Tx | typeof db, schoolId: string, d: { intakeYearId?: string; classAppliedId?: string }) {
  if (d.intakeYearId && !(await client.academicYear.findFirst({ where: { id: d.intakeYearId, schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { intakeYearId: "Invalid academic year" });
  if (d.classAppliedId && !(await client.schoolClass.findFirst({ where: { id: d.classAppliedId, schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { classAppliedId: "Invalid class" });
}

/**
 * Duplicate rules: an OPEN application for the same child (name + date of birth, or birth certificate) is
 * refused outright; an existing STUDENT with the same name + date of birth (or certificate number) needs
 * the registrar to confirm it is a different child.
 */
async function checkDuplicates(tx: Tx, schoolId: string, d: { firstName: string; lastName: string; dateOfBirth: Date; birthCertificateNo?: string; confirmDuplicate: boolean }, excludeId?: string) {
  const open = await tx.application.findFirst({
    where: {
      schoolId,
      status: { in: [...OPEN_STATUSES] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        { firstName: { equals: d.firstName, mode: "insensitive" }, lastName: { equals: d.lastName, mode: "insensitive" }, dateOfBirth: d.dateOfBirth },
        ...(d.birthCertificateNo ? [{ birthCertificateNo: { equals: d.birthCertificateNo, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { applicationNo: true },
  });
  if (open) throw conflict(`An open application for this child already exists (${open.applicationNo}). Open that application instead of creating another.`);
  if (d.confirmDuplicate) return;
  const student = await tx.student.findFirst({
    where: {
      schoolId,
      OR: [
        { firstName: { equals: d.firstName, mode: "insensitive" }, lastName: { equals: d.lastName, mode: "insensitive" }, dateOfBirth: d.dateOfBirth },
        ...(d.birthCertificateNo ? [{ birthCertificateNo: { equals: d.birthCertificateNo, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { admissionNo: true },
  });
  if (student) throw conflict(`A student with the same name and date of birth, or the same birth certificate number, already exists (${student.admissionNo}). If this is a different child, confirm and submit again.`);
}

async function schoolToday(schoolId: string): Promise<Date> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return parseDateOnly(todayInTimezone(school.timezone)) as Date;
}

export async function createApplication(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "admission.create");
  const d = parse(createSchema, input);
  const today = await schoolToday(ctx.schoolId);
  if (d.dateOfBirth >= today) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "Date of birth must be in the past" });
  if (d.submittedOn && d.submittedOn > today) throw invalid("Please correct the highlighted fields.", { submittedOn: "The date cannot be in the future" });
  await assertRefs(db, ctx.schoolId, d);
  try {
    return await db.$transaction(async (tx) => {
      await checkDuplicates(tx, ctx.schoolId, d);
      const applicationNo = await allocateApplicationNo(tx, ctx.schoolId, today.getUTCFullYear());
      const { confirmDuplicate: _c, guardians, ...fields } = d;
      const app = await tx.application.create({
        data: { ...fields, guardians: guardians as unknown as Prisma.InputJsonValue, schoolId: ctx.schoolId, applicationNo, createdById: ctx.userId, submittedOn: d.submittedOn ?? today },
      });
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, toStatus: "APPLIED", byUserId: ctx.userId } });
      await openTask(tx, { schoolId: ctx.schoolId, kind: "APPLICATION_REVIEW", relatedType: "Application", relatedId: app.id, relatedLabel: `${app.firstName} ${app.lastName} (${applicationNo})`, sourceEvent: "application.registered_physical", createdById: ctx.userId });
      await writeAudit(tx, actorOf(ctx), {
        action: "admission.create",
        entityType: "Application",
        entityId: app.id,
        summary: `${app.firstName} ${app.lastName} (${applicationNo})`,
        changes: { applicationNo, duplicateConfirmed: d.confirmDuplicate, channel: "PHYSICAL", submittedOn: formatDateOnly(d.submittedOn ?? today) },
      });
      return app;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An open application for this child already exists. Open that application instead of creating another.");
    throw e;
  }
}

const EDITABLE = ["firstName", "middleName", "lastName", "dateOfBirth", "gender", "intakeYearId", "classAppliedId", "nationality", "religion", "birthCertificateNo", "previousSchool", "address", "assessmentNotes"] as const;

export async function updateApplication(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.create");
  const d = parse(updateSchema, input);
  const today = await schoolToday(ctx.schoolId);
  if (d.dateOfBirth >= today) throw invalid("Please correct the highlighted fields.", { dateOfBirth: "Date of birth must be in the past" });
  await assertRefs(db, ctx.schoolId, d);
  try {
    await db.$transaction(async (tx) => {
      const app = await lockApplication(tx, ctx.schoolId, applicationId);
      if (!isOpen(app.status)) throw conflict("This application is closed and can no longer be edited.");
      await checkDuplicates(tx, ctx.schoolId, d, applicationId);
      const { confirmDuplicate: _c, guardians, ...fields } = d;
      const data = { ...fields, middleName: d.middleName ?? null, intakeYearId: d.intakeYearId ?? null, classAppliedId: d.classAppliedId ?? null, nationality: d.nationality ?? null, religion: d.religion ?? null, birthCertificateNo: d.birthCertificateNo ?? null, previousSchool: d.previousSchool ?? null, address: d.address ?? null, assessmentNotes: d.assessmentNotes ?? null };
      await tx.application.update({ where: { id: applicationId }, data: { ...data, ...(guardians ? { guardians: guardians as unknown as Prisma.InputJsonValue } : {}) } });
      await writeAudit(tx, actorOf(ctx), { action: "admission.update", entityType: "Application", entityId: applicationId, summary: `${data.firstName} ${data.lastName} (${app.applicationNo})`, changes: diffFields(app, data, EDITABLE) });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An open application for this child already exists.");
    throw e;
  }
}

/** Locks the application row for the rest of the transaction so concurrent transitions/enrolments serialise. */
async function lockApplication(tx: Tx, schoolId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM applications WHERE id = ${id}::uuid AND "schoolId" = ${schoolId}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound("Application");
  return tx.application.findUniqueOrThrow({ where: { id } });
}

// ───────────────────────── Status transitions ─────────────────────────

const CLOSABLE: readonly ApplicationStatus[] = ["APPLIED", "INTERVIEW", "ACCEPTED"];

const transitionSchema = z.object({ to: z.enum(["REJECTED", "WITHDRAWN"]), reason: optText(500), assessmentNotes: optText(1000) });

/**
 * Closes an application as Rejected or Withdrawn (a reason is required). Interviews and offers are set aside with it, so nothing stays
 * scheduled for someone who is no longer applying. Interview, ACCEPTED and ENROLLED are reached only through their own steps.
 */
export async function transitionApplication(ctx: AuthContext, applicationId: string, input: unknown) {
  const d = parse(transitionSchema, input);
  if (d.to === "WITHDRAWN") {
    if (!ctx.permissions.has("admission.review") && !ctx.permissions.has("admission.create")) requirePermission(ctx, "admission.review");
  } else requirePermission(ctx, "admission.review");
  if (!d.reason) throw invalid("A reason is required.", { reason: "Required" });

  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!CLOSABLE.includes(app.status)) throw conflict(`An application that is ${app.status.toLowerCase()} cannot be moved to ${d.to.toLowerCase()}.`);
    await tx.application.update({
      where: { id: applicationId },
      data: { status: d.to, ...(d.assessmentNotes ? { assessmentNotes: d.assessmentNotes } : {}), decisionReason: d.reason, decidedAt: new Date(), decidedById: ctx.userId },
    });
    await tx.interview.updateMany({ where: { applicationId, status: "SCHEDULED" }, data: { status: "CANCELLED", cancelReason: `Application ${d.to.toLowerCase()}` } });
    await tx.admissionOffer.updateMany({ where: { applicationId, status: { in: ["ISSUED", "PENDING_APPROVAL"] } }, data: { status: "WITHDRAWN", respondedAt: new Date(), responseNote: `Application ${d.to.toLowerCase()}: ${d.reason}` } });
    const heldMoney = await tx.admissionPayment.count({ where: { applicationId, status: "VERIFIED" } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, status: "CANCELLED", by: ctx.userId, note: `Application ${d.to.toLowerCase()}` });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: d.to, reason: d.reason, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), {
      action: `admission.${d.to.toLowerCase()}`,
      entityType: "Application",
      entityId: applicationId,
      summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`,
      changes: { from: app.status, to: d.to, verifiedAdmissionPayments: heldMoney },
      reason: d.reason,
    });
  });
}

// ───────────────────────── Recording the decision ─────────────────────────

const decisionSchema = z.object({
  outcome: z.enum(["ACCEPTED", "NOT_ACCEPTED", "DEFERRED", "FURTHER_ASSESSMENT", "AWAITING_DECISION"]),
  note: optText(500),
});

/**
 * Records the admission decision. Accepted makes the offer (all the usual conditions apply), Not accepted closes the application with the
 * reason, and Deferred, Further assessment and Awaiting decision keep it open with the outcome and the reason on the record. Further
 * assessment also asks the Academic Office to arrange it. Only people who may decide (admission.review) can do this; a teacher cannot unless
 * that permission is given to them.
 */
export async function recordAdmissionDecision(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.review");
  const d = parse(decisionSchema, input);
  if (d.outcome === "ACCEPTED") return issueOffer(ctx, applicationId, input);
  if (d.outcome === "NOT_ACCEPTED") return transitionApplication(ctx, applicationId, { to: "REJECTED", reason: d.note });
  if ((d.outcome === "DEFERRED" || d.outcome === "FURTHER_ASSESSMENT") && !d.note) throw invalid("Say why.", { note: "Required" });
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!["APPLIED", "INTERVIEW"].includes(app.status)) throw conflict("A decision can only be recorded while the application is still under consideration.");
    const n = await tx.applicationEvent.count({ where: { applicationId, kind: "DECISION" } });
    await tx.application.update({ where: { id: applicationId }, data: { decisionOutcome: d.outcome, decisionNote: d.note ?? null, decidedAt: new Date(), decidedById: ctx.userId } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "DECISION", reason: `${d.outcome}${d.note ? ` - ${d.note}` : ""}`, byUserId: ctx.userId } });
    if (d.outcome === "FURTHER_ASSESSMENT") await openTask(tx, { schoolId: ctx.schoolId, kind: "ASSESSMENT_COORDINATE", relatedType: "Application", relatedId: applicationId, relatedLabel: `${app.firstName} ${app.lastName} (${app.applicationNo})`, sourceEvent: "decision.further_assessment", createdById: ctx.userId, discriminator: `further-${n}` });
    await writeAudit(tx, actorOf(ctx), { action: "admission.decision", entityType: "Application", entityId: applicationId, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { outcome: d.outcome }, reason: d.note });
  });
}

// ───────────────────────── Enrol ─────────────────────────

const enrolSchema = z.object({
  classId: optUuid(),
  streamId: optUuid(),
  admissionDate: optDateOnly(),
  confirmDuplicate: checkbox().default(false),
  confirmSharedPhone: checkbox().default(false),
  overrideCapacity: checkbox().default(false),
  overrideReason: optText(300),
});

/**
 * Creates the Student (with admission number and guardians; the class placement is optional and can follow as its own step) from an
 * ACCEPTED application, atomically with marking the application ENROLLED. The gate (`enrolmentReadiness`) is checked again inside the
 * transaction after the row is locked. If anything fails nothing is created, and two people pressing Enrol at once cannot create two students.
 */
export async function enrolApplication(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.enrol");
  const d = parse(enrolSchema, input);
  const snapshot = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId } });
  if (!snapshot) throw notFound("Application");

  // A guardian phone that already belongs to another guardian must be explicitly confirmed (never inferred).
  const guardians = (snapshot.guardians as unknown[]).map((g) => {
    const parsed = guardianLinkSchema.parse(g) as GuardianLinkInput;
    return d.confirmSharedPhone && !parsed.guardianId ? { ...parsed, allowSharedPhone: true } : parsed;
  });
  // Placement is a separate step unless a class is chosen here: the class the family asked for is only a preference.
  const classId = d.classId;
  const prepared = await prepareStudent(ctx, {
    firstName: snapshot.firstName,
    middleName: snapshot.middleName ?? undefined,
    lastName: snapshot.lastName,
    dateOfBirth: formatDateOnly(snapshot.dateOfBirth),
    gender: snapshot.gender,
    nationality: snapshot.nationality ?? undefined,
    religion: snapshot.religion ?? undefined,
    birthCertificateNo: snapshot.birthCertificateNo ?? undefined,
    previousSchool: snapshot.previousSchool ?? undefined,
    address: snapshot.address ?? undefined,
    admissionDate: d.admissionDate ? formatDateOnly(d.admissionDate) : undefined,
    classId,
    streamId: d.streamId,
    guardians,
    confirmDuplicate: d.confirmDuplicate,
    overrideCapacity: d.overrideCapacity,
    overrideReason: d.overrideReason,
  });

  return db.$transaction(
    async (tx) => {
      const app = await lockApplication(tx, ctx.schoolId, applicationId);
      if (app.status === "ENROLLED") throw conflict("This applicant has already been enrolled.");
      if (app.status !== "ACCEPTED") throw conflict("Only accepted applicants can be enrolled. Make an admission offer first.");
      const gate = await enrolmentReadiness(tx, ctx.schoolId, app);
      if (!gate.ready) throw conflict(`This applicant cannot be enrolled yet. ${gate.items.filter((i) => !i.ok).map((i) => i.message).join(" ")}`);
      const student = await createStudentInTx(tx, ctx, prepared, { source: "admission", applicationId });
      await tx.application.update({ where: { id: applicationId }, data: { status: "ENROLLED", studentId: student.id } });
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "ACCEPTED", toStatus: "ENROLLED", byUserId: ctx.userId } });
      await tx.document.updateMany({ where: { schoolId: ctx.schoolId, applicationId, studentId: null }, data: { studentId: student.id } });
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ENROL_APPLICANT", "OFFER_COMMUNICATE", "ADMISSION_PAYMENT"], by: ctx.userId, note: `Enrolled as ${student.admissionNo}` });
      // Enrolment hands the student to the Academic Office for a class unless a class was chosen right here.
      if (!classId) await openTask(tx, { schoolId: ctx.schoolId, kind: "CLASS_PLACEMENT", relatedType: "Student", relatedId: student.id, relatedLabel: `${app.firstName} ${app.lastName} (${student.admissionNo})`, sourceEvent: "student.enrolled", createdById: ctx.userId });
      await writeAudit(tx, actorOf(ctx), {
        action: "admission.enrol",
        entityType: "Application",
        entityId: applicationId,
        summary: `${app.firstName} ${app.lastName} (${app.applicationNo} → ${student.admissionNo})`,
        changes: { studentId: student.id, admissionNo: student.admissionNo, placedInClass: Boolean(classId), admissionPayment: gate.account?.status ?? null, paymentWaived: gate.offer?.paymentWaivedAt ? gate.offer.paymentWaiverReason : null },
      });
      return student;
    },
    { timeout: 30000 },
  );
}

// ───────────────────────── Reads ─────────────────────────

export async function listApplications(ctx: AuthContext, opts: { q?: string; status?: string; stage?: string; source?: string; page?: number } = {}) {
  requirePermission(ctx, "admission.read");
  const pageSize = 25;
  const page = Math.max(1, opts.page ?? 1);
  const statuses = ["APPLIED", "INTERVIEW", "ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const;
  const and: Prisma.ApplicationWhereInput[] = [{ schoolId: ctx.schoolId }];
  for (const token of (opts.q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 4)) {
    and.push({ OR: [{ firstName: { contains: token, mode: "insensitive" } }, { lastName: { contains: token, mode: "insensitive" } }, { applicationNo: { contains: token, mode: "insensitive" } }] });
  }
  if (opts.status && (statuses as readonly string[]).includes(opts.status)) and.push({ status: opts.status as (typeof statuses)[number] });
  if (opts.source === "ONLINE" || opts.source === "STAFF") and.push({ source: opts.source });
  if (opts.stage && (STAGES as readonly string[]).includes(opts.stage)) and.push({ id: { in: await stageIds(ctx, opts.stage as Stage) } });
  const where: Prisma.ApplicationWhereInput = { AND: and };
  const [items, total, counts] = await Promise.all([
    db.application.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      include: { offer: { select: { status: true, feeAmount: true, paymentWaivedAt: true } }, payments: { select: { status: true, amount: true } }, interviews: { where: { status: "SCHEDULED" }, select: { scheduledAt: true } } },
    }),
    db.application.count({ where }),
    db.application.groupBy({ by: ["status"], where: { schoolId: ctx.schoolId }, _count: { _all: true } }),
  ]);
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: items.map((i) => i.classAppliedId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  return {
    items: items.map(({ offer, payments, interviews, ...a }) => ({
      ...a,
      className: classes.find((c) => c.id === a.classAppliedId)?.name ?? null,
      primaryGuardian: (a.guardians as { fullName?: string; phone?: string }[])[0] ?? null,
      offerStatus: offer?.status ?? null,
      account: offer ? admissionAccount(centsOf(offer.feeAmount), payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!offer.paymentWaivedAt) : null,
      interviewAt: interviews[0]?.scheduledAt ?? null,
    })),
    total,
    page,
    pageSize,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number>,
  };
}

export async function getApplication(ctx: AuthContext, applicationId: string) {
  requirePermission(ctx, "admission.read");
  const app = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, include: { events: { orderBy: { createdAt: "asc" } } } });
  if (!app) throw notFound("Application");
  const users = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(app.events.flatMap((e) => (e.byUserId ? [e.byUserId] : [])))] } }, select: { id: true, fullName: true } });
  const [cls, year, student] = await Promise.all([
    app.classAppliedId ? db.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId: ctx.schoolId }, select: { name: true } }) : null,
    app.intakeYearId ? db.academicYear.findFirst({ where: { id: app.intakeYearId, schoolId: ctx.schoolId }, select: { name: true } }) : null,
    app.studentId ? db.student.findFirst({ where: { id: app.studentId, schoolId: ctx.schoolId }, select: { id: true, admissionNo: true } }) : null,
  ]);
  return {
    ...app,
    guardians: (app.guardians as unknown[]).map((g) => g as { fullName?: string; phone?: string; relationship?: string; email?: string }),
    className: cls?.name ?? null,
    intakeYear: year?.name ?? null,
    student,
    events: app.events.map((e) => ({ ...e, by: e.byUserId ? (users.find((u) => u.id === e.byUserId)?.fullName ?? "") : "", byApplicant: !e.byUserId })),
  };
}
