import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as att from "@/server/attendance";
import * as reports from "@/server/attendance-reports";
import { processPendingEvents } from "@/server/notifications";
import { setSmsAdapter, type SmsAdapter } from "@/lib/sms/adapter";
import type { AuthContext } from "@/lib/auth/context";
import { createCurrentYearAcademics, createTestSchool, createTestUser, guardianFor, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, headTeacher: AuthContext, teacherA: AuthContext, teacherB: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let streamA: { id: string }, streamB: { id: string };
let sessionId: string;
let kids: { id: string; name: string }[] = [];
let n = 5000;

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const sheetInput = (extra: Record<string, unknown> = {}) => ({ classId: setup.cls.id, streamId: streamA.id, sessionId, date: setup.today, ...extra });
const submit = (ctx: AuthContext, entries: [number, string][], extra: Record<string, unknown> = {}) =>
  att.submitAttendance(ctx, {
    clientOpId: randomUUID(),
    kind: "SAVE_DRAFT",
    ...sheetInput(),
    entries: entries.map(([i, status]) => ({ studentId: kids[i]!.id, status })),
    ...extra,
  });
const allPresent = (status = "PRESENT"): [number, string][] => kids.map((_, i) => [i, status]);

async function freshRegister() {
  // A different stream-less date is not possible (future dates are rejected), so tests reuse today's
  // register and clear it between scenarios. Records are removed directly (test database only).
  const reg = await db.attendanceRegister.findFirst({ where: { schoolId: school.id, classId: setup.cls.id, streamId: streamA.id, date: new Date(`${setup.today}T00:00:00Z`) } });
  if (!reg) return;
  await db.notificationDelivery.deleteMany({ where: { schoolId: school.id } });
  await db.inAppNotification.deleteMany({ where: { schoolId: school.id } });
  await db.notificationEvent.deleteMany({ where: { schoolId: school.id } });
  await db.attendanceOperation.deleteMany({ where: { schoolId: school.id } });
  await db.$executeRaw`ALTER TABLE attendance_corrections DISABLE TRIGGER attendance_corrections_append_only`;
  await db.attendanceCorrection.deleteMany({ where: { schoolId: school.id } });
  await db.$executeRaw`ALTER TABLE attendance_corrections ENABLE TRIGGER attendance_corrections_append_only`;
  await db.studentAttendance.deleteMany({ where: { registerId: reg.id } });
  await db.attendanceRegister.delete({ where: { id: reg.id } });
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  headTeacher = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacherA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  teacherB = (await createTestUser(school.id, ["class_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!;
  streamB = setup.streams[1]!;
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id, staffId: teacherA.staffId });
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamB.id, staffId: teacherB.staffId });
  sessionId = (await att.getUsableSessions(db, school.id))[0]!.id;

  for (let i = 0; i < 4; i++) {
    const k = ++n;
    // Student 0 has two guardians: the second one does not receive notifications.
    const guardians = i === 0 ? [guardianFor(k), { fullName: "Silent Father", phone: `0755${String(k).padStart(6, "0")}`, relationship: "FATHER", receivesNotifications: "false" }] : [guardianFor(k)];
    const s = await students.createStudent(registrar, studentInput(k, { classId: setup.cls.id, streamId: streamA.id, guardians }));
    kids.push({ id: s.id, name: `First${k} Last${k}` });
  }
  // One student in stream B (teacher A has no access there).
  await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamB.id }));
});

describe("sessions & settings", () => {
  it("defaults to one whole-day session per day and refuses per-session mode without sessions", async () => {
    const s = await att.getAttendanceSettings(db, school.id);
    expect(s.mode).toBe("DAILY");
    const usable = await att.getUsableSessions(db, school.id);
    expect(usable.map((x) => x.code)).toEqual(["DAY"]);
    expect(await code(att.updateAttendanceSettings(admin, { mode: "PER_SESSION", lowThresholdPct: 85 }))).toBe("VALIDATION");
    expect(await code(att.updateAttendanceSettings(teacherA, { mode: "DAILY", lowThresholdPct: 85 }))).toBe("FORBIDDEN");
  });
});

describe("taking attendance", () => {
  it("saves a draft, then refuses to finalise until every student is marked", async () => {
    await freshRegister();
    const draft = await submit(teacherA, [[0, "PRESENT"], [1, "ABSENT"]]);
    expect(draft).toMatchObject({ outcome: "APPLIED", registerStatus: "DRAFT", replay: false });
    expect(await code(submit(teacherA, [[0, "PRESENT"]], { kind: "FINALISE" }))).toBe("VALIDATION"); // 2 and 3 unmarked
    // Draft is editable by the same teacher; the second save changes student 1 only.
    await submit(teacherA, [[1, "LATE"]]);
    const rows = await db.studentAttendance.findMany({ where: { registerId: draft.registerId! } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.studentId === kids[1]!.id)?.status).toBe("LATE");
    const done = await submit(teacherA, [[2, "PRESENT"], [3, "ABSENT"]], { kind: "FINALISE" });
    expect(done).toMatchObject({ outcome: "APPLIED", registerStatus: "FINALISED" });
    expect(await db.studentAttendance.count({ where: { registerId: draft.registerId! } })).toBe(4);
  });

  it("rejects unassigned teachers, non-takers, future dates, unknown students and wrong sessions — and records nothing", async () => {
    await freshRegister();
    expect(await code(submit(teacherB, [[0, "PRESENT"]]))).toBe("FORBIDDEN"); // assigned to stream B only
    expect(await code(submit(accountant, [[0, "PRESENT"]]))).toBe("FORBIDDEN");
    expect(await code(submit(teacherA, [[0, "PRESENT"]], { date: "2999-01-01" }))).toBe("VALIDATION");
    expect(await code(att.submitAttendance(teacherA, { clientOpId: randomUUID(), kind: "SAVE_DRAFT", ...sheetInput(), entries: [{ studentId: randomUUID(), status: "PRESENT" }] }))).toBe("VALIDATION");
    expect(await code(submit(teacherA, [[0, "PRESENT"]], { sessionId: randomUUID() }))).toBe("VALIDATION");
    expect(await db.attendanceOperation.count({ where: { schoolId: school.id } })).toBe(0);
    expect(await db.studentAttendance.count({ where: { schoolId: school.id } })).toBe(0);
    // The registrar holds attendance.take_any and may record for any class.
    expect((await submit(registrar, [[0, "PRESENT"]])).outcome).toBe("APPLIED");
  });

  it("is idempotent: replaying an operation id (even concurrently) never duplicates records", async () => {
    await freshRegister();
    const op = { clientOpId: randomUUID(), kind: "FINALISE", ...sheetInput(), entries: kids.map((k) => ({ studentId: k.id, status: "PRESENT" })) };
    const results = await Promise.all(Array.from({ length: 6 }, () => att.submitAttendance(teacherA, op)));
    expect(results.filter((r) => !r.replay)).toHaveLength(1);
    expect(results.every((r) => r.outcome === "APPLIED" && r.registerStatus === "FINALISED")).toBe(true);
    expect(await db.studentAttendance.count({ where: { schoolId: school.id } })).toBe(4);
    expect(await db.attendanceRegister.count({ where: { schoolId: school.id } })).toBe(1);
    expect(await db.attendanceOperation.count({ where: { schoolId: school.id, clientOpId: op.clientOpId } })).toBe(1);
    // A later replay returns the stored outcome and changes nothing.
    const again = await att.submitAttendance(teacherA, op);
    expect(again).toMatchObject({ replay: true, outcome: "APPLIED" });
  });

  it("scopes operation ids per user: another user reusing the id is a separate operation", async () => {
    await freshRegister();
    const id = randomUUID();
    const a = await submit(teacherA, [[0, "PRESENT"]], { clientOpId: id });
    const b = await submit(registrar, [[0, "PRESENT"]], { clientOpId: id });
    expect(a.replay).toBe(false);
    expect(b.replay).toBe(false); // not a replay of teacher A's operation
  });

  it("enforces one status per student, session and day in the database itself", async () => {
    await freshRegister();
    const r = await submit(teacherA, [[0, "PRESENT"]]);
    await expect(
      db.studentAttendance.create({
        data: { schoolId: school.id, registerId: r.registerId!, studentId: kids[0]!.id, classId: setup.cls.id, streamId: streamA.id, sessionId, date: new Date(`${setup.today}T00:00:00Z`), status: "ABSENT", markedById: teacherA.userId },
      }),
    ).rejects.toThrow();
  });
});

describe("conflicts and the keep-first-finalised policy", () => {
  it("never overwrites a finalised register: a different later submission is flagged, an identical one is a no-op", async () => {
    await freshRegister();
    const first = await submit(teacherA, allPresent(), { kind: "FINALISE" });
    expect(first.registerStatus).toBe("FINALISED");
    const dup = await submit(headTeacher, allPresent(), { kind: "FINALISE" });
    expect(dup).toMatchObject({ outcome: "APPLIED", code: "NOOP_ALREADY_FINALISED" });
    const late = await submit(headTeacher, [[1, "ABSENT"]], { kind: "FINALISE" });
    expect(late).toMatchObject({ outcome: "CONFLICT", code: "ALREADY_FINALISED" });
    const rec = await db.studentAttendance.findFirstOrThrow({ where: { studentId: kids[1]!.id } });
    expect(rec.status).toBe("PRESENT"); // first finalised record kept
    const op = await db.attendanceOperation.findFirstOrThrow({ where: { schoolId: school.id, outcome: "CONFLICT" } });
    expect(op.resolution).toBe("PENDING");
  });

  it("serialises two different operations finalising the same register at once: exactly one wins, the other is flagged", async () => {
    await freshRegister();
    const [a, b] = await Promise.all([
      submit(teacherA, allPresent("PRESENT"), { kind: "FINALISE" }),
      submit(headTeacher, allPresent("ABSENT"), { kind: "FINALISE" }),
    ]);
    expect([a.outcome, b.outcome].sort()).toEqual(["APPLIED", "CONFLICT"]);
    expect(await db.attendanceRegister.count({ where: { schoolId: school.id } })).toBe(1);
    expect(await db.studentAttendance.count({ where: { schoolId: school.id } })).toBe(4);
    const winner = a.outcome === "APPLIED" ? "PRESENT" : "ABSENT";
    expect((await db.studentAttendance.findMany({ where: { schoolId: school.id } })).every((r) => r.status === winner)).toBe(true);
  });

  it("flags another user's different submission against an open draft, but lets the same user keep editing", async () => {
    await freshRegister();
    await submit(teacherA, [[0, "PRESENT"], [1, "ABSENT"]]);
    expect(await submit(teacherA, [[1, "PRESENT"]])).toMatchObject({ outcome: "APPLIED" });
    const other = await submit(headTeacher, [[1, "LATE"]]);
    expect(other).toMatchObject({ outcome: "CONFLICT", code: "OTHER_USER_DRAFT" });
    expect((await db.studentAttendance.findFirstOrThrow({ where: { studentId: kids[1]!.id } })).status).toBe("PRESENT");
  });

  it("lets only attendance.correct holders resolve conflicts; accepting applies audited corrections", async () => {
    await freshRegister();
    await submit(teacherA, allPresent(), { kind: "FINALISE" });
    await submit(headTeacher, [[1, "ABSENT"], [2, "EXCUSED"]], { kind: "FINALISE" });
    const op = await db.attendanceOperation.findFirstOrThrow({ where: { schoolId: school.id, outcome: "CONFLICT" } });
    expect(await code(att.resolveConflict(teacherA, { operationId: op.id, action: "ACCEPT", reason: "I think I was right" }))).toBe("FORBIDDEN");
    expect(await code(att.resolveConflict(headTeacher, { operationId: op.id, action: "ACCEPT", reason: "" }))).toBe("VALIDATION");
    const listed = await att.listConflicts(headTeacher);
    expect(listed[0]!.differences).toHaveLength(2);
    await att.resolveConflict(headTeacher, { operationId: op.id, action: "ACCEPT", reason: "Teacher confirmed on the phone" });
    const statuses = Object.fromEntries((await db.studentAttendance.findMany({ where: { schoolId: school.id } })).map((r) => [r.studentId, r.status]));
    expect(statuses[kids[1]!.id]).toBe("ABSENT");
    expect(statuses[kids[2]!.id]).toBe("EXCUSED");
    expect(await db.attendanceCorrection.count({ where: { schoolId: school.id, operationId: op.id } })).toBe(2);
    expect(await code(att.resolveConflict(headTeacher, { operationId: op.id, action: "DISMISS", reason: "again" }))).toBe("CONFLICT"); // already resolved
    expect(await att.countPendingConflicts(headTeacher)).toBe(0);
  });

  it("dismissing keeps the server version", async () => {
    await freshRegister();
    await submit(teacherA, allPresent(), { kind: "FINALISE" });
    await submit(headTeacher, [[3, "ABSENT"]], { kind: "FINALISE" });
    const op = await db.attendanceOperation.findFirstOrThrow({ where: { schoolId: school.id, outcome: "CONFLICT" } });
    await att.resolveConflict(headTeacher, { operationId: op.id, action: "DISMISS", reason: "Keep original" });
    expect((await db.studentAttendance.findFirstOrThrow({ where: { studentId: kids[3]!.id } })).status).toBe("PRESENT");
    expect((await db.attendanceOperation.findUniqueOrThrow({ where: { id: op.id } })).resolution).toBe("DISMISSED");
  });
});

describe("corrections", () => {
  it("require attendance.correct, a reason and a finalised register; every correction is recorded", async () => {
    await freshRegister();
    const draft = await submit(teacherA, [[0, "PRESENT"]]);
    const rec = await db.studentAttendance.findFirstOrThrow({ where: { registerId: draft.registerId! } });
    expect(await code(att.correctAttendance(headTeacher, { attendanceId: rec.id, status: "ABSENT", reason: "Typo fix" }))).toBe("CONFLICT"); // still a draft
    await submit(teacherA, [[1, "PRESENT"], [2, "PRESENT"], [3, "PRESENT"]], { kind: "FINALISE" });

    // Unauthorised: the class teacher who took the attendance, the registrar and an unrelated teacher.
    for (const who of [teacherA, teacherB, registrar]) {
      expect(await code(att.correctAttendance(who, { attendanceId: rec.id, status: "ABSENT", reason: "Changed my mind" }))).toBe("FORBIDDEN");
    }
    expect(await code(att.correctAttendance(headTeacher, { attendanceId: rec.id, status: "ABSENT", reason: " " }))).toBe("VALIDATION");
    expect(await code(att.correctAttendance(headTeacher, { attendanceId: rec.id, status: "PRESENT", reason: "No change" }))).toBe("CONFLICT");
    expect(await code(att.correctAttendance(headTeacher, { attendanceId: randomUUID(), status: "ABSENT", reason: "Unknown record" }))).toBe("NOT_FOUND");
    expect((await db.studentAttendance.findUniqueOrThrow({ where: { id: rec.id } })).status).toBe("PRESENT");

    await att.correctAttendance(headTeacher, { attendanceId: rec.id, status: "ABSENT", reason: "Parent called: child was not at school" });
    const corrections = await db.attendanceCorrection.findMany({ where: { attendanceId: rec.id } });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ fromStatus: "PRESENT", toStatus: "ABSENT", correctedById: headTeacher.userId });
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "attendance.correct", entityId: rec.id } })).toBe(1);
    // The corrections table is append-only at database level.
    await expect(db.attendanceCorrection.update({ where: { id: corrections[0]!.id }, data: { reason: "rewritten" } })).rejects.toThrow();
    await expect(db.attendanceCorrection.delete({ where: { id: corrections[0]!.id } })).rejects.toThrow();
  });
});

describe("absence notification events", () => {
  it("creates exactly one event per notifying guardian and never duplicates on replay, re-finalise or corrections", async () => {
    await freshRegister();
    const op = { clientOpId: randomUUID(), kind: "FINALISE", ...sheetInput(), entries: kids.map((k, i) => ({ studentId: k.id, status: i === 0 ? "ABSENT" : "PRESENT" })) };
    await att.submitAttendance(teacherA, op);
    await att.submitAttendance(teacherA, op); // replay
    await submit(headTeacher, kids.map((k, i) => [i, i === 0 ? "ABSENT" : "PRESENT"] as [number, string]), { kind: "FINALISE" }); // identical re-finalise
    let events = await db.notificationEvent.findMany({ where: { schoolId: school.id } });
    // Student 0 has two guardians, only one of which receives notifications.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "ABSENCE", studentId: kids[0]!.id });
    expect(["PENDING", "PROCESSED"]).toContain(events[0]!.status); // processing runs right after finalisation
    expect((events[0]!.payload as { studentName: string }).studentName).toBe(kids[0]!.name);

    // Correcting present → absent creates one more; flipping back and forth never duplicates.
    const rec1 = await db.studentAttendance.findFirstOrThrow({ where: { studentId: kids[1]!.id } });
    await att.correctAttendance(headTeacher, { attendanceId: rec1.id, status: "ABSENT", reason: "Absent after roll call" });
    expect(await db.notificationEvent.count({ where: { attendanceId: rec1.id } })).toBe(1);
    // Simulate "not processed yet": a pending event is cancelled when the absence is corrected away…
    await db.notificationEvent.updateMany({ where: { attendanceId: rec1.id }, data: { status: "PENDING" } });
    await att.correctAttendance(headTeacher, { attendanceId: rec1.id, status: "PRESENT", reason: "Arrived late, mistake" });
    expect((await db.notificationEvent.findMany({ where: { attendanceId: rec1.id } })).map((e) => e.status)).toEqual(["CANCELLED"]);
    // …and revived (not duplicated) if the student is marked absent again.
    await att.correctAttendance(headTeacher, { attendanceId: rec1.id, status: "ABSENT", reason: "Confirmed absent" });
    events = await db.notificationEvent.findMany({ where: { attendanceId: rec1.id } });
    expect(events).toHaveLength(1);
    expect(["PENDING", "PROCESSED"]).toContain(events[0]!.status);
  });

  it("processes events through the outbox without claiming SMS delivery, and stores one in-app item per portal user", async () => {
    await freshRegister();
    // Give student 0's notifying guardian a portal account.
    const link = await db.studentGuardian.findFirstOrThrow({ where: { studentId: kids[0]!.id, receivesNotifications: true } });
    const portal = await db.user.create({ data: { schoolId: school.id, type: "GUARDIAN", fullName: "Portal Parent", email: `p-${randomUUID().slice(0, 8)}@test.example`, passwordHash: "x", mustChangePassword: false } });
    await db.guardian.update({ where: { id: link.guardianId }, data: { userId: portal.id } });

    await submit(teacherA, kids.map((k, i) => [i, i < 2 ? "ABSENT" : "PRESENT"] as [number, string]), { kind: "FINALISE" });
    // finalise already triggered a best-effort run; run again to prove it is idempotent
    const r1 = await processPendingEvents({ schoolId: school.id });
    const r2 = await processPendingEvents({ schoolId: school.id });
    expect(r2.claimed).toBe(0);
    expect(r1.failed).toBe(0);
    const events = await db.notificationEvent.findMany({ where: { schoolId: school.id }, include: { deliveries: true } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.status === "PROCESSED")).toBe(true);
    for (const e of events) {
      const sms = e.deliveries.find((d) => d.channel === "SMS")!;
      expect(sms.status).toBe("SKIPPED"); // no provider configured → never "sent" or "delivered"
      expect(e.deliveries.some((d) => d.status === "DELIVERED")).toBe(false);
    }
    expect(await db.inAppNotification.count({ where: { schoolId: school.id, userId: portal.id } })).toBe(1);
    expect((await db.notificationDelivery.findFirstOrThrow({ where: { channel: "IN_APP", status: "STORED" } })).status).toBe("STORED");
  });

  it("reports an SMS as SUBMITTED (not delivered) only when a configured adapter accepts it, and retries failures later", async () => {
    await freshRegister();
    const sent: string[] = [];
    let fail = true;
    const adapter: SmsAdapter = {
      name: "test",
      isConfigured: () => true,
      async send(req) {
        if (fail) return { status: "FAILED", error: "gateway down", retryable: true };
        sent.push(req.reference);
        return { status: "SUBMITTED", providerRef: "prov-1" };
      },
    };
    setSmsAdapter(adapter);
    try {
      await submit(teacherA, kids.map((k, i) => [i, i === 2 ? "ABSENT" : "PRESENT"] as [number, string]), { kind: "FINALISE" });
      let ev = await db.notificationEvent.findFirstOrThrow({ where: { schoolId: school.id }, include: { deliveries: true } });
      expect(ev.status).toBe("PENDING"); // retry scheduled
      expect(ev.deliveries.find((d) => d.channel === "SMS")?.status).toBe("FAILED");
      await db.notificationEvent.update({ where: { id: ev.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      fail = false;
      await processPendingEvents({ schoolId: school.id });
      ev = await db.notificationEvent.findFirstOrThrow({ where: { id: ev.id }, include: { deliveries: true } });
      expect(ev.status).toBe("PROCESSED");
      expect(ev.deliveries.find((d) => d.channel === "SMS")).toMatchObject({ status: "SUBMITTED", providerRef: "prov-1" });
      expect(sent).toEqual([ev.id]); // exactly one accepted send
    } finally {
      setSmsAdapter(null);
    }
  });
});

describe("class lists by date", () => {
  it("includes a student only on dates inside their enrolment [startedOn, endedOn)", async () => {
    const sheet = await att.getAttendanceSheet(teacherA, sheetInput());
    expect(sheet.students).toHaveLength(4);
    expect(sheet.canTake).toBe(true);
    // Move one student's enrolment to start tomorrow-ish in the past boundary: yesterday's list excludes them.
    const yesterday = new Date(Date.parse(`${setup.today}T00:00:00Z`) - 86_400_000);
    const y = yesterday.toISOString().slice(0, 10);
    const old = await att.getAttendanceSheet(teacherA, sheetInput({ date: y }));
    expect(old.students).toHaveLength(0); // everyone enrolled today
    await db.studentEnrollment.updateMany({ where: { studentId: kids[3]!.id }, data: { startedOn: new Date(`${setup.yearNo}-01-10T00:00:00Z`), endedOn: new Date(`${y}T00:00:00Z`), status: "MOVED" } });
    expect((await att.getAttendanceSheet(teacherA, sheetInput({ date: y }))).students).toHaveLength(0); // ended on y: not on the list on y (half-open)
    const dayBefore = new Date(yesterday.getTime() - 86_400_000).toISOString().slice(0, 10);
    expect((await att.getAttendanceSheet(teacherA, sheetInput({ date: dayBefore }))).students.map((s) => s.id)).toEqual([kids[3]!.id]);
    await db.studentEnrollment.updateMany({ where: { studentId: kids[3]!.id }, data: { startedOn: new Date(`${setup.today}T00:00:00Z`), endedOn: null, status: "ACTIVE" } }); // restore
    expect(await code(att.getAttendanceSheet(teacherB, sheetInput()))).toBe("FORBIDDEN");
  });
});

describe("reports", () => {
  it("count finalised registers only, honour the late/excused policy and the configurable threshold", async () => {
    await freshRegister();
    // Draft only: nothing to report.
    await submit(teacherA, allPresent("ABSENT"));
    const range = { from: setup.today, to: setup.today };
    let rep = await reports.classReport(teacherA, { classId: setup.cls.id, streamId: streamA.id, ...range });
    expect(rep.rows).toHaveLength(0);
    await submit(teacherA, [[0, "PRESENT"], [1, "ABSENT"], [2, "LATE"], [3, "EXCUSED"]], { kind: "FINALISE" });
    rep = await reports.classReport(teacherA, { classId: setup.cls.id, streamId: streamA.id, ...range });
    const rate = Object.fromEntries(rep.rows.map((r) => [r.studentId, r.rate]));
    expect(rate[kids[0]!.id]).toBe(100);
    expect(rate[kids[1]!.id]).toBe(0);
    expect(rate[kids[2]!.id]).toBe(100); // late counts as present by default
    expect(rate[kids[3]!.id]).toBe(0); // excused does not (default)
    expect(rep.rows.filter((r) => r.low).map((r) => r.studentId).sort()).toEqual([kids[1]!.id, kids[3]!.id].sort());
    await att.updateAttendanceSettings(admin, { mode: "DAILY", lowThresholdPct: 50, lateCountsAsPresent: "false", excusedCountsAsPresent: "on" });
    rep = await reports.classReport(teacherA, { classId: setup.cls.id, streamId: streamA.id, ...range });
    const r2 = Object.fromEntries(rep.rows.map((r) => [r.studentId, r.rate]));
    expect(r2[kids[2]!.id]).toBe(0);
    expect(r2[kids[3]!.id]).toBe(100);
    expect(rep.thresholdPct).toBe(50);
    expect(await code(reports.classReport(teacherB, { classId: setup.cls.id, streamId: streamA.id, ...range }))).toBe("FORBIDDEN");
    const school_ = await reports.schoolReport(headTeacher, range);
    expect(school_.classes[0]!.students).toBe(4);
    const term = await reports.termReport(headTeacher, setup.term.id);
    expect(term.totals.ABSENT).toBe(1);
    expect(await code(reports.schoolReport(accountant, range))).toBe("FORBIDDEN");
    const student = await reports.studentReport(teacherA, kids[1]!.id, range);
    expect(student.records).toHaveLength(1);
    expect(await code(reports.studentReport(teacherB, kids[1]!.id, range))).toBe("NOT_FOUND");
    await att.updateAttendanceSettings(admin, { mode: "DAILY", lowThresholdPct: 85, lateCountsAsPresent: "on", excusedCountsAsPresent: "false" });
  });
});

describe("registers overview and staff attendance", () => {
  it("shows completion per class and scopes teachers to their own", async () => {
    await freshRegister();
    await submit(teacherA, allPresent(), { kind: "FINALISE" });
    const all = await att.registerOverview(headTeacher, setup.today);
    const a = all.rows.find((r) => r.streamId === streamA.id)!;
    const b = all.rows.find((r) => r.streamId === streamB.id)!;
    expect(a.cells[0]!.status).toBe("FINALISED");
    expect(b.cells[0]!.status).toBe("NOT_STARTED");
    expect(a.studentCount).toBe(4);
    const mine = await att.registerOverview(teacherA, setup.today);
    expect(mine.rows.map((r) => r.streamId)).toEqual([streamA.id]);
    expect(mine.rows[0]!.canTake).toBe(true);
    expect(headTeacher.permissions.has("attendance.take_any")).toBe(true);
  });

  it("records staff attendance with audit and permission checks", async () => {
    expect(await code(att.recordStaffAttendance(teacherA, { date: setup.today, entries: [{ staffId: teacherB.staffId, status: "PRESENT" }] }))).toBe("FORBIDDEN");
    await att.recordStaffAttendance(registrar, { date: setup.today, entries: [{ staffId: teacherA.staffId, status: "PRESENT" }, { staffId: teacherB.staffId, status: "ABSENT", note: "sick" }] });
    await att.recordStaffAttendance(registrar, { date: setup.today, entries: [{ staffId: teacherB.staffId, status: "EXCUSED" }] });
    const list = await att.listStaffAttendance(registrar, setup.today);
    expect(list.find((s) => s.staffId === teacherB.staffId)?.status).toBe("EXCUSED");
    expect(await db.staffAttendance.count({ where: { schoolId: school.id, date: new Date(`${setup.today}T00:00:00Z`) } })).toBe(2);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "staff_attendance.record" } })).toBe(2);
    expect(await code(att.recordStaffAttendance(registrar, { date: "2999-01-01", entries: [{ staffId: teacherA.staffId, status: "PRESENT" }] }))).toBe("VALIDATION");
  });
});

describe("per-session mode", () => {
  it("records each configured session separately and rejects the whole-day session", async () => {
    await att.createAttendanceSession(admin, { code: "am", name: "Morning" });
    await att.createAttendanceSession(admin, { code: "pm", name: "Afternoon" });
    expect(await code(att.createAttendanceSession(admin, { code: "AM", name: "Dup" }))).toBe("VALIDATION");
    await att.updateAttendanceSettings(admin, { mode: "PER_SESSION", lowThresholdPct: 85, lateCountsAsPresent: "on" });
    const sessions = await att.getUsableSessions(db, school.id);
    expect(sessions.map((s) => s.code)).toEqual(["AM", "PM"]);
    await freshRegister();
    expect(await code(submit(teacherA, [[0, "PRESENT"]]))).toBe("VALIDATION"); // DAY session not usable in this mode
    const am = await submit(teacherA, allPresent(), { kind: "FINALISE", sessionId: sessions[0]!.id });
    const pm = await submit(teacherA, allPresent("ABSENT"), { kind: "FINALISE", sessionId: sessions[1]!.id });
    expect(am.registerId).not.toBe(pm.registerId);
    expect(await db.studentAttendance.count({ where: { schoolId: school.id } })).toBe(8);
    await att.updateAttendanceSettings(admin, { mode: "DAILY", lowThresholdPct: 85, lateCountsAsPresent: "on" });
    expect(await code(att.setAttendanceSessionActive(admin, sessions[0]!.id, false))).toBe(null); // fine in daily mode
  });
});

describe("tenant isolation", () => {
  it("cannot read or correct another school's attendance", async () => {
    const other = await createTestSchool("Other School");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const rec = await db.studentAttendance.findFirst({ where: { schoolId: school.id } });
    expect(rec).not.toBeNull();
    expect(await code(att.correctAttendance(otherAdmin, { attendanceId: rec!.id, status: "ABSENT", reason: "cross-school attempt" }))).toBe("NOT_FOUND");
    expect(await code(att.getAttendanceSheet(otherAdmin, sheetInput()))).not.toBe(null);
    expect(await att.listConflicts(otherAdmin)).toEqual([]);
    expect(AppError).toBeDefined();
  });
});
