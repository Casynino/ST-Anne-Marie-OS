import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "@/lib/db";
import { conflict, invalid } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext, type RequestMeta } from "@/lib/auth/context";
import { todayInTimezone, zonedToUtc } from "@/lib/dates";
import { cleanDays, coversClass, dayOpenOn, pickDay, type InterviewDay } from "@/lib/admissions/interview-days";
import { actorOf, writeAudit } from "@/server/audit";
import { assessmentFor, getAdmissionPolicy } from "@/server/admission-policy";
import { noticeFamily } from "@/server/application-notices";
import { optText, parse } from "@/lib/validation";

/*
 * Application windows (setting `interview_days`; a window is an interview day with its class, name and dates): the office opens a window for
 * the classes it is taking applications for, with the interview date already set. When an application for one of those classes is received
 * (its fee is paid) while the window is open, the applicant is placed on that interview and the family is told; otherwise the application
 * waits under review and the office gives it a date when it accepts it. Nothing is placed when the school does not ask for an interview for
 * that class. Applications are accepted at any time, window or not.
 */

const KEY = "interview_days";
const MAX_DAYS = 60;

export async function getInterviewDays(client: Pick<Tx, "schoolSetting">, schoolId: string): Promise<InterviewDay[]> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: KEY } } });
  return cleanDays(row?.value);
}

const optDate = z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date").optional());
const daySchema = z.object({
  name: z.string().trim().min(2, "Give the window a name").max(80),
  classIds: z.preprocess((v) => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.string().uuid()).max(60)),
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
  if (d.classIds.length) {
    const known = await db.schoolClass.count({ where: { schoolId: ctx.schoolId, id: { in: d.classIds } } });
    if (known !== d.classIds.length) errors.classIds = "Choose classes of this school";
  }
  if (Object.keys(errors).length) throw invalid("Please correct the highlighted fields.", errors);
  const day: InterviewDay = { id: randomUUID(), name: d.name, classIds: d.classIds, on: d.on, time: d.time, venue: d.venue ?? "", from: d.from ?? "", until: d.until ?? "", capacity: d.capacity };
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interviewdays:${ctx.schoolId}`}, 0))::text AS locked`;
    const days = await getInterviewDays(tx, ctx.schoolId);
    if (days.length >= MAX_DAYS) throw conflict("There are too many interview days. Remove the ones that have passed.");
    if (days.some((x) => x.name.toLowerCase() === day.name.toLowerCase() && x.on === day.on && x.time === day.time)) throw conflict("This window is already set.");
    await saveDays(tx, ctx, [...days, day]);
    await writeAudit(tx, actorOf(ctx), { action: "admission.interview_day_add", entityType: "SchoolSetting", entityId: KEY, summary: `${day.name}: ${day.on} ${day.time}`, changes: { ...day } });
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
    await writeAudit(tx, actorOf(ctx), { action: "admission.interview_day_remove", entityType: "SchoolSetting", entityId: KEY, summary: `${gone.name}: ${gone.on} ${gone.time}`, changes: { ...gone } });
  });
}

export type InterviewDayRow = InterviewDay & { placed: number; startsAt: Date | null; classNames: string[] };

/** The days that are still to come, with how many applicants each has. */
export async function listInterviewDays(ctx: AuthContext): Promise<InterviewDayRow[]> {
  requireAnyPermission(ctx, ["admission.read", "admission.interview.manage"]);
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const days = (await getInterviewDays(db, ctx.schoolId)).filter((d) => d.on >= today);
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } });
  return Promise.all(days.map(async (d) => {
    const startsAt = zonedToUtc(`${d.on}T${d.time}`, school.timezone);
    const placed = startsAt ? await db.interview.count({ where: { schoolId: ctx.schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: startsAt } }) : 0;
    return { ...d, placed, startsAt, classNames: d.classIds.map((id) => classes.find((c) => c.id === id)?.name).filter((x): x is string => !!x) };
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
    return at !== null && at.getTime() > now && coversClass(d, app.classAppliedId);
  });
  // Count the applicants of each day under a lock so two applications received together cannot overfill it.
  const placed: Record<string, number> = {};
  for (const d of candidates) {
    if (d.capacity === 0) continue;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interviewday:${schoolId}:${d.id}`}, 0))::text AS locked`;
    placed[d.id] = await tx.interview.count({ where: { schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: zonedToUtc(`${d.on}T${d.time}`, school.timezone)! } });
  }
  const day = pickDay(candidates, today, placed, app.classAppliedId);
  if (!day) return { placed: false };

  const start = zonedToUtc(`${day.on}T${day.time}`, school.timezone)!;
  const i = await tx.interview.create({
    data: { schoolId, applicationId, kind: "INTERVIEW", scheduledAt: start, durationMinutes: policy.interviewMinutes, location: day.venue || null, scheduleNote: `Placed on the interview of the window "${day.name}"`, arrangement: "DAY", createdById: null },
  });
  await tx.application.update({ where: { id: applicationId }, data: { status: "INTERVIEW", interviewOn: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) } });
  await tx.applicationEvent.create({ data: { schoolId, applicationId, fromStatus: "APPLIED", toStatus: "INTERVIEW", kind: "STATUS", reason: `Placed on the interview of the window "${day.name}": ${when(start, school.timezone)}${day.venue ? ` at ${day.venue}` : ""}` } });
  await noticeFamily(tx, { schoolId, userId: null }, app, { kind: "INTERVIEW", key: `interview:${i.id}`, vars: { when: when(start, school.timezone), where: day.venue || undefined } });
  await writeAudit(tx, { schoolId, actorId: null, actorName: "Interview day (automatic)", meta }, { action: "interview.placed_on_day", entityType: "Interview", entityId: i.id, summary: `${app.firstName} ${app.lastName} (${app.applicationNo})`, changes: { scheduledAt: start.toISOString(), dayId: day.id, venue: day.venue || null } });
  return { placed: true, interviewId: i.id };
}

export type OpenWindow = { id: string; name: string; classNames: string[]; closesOn: string | null; on: string; time: string; venue: string; startsAt: Date; full: boolean };

/**
 * The application windows that are open today, for telling families on the site and on the forms which classes are open, until when, and when the
 * interview is. Public: it reveals only what the school has chosen to announce, and nothing at all when the school asks for no interview.
 */
export async function openWindows(schoolId: string): Promise<OpenWindow[]> {
  const days = await getInterviewDays(db, schoolId);
  if (days.length === 0) return [];
  const policy = await getAdmissionPolicy(db, schoolId);
  if (!policy.requireInterview) return [];
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  const today = todayInTimezone(school.timezone);
  const classes = await db.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true } });
  const out: OpenWindow[] = [];
  for (const d of days) {
    const at = zonedToUtc(`${d.on}T${d.time}`, school.timezone);
    if (!at || at.getTime() <= Date.now() || !dayOpenOn(d, today)) continue;
    const placed = d.capacity > 0 ? await db.interview.count({ where: { schoolId, status: "SCHEDULED", kind: "INTERVIEW", scheduledAt: at } }) : 0;
    out.push({ id: d.id, name: d.name || d.on, classNames: d.classIds.map((id) => classes.find((c) => c.id === id)?.name).filter((x): x is string => !!x), closesOn: d.until || null, on: d.on, time: d.time, venue: d.venue, startsAt: at, full: d.capacity > 0 && placed >= d.capacity });
  }
  return out;
}
