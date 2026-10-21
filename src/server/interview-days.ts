import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext, type RequestMeta } from "@/lib/auth/context";
import { todayInTimezone, zonedToUtc } from "@/lib/dates";
import { cleanDays, pickDay, type InterviewDay } from "@/lib/admissions/interview-days";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy } from "@/server/admission-policy";
import { noticeFamily } from "@/server/application-notices";
import { optText, parse } from "@/lib/validation";

/*
 * Interview days (setting `interview_days`): the school sets the dates before families apply. When an application is received (its fee is
 * paid) and a day is open for it, the applicant is placed on that day and the family is told; otherwise the application simply waits and the
 * office gives it a date later with the usual interview screens. Nothing is placed when the school does not ask for an interview for that class.
 */

const KEY = "interview_days";
const MAX_DAYS = 60;

export async function getInterviewDays(client: Pick<Tx, "schoolSetting">, schoolId: string): Promise<InterviewDay[]> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  return cleanDays(row?.value);
}

const optDate = z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date").optional());
const daySchema = z.object({
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time such as 09:00"),
  venue: optText(120),
  from: optDate,
  until: optDate,
  capacity: z.preprocess((v) => (v === "" || v === undefined ? 0 : v), z.coerce.number().int().min(0).max(1000)),
});

async function saveDays(tx: Tx, ctx: AuthContext, days: InterviewDay[]) {
  await tx.schoolSetting.upsert({
    where: { schoolId_key: { schoolId: ctx.schoolId, key: KEY } },
    create: { schoolId: ctx.schoolId, key: KEY, value: days as unknown as object, updatedById: ctx.userId },
    update: { value: days as unknown as object, updatedById: ctx.userId },
  });
}

/** Sets a new interview day. Applicants received within its window are placed on it automatically. */
export async function addInterviewDay(ctx: AuthContext, input: unknown): Promise<InterviewDay> {
  requirePermission(ctx, "admission.interview.manage");
  const d = parse(daySchema, input);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const errors: Record<string, string> = {};
  if (d.on < today) errors.on = "Choose a day that has not passed";
  if (d.from && d.until && d.from > d.until) errors.until = "This cannot be before the first date";
  if (d.until && d.until > d.on) errors.until = "Applications must be received by the interview day";
  if (Object.keys(errors).length) throw invalid("Please correct the highlighted fields.", errors);
  const day: InterviewDay = { id: randomUUID(), on: d.on, time: d.time, venue: d.venue ?? "", from: d.from ?? "", until: d.until ?? "", capacity: d.capacity };
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interviewdays:${ctx.schoolId}`}, 0))::text AS locked`;
    const days = await getInterviewDays(tx, ctx.schoolId);
    if (days.length >= MAX_DAYS) throw conflict("There are too many interview days. Remove the ones that have passed.");
    if (days.some((x) => x.on === day.on && x.time === day.time && x.venue === day.venue)) throw conflict("This interview day is already set.");
    await saveDays(tx, ctx, [...days, day]);
    await writeAudit(tx, actorOf(ctx), { action: "admission.interview_day_add", entityType: "SchoolSetting", entityId: KEY, summary: `${day.on} ${day.time}`, changes: { ...day } });
  });
  return day;
}

/** Takes a day off the list. Applicants already placed on it keep their interview (change it from the application if needed). */
export async function removeInterviewDay(ctx: AuthContext, id: string) {
  requirePermission(ctx, "admission.interview.manage");
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interviewdays:${ctx.schoolId}`}, 0))::text AS locked`;
    const days = await getInterviewDays(tx, ctx.schoolId);
    const gone = days.find((x) => x.id === id);
    if (!gone) return;
    await saveDays(tx, ctx, days.filter((x) => x.id !== id));
    await writeAudit(tx, actorOf(ctx), { action: "admission.interview_day_remove", entityType: "SchoolSetting", entityId: KEY, summary: `${gone.on} ${gone.time}`, changes: { ...gone } });
  });
}

export type InterviewDayRow = InterviewDay & { placed: number; startsAt: Date | null };

/** The days that are still to come, with how many applicants each has. */
export async function listInterviewDays(ctx: AuthContext): Promise<InterviewDayRow[]> {
  requireAnyPermission(ctx, ["admission.read", "admission.interview.manage"]);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const days = (await getInterviewDays(db, ctx.schoolId)).filter((d) => d.on >= today);
  return Promise.all(days.map(async (d) => {
    const startsAt = zonedToUtc(`${d.on}T${d.time}`, school.timezone);
    const placed = startsAt ? await db.interview.count({ where: { schoolId: ctx.schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: startsAt } }) : 0;
    return { ...d, placed, startsAt };
  }));
}

const when = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

/**
 * Places a newly received application on the interview day that is open for it, if the school asks for an interview for that class and a day
 * with room exists. Call it inside the transaction that links the application to the family's record, so the family can be told. It does
 * not need the papers to be in order (the date already exists), and it is silent when there is nothing to do.
 */
export async function placeOnInterviewDay(tx: Tx, schoolId: string, applicationId: string, meta: RequestMeta): Promise<{ placed: boolean; interviewId?: string }> {
  const app = await tx.application.findFirst({ where: { id: applicationId, schoolId } });
  if (!app || app.status !== "APPLIED") return { placed: false };
  const days = await getInterviewDays(tx, schoolId);
  if (days.length === 0) return { placed: false };
  const policy = await getAdmissionPolicy(tx, schoolId);
  const levelId = app.classAppliedId ? (await tx.schoolClass.findFirst({ where: { id: app.classAppliedId, schoolId }, select: { levelId: true } }))?.levelId ?? null : null;
  if (!assessmentFor(policy, levelId).interview) return { placed: false };
  if (await tx.interview.findFirst({ where: { applicationId, status: { in: ["SCHEDULED", "COMPLETED"] } }, select: { id: true } })) return { placed: false };

  const school = await tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const now = Date.now();
  const candidates = days.filter((d) => {
    const at = zonedToUtc(`${d.on}T${d.time}`, school.timezone);
    return at !== null && at.getTime() > now;
  });
  // Count the applicants of each day under a lock so two applications received together cannot overfill it.
  const placed: Record<string, number> = {};
  for (const d of candidates) {
    if (d.capacity === 0) continue;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interviewday:${schoolId}:${d.id}`}, 0))::text AS locked`;
    placed[d.id] = await tx.interview.count({ where: { schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: zonedToUtc(`${d.on}T${d.time}`, school.timezone)! } });
  }
  const day = pickDay(candidates, today, placed);
  if (!day) return { placed: false };

  const start = zonedToUtc(`${day.on}T${day.time}`, school.timezone)!;
  const i = await tx.interview.create({
    data: { schoolId, applicationId, kind: "INTERVIEW", scheduledAt: start, durationMinutes: policy.interviewMinutes, location: day.venue || null, scheduleNote: "Placed on the interview day the school had already set", arrangement: "DAY", createdById: null },
  });
  await tx.application.update({ where: { id: applicationId }, data: { status: "INTERVIEW", interviewOn: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) } });
  await tx.applicationEvent.create({ data: { schoolId, applicationId, fromStatus: "APPLIED", toStatus: "INTERVIEW", kind: "STATUS", reason: `Placed on the interview day: ${when(start, school.timezone)}${day.venue ? ` at ${day.venue}` : ""}` } });
  await noticeFamily(tx, { schoolId, userId: null }, app, { kind: "INTERVIEW", key: `interview:${i.id}`, vars: { when: when(start, school.timezone), where: day.venue || undefined } });
  await writeAudit(tx, { schoolId, actorId: null, actorName: "Interview day (automatic)", meta }, { action: "interview.placed_on_day", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { scheduledAt: start.toISOString(), dayId: day.id, venue: day.venue || null } });
  return { placed: true, interviewId: i.id };
}

export type OpenDayNotice = { on: string; time: string; venue: string; startsAt: Date };

/**
 * The interview day an application received now would be placed on (the earliest open day with room), for telling families on the form
 * before they apply. It is information only: the placement itself happens when the application is received. Public: it reveals nothing but
 * the dates the school has chosen to announce, and nothing at all when the school does not ask for an interview.
 */
export async function openInterviewDayNotice(schoolId: string): Promise<OpenDayNotice | null> {
  const days = await getInterviewDays(db, schoolId);
  if (days.length === 0) return null;
  const policy = await getAdmissionPolicy(db, schoolId);
  if (!policy.requireInterview) return null;
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const future = days.filter((d) => { const at = zonedToUtc(`${d.on}T${d.time}`, school.timezone); return at !== null && at.getTime() > Date.now(); });
  const placed: Record<string, number> = {};
  for (const d of future) if (d.capacity > 0) placed[d.id] = await db.interview.count({ where: { schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: zonedToUtc(`${d.on}T${d.time}`, school.timezone)! } });
  const day = pickDay(future, today, placed);
  return day ? { on: day.on, time: day.time, venue: day.venue, startsAt: zonedToUtc(`${day.on}T${day.time}`, school.timezone)! } : null;
}
