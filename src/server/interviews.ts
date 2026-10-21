import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { slotsOverlap } from "@/lib/admissions/rules";
import { zonedToUtc } from "@/lib/dates";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy } from "@/server/admission-policy";
import { noticeFamily } from "@/server/application-notices";
import { reviewBlockers } from "@/server/admission-review";
import { closeTasks, openTask } from "@/server/workflow";
import { getInterviewDays } from "@/server/interview-days";
import { assertExamsComplete, moveExams, withdrawOpenExams } from "@/server/admission-exams";
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
  /** Joining a date already set for other applicants (an interview day): the same interviewer may see several applicants that start together. */
  allowSharedSlot: checkbox().default(false),
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

async function assertNoClash(tx: Tx, schoolId: string, slot: { start: Date; minutes: number }, d: { interviewerId?: string; location?: string; confirmLocationClash: boolean; allowSharedSlot?: boolean }, excludeId?: string) {
  const near = await tx.interview.findMany({
    where: { schoolId, status: "SCHEDULED", ...(excludeId ? { id: { not: excludeId } } : {}), scheduledAt: { gte: new Date(slot.start.getTime() - 8 * 3_600_000), lt: new Date(slot.start.getTime() + slot.minutes * 60_000) } },
    include: { application: { select: { applicationNo: true, firstName: true, lastName: true } } },
  });
  const overlapping = near.filter((i) => slotsOverlap(slot, { start: i.scheduledAt, minutes: i.durationMinutes }));
  // An interviewer is never double-booked, except when the office joins an applicant to a date already set (an interview day) that starts at exactly the same time.
  const byInterviewer = d.interviewerId ? overlapping.find((i) => i.interviewerId === d.interviewerId && !(d.allowSharedSlot && i.scheduledAt.getTime() === slot.start.getTime())) : undefined;
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

/** Scheduling an interview takes back an earlier "interview not required" (the history keeps the reason). */
const restoreInterview = (app: { interviewWaivedAt: Date | null }) => (app.interviewWaivedAt ? { interviewWaivedAt: null, interviewWaivedById: null, interviewWaivedReason: null } : {});

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

async function create(tx: Tx, ctx: AuthContext, appId: string, d: z.output<typeof scheduleSchema>, start: Date, minutes: number, extra: { rescheduledFromId?: string; arrangement?: "SCHEDULED" | "EXISTING" } = {}) {
  const i = await tx.interview.create({
    data: { schoolId: ctx.schoolId, applicationId: appId, kind: d.kind, scheduledAt: start, durationMinutes: minutes, location: d.location ?? null, method: d.method ?? null, interviewerId: d.interviewerId ?? null, scheduleNote: d.note ?? null, createdById: ctx.userId, rescheduledFromId: extra.rescheduledFromId ?? null, arrangement: extra.arrangement ?? "SCHEDULED" },
  });
  // A new date replaces the old appointment: the teachers assigned to the applicant follow to the new interview.
  if (extra.rescheduledFromId) await moveExams(tx, ctx.schoolId, extra.rescheduledFromId, i.id);
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
    await assertNoClash(tx, ctx.schoolId, { start, minutes }, { interviewerId: d.interviewerId, location: d.location, confirmLocationClash: d.confirmLocationClash, allowSharedSlot: d.allowSharedSlot });
    const i = await create(tx, ctx, applicationId, d, start, minutes);
    await tx.application.update({ where: { id: applicationId }, data: { status: "INTERVIEW", interviewOn: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())), ...restoreInterview(app) } });
    if (app.interviewWaivedAt) await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: "INTERVIEW", reason: "Interview requirement restored: an interview was scheduled", byUserId: ctx.userId } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ASSESSMENT_COORDINATE"], by: ctx.userId, note: "Interview scheduled" });
    if (d.kind === "INTERVIEW") await noticeFamily(tx, ctx, app, { kind: "INTERVIEW", key: `interview:${i.id}`, vars: { when: when(start, school.timezone), where: d.location } });
    await assignInterviewer(tx, ctx, app, i, "interview.scheduled");
    if (app.status !== "INTERVIEW") await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: "INTERVIEW", kind: "STATUS", byUserId: ctx.userId } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "INTERVIEW", toStatus: "INTERVIEW", kind: "INTERVIEW", reason: `Interview scheduled for ${when(start, school.timezone)}${d.location ? ` at ${d.location}` : ""}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.schedule", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { scheduledAt: start.toISOString(), minutes, location: d.location ?? null, interviewerId: d.interviewerId ?? null } });
    return i;
  });
}

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// ───────────────────────── The other ways an interview can be arranged ─────────────────────────

export type ArrangeResult = { interviewId: string; unchanged: boolean };

/**
 * An interview date that was already agreed (by phone, at the gate, in the family's request) is entered as it is. It is the one live
 * interview of the application: entering the same date again changes nothing and tells nobody; a different date replaces it, the old date
 * stays in the history and the family hears about the change. A date that has passed is refused here (record a completed interview instead).
 * The papers do not have to be in order for a date that already exists.
 */
export async function confirmExistingInterview(ctx: AuthContext, applicationId: string, input: unknown): Promise<ArrangeResult> {
  requirePermission(ctx, "admission.interview.manage");
  const d = parse(scheduleSchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const start = instant(d.scheduledAt, school.timezone);
  if (!start) throw invalid("Please correct the highlighted fields.", { scheduledAt: "Enter a date and time" });
  if (start.getTime() < Date.now() - FUTURE_SLACK_MS) throw invalid("Please correct the highlighted fields.", { scheduledAt: "This date has passed. If the interview already took place, record it as completed instead." });
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  const minutes = d.durationMinutes ?? policy.interviewMinutes;
  return db.$transaction(async (tx) => {
    if (d.interviewerId) { await assertInterviewer(tx, ctx.schoolId, d.interviewerId); await lockInterviewer(tx, d.interviewerId); }
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!(OPEN as readonly string[]).includes(app.status)) throw conflict("An interview can only be arranged for an application that is still under consideration.");
    const live = await tx.interview.findFirst({ where: { applicationId, status: "SCHEDULED" } });
    if (live && live.kind === d.kind && live.scheduledAt.getTime() === start.getTime()) return { interviewId: live.id, unchanged: true };
    const done = await tx.interview.findFirst({ where: { applicationId, status: "COMPLETED", kind: d.kind }, orderBy: { scheduledAt: "desc" } });
    if (done) throw conflict(`This applicant already has a completed ${d.kind.toLowerCase().replace("_", " ")} (${when(done.scheduledAt, school.timezone)}), so another date is not needed.`);
    await assertNoClash(tx, ctx.schoolId, { start, minutes }, { interviewerId: d.interviewerId, location: d.location, confirmLocationClash: d.confirmLocationClash, allowSharedSlot: d.allowSharedSlot }, live?.id);
    const label = `${app.firstName} ${app.lastName} (${app.applicationNo})`;
    if (live) {
      await tx.interview.update({ where: { id: live.id }, data: { status: "CANCELLED", cancelReason: `Date changed to ${when(start, school.timezone)}` } });
      await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: app.id, kinds: ["INTERVIEW_ASSIGNED"], discriminator: live.id, status: "CANCELLED", by: ctx.userId, note: "Interview date changed" });
    }
    const i = await create(tx, ctx, applicationId, { ...d, interviewerId: d.interviewerId ?? live?.interviewerId ?? undefined, location: d.location ?? live?.location ?? undefined }, start, minutes, { rescheduledFromId: live?.id, arrangement: "EXISTING" });
    await tx.application.update({ where: { id: applicationId }, data: { status: "INTERVIEW", interviewOn: dayOf(start), ...restoreInterview(app) } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ASSESSMENT_COORDINATE"], by: ctx.userId, note: "Interview date confirmed" });
    await assignInterviewer(tx, ctx, app, i, "interview.confirmed");
    if (app.status !== "INTERVIEW") await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: "INTERVIEW", kind: "STATUS", byUserId: ctx.userId } });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "INTERVIEW", toStatus: "INTERVIEW", kind: "INTERVIEW", reason: live ? `Interview date changed from ${when(live.scheduledAt, school.timezone)} to ${when(start, school.timezone)}` : `Agreed interview date recorded: ${when(start, school.timezone)}${d.location ? ` at ${d.location}` : ""}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.confirm_existing", entityType: "Interview", entityId: i.id, summary: label, changes: { scheduledAt: start.toISOString(), previous: live?.scheduledAt.toISOString() ?? null, previousInterviewId: live?.id ?? null } });
    if (d.kind === "INTERVIEW") await noticeFamily(tx, ctx, app, { kind: live ? "INTERVIEW_CHANGED" : "INTERVIEW", key: `interview:${i.id}`, vars: { when: when(start, school.timezone), where: i.location ?? undefined } });
    return { interviewId: i.id, unchanged: false };
  });
}

const notRequiredSchema = z.object({ reason: optText(400) });

/**
 * Records that no interview is needed for this application. When the school's policy does not require one for the class applied for, the
 * Admissions Office can say so (a reason is optional). When the policy does require one, only a person who may authorise exceptions can, and
 * a reason is required. Never changes an interview that was held, and cannot be done while one is scheduled.
 */
export async function markInterviewNotRequired(ctx: AuthContext, applicationId: string, input: unknown): Promise<{ changed: boolean }> {
  requirePermission(ctx, "admission.interview.manage");
  const d = parse(notRequiredSchema, input);
  const policy = await getAdmissionPolicy(db, ctx.schoolId);
  return db.$transaction(async (tx) => {
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!(OPEN as readonly string[]).includes(app.status)) throw conflict("This application is no longer under consideration.");
    if (app.interviewWaivedAt) return { changed: false };
    if (await tx.interview.findFirst({ where: { applicationId, status: "SCHEDULED" }, select: { id: true } })) throw conflict("An interview is scheduled for this applicant. Cancel it first if no interview is needed.");
    if (await tx.interview.findFirst({ where: { applicationId, status: "COMPLETED", kind: { in: ["INTERVIEW", "ASSESSMENT"] } }, select: { id: true } })) throw conflict("An interview has already been held for this applicant.");
    const levelId = app.classAppliedId ? (await tx.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId: ctx.schoolId }, select: { levelId: true } }))?.levelId ?? null : null;
    const required = assessmentFor(policy, levelId).interview;
    if (required) {
      requirePermission(ctx, "admission.override");
      if (!d.reason) throw invalid("The school requires an interview for this class. Say why it is not needed.", { reason: "Required" });
    }
    await tx.application.update({ where: { id: applicationId }, data: { interviewWaivedAt: new Date(), interviewWaivedById: ctx.userId, interviewWaivedReason: d.reason ?? null } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ASSESSMENT_COORDINATE"], by: ctx.userId, note: "Interview not required" });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: app.status, toStatus: app.status, kind: required ? "EXCEPTION" : "INTERVIEW", reason: `Interview not required${d.reason ? `: ${d.reason}` : ""}${required ? " (the school's policy asks for one)" : ""}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: required ? "admission.exception_interview_waived" : "admission.interview_not_required", entityType: "Application", entityId: applicationId, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { policyRequiresInterview: required }, reason: d.reason });
    if (app.reviewStatus === "VERIFIED") await openTask(tx, { schoolId: ctx.schoolId, kind: "DECISION_REVIEW", relatedType: "Application", relatedId: applicationId, relatedLabel: `${app.firstName} ${app.lastName} (${app.applicationNo})`, sourceEvent: "interview.not_required", createdById: ctx.userId });
    return { changed: true };
  });
}

const completedSchema = z
  .object({
    kind: z.enum(["INTERVIEW", "ENTRANCE_EXAM", "ASSESSMENT"]).default("INTERVIEW"),
    heldAt: text(40),
    outcome: z.enum(["PASSED", "NOT_PASSED", "DEFERRED", "FURTHER_ASSESSMENT", "AWAITING_DECISION"]),
    score: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.coerce.number().int().min(0).max(100).optional()),
    notes: optText(2000),
    interviewerId: optUuid(),
    recommendation: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["RECOMMEND", "RECOMMEND_WITH_CONDITIONS", "NOT_RECOMMENDED"]).optional()),
  });

/**
 * Records an interview that has already taken place (it may be well in the past). It becomes the completed interview of the application,
 * nothing new has to be scheduled, and the application can go straight to the decision. The same interview cannot be recorded twice.
 */
export async function recordCompletedInterview(ctx: AuthContext, applicationId: string, input: unknown): Promise<{ interviewId: string }> {
  requirePermission(ctx, "admission.interview.manage");
  const d = parse(completedSchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const held = instant(d.heldAt, school.timezone);
  if (!held) throw invalid("Please correct the highlighted fields.", { heldAt: "Enter the date and time it took place" });
  if (held.getTime() > Date.now() + FUTURE_SLACK_MS) throw invalid("Please correct the highlighted fields.", { heldAt: "This date has not come yet. Arrange the interview instead." });
  return db.$transaction(async (tx) => {
    if (d.interviewerId) await assertInterviewer(tx, ctx.schoolId, d.interviewerId);
    const app = await lockApplication(tx, ctx.schoolId, applicationId);
    if (!(OPEN as readonly string[]).includes(app.status)) throw conflict("This application is no longer under consideration.");
    if (await tx.interview.findFirst({ where: { applicationId, status: "SCHEDULED" }, select: { id: true } })) throw conflict("An interview is scheduled for this applicant. Record its result instead of adding another.");
    const sameDay = await tx.interview.findFirst({ where: { applicationId, status: "COMPLETED", kind: d.kind, scheduledAt: { gte: dayOf(held), lt: new Date(dayOf(held).getTime() + 86_400_000) } } });
    if (sameDay) throw conflict(`This ${d.kind.toLowerCase().replace("_", " ")} was already recorded for ${when(sameDay.scheduledAt, school.timezone)}.`);
    const i = await tx.interview.create({
      data: { schoolId: ctx.schoolId, applicationId, kind: d.kind, scheduledAt: held, status: "COMPLETED", outcome: d.outcome, score: d.score ?? null, notes: d.notes ?? null, recommendation: d.recommendation ?? null, interviewerId: d.interviewerId ?? null, arrangement: "RECORDED", completedAt: new Date(), completedById: ctx.userId, createdById: ctx.userId },
    });
    const label = `${app.firstName} ${app.lastName} (${app.applicationNo})`;
    await tx.application.update({ where: { id: applicationId }, data: { ...(app.status === "APPLIED" ? { status: "INTERVIEW" as const } : {}), interviewOn: dayOf(held), ...restoreInterview(app) } });
    if (app.status === "APPLIED") await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "APPLIED", toStatus: "INTERVIEW", kind: "STATUS", byUserId: ctx.userId } });
    await closeTasks(tx, { schoolId: ctx.schoolId, relatedType: "Application", relatedId: applicationId, kinds: ["ASSESSMENT_COORDINATE"], by: ctx.userId, note: "Interview already completed" });
    await openTask(tx, { schoolId: ctx.schoolId, kind: "DECISION_REVIEW", relatedType: "Application", relatedId: applicationId, relatedLabel: label, sourceEvent: "interview.recorded", createdById: ctx.userId, discriminator: i.id });
    await tx.applicationEvent.create({ data: { schoolId: ctx.schoolId, applicationId, fromStatus: "INTERVIEW", toStatus: "INTERVIEW", kind: "INTERVIEW", reason: `Completed interview recorded for ${when(held, school.timezone)}: ${d.outcome}`, byUserId: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "interview.record_completed", entityType: "Interview", entityId: i.id, summary: label, changes: { heldAt: held.toISOString(), outcome: d.outcome, kind: d.kind, score: d.score ?? null } });
    return { interviewId: i.id };
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
    if (old.kind === "INTERVIEW") await noticeFamily(tx, ctx, app, { kind: "INTERVIEW_CHANGED", key: `interview:${i.id}`, vars: { when: when(start, school.timezone), where: merged.location } });
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
    await withdrawOpenExams(tx, ctx, i.id, "Interview cancelled");
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
    if (d.status === "COMPLETED") await assertExamsComplete(tx, ctx.schoolId, app.id);
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

/** The dates and times already set for interviews that are still to come, with how many applicants each has, so another applicant can be added to one. */
export async function upcomingInterviewSlots(ctx: AuthContext) {
  requireAnyPermission(ctx, ["admission.read", "admission.interview.manage"]);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const rows = await db.interview.groupBy({ by: ["scheduledAt"], where: { schoolId: ctx.schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: { gt: new Date() } }, _count: { _all: true }, orderBy: { scheduledAt: "asc" }, take: 30 });
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: school.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const slots = rows.map((r) => ({ venue: "", name: "", classIds: null as string[] | null, at: r.scheduledAt, local: local.format(r.scheduledAt).replace(" ", "T"), when: when(r.scheduledAt, school.timezone), count: r._count._all }));
  // The interview days the school has set are offered too, even before anybody is on them, so a waiting applicant can be given one.
  for (const d of await getInterviewDays(db, ctx.schoolId)) {
    const at = zonedToUtc(`${d.on}T${d.time}`, school.timezone);
    if (!at || at.getTime() <= Date.now()) continue;
    const existing = slots.find((x) => x.at.getTime() === at.getTime());
    if (existing) Object.assign(existing, { venue: d.venue, name: d.name, classIds: d.classIds }); // a slot that is a window's interview carries the window's name and classes
    else slots.push({ venue: d.venue, name: d.name, classIds: d.classIds, at, local: `${d.on}T${d.time}`, when: when(at, school.timezone), count: 0 });
  }
  return slots.sort((a, b) => a.at.getTime() - b.at.getTime());
}
