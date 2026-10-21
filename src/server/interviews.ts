import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { slotsOverlap } from "@/lib/admissions/rules";
import { zonedToUtc } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { getAdmissionPolicy } from "@/server/admission-policy";
import { reviewBlockers } from "@/server/admission-review";
import { closeTasks, openTask } from "@/server/workflow";
import { checkbox, optText, optUuid, parse, text } from "@/lib/validation";

/*
 * Interviews. One live appointment per application (a reschedule cancels the old one and links the new one to it). Scheduling needs the
 * application to be in order (verified papers, or a recorded exception), refuses to double-book an interviewer, and warns about a room that
 * is already in use. Recording a result never admits or rejects anybody: the decision is a separate step.
 */

const OPEN = ["APPLIED", "INTERVIEW"] as const;
const FUTURE_SLACK_MS = 60_000;

/** A readable date and time in the school's time zone, for the history shown to staff. */
const when = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

/** "2026-11-02T09:30" in the school's time zone, or a full ISO timestamp, as a UTC instant. */
function instant(value: string, timezone: string): Date | null {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return zonedToUtc(v, timezone);
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
}

const scheduleSchema = z.object({
  /** An interview, an entrance examination or another assessment of the applicant. */
  kind: z.enum(["INTERVIEW", "ENTRANCE_EXAM", "ASSESSMENT"]).default("INTERVIEW"),
  scheduledAt: text(40),
  durationMinutes: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(5).max(480).optional()),
  location: optText(120),
  method: optText(60),
  interviewerId: optUuid(),
  note: optText(500),
  confirmLocationClash: checkbox().default(false),
  /** An authorised person lets the interview go ahead although the papers are not complete. */
  exceptionReason: optText(400),
});

async function lockInterviewer(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interview:${key}`}, 0))::text AS locked`;
}

async function assertInterviewer(tx: Tx, schoolId: string, userId: string) {
  const u = await tx.user.findFirst({ where: { id: userId, schoolId, type: "STAFF", status: "ACTIVE" }, select: { id: true } });
  if (!u) throw invalid("Please correct the highlighted fields.", { interviewerId: "Choose an active staff member" });
}

async function assertNoClash(tx: Tx, schoolId: string, slot: { start: Date; minutes: number }, d: { interviewerId?: string; location?: string; confirmLocationClash: boolean }, excludeId?: string) {
  const near = await tx.interview.findMany({
    where: { schoolId, status: "SCHEDULED", ...(excludeId ? { id: { not: excludeId } } : {}), scheduledAt: { gte: new Date(slot.start.getTime() - 8 * 3_600_000), lt: new Date(slot.start.getTime() + slot.minutes * 60_000) } },
    include: { application: { select: { applicationNo: true, firstName: true, lastName: true } } },
  });
  const overlapping = near.filter((i) => slotsOverlap(slot, { start: i.scheduledAt, minutes: i.durationMinutes }));
  const byInterviewer = d.interviewerId ? overlapping.find((i) => i.interviewerId === d.interviewerId) : undefined;
  if (byInterviewer) throw conflict(`This interviewer already has an interview at that time (${byInterviewer.application.firstName} ${byInterviewer.application.lastName}, ${byInterviewer.application.applicationNo}). Choose another time or interviewer.`);
  const byRoom = d.location ? overlapping.find((i) => (i.location ?? "").toLowerCase() === d.location!.toLowerCase()) : undefined;
  if (byRoom && !d.confirmLocationClash) throw conflict(`"${d.location}" is already in use at that time (${byRoom.application.applicationNo}). Tick the confirmation if both interviews can share it.`);
}

/** The interviewer's assignment (when one is named): due on the day of the interview. */
async function assignInterviewer(tx: Tx, ctx: AuthContext, app: { id: string; applicationNo: string; firstName: string; lastName: string }, i: { id: string; interviewerId: string | null; scheduledAt: Date }, event: string) {
  await openTask(tx, {
    schoolId: ctx.schoolId, kind: "INTERVIEW_ASSIGNED", relatedType: "Application", relatedId: app.id, relatedLabel: `${app.firstName} ${app.lastName} (${app.applicationNo})`, sourceEvent: event,
    assignedToId: i.interviewerId, dueOn: new Date(Date.UTC(i.scheduledAt.getUTCFullYear(), i.scheduledAt.getUTCMonth(), i.scheduledAt.getUTCDate())), createdById: ctx.userId, discriminator: i.id,
  });
}

async function lockApplication(tx: Tx, schoolId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM applications WHERE id = ${id}::uuid AND "schoolId" = ${schoolId}::uuid FOR UPDATE`;
  if (!rows.length) throw notFound("Application");
  return tx.application.findUniqueOrThrow({ where: { id } });
}

/** Papers in order, or an exception granted now by someone allowed to (the reason is recorded on the application). */
async function checkReadyForInterview(tx: Tx, ctx: AuthContext, app: { id: string; reviewStatus: string; docsExceptionAt: Date | null; applicationNo: string; firstName: string; lastName: string }, exceptionReason?: string) {
  const blockers = await reviewBlockers(tx, ctx.schoolId, app);
  if (blockers.length === 0) return;
  if (!exceptionReason) throw conflict(`This application is not ready for an interview. ${blockers.join(" ")} An authorised person can record an exception.`);
  requirePermission(ctx, "admission.override");
  await tx.application.update({ where: { id: app.id }, data: { docsExceptionAt: new Date(), docsExceptionById: ctx.userId, docsExceptionReason: exceptionReason, ...(app.reviewStatus === "RETURNED" ? { reviewStatus: "PENDING" as const } : {}) } });
  await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, fromStatus: "APPLIED", toStatus: "APPLIED", kind: "EXCEPTION", reason: `Interview allowed without complete papers: ${exceptionReason}`, byUserId: ctx.userId } });
  await writeAudit(tx, actorOf(ctx), { action: "admission.exception_documents", entityType: "Application", entityId: app.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { blockers }, reason: exceptionReason });
}

async function create(tx: Tx, ctx: AuthContext, appId: string, d: z.output<typeof scheduleSchema>, start: Date, minutes: number, extra: { rescheduledFromId?: string } = {}) {
  const i = await tx.interview.create({
    data: { schoolId: ctx.schoolId, applicationId: appId, kind: d.kind, scheduledAt: start, durationMinutes: minutes, location: d.location ?? null, method: d.method ?? null, interviewerId: d.interviewerId ?? null, scheduleNote: d.note ?? null, createdById: ctx.userId, rescheduledFromId: extra.rescheduledFromId ?? null },
  });
  return i;
}

export async function scheduleInterview(ctx: AuthContext, applicationId: string, input: unknown) {
  requirePermission(ctx, "admission.interview.manage");
  const d = parse(scheduleSchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const start = instant(d.scheduledAt, school.timezone);
  if (!start) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Enter a date and time" });
  if (start.getTime() < Date.now() - FUTURE_SLACK_MS) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Choose a time that has not passed" });
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const minutes = d.durationMinutes ?? policy.interviewMinutes;
  return db.$transaction(async (tx) => {
    if (d.interviewerId) { await assertInterviewer(tx, ctx.schoolId, d.interviewerId); await lockInterviewer(tx, d.interviewerId); }
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!(OPEN as readonly string[]).includes(app.status)) throw conflict("An interview can only be scheduled for an application that is still under consideration.");
    if (await tx.interview.findFirst({ where: { applicationId, status: "SCHEDULED" }, select: { id: true } })) throw conflict("This applicant already has a scheduled interview. Reschedule it instead.");
    await checkReadyForInterview(tx, ctx, app, d.exceptionReason);
    await assertNoClash(tx, ctx.schoolId, { start, minutes }, { interviewerId: d.interviewerId, location: d.location, confirmLocationClash: d.confirmLocationClash });
    const i = await create(tx, ctx, applicationId, d, start, minutes);
    await tx.application.update({ where: { id: applicationId }, data: { status: "INTERVIEW", interviewOn: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ASSESSMENT_COORDINATE"], by: ctx.userId, note: "Interview scheduled" });
    await assignInterviewer(tx, ctx, app, i, "interview.scheduled");
    if (app.status !== "INTERVIEW") await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: "INTERVIEW", kind: "STATUS", byUserId: ctx.userId } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "INTERVIEW", toStatus: "INTERVIEW", kind: "INTERVIEW", reason: `Interview scheduled for ${when(start, school.timezone)}${d.location ? ` at ${d.location}` : ""}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.schedule", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { scheduledAt: start.toISOString(), minutes, location: d.location ?? null, interviewerId: d.interviewerId ?? null } });
    return i;
  });
}

const rescheduleSchema = scheduleSchema.extend({ reason: text(300) });

export async function rescheduleInterview(ctx: AuthContext, interviewId: string, input: unknown) {
  requirePermission(ctx, "admission.interview.manage");
  const d = parse(rescheduleSchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const start = instant(d.scheduledAt, school.timezone);
  if (!start) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Enter a date and time" });
  if (start.getTime() < Date.now() - FUTURE_SLACK_MS) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Choose a time that has not passed" });
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const found = await db.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId }, select: { applicationId: true } });
  if (!found) throw notFound("Interview");
  return db.$transaction(async (tx) => {
    if (d.interviewerId) { await assertInterviewer(tx, ctx.schoolId, d.interviewerId); await lockInterviewer(tx, d.interviewerId); }
    const app = await lockApplication(tx, ctx.schoolId, found.applicationId);
    const old = await tx.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId } });
    if (!old) throw notFound("Interview");
    if (old.status !== "SCHEDULED") throw conflict("Only a scheduled interview can be moved.");
    if (!(OPEN as readonly string[]).includes(app.status)) throw conflict("This application is no longer under consideration.");
    const minutes = d.durationMinutes ?? old.durationMinutes ?? policy.interviewMinutes;
    const merged = { ...d, interviewerId: d.interviewerId ?? old.interviewerId ?? undefined, location: d.location ?? old.location ?? undefined };
    await assertNoClash(tx, ctx.schoolId, { start, minutes }, merged, old.id);
    await tx.interview.update({ where: { id: old.id }, data: { status: "CANCELLED", cancelReason: `Rescheduled: ${d.reason}` } });
    const i = await create(tx, ctx, app.id, merged, start, minutes, { rescheduledFromId: old.id });
    await tx.application.update({ where: { id: app.id }, data: { interviewOn: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: app.id, kinds: ["INTERVIEW_ASSIGNED"], discriminator: old.id, status: "CANCELLED", by: ctx.userId, note: "Interview moved" });
    await assignInterviewer(tx, ctx, app, i, "interview.rescheduled");
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, fromStatus: app.status, toStatus: app.status, kind: "INTERVIEW", reason: `Interview moved to ${when(start, school.timezone)}: ${d.reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.reschedule", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { from: old.scheduledAt.toISOString(), to: start.toISOString(), previousInterviewId: old.id }, reason: d.reason });
    return i;
  });
}

export async function cancelInterview(ctx: AuthContext, interviewId: string, input: unknown) {
  requirePermission(ctx, "admission.interview.manage");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  const found = await db.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId }, select: { applicationId: true } });
  if (!found) throw notFound("Interview");
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, found.applicationId);
    const i = await tx.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId } });
    if (!i) throw notFound("Interview");
    if (i.status !== "SCHEDULED") throw conflict("Only a scheduled interview can be cancelled.");
    await tx.interview.update({ where: { id: i.id }, data: { status: "CANCELLED", cancelReason: reason } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: app.id, kinds: ["INTERVIEW_ASSIGNED"], discriminator: i.id, status: "CANCELLED", by: ctx.userId, note: "Interview cancelled" });
    // With no live or finished interview left, the application goes back to the review stage.
    const remaining = await tx.interview.count({ where: { applicationId: app.id, status: { in: ["SCHEDULED", "COMPLETED"] } } });
    if (app.status === "INTERVIEW" && remaining === 0) {
      await tx.application.update({ where: { id: app.id }, data: { status: "APPLIED", interviewOn: null } });
      await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, fromStatus: "INTERVIEW", toStatus: "APPLIED", kind: "STATUS", reason: "Interview cancelled", byUserId: ctx.userId } });
      await openTask(tx, { schoolId: ctx.schoolId, kind: "ASSESSMENT_COORDINATE", relatedType: "Application", relatedId: app.id, relatedLabel: `${app.firstName} ${app.lastName} (${app.applicationNo})`, sourceEvent: "interview.cancelled", createdById: ctx.userId, discriminator: i.id });
    }
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, fromStatus: app.status, toStatus: app.status, kind: "INTERVIEW", reason: `Interview cancelled: ${reason}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.cancel", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, reason });
  });
}

const resultSchema = z
  .object({
    status: z.enum(["COMPLETED", "NO_SHOW"]),
    outcome: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PASSED", "NOT_PASSED", "DEFERRED", "FURTHER_ASSESSMENT", "AWAITING_DECISION"]).optional()),
    score: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(100).optional()),
    notes: optText(2000),
    /** The Academic Office's view of the applicant's academic suitability. */
    recommendation: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["RECOMMEND", "RECOMMEND_WITH_CONDITIONS", "NOT_RECOMMENDED"]).optional()),
    recommendationNote: optText(600),
  })
  .refine((v) => v.status !== "COMPLETED" || !!v.outcome, { path: ["outcome"], message: "Choose the result" });

/** Records what happened. The assigned interviewer or staff who manage interviews can do it; it admits or rejects nobody. */
export async function recordInterviewResult(ctx: AuthContext, interviewId: string, input: unknown) {
  const d = parse(resultSchema, input);
  const found = await db.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId }, select: { applicationId: true, interviewerId: true } });
  if (!found) throw notFound("Interview");
  if (found.interviewerId !== ctx.userId) requirePermission(ctx, "admission.interview.manage");
  await db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, found.applicationId);
    const i = await tx.interview.findFirst({ where: { id: interviewId, schoolId: ctx.schoolId } });
    if (!i) throw notFound("Interview");
    if (i.status === "CANCELLED") throw conflict("A cancelled interview has no result.");
    if (!["APPLIED", "INTERVIEW"].includes(app.status)) throw conflict("A decision has already been made on this application.");
    if (i.scheduledAt.getTime() > Date.now()) throw conflict("The interview has not taken place yet.");
    const data: Prisma.InterviewUpdateInput = { status: d.status, outcome: d.status === "COMPLETED" ? d.outcome : null, score: d.score ?? null, notes: d.notes ?? null, recommendation: d.recommendation ?? null, recommendationNote: d.recommendationNote ?? null, completedAt: new Date(), completedById: ctx.userId };
    await tx.interview.update({ where: { id: i.id }, data });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: app.id, kinds: ["INTERVIEW_ASSIGNED"], discriminator: i.id, by: ctx.userId, note: d.status === "NO_SHOW" ? "Applicant did not attend" : `Result recorded: ${d.outcome}` });
    const label = `${app.firstName} ${app.lastName} (${app.applicationNo})`;
    if (d.status === "COMPLETED") await openTask(tx, { schoolId: ctx.schoolId, kind: "DECISION_REVIEW", relatedType: "Application", relatedId: app.id, relatedLabel: label, sourceEvent: "interview.completed", createdById: ctx.userId, discriminator: i.id });
    else await openTask(tx, { schoolId: ctx.schoolId, kind: "ASSESSMENT_COORDINATE", relatedType: "Application", relatedId: app.id, relatedLabel: label, sourceEvent: "interview.no_show", createdById: ctx.userId, discriminator: `noshow-${i.id}` });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId: app.id, fromStatus: app.status, toStatus: app.status, kind: "INTERVIEW", reason: d.status === "NO_SHOW" ? "Interview: applicant did not attend" : `Interview completed: ${d.outcome}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.result", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { status: d.status, outcome: d.outcome ?? null, score: d.score ?? null, previous: { status: i.status, outcome: i.outcome } } });
  });
}

// ───────────────────────── Reads ─────────────────────────

export type InterviewRow = {
  id: string; kind: string; recommendation: string | null; recommendationNote: string | null; applicationId: string; applicationNo: string; applicantName: string; scheduledAt: Date; durationMinutes: number; location: string | null; method: string | null; interviewerId: string | null; interviewer: string | null;
  status: string; outcome: string | null; score: number | null; notes: string | null; scheduleNote: string | null; cancelReason: string | null; className: string | null;
};

async function rows(ctx: AuthContext, where: Prisma.InterviewWhereInput): Promise<InterviewRow[]> {
  const list = await db.interview.findMany({ where: { schoolId: ctx.schoolId, ...where }, orderBy: { scheduledAt: "asc" }, take: 300, include: { application: { select: { applicationNo: true, firstName: true, lastName: true, classAppliedId: true } } } });
  const users = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(list.map((i) => i.interviewerId).filter((x): x is string => !!x))] } }, select: { id: true, fullName: true } });
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(list.map((i) => i.application.classAppliedId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const canNotes = ctx.permissions.has("admission.interview.notes");
  return list.map((i) => ({
    id: i.id, kind: i.kind, recommendation: i.recommendation, recommendationNote: i.recommendationNote, applicationId: i.applicationId, applicationNo: i.application.applicationNo, applicantName: `${i.application.firstName} ${i.application.lastName}`, scheduledAt: i.scheduledAt, durationMinutes: i.durationMinutes, location: i.location, method: i.method,
    interviewerId: i.interviewerId, interviewer: users.find((u) => u.id === i.interviewerId)?.fullName ?? null, status: i.status, outcome: i.outcome, score: i.score,
    // Notes are restricted to people with the permission and to the interviewer who wrote them.
    notes: canNotes || i.interviewerId === ctx.userId ? i.notes : null, scheduleNote: i.scheduleNote, cancelReason: i.cancelReason, className: classes.find((c) => c.id === i.application.classAppliedId)?.name ?? null,
  }));
}

export async function listInterviews(ctx: AuthContext, opts: { from?: Date; to?: Date; status?: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"; interviewerId?: string } = {}) {
  requireAnyPermission(ctx, ["admission.read", "admission.interview.manage"]);
  return rows(ctx, { ...(opts.status ? { status: opts.status } : {}), ...(opts.interviewerId ? { interviewerId: opts.interviewerId } : {}), ...(opts.from || opts.to ? { scheduledAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}) });
}

export async function interviewsOfApplication(ctx: AuthContext, applicationId: string) {
  requireAnyPermission(ctx, ["admission.read", "admission.interview.manage"]);
  const app = await db.application.findFirst({ where: { id: applicationId, schoolId: ctx.schoolId }, select: { id: true } });
  if (!app) throw notFound("Application");
  return (await rows(ctx, { applicationId })).reverse();
}

/** Staff who can be named as interviewer. */
export async function listInterviewers(ctx: AuthContext) {
  requireAnyPermission(ctx, ["admission.interview.manage", "admission.read"]);
  return db.user.findMany({ where: { schoolId: ctx.schoolId, type: "STAFF", status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } });
}
