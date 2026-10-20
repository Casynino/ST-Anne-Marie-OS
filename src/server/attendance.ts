import { z } from "zod";
import type { AttendanceStatus, Prisma } from "@/generated/prisma/client";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { checkbox, dateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";
import { actorOf, writeAudit } from "@/server/audit";
import { teachingScope } from "@/server/academics";
import { cancelAbsenceEvents, createAbsenceEvents, processPendingEvents } from "@/server/notifications";

/*
 * Attendance core.
 *
 * Model: one AttendanceRegister per class/stream/session/date holds DRAFT|FINALISED; StudentAttendance
 * rows (unique per student+session+date) belong to it. Finalised registers change only through
 * `correctAttendance` (reason + who, append-only). Every submission — from the online form or the
 * offline sync queue — goes through `submitAttendance`, which is idempotent on the client-generated
 * operation id and never overwrites someone else's finalised work: a divergent later submission is
 * stored as a CONFLICT for review (policy: keep the first finalised record, flag the later one).
 */

export const ATTENDANCE_STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;
export const DEFAULT_SESSION_CODE = "DAY";

// ───────────────────────── Settings & sessions ─────────────────────────

export type AttendanceSettings = {
  /** DAILY: one register per class per day (session DAY). PER_SESSION: one per configured session. */
  mode: "DAILY" | "PER_SESSION";
  /** Students below this attendance rate (%) are flagged in reports. Placeholder until the school decides. */
  lowThresholdPct: number;
  lateCountsAsPresent: boolean;
  excusedCountsAsPresent: boolean;
};

export const DEFAULT_ATTENDANCE_SETTINGS: AttendanceSettings = {
  mode: "DAILY",
  lowThresholdPct: 85,
  lateCountsAsPresent: true,
  excusedCountsAsPresent: false,
};

export async function getAttendanceSettings(client: Db | Tx, schoolId: string): Promise<AttendanceSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "attendance" } } });
  const stored = (row?.value ?? {}) as Partial<AttendanceSettings>;
  return {
    mode: stored.mode === "PER_SESSION" ? "PER_SESSION" : "DAILY",
    lowThresholdPct: typeof stored.lowThresholdPct === "number" ? stored.lowThresholdPct : DEFAULT_ATTENDANCE_SETTINGS.lowThresholdPct,
    lateCountsAsPresent: stored.lateCountsAsPresent ?? DEFAULT_ATTENDANCE_SETTINGS.lateCountsAsPresent,
    excusedCountsAsPresent: stored.excusedCountsAsPresent ?? DEFAULT_ATTENDANCE_SETTINGS.excusedCountsAsPresent,
  };
}

/** Creates the default whole-day session if the school has none yet (idempotent). */
export async function ensureDefaultSession(client: Db | Tx, schoolId: string) {
  return client.attendanceSession.upsert({
    where: { schoolId_code: { schoolId, code: DEFAULT_SESSION_CODE } },
    create: { schoolId, code: DEFAULT_SESSION_CODE, name: "Full day", nameSw: "Siku nzima", sortOrder: 0 },
    update: {},
  });
}

/** Sessions teachers can record right now, according to the school's mode. */
export async function getUsableSessions(client: Db | Tx, schoolId: string, settings?: AttendanceSettings) {
  const s = settings ?? (await getAttendanceSettings(client, schoolId));
  if (s.mode === "DAILY") return [await ensureDefaultSession(client, schoolId)];
  return client.attendanceSession.findMany({
    where: { schoolId, isActive: true, code: { not: DEFAULT_SESSION_CODE } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function listAttendanceSessions(ctx: AuthContext) {
  requirePermission(ctx, "attendance.configure");
  await ensureDefaultSession(db, ctx.schoolId);
  return db.attendanceSession.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

const settingsSchema = z.object({
  mode: z.enum(["DAILY", "PER_SESSION"]),
  lowThresholdPct: z.coerce.number().int().min(1, "Enter a value from 1 to 100").max(100, "Enter a value from 1 to 100"),
  lateCountsAsPresent: checkbox(),
  excusedCountsAsPresent: checkbox(),
});

export async function updateAttendanceSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "attendance.configure");
  const data = parse(settingsSchema, input);
  const before = await getAttendanceSettings(db, ctx.schoolId);
  if (data.mode === "PER_SESSION") {
    const active = await db.attendanceSession.count({ where: { schoolId: ctx.schoolId, isActive: true, code: { not: DEFAULT_SESSION_CODE } } });
    if (!active) throw invalid("Add at least one session (for example Morning and Afternoon) before switching to per-session attendance.", { mode: "No sessions configured" });
  }
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({
      where: { schoolId_key: { schoolId: ctx.schoolId, key: "attendance" } },
      create: { schoolId: ctx.schoolId, key: "attendance", value: data, updatedById: ctx.userId },
      update: { value: data, updatedById: ctx.userId },
    });
    await writeAudit(tx, actorOf(ctx), { action: "settings.attendance_update", entityType: "SchoolSetting", entityId: "attendance", changes: { before, after: data } });
  });
}

const sessionSchema = z.object({
  code: z.string().trim().min(1, "Required").max(20).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, dashes only").transform((v) => v.toUpperCase()),
  name: text(60),
  nameSw: optText(60),
});

export async function createAttendanceSession(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "attendance.configure");
  const data = parse(sessionSchema, input);
  if (data.code === DEFAULT_SESSION_CODE) throw invalid("Please correct the highlighted fields.", { code: "This code is reserved for the whole-day session" });
  if (await db.attendanceSession.findUnique({ where: { schoolId_code: { schoolId: ctx.schoolId, code: data.code } } })) {
    throw invalid("Please correct the highlighted fields.", { code: "A session with this code already exists" });
  }
  return db.$transaction(async (tx) => {
    const max = (await tx.attendanceSession.aggregate({ where: { schoolId: ctx.schoolId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0;
    const row = await tx.attendanceSession.create({ data: { ...data, schoolId: ctx.schoolId, sortOrder: max + 1 } });
    await writeAudit(tx, actorOf(ctx), { action: "attendance_session.create", entityType: "AttendanceSession", entityId: row.id, summary: `${row.code} ${row.name}` });
    return row;
  });
}

export async function setAttendanceSessionActive(ctx: AuthContext, sessionId: string, active: boolean) {
  requirePermission(ctx, "attendance.configure");
  const session = await db.attendanceSession.findFirst({ where: { id: sessionId, schoolId: ctx.schoolId } });
  if (!session) throw notFound("Session");
  if (session.code === DEFAULT_SESSION_CODE) throw conflict("The whole-day session cannot be deactivated.");
  if (!active) {
    const settings = await getAttendanceSettings(db, ctx.schoolId);
    const others = await db.attendanceSession.count({ where: { schoolId: ctx.schoolId, isActive: true, code: { not: DEFAULT_SESSION_CODE }, id: { not: sessionId } } });
    if (settings.mode === "PER_SESSION" && !others) throw conflict("Per-session attendance needs at least one active session. Switch to daily attendance first.");
  }
  await db.$transaction(async (tx) => {
    await tx.attendanceSession.update({ where: { id: sessionId }, data: { isActive: active } });
    await writeAudit(tx, actorOf(ctx), { action: active ? "attendance_session.activate" : "attendance_session.deactivate", entityType: "AttendanceSession", entityId: sessionId, summary: session.name });
  });
}

// ───────────────────────── Access scope ─────────────────────────

export type ClassScope = "ALL" | { classId: string; streamId: string | null }[];

async function assignedScope(ctx: AuthContext, academicYearId: string): Promise<ClassScope> {
  if (!ctx.staffId) return [];
  return teachingScope(ctx.staffId, academicYearId);
}

/** Classes/streams this user may TAKE attendance for in the given academic year. */
export async function takeScope(ctx: AuthContext, academicYearId: string): Promise<ClassScope> {
  if (ctx.permissions.has("attendance.take_any")) return "ALL";
  if (!ctx.permissions.has("attendance.take")) throw forbidden();
  return assignedScope(ctx, academicYearId);
}

/** Classes/streams this user may VIEW attendance for. */
export async function readScope(ctx: AuthContext, academicYearId: string): Promise<ClassScope> {
  if (ctx.permissions.has("attendance.read") || ctx.permissions.has("attendance.take_any")) return "ALL";
  if (ctx.permissions.has("attendance.read_assigned") || ctx.permissions.has("attendance.take")) return assignedScope(ctx, academicYearId);
  throw forbidden();
}

export function inScope(scope: ClassScope, classId: string, streamId: string | null | undefined): boolean {
  if (scope === "ALL") return true;
  return scope.some((s) => s.classId === classId && (s.streamId === null || s.streamId === (streamId ?? null)));
}

// ───────────────────────── Dates, roster ─────────────────────────

async function schoolToday(client: Db | Tx, schoolId: string): Promise<Date> {
  const school = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return parseDateOnly(todayInTimezone(school.timezone)) as Date;
}

/** Academic year that contains a calendar date (attendance belongs to the year the date falls in). */
async function yearForDate(client: Db | Tx, schoolId: string, date: Date) {
  const year = await client.academicYear.findFirst({ where: { schoolId, startsOn: { lte: date }, endsOn: { gte: date } } });
  if (!year) throw invalid("No academic year covers this date.", { date: "No academic year covers this date" });
  return year;
}

type Target = { classId: string; streamId?: string | null };

/** Validates the class/stream pair: streams are required exactly when the class has them. */
async function resolveTarget(client: Db | Tx, schoolId: string, t: Target) {
  const cls = await client.schoolClass.findFirst({ where: { id: t.classId, schoolId }, select: { id: true, name: true, nameSw: true, isActive: true } });
  if (!cls) throw notFound("Class");
  const streams = await client.stream.findMany({ where: { classId: t.classId, schoolId }, select: { id: true, name: true } });
  if (t.streamId) {
    const stream = streams.find((s) => s.id === t.streamId);
    if (!stream) throw invalid("That stream does not belong to the selected class.", { streamId: "Invalid stream" });
    return { cls, stream };
  }
  if (streams.length) throw invalid("Select a stream for this class.", { streamId: "Required for this class" });
  return { cls, stream: null };
}

/** Students on the class list on a given date: enrolled [startedOn, endedOn) in that class/stream. */
export async function loadRoster(client: Db | Tx, schoolId: string, yearId: string, t: { classId: string; streamId?: string | null }, date: Date) {
  const rows = await client.studentEnrollment.findMany({
    where: {
      schoolId,
      academicYearId: yearId,
      classId: t.classId,
      ...(t.streamId ? { streamId: t.streamId } : {}),
      startedOn: { lte: date },
      OR: [{ endedOn: null }, { endedOn: { gt: date } }],
    },
    select: { student: { select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true } } },
  });
  const seen = new Set<string>();
  return rows
    .map((r) => r.student)
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
}

const fullName = (s: { firstName: string; middleName: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");

// ───────────────────────── Sheet (roster + current state) ─────────────────────────

const sheetSchema = z.object({ classId: uuid(), streamId: optUuid(), sessionId: uuid(), date: dateOnly() });

/**
 * Everything the attendance form (or an offline download) needs for one class/stream/session/date.
 * `canTake` tells the UI whether this user may edit; read-only viewers get the same data.
 */
export async function getAttendanceSheet(ctx: AuthContext, input: unknown) {
  const d = parse(sheetSchema, input);
  const today = await schoolToday(db, ctx.schoolId);
  const year = await yearForDate(db, ctx.schoolId, d.date);
  const scope = await readScope(ctx, year.id);
  if (!inScope(scope, d.classId, d.streamId)) throw forbidden();
  const [{ cls, stream }, settings] = await Promise.all([resolveTarget(db, ctx.schoolId, d), getAttendanceSettings(db, ctx.schoolId)]);
  const sessions = await getUsableSessions(db, ctx.schoolId, settings);
  const session = sessions.find((s) => s.id === d.sessionId);
  if (!session) throw invalid("This session is not available.", { sessionId: "Invalid session" });

  const [students, register] = await Promise.all([
    loadRoster(db, ctx.schoolId, year.id, d, d.date),
    db.attendanceRegister.findFirst({
      where: { schoolId: ctx.schoolId, classId: d.classId, streamId: d.streamId ?? null, sessionId: d.sessionId, date: d.date },
      include: { records: { select: { id: true, studentId: true, status: true, note: true, markedById: true } } },
    }),
  ]);
  // Students already marked for this session/date in ANOTHER register (e.g. moved class that day).
  const elsewhere = students.length
    ? await db.studentAttendance.findMany({
        where: { schoolId: ctx.schoolId, sessionId: d.sessionId, date: d.date, studentId: { in: students.map((s) => s.id) }, ...(register ? { registerId: { not: register.id } } : {}) },
        select: { studentId: true, classId: true },
      })
    : [];
  const [startedBy, finalisedBy] = register
    ? await Promise.all([
        db.user.findUnique({ where: { id: register.startedById }, select: { fullName: true } }),
        register.finalisedById ? db.user.findUnique({ where: { id: register.finalisedById }, select: { fullName: true } }) : null,
      ])
    : [null, null];

  const takeAllowed = await takeScope(ctx, year.id).then((s) => inScope(s, d.classId, d.streamId), () => false);
  return {
    date: formatDateOnly(d.date),
    isFuture: d.date > today,
    academicYearId: year.id,
    class: { id: cls.id, name: cls.name },
    stream,
    session: { id: session.id, code: session.code, name: session.name, nameSw: session.nameSw },
    register: register
      ? { id: register.id, status: register.status, startedByName: startedBy?.fullName ?? null, finalisedByName: finalisedBy?.fullName ?? null, finalisedAt: register.finalisedAt, startedById: register.startedById }
      : null,
    students: students.map((s) => ({ id: s.id, admissionNo: s.admissionNo, name: fullName(s) })),
    records: Object.fromEntries((register?.records ?? []).map((r) => [r.studentId, { id: r.id, status: r.status, note: r.note }])),
    markedElsewhere: elsewhere.map((e) => e.studentId),
    canTake: takeAllowed && d.date <= today,
  };
}

export type AttendanceSheet = Awaited<ReturnType<typeof getAttendanceSheet>>;

// ───────────────────────── Submit (online + offline sync) ─────────────────────────

const entrySchema = z.object({ studentId: uuid(), status: z.enum(ATTENDANCE_STATUSES), note: optText(200) });
const optIso = z.preprocess((v) => (v === undefined || v === null || v === "" ? undefined : v), z.iso.datetime({ offset: true }).optional());

export const submitSchema = z.object({
  clientOpId: uuid(),
  deviceId: optText(80),
  kind: z.enum(["SAVE_DRAFT", "FINALISE"]),
  classId: uuid(),
  streamId: optUuid(),
  sessionId: uuid(),
  date: dateOnly(),
  entries: z.array(entrySchema).max(400),
  clientCreatedAt: optIso,
});

export type SubmitInput = z.input<typeof submitSchema>;
export type SubmitResult = {
  outcome: "APPLIED" | "CONFLICT";
  code: string;
  /** True when this operation id was already processed; nothing was changed by this call. */
  replay: boolean;
  registerId: string | null;
  registerStatus: "DRAFT" | "FINALISED" | null;
};

type Entry = z.infer<typeof entrySchema>;

const lockKey = (schoolId: string, t: { classId: string; streamId?: string | null; sessionId: string }, date: Date) =>
  `attendance:${schoolId}:${t.classId}:${t.streamId ?? "-"}:${t.sessionId}:${formatDateOnly(date)}`;

async function lockRegister(tx: Tx, key: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text AS locked`;
}

/** Dedupes entries by student (last wins) so one request can never write a student twice. */
function dedupeEntries(entries: Entry[]): Entry[] {
  return [...new Map(entries.map((e) => [e.studentId, e])).values()];
}

function sameStatuses(existing: Map<string, AttendanceStatus>, entries: Entry[]) {
  return entries.every((e) => existing.get(e.studentId) === e.status);
}

/**
 * Records attendance for one register. Idempotent on (user, clientOpId): replaying an operation
 * returns the stored outcome and changes nothing. Rules:
 *  - no register yet → created (DRAFT, or FINALISED when kind=FINALISE and the class list is fully marked)
 *  - DRAFT by the same user → entries replace/extend the draft
 *  - DRAFT by someone else, or FINALISED, with different content → CONFLICT (stored for review; the
 *    existing record is kept — first finalised record wins, nothing is silently overwritten)
 *  - identical content → APPLIED as a no-op
 * Validation problems (class list changed, incomplete finalisation, forbidden…) throw and are NOT
 * recorded, so the client can fix the data and retry with the same operation id.
 */
export async function submitAttendance(ctx: AuthContext, input: unknown): Promise<SubmitResult> {
  if (!ctx.permissions.has("attendance.take") && !ctx.permissions.has("attendance.take_any")) throw forbidden();
  const d = parse(submitSchema, input);
  const entries = dedupeEntries(d.entries);
  const today = await schoolToday(db, ctx.schoolId);
  if (d.date > today) throw invalid("Attendance cannot be recorded for a future date.", { date: "Cannot be in the future" });
  const year = await yearForDate(db, ctx.schoolId, d.date);
  const scope = await takeScope(ctx, year.id);
  if (!inScope(scope, d.classId, d.streamId)) throw forbidden("You are not assigned to this class.");
  const { cls, stream } = await resolveTarget(db, ctx.schoolId, d);
  const settings = await getAttendanceSettings(db, ctx.schoolId);
  const session = (await getUsableSessions(db, ctx.schoolId, settings)).find((s) => s.id === d.sessionId);
  if (!session) throw invalid("This session is not available.", { sessionId: "Invalid session" });

  const result = await db.$transaction(
    async (tx): Promise<SubmitResult> => {
      // 1. Idempotency: the unique (school, user, clientOpId) row is inserted first. A concurrent duplicate
      //    blocks here until the first transaction finishes, then sees the stored outcome.
      const inserted = await tx.attendanceOperation.createMany({
        data: [
          {
            schoolId: ctx.schoolId,
            userId: ctx.userId,
            clientOpId: d.clientOpId,
            deviceId: d.deviceId,
            kind: d.kind,
            classId: d.classId,
            streamId: d.streamId ?? null,
            sessionId: d.sessionId,
            date: d.date,
            payload: { entries } as unknown as Prisma.InputJsonValue,
            outcome: "APPLIED",
            outcomeCode: "PENDING",
            clientCreatedAt: d.clientCreatedAt ? new Date(d.clientCreatedAt) : undefined,
          },
        ],
        skipDuplicates: true,
      });
      const op = await tx.attendanceOperation.findUniqueOrThrow({
        where: { schoolId_userId_clientOpId: { schoolId: ctx.schoolId, userId: ctx.userId, clientOpId: d.clientOpId } },
      });
      if (inserted.count === 0) {
        const reg = op.registerId ? await tx.attendanceRegister.findUnique({ where: { id: op.registerId }, select: { status: true } }) : null;
        return { outcome: op.outcome, code: op.outcomeCode, replay: true, registerId: op.registerId, registerStatus: reg?.status ?? null };
      }

      // 2. Serialise everything touching this register.
      await lockRegister(tx, lockKey(ctx.schoolId, d, d.date));
      const roster = await loadRoster(tx, ctx.schoolId, year.id, d, d.date);
      const rosterIds = new Set(roster.map((s) => s.id));
      const stray = entries.filter((e) => !rosterIds.has(e.studentId));
      if (stray.length) {
        throw invalid("The class list has changed since it was loaded. Reload the list and check the attendance again.", { entries: "ROSTER_CHANGED" });
      }
      const register = await tx.attendanceRegister.findFirst({
        where: { schoolId: ctx.schoolId, classId: d.classId, streamId: d.streamId ?? null, sessionId: d.sessionId, date: d.date },
        include: { records: true },
      });
      const existing = new Map((register?.records ?? []).map((r) => [r.studentId, r.status]));

      const finish = async (outcome: "APPLIED" | "CONFLICT", code: string, registerId: string | null, status: "DRAFT" | "FINALISED" | null): Promise<SubmitResult> => {
        await tx.attendanceOperation.update({
          where: { id: op.id },
          data: { outcome, outcomeCode: code, registerId, resolution: outcome === "CONFLICT" ? "PENDING" : null },
        });
        if (outcome === "CONFLICT") {
          await writeAudit(tx, actorOf(ctx), {
            action: "attendance.conflict_flagged",
            entityType: "AttendanceRegister",
            entityId: registerId,
            summary: `${cls.name}${stream ? ` ${stream.name}` : ""} ${formatDateOnly(d.date)}`,
            changes: { operationId: op.id, code, kind: d.kind },
          });
        }
        return { outcome, code, replay: false, registerId, registerStatus: status };
      };

      // 3. Conflicts. A later divergent submission never replaces a finalised register or another user's draft.
      //    Students who have NO record yet (e.g. enrolled after the register was finalised) can still be added:
      //    that only adds information and changes nothing that was already recorded.
      if (register?.status === "FINALISED") {
        const diverges = entries.some((e) => existing.has(e.studentId) && existing.get(e.studentId) !== e.status);
        if (diverges) return finish("CONFLICT", "ALREADY_FINALISED", register.id, "FINALISED");
        const additions = entries.filter((e) => !existing.has(e.studentId));
        if (!additions.length) return finish("APPLIED", "NOOP_ALREADY_FINALISED", register.id, "FINALISED");
        const taken = await tx.studentAttendance.findFirst({
          where: { schoolId: ctx.schoolId, sessionId: d.sessionId, date: d.date, studentId: { in: additions.map((e) => e.studentId) }, registerId: { not: register.id } },
          select: { id: true },
        });
        if (taken) return finish("CONFLICT", "STUDENT_MARKED_ELSEWHERE", register.id, "FINALISED");
        await addRecordsToFinalised(tx, ctx, { register: { id: register.id, classId: d.classId, streamId: d.streamId ?? null, sessionId: d.sessionId, date: d.date }, additions, cls: cls.name, stream: stream?.name ?? null, session: session.name });
        return finish("APPLIED", "ADDED_TO_FINALISED", register.id, "FINALISED");
      }
      if (register && register.startedById !== ctx.userId && !sameStatuses(existing, entries)) {
        return finish("CONFLICT", "OTHER_USER_DRAFT", register.id, "DRAFT");
      }
      // A student can hold only one status per session/date; refuse if another register already has them.
      const clash = entries.length
        ? await tx.studentAttendance.findFirst({
            where: { schoolId: ctx.schoolId, sessionId: d.sessionId, date: d.date, studentId: { in: entries.map((e) => e.studentId) }, ...(register ? { registerId: { not: register.id } } : {}) },
            select: { id: true },
          })
        : null;
      if (clash) return finish("CONFLICT", "STUDENT_MARKED_ELSEWHERE", register?.id ?? null, register?.status ?? null);

      // 4. Apply.
      const result = await applyEntries(tx, ctx, { year: year.id, d, entries, roster, register, finalise: d.kind === "FINALISE", cls: cls.name, stream: stream?.name ?? null, session: session.name });
      return finish("APPLIED", result.code, result.registerId, result.status);
    },
    { timeout: 30000 },
  );

  if (result.outcome === "APPLIED" && result.registerStatus === "FINALISED" && !result.replay) {
    // Best-effort: events are durable already; a failure here only delays processing to the next run.
    await processPendingEvents({ schoolId: ctx.schoolId, limit: 100 }).catch(() => undefined);
  }
  return result;
}

type ApplyArgs = {
  year: string;
  d: { classId: string; streamId?: string; sessionId: string; date: Date };
  entries: Entry[];
  roster: { id: string }[];
  register: ({ id: string; status: "DRAFT" | "FINALISED"; records: { id: string; studentId: string; status: AttendanceStatus; note: string | null }[] } & Record<string, unknown>) | null;
  finalise: boolean;
  cls: string;
  stream: string | null;
  session: string;
};

/** Writes entries into the (possibly new) register and finalises it when asked. Runs inside the caller's transaction. */
async function applyEntries(tx: Tx, ctx: AuthContext, a: ApplyArgs): Promise<{ code: string; registerId: string; status: "DRAFT" | "FINALISED" }> {
  const { d, entries } = a;
  const existingIds = new Set((a.register?.records ?? []).map((r) => r.studentId));
  if (a.finalise) {
    const missing = a.roster.filter((s) => !existingIds.has(s.id) && !entries.some((e) => e.studentId === s.id));
    if (missing.length) {
      throw invalid(`${missing.length} student${missing.length === 1 ? " is" : "s are"} not marked yet. Mark everyone before finalising.`, { entries: "INCOMPLETE" });
    }
    if (!a.roster.length) throw invalid("There are no students in this class list.", { entries: "EMPTY_ROSTER" });
  }

  const register =
    a.register ??
    (await tx.attendanceRegister.create({
      data: { schoolId: ctx.schoolId, academicYearId: a.year, classId: d.classId, streamId: d.streamId ?? null, sessionId: d.sessionId, date: d.date, startedById: ctx.userId },
      include: { records: true },
    }));

  const now = new Date();
  const newRows = entries.filter((e) => !existingIds.has(e.studentId));
  if (newRows.length) {
    await tx.studentAttendance.createMany({
      data: newRows.map((e) => ({
        schoolId: ctx.schoolId,
        registerId: register.id,
        studentId: e.studentId,
        classId: d.classId,
        streamId: d.streamId ?? null,
        sessionId: d.sessionId,
        date: d.date,
        status: e.status,
        note: e.note ?? null,
        markedById: ctx.userId,
        markedAt: now,
      })),
    });
  }
  const current = new Map((a.register?.records ?? []).map((r) => [r.studentId, r]));
  const changed = entries.filter((e) => {
    const r = current.get(e.studentId);
    return r !== undefined && (r.status !== e.status || (r.note ?? null) !== (e.note ?? null));
  });
  for (const e of changed) {
    await tx.studentAttendance.update({
      where: { studentId_sessionId_date: { studentId: e.studentId, sessionId: d.sessionId, date: d.date } },
      data: { status: e.status, note: e.note ?? null, markedById: ctx.userId, markedAt: now },
    });
  }
  await tx.attendanceRegister.update({ where: { id: register.id }, data: { updatedAt: now } });

  if (!a.finalise) return { code: a.register ? "DRAFT_UPDATED" : "DRAFT_CREATED", registerId: register.id, status: "DRAFT" };

  await tx.attendanceRegister.update({ where: { id: register.id }, data: { status: "FINALISED", finalisedAt: now, finalisedById: ctx.userId } });
  const all = await tx.studentAttendance.findMany({ where: { registerId: register.id }, select: { id: true, studentId: true, status: true } });
  const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, all.filter((r) => r.status === s).length]));
  const absent = all.filter((r) => r.status === "ABSENT");
  const events = await createAbsenceEvents(tx, ctx.schoolId, absent.map((r) => ({ attendanceId: r.id, studentId: r.studentId })), {
    className: a.cls,
    streamName: a.stream,
    sessionName: a.session,
    date: formatDateOnly(d.date),
  });
  await writeAudit(tx, actorOf(ctx), {
    action: "attendance.finalise",
    entityType: "AttendanceRegister",
    entityId: register.id,
    summary: `${a.cls}${a.stream ? ` ${a.stream}` : ""} ${formatDateOnly(d.date)} (${a.session})`,
    changes: { counts, absenceEventsCreated: events },
  });
  return { code: a.register ? "FINALISED" : "CREATED_FINALISED", registerId: register.id, status: "FINALISED" };
}

/** Adds records for students who have none in an already-finalised register (audited; existing records untouched). */
async function addRecordsToFinalised(
  tx: Tx,
  ctx: AuthContext,
  a: { register: { id: string; classId: string; streamId: string | null; sessionId: string; date: Date }; additions: Entry[]; cls: string; stream: string | null; session: string },
) {
  const now = new Date();
  const created = await tx.studentAttendance.createManyAndReturn({
    data: a.additions.map((e) => ({ schoolId: ctx.schoolId, registerId: a.register.id, studentId: e.studentId, classId: a.register.classId, streamId: a.register.streamId, sessionId: a.register.sessionId, date: a.register.date, status: e.status, note: e.note ?? null, markedById: ctx.userId, markedAt: now })),
    select: { id: true, studentId: true, status: true },
  });
  const events = await createAbsenceEvents(tx, ctx.schoolId, created.filter((r) => r.status === "ABSENT").map((r) => ({ attendanceId: r.id, studentId: r.studentId })), {
    className: a.cls,
    streamName: a.stream,
    sessionName: a.session,
    date: formatDateOnly(a.register.date),
  });
  await writeAudit(tx, actorOf(ctx), {
    action: "attendance.add_late_records",
    entityType: "AttendanceRegister",
    entityId: a.register.id,
    summary: `${a.cls}${a.stream ? ` ${a.stream}` : ""} ${formatDateOnly(a.register.date)} (${a.session})`,
    changes: { students: created.map((r) => ({ studentId: r.studentId, status: r.status })), absenceEventsCreated: events },
  });
}

// ───────────────────────── Corrections ─────────────────────────

const correctionSchema = z.object({
  attendanceId: uuid(),
  status: z.enum(ATTENDANCE_STATUSES),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
});

type CorrectionSource = { operationId?: string };

async function applyCorrection(tx: Tx, ctx: AuthContext, rec: { id: string; studentId: string; status: AttendanceStatus; registerId: string; classId: string; sessionId: string; date: Date }, to: AttendanceStatus, reason: string, src: CorrectionSource = {}) {
  if (rec.status === to) return false;
  await tx.studentAttendance.update({ where: { id: rec.id }, data: { status: to } });
  await tx.attendanceCorrection.create({
    data: { schoolId: ctx.schoolId, attendanceId: rec.id, studentId: rec.studentId, fromStatus: rec.status, toStatus: to, reason, correctedById: ctx.userId, operationId: src.operationId },
  });
  if (to === "ABSENT") {
    const info = await correctionContext(tx, ctx.schoolId, rec);
    await createAbsenceEvents(tx, ctx.schoolId, [{ attendanceId: rec.id, studentId: rec.studentId }], info);
  } else if (rec.status === "ABSENT") {
    await cancelAbsenceEvents(tx, ctx.schoolId, [rec.id]);
  }
  await writeAudit(tx, actorOf(ctx), {
    action: "attendance.correct",
    entityType: "StudentAttendance",
    entityId: rec.id,
    summary: `${formatDateOnly(rec.date)}`,
    changes: { studentId: rec.studentId, from: rec.status, to, ...(src.operationId ? { operationId: src.operationId } : {}) },
    reason,
  });
  return true;
}

async function correctionContext(tx: Tx, schoolId: string, rec: { classId: string; sessionId: string; date: Date; registerId: string }) {
  const [cls, session, register] = await Promise.all([
    tx.schoolClass.findUnique({ where: { id: rec.classId }, select: { name: true } }),
    tx.attendanceSession.findUnique({ where: { id: rec.sessionId }, select: { name: true } }),
    tx.attendanceRegister.findUnique({ where: { id: rec.registerId }, select: { streamId: true } }),
  ]);
  const stream = register?.streamId ? await tx.stream.findUnique({ where: { id: register.streamId }, select: { name: true } }) : null;
  return { className: cls?.name ?? "", streamName: stream?.name ?? null, sessionName: session?.name ?? "", date: formatDateOnly(rec.date) };
}

/** Changes one finalised record. Requires attendance.correct, a reason, and is recorded in corrections + audit. */
export async function correctAttendance(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "attendance.correct");
  const d = parse(correctionSchema, input);
  await db.$transaction(async (tx) => {
    const rec = await tx.studentAttendance.findFirst({ where: { id: d.attendanceId, schoolId: ctx.schoolId }, include: { register: { select: { status: true } } } });
    if (!rec) throw notFound("Attendance record");
    if (rec.register.status !== "FINALISED") throw conflict("This register is still a draft. Edit it from the attendance form instead.");
    if (rec.status === d.status) throw conflict("The record already has this status.");
    await applyCorrection(tx, ctx, rec, d.status, d.reason);
  });
  await processPendingEvents({ schoolId: ctx.schoolId, limit: 100 }).catch(() => undefined);
}

// ───────────────────────── Conflict review ─────────────────────────

export async function listConflicts(ctx: AuthContext, opts: { includeResolved?: boolean } = {}) {
  requirePermission(ctx, "attendance.correct");
  const ops = await db.attendanceOperation.findMany({
    where: { schoolId: ctx.schoolId, outcome: "CONFLICT", ...(opts.includeResolved ? {} : { resolution: "PENDING" }) },
    orderBy: { receivedAt: "desc" },
    take: 100,
  });
  if (!ops.length) return [];
  const registerIds = [...new Set(ops.map((o) => o.registerId).filter((x): x is string => Boolean(x)))];
  const [registers, users, classes] = await Promise.all([
    db.attendanceRegister.findMany({ where: { id: { in: registerIds }, schoolId: ctx.schoolId }, include: { records: true } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(ops.map((o) => o.userId))] } }, select: { id: true, fullName: true } }),
    db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(ops.map((o) => o.classId))] } }, select: { id: true, name: true } }),
  ]);
  const studentIds = [...new Set(ops.flatMap((o) => ((o.payload as { entries?: Entry[] }).entries ?? []).map((e) => e.studentId)))];
  const students = await db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, middleName: true, lastName: true, admissionNo: true } });
  const studentName = new Map(students.map((s) => [s.id, `${fullName(s)} (${s.admissionNo})`]));
  return ops.map((o) => {
    const reg = registers.find((r) => r.id === o.registerId);
    const current = new Map((reg?.records ?? []).map((r) => [r.studentId, r.status]));
    const submitted = ((o.payload as { entries?: Entry[] }).entries ?? []);
    return {
      id: o.id,
      date: formatDateOnly(o.date),
      className: classes.find((c) => c.id === o.classId)?.name ?? "",
      submittedBy: users.find((u) => u.id === o.userId)?.fullName ?? "",
      receivedAt: o.receivedAt,
      kind: o.kind,
      code: o.outcomeCode,
      resolution: o.resolution!,
      resolutionReason: o.resolutionReason,
      registerStatus: reg?.status ?? null,
      differences: submitted.filter((e) => current.get(e.studentId) !== e.status).map((e) => ({ student: studentName.get(e.studentId) ?? e.studentId, current: current.get(e.studentId) ?? null, submitted: e.status })),
    };
  });
}

const resolveSchema = z.object({
  operationId: uuid(),
  action: z.enum(["ACCEPT", "DISMISS"]),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
});

/**
 * Resolves a flagged submission. DISMISS keeps what is on the server. ACCEPT applies the submitted
 * statuses: as audited corrections when the register is finalised, or as the new draft (and finalising
 * if the operation asked to finalise) when it is still a draft.
 */
export async function resolveConflict(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "attendance.correct");
  const d = parse(resolveSchema, input);
  await db.$transaction(
    async (tx) => {
      const op = await tx.attendanceOperation.findFirst({ where: { id: d.operationId, schoolId: ctx.schoolId, outcome: "CONFLICT" } });
      if (!op) throw notFound("Conflict");
      if (op.resolution !== "PENDING") throw conflict("This conflict has already been resolved.");
      const entries = ((op.payload as { entries?: Entry[] }).entries ?? []);
      if (d.action === "ACCEPT") {
        await lockRegister(tx, lockKey(ctx.schoolId, op, op.date));
        const register = op.registerId
          ? await tx.attendanceRegister.findFirst({ where: { id: op.registerId, schoolId: ctx.schoolId }, include: { records: true } })
          : null;
        if (!register) throw conflict("The register for this submission no longer exists.");
        if (register.status === "FINALISED") {
          const byStudent = new Map(register.records.map((r) => [r.studentId, r]));
          const additions: Entry[] = [];
          for (const e of entries) {
            const rec = byStudent.get(e.studentId);
            if (rec) await applyCorrection(tx, ctx, rec, e.status, d.reason, { operationId: op.id });
            else additions.push(e);
          }
          if (additions.length) {
            const [cls, session, stream] = await Promise.all([
              tx.schoolClass.findUniqueOrThrow({ where: { id: op.classId }, select: { name: true } }),
              tx.attendanceSession.findUniqueOrThrow({ where: { id: op.sessionId }, select: { name: true } }),
              op.streamId ? tx.stream.findUnique({ where: { id: op.streamId }, select: { name: true } }) : null,
            ]);
            await addRecordsToFinalised(tx, ctx, { register: { id: register.id, classId: op.classId, streamId: op.streamId, sessionId: op.sessionId, date: op.date }, additions, cls: cls.name, stream: stream?.name ?? null, session: session.name });
          }
        } else {
          const [cls, session, stream] = await Promise.all([
            tx.schoolClass.findUniqueOrThrow({ where: { id: op.classId }, select: { name: true } }),
            tx.attendanceSession.findUniqueOrThrow({ where: { id: op.sessionId }, select: { name: true } }),
            op.streamId ? tx.stream.findUnique({ where: { id: op.streamId }, select: { name: true } }) : null,
          ]);
          const year = await yearForDate(tx, ctx.schoolId, op.date);
          const roster = await loadRoster(tx, ctx.schoolId, year.id, op, op.date);
          await applyEntries(tx, ctx, {
            year: year.id,
            d: { classId: op.classId, streamId: op.streamId ?? undefined, sessionId: op.sessionId, date: op.date },
            entries,
            roster,
            register: register as ApplyArgs["register"],
            finalise: op.kind === "FINALISE",
            cls: cls.name,
            stream: stream?.name ?? null,
            session: session.name,
          });
        }
      }
      await tx.attendanceOperation.update({
        where: { id: op.id },
        data: { resolution: d.action === "ACCEPT" ? "ACCEPTED" : "DISMISSED", resolvedById: ctx.userId, resolvedAt: new Date(), resolutionReason: d.reason },
      });
      await writeAudit(tx, actorOf(ctx), {
        action: d.action === "ACCEPT" ? "attendance.conflict_accepted" : "attendance.conflict_dismissed",
        entityType: "AttendanceOperation",
        entityId: op.id,
        changes: { registerId: op.registerId, code: op.outcomeCode },
        reason: d.reason,
      });
    },
    { timeout: 30000 },
  );
  await processPendingEvents({ schoolId: ctx.schoolId, limit: 100 }).catch(() => undefined);
}

export async function countPendingConflicts(ctx: AuthContext): Promise<number> {
  if (!ctx.permissions.has("attendance.correct")) return 0;
  return db.attendanceOperation.count({ where: { schoolId: ctx.schoolId, outcome: "CONFLICT", resolution: "PENDING" } });
}

// ───────────────────────── Registers overview ─────────────────────────

export type RegisterCell = { sessionId: string; status: "NOT_STARTED" | "DRAFT" | "FINALISED"; registerId: string | null; counts: Record<AttendanceStatus, number> };
export type OverviewRow = {
  classId: string;
  className: string;
  streamId: string | null;
  streamName: string | null;
  studentCount: number;
  canTake: boolean;
  cells: RegisterCell[];
};

const emptyCounts = (): Record<AttendanceStatus, number> => ({ PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 });

/** Completion status per class (and stream) and session for one date, limited to the user's read scope. */
export async function registerOverview(ctx: AuthContext, dateInput: string) {
  const date = parseDateOnly(dateInput);
  if (!date) throw invalid("Enter a valid date.", { date: "Enter a valid date" });
  const year = await yearForDate(db, ctx.schoolId, date);
  const [scope, canTakeScope] = await Promise.all([readScope(ctx, year.id), takeScope(ctx, year.id).catch(() => [] as ClassScope)]);
  const settings = await getAttendanceSettings(db, ctx.schoolId);
  const sessions = await getUsableSessions(db, ctx.schoolId, settings);

  const [classes, registers, enrolled] = await Promise.all([
    db.schoolClass.findMany({
      where: { schoolId: ctx.schoolId, isActive: true },
      orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      include: { streams: { orderBy: { name: "asc" } } },
    }),
    db.attendanceRegister.findMany({ where: { schoolId: ctx.schoolId, date }, include: { records: { select: { status: true } } } }),
    db.studentEnrollment.groupBy({
      by: ["classId", "streamId"],
      where: { schoolId: ctx.schoolId, academicYearId: year.id, startedOn: { lte: date }, OR: [{ endedOn: null }, { endedOn: { gt: date } }] },
      _count: { _all: true },
    }),
  ]);
  const rows: OverviewRow[] = [];
  for (const c of classes) {
    const targets: { id: string | null; name: string | null }[] = c.streams.length ? c.streams.map((s) => ({ id: s.id, name: s.name })) : [{ id: null, name: null }];
    for (const t of targets) {
      if (!inScope(scope, c.id, t.id)) continue;
      const studentCount = enrolled.filter((e) => e.classId === c.id && (t.id ? e.streamId === t.id : true)).reduce((n, e) => n + e._count._all, 0);
      rows.push({
        classId: c.id,
        className: c.name,
        streamId: t.id,
        streamName: t.name,
        studentCount,
        canTake: inScope(canTakeScope, c.id, t.id),
        cells: sessions.map((s) => {
          const reg = registers.find((r) => r.classId === c.id && (r.streamId ?? null) === t.id && r.sessionId === s.id);
          const counts = emptyCounts();
          for (const r of reg?.records ?? []) counts[r.status]++;
          return { sessionId: s.id, status: reg ? reg.status : "NOT_STARTED", registerId: reg?.id ?? null, counts };
        }),
      });
    }
  }
  return { date: formatDateOnly(date), sessions: sessions.map((s) => ({ id: s.id, name: s.name, nameSw: s.nameSw })), rows, settings };
}

// ───────────────────────── Staff attendance ─────────────────────────

const staffEntrySchema = z.object({ staffId: uuid(), status: z.enum(ATTENDANCE_STATUSES), note: optText(200) });
const staffBatchSchema = z.object({ date: dateOnly(), entries: z.array(staffEntrySchema).min(1, "Mark at least one staff member").max(500) });

export async function listStaffAttendance(ctx: AuthContext, dateInput: string) {
  requirePermission(ctx, "attendance.staff.read");
  const date = parseDateOnly(dateInput);
  if (!date) throw invalid("Enter a valid date.", { date: "Enter a valid date" });
  const [staff, records] = await Promise.all([
    db.staff.findMany({ where: { schoolId: ctx.schoolId, user: { status: "ACTIVE" } }, select: { id: true, jobTitle: true, user: { select: { fullName: true } } }, orderBy: { user: { fullName: "asc" } } }),
    db.staffAttendance.findMany({ where: { schoolId: ctx.schoolId, date } }),
  ]);
  const byStaff = new Map(records.map((r) => [r.staffId, r]));
  return staff.map((s) => ({ staffId: s.id, name: s.user.fullName, jobTitle: s.jobTitle, status: byStaff.get(s.id)?.status ?? null, note: byStaff.get(s.id)?.note ?? null }));
}

/** Upserts staff attendance for a date. Each change from an existing value is audited with before/after. */
export async function recordStaffAttendance(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "attendance.staff.record");
  const d = parse(staffBatchSchema, input);
  const today = await schoolToday(db, ctx.schoolId);
  if (d.date > today) throw invalid("Attendance cannot be recorded for a future date.", { date: "Cannot be in the future" });
  const entries = [...new Map(d.entries.map((e) => [e.staffId, e])).values()];
  const valid = await db.staff.findMany({ where: { schoolId: ctx.schoolId, id: { in: entries.map((e) => e.staffId) }, user: { status: "ACTIVE" } }, select: { id: true } });
  if (valid.length !== entries.length) throw invalid("One of the selected staff members is not valid.");
  await db.$transaction(async (tx) => {
    const before = new Map((await tx.staffAttendance.findMany({ where: { schoolId: ctx.schoolId, date: d.date, staffId: { in: entries.map((e) => e.staffId) } } })).map((r) => [r.staffId, r.status]));
    for (const e of entries) {
      await tx.staffAttendance.upsert({
        where: { staffId_date: { staffId: e.staffId, date: d.date } },
        create: { schoolId: ctx.schoolId, staffId: e.staffId, date: d.date, status: e.status, note: e.note, recordedById: ctx.userId },
        update: { status: e.status, note: e.note ?? null, recordedById: ctx.userId },
      });
    }
    const changes = entries.filter((e) => before.get(e.staffId) !== e.status).map((e) => ({ staffId: e.staffId, from: before.get(e.staffId) ?? null, to: e.status }));
    if (changes.length) await writeAudit(tx, actorOf(ctx), { action: "staff_attendance.record", entityType: "StaffAttendance", entityId: formatDateOnly(d.date), summary: `${changes.length} change(s)`, changes: { changes } });
  });
}

// ───────────────────────── Register detail ─────────────────────────

export async function getRegisterDetail(ctx: AuthContext, registerId: string) {
  const register = await db.attendanceRegister.findFirst({
    where: { id: registerId, schoolId: ctx.schoolId },
    include: { session: { select: { name: true } }, records: true },
  });
  if (!register) throw notFound("Register");
  const scope = await readScope(ctx, register.academicYearId);
  if (!inScope(scope, register.classId, register.streamId)) throw notFound("Register");
  const [cls, stream, students, corrections, users] = await Promise.all([
    db.schoolClass.findFirst({ where: { id: register.classId, schoolId: ctx.schoolId }, select: { name: true } }),
    register.streamId ? db.stream.findFirst({ where: { id: register.streamId }, select: { name: true } }) : null,
    db.student.findMany({ where: { schoolId: ctx.schoolId, id: { in: register.records.map((r) => r.studentId) } }, select: { id: true, admissionNo: true, firstName: true, middleName: true, lastName: true } }),
    db.attendanceCorrection.findMany({ where: { schoolId: ctx.schoolId, attendanceId: { in: register.records.map((r) => r.id) } }, orderBy: { createdAt: "desc" } }),
    db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [register.startedById, register.finalisedById ?? register.startedById] } }, select: { id: true, fullName: true } }),
  ]);
  const correctors = await db.user.findMany({ where: { schoolId: ctx.schoolId, id: { in: [...new Set(corrections.map((c) => c.correctedById))] } }, select: { id: true, fullName: true } });
  const nameOf = new Map(students.map((s) => [s.id, fullName(s)]));
  return {
    id: register.id,
    status: register.status,
    date: formatDateOnly(register.date),
    className: cls?.name ?? "",
    streamName: stream?.name ?? null,
    sessionName: register.session.name,
    startedBy: users.find((u) => u.id === register.startedById)?.fullName ?? "",
    finalisedBy: users.find((u) => u.id === register.finalisedById)?.fullName ?? null,
    finalisedAt: register.finalisedAt,
    records: register.records
      .map((r) => ({ id: r.id, studentId: r.studentId, name: nameOf.get(r.studentId) ?? "", admissionNo: students.find((s) => s.id === r.studentId)?.admissionNo ?? "", status: r.status, note: r.note }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    corrections: corrections.map((c) => ({ id: c.id, student: nameOf.get(c.studentId) ?? "", from: c.fromStatus, to: c.toStatus, reason: c.reason, by: correctors.find((u) => u.id === c.correctedById)?.fullName ?? "", at: c.createdAt })),
    canCorrect: ctx.permissions.has("attendance.correct") && register.status === "FINALISED",
  };
}
