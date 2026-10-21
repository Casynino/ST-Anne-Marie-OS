import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { setSmsAdapter, type SmsAdapter, type SmsSendRequest } from "@/lib/sms/adapter";
import { signBody } from "@/lib/payments/providers";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as fees from "@/server/fees";
import * as invoices from "@/server/invoices";
import * as payments from "@/server/payments";
import * as comm from "@/server/communication";
import * as notifications from "@/server/notifications";
import * as portal from "@/server/portal";
import * as msg from "@/server/messaging";
import { processSmsReport } from "@/server/sms-reports";
import { calendarFor } from "@/server/calendar";
import { letterDocument, letterPdf } from "@/server/letter";
import { createCurrentYearAcademics, createTestSchool, createTestUser, guardianFor, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, accountant: AuthContext, registrar: AuthContext, teacherA: AuthContext, teacherB: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let streamA: { id: string }, streamB: { id: string };
let kids: { id: string; admissionNo: string }[] = [];
let guardianUser: AuthContext[] = [];
let n = 400000 + Math.floor(Math.random() * 5_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const sent: SmsSendRequest[] = [];
const fakeSms: SmsAdapter = { name: "fake", isConfigured: () => true, send: async (r) => { sent.push(r); return { status: "SUBMITTED", providerRef: `ref-${r.reference}` }; } };

const evs = (broadcastId: string) => db.notificationEvent.findMany({ where: { broadcastId }, include: { deliveries: true } });
const del = (e: { deliveries: { channel: string; status: string }[] }, channel: string) => e.deliveries.find((d) => d.channel === channel)?.status;

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  teacherA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  teacherB = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!; streamB = setup.streams[1]!;
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id, staffId: teacherA.staffId });
  // kids 0,1 in stream A; kid 2 in stream B (no class teacher); kids 3,4 share ONE guardian (siblings); kid 5 has a guardian who opted out of notifications.
  for (let i = 0; i < 3; i++) kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: i < 2 ? streamA.id : streamB.id })));
  const sib = guardianFor(++n);
  kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id, guardians: [sib] })));
  const sibLink = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kids[3]!.id } } } });
  kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id, guardians: [{ guardianId: sibLink.id, relationship: "MOTHER", isPrimary: "on" }] })));
  kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id, guardians: [{ ...guardianFor(++n), receivesNotifications: "false" }] })));
  // Portal accounts for the parents of kids 0, 1 and 2.
  for (const i of [0, 1, 2]) {
    const g = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kids[i]!.id } } } });
    await portal.createGuardianAccount(registrar, g.id);
    guardianUser.push(await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g.id } })).userId!));
  }
  await db.user.update({ where: { id: guardianUser[1]!.userId }, data: { locale: "SW" } });
});
afterAll(() => setSmsAdapter(null));

describe("broadcast permissions and validation", () => {
  const base = { kind: "ANNOUNCEMENT", title: "Parents meeting", bodyEn: "Dear parent of {student}, there is a meeting on Friday.", audience: { type: "ALL" } };
  it("teachers cannot broadcast; announcements need comms.send, fee reminders comms.fee_reminder", async () => {
    expect(await code(comm.previewBroadcast(teacherA, base))).toBe("FORBIDDEN");
    expect(await code(comm.createBroadcast(teacherA, base))).toBe("FORBIDDEN");
    expect(await code(comm.createBroadcast(accountant, base))).toBe("FORBIDDEN");
    expect(await code(comm.createBroadcast(registrar, { ...base, kind: "FEE_REMINDER", audience: { type: "ARREARS" }, bodyEn: "Owed {amount}" }))).toBe("FORBIDDEN");
  });
  it("rejects unknown variables, missing {amount}, long texts, past times, no channel and mismatched audiences", async () => {
    expect(await code(comm.previewBroadcast(head, { ...base, bodyEn: "Hello {nobody}" }))).toBe("VALIDATION");
    expect(await code(comm.previewBroadcast(head, { ...base, bodyEn: "x".repeat(641) }))).toBe("VALIDATION");
    expect(await code(comm.previewBroadcast(head, { ...base, title: "" }))).toBe("VALIDATION");
    expect(await code(comm.previewBroadcast(head, { ...base, sendAt: new Date(Date.now() - 3_600_000).toISOString() }))).toBe("VALIDATION");
    expect(await code(comm.previewBroadcast(head, { ...base, sendSms: false, sendInApp: false }))).toBe("VALIDATION");
    expect(await code(comm.previewBroadcast(head, { ...base, audience: { type: "ARREARS" } }))).toBe("VALIDATION"); // an announcement is not a fee reminder
    expect(await code(comm.previewBroadcast(head, { kind: "FEE_REMINDER", title: "Fees", bodyEn: "Please pay", audience: { type: "ARREARS" } }))).toBe("VALIDATION"); // no {amount}
    expect(await code(comm.previewBroadcast(head, { kind: "FEE_REMINDER", title: "Fees", bodyEn: "Owed {amount}", audience: { type: "ALL" } }))).toBe("VALIDATION");
    expect(await code(comm.previewBroadcast(head, { ...base, audience: { type: "CLASS", classIds: [randomUUID()] } }))).toBe("NOT_FOUND");
  });
});

describe("audiences", () => {
  it("a notice reaches each guardian once, honours notification preferences and skips students who are not enrolled", async () => {
    const r = await comm.resolveRecipients(db, school.id, "ANNOUNCEMENT", { type: "ALL" });
    const byStudent = new Set(r.map((x) => x.studentId));
    expect(r.filter((x) => [kids[3]!.id, kids[4]!.id].includes(x.studentId))).toHaveLength(1); // siblings share one guardian: one message
    expect(byStudent.has(kids[5]!.id)).toBe(false); // that guardian switched notifications off
    expect(byStudent.has(kids[0]!.id) && byStudent.has(kids[1]!.id) && byStudent.has(kids[2]!.id)).toBe(true);
    await db.student.update({ where: { id: kids[1]!.id }, data: { status: "WITHDRAWN" } });
    expect((await comm.resolveRecipients(db, school.id, "ANNOUNCEMENT", { type: "ALL" })).some((x) => x.studentId === kids[1]!.id)).toBe(false);
    await db.student.update({ where: { id: kids[1]!.id }, data: { status: "ENROLLED" } });
  });
  it("filters by class and stream", async () => {
    const a = await comm.resolveRecipients(db, school.id, "ANNOUNCEMENT", { type: "CLASS", classIds: [setup.cls.id], streamId: streamB.id });
    expect(a.map((x) => x.studentId)).toEqual([kids[2]!.id]);
    expect(await code(comm.resolveRecipients(db, school.id, "ANNOUNCEMENT", { type: "CLASS", classIds: [setup.cls.id], streamId: randomUUID() }))).toBe("VALIDATION");
    expect((await comm.resolveRecipients(db, school.id, "ANNOUNCEMENT", { type: "LEVEL", levelId: setup.level.id })).length).toBeGreaterThan(3);
  });
});

describe("sending announcements", () => {
  it("queues one event per recipient and, with no SMS provider, records SMS as skipped (never sent) while in-app is stored", async () => {
    setSmsAdapter(null);
    const b = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "Parents meeting", bodyEn: "Dear parent of {student}: meeting on Friday at {school}.", bodySw: "Mzazi wa {student}: mkutano Ijumaa {school}.", audience: { type: "ALL" } });
    expect(b.recipientCount).toBeGreaterThan(3);
    await notifications.processPendingEvents({ schoolId: school.id, limit: 200 });
    const rows = await evs(b.id);
    expect(rows.every((e) => e.status === "PROCESSED")).toBe(true);
    expect(rows.every((e) => del(e, "SMS") === "SKIPPED")).toBe(true);
    const mine = rows.find((e) => e.studentId === kids[0]!.id)!;
    expect(del(mine, "IN_APP")).toBe("STORED");
    expect(rows.find((e) => e.studentId === kids[3]!.id)!.deliveries.find((d) => d.channel === "IN_APP")!.status).toBe("SKIPPED"); // no portal account
    const note = await db.inAppNotification.findFirstOrThrow({ where: { userId: guardianUser[0]!.userId, eventId: mine.id } });
    expect(note.body).toContain(`${await studentName(kids[0]!.id)}`);
    expect(note.body).toContain(school.name);
    const sw = await db.inAppNotification.findFirstOrThrow({ where: { userId: guardianUser[1]!.userId, title: "Parents meeting" } });
    expect(sw.body.startsWith("Mzazi wa")).toBe(true); // this parent uses Swahili
    expect(await notifications.processPendingEvents({ schoolId: school.id })).toMatchObject({ claimed: 0 }); // nothing is processed twice
  });

  it("with a provider, SMS is only SUBMITTED, in each parent's language, and respects opt-outs", async () => {
    sent.length = 0;
    setSmsAdapter(fakeSms);
    await comm.setMyPreference(guardianUser[0]!, { category: "ANNOUNCEMENTS", smsEnabled: false, inAppEnabled: true });
    const b = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "Sports day", bodyEn: "Sports day for {student}.", bodySw: "Siku ya michezo kwa {student}.", audience: { type: "CLASS", classIds: [setup.cls.id], streamId: streamA.id } });
    await notifications.processPendingEvents({ schoolId: school.id, limit: 200 });
    const rows = await evs(b.id);
    const optedOut = rows.find((e) => e.studentId === kids[0]!.id)!;
    expect(del(optedOut, "SMS")).toBe("SKIPPED");
    expect(optedOut.deliveries.find((d) => d.channel === "SMS")!.detail).toMatch(/opted out/i);
    const swEvent = rows.find((e) => e.studentId === kids[1]!.id)!;
    expect(del(swEvent, "SMS")).toBe("SUBMITTED"); // submitted, not delivered
    expect(sent.find((s) => s.reference === swEvent.id)!.body.startsWith("Siku ya michezo")).toBe(true);
    const plain = rows.find((e) => e.studentId === kids[3]!.id)!; // no portal account: language falls back to the school default
    expect(del(plain, "SMS")).toBe("SUBMITTED");
    expect(rows.some((e) => e.studentId === kids[2]!.id)).toBe(false); // stream B was not chosen
    setSmsAdapter(null);
  });

  it("in-app can be switched off for a message", async () => {
    const b = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "No in-app", bodyEn: "Hello.", sendInApp: false, audience: { type: "CLASS", classIds: [setup.cls.id], streamId: streamB.id } });
    await notifications.processPendingEvents({ schoolId: school.id });
    const e = (await evs(b.id))[0]!;
    expect(del(e, "IN_APP")).toBe("SKIPPED");
    expect(await db.inAppNotification.count({ where: { eventId: e.id } })).toBe(0);
  });

  it("a scheduled broadcast waits for its time and a cancelled one never goes out", async () => {
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const b = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "Later", bodyEn: "Later notice.", sendAt: later, audience: { type: "CLASS", classIds: [setup.cls.id], streamId: streamB.id } });
    await notifications.processPendingEvents({ schoolId: school.id });
    expect((await evs(b.id)).every((e) => e.status === "PENDING")).toBe(true);
    expect(await code(comm.cancelBroadcast(teacherA, b.id))).toBe("FORBIDDEN");
    const r = await comm.cancelBroadcast(head, b.id);
    expect(r.stopped).toBe(1);
    await db.notificationEvent.updateMany({ where: { broadcastId: b.id }, data: { nextAttemptAt: new Date() } });
    await notifications.processPendingEvents({ schoolId: school.id });
    expect((await evs(b.id)).every((e) => e.status === "CANCELLED" && e.deliveries.length === 0)).toBe(true);
    expect((await comm.getBroadcast(head, b.id)).events.cancelled).toBe(1);
  });

  it("history is readable only with comms.read", async () => {
    expect((await comm.listBroadcasts(head)).length).toBeGreaterThan(2);
    expect(await code(comm.listBroadcasts(teacherA))).toBe("FORBIDDEN");
  });
});

describe("fee reminders", () => {
  let reminder: { id: string };
  beforeAll(async () => {
    const tuition = await fees.createFeeItem(accountant, { name: "Tuition" });
    await fees.createStructure(accountant, { academicYearId: setup.year.id, name: "Fees", classId: setup.cls.id, lines: [{ feeItemId: tuition.id, amount: "100000", termSequence: null }] });
    await invoices.generateTermInvoices(accountant, { termId: setup.term.id, issueDate: `${setup.yearNo}-01-10`, dueDate: `${setup.yearNo}-02-01` });
    await payments.recordPayment(accountant, { studentId: kids[0]!.id, amount: "100000", method: "CASH" }); // paid in full
    await payments.recordPayment(accountant, { studentId: kids[1]!.id, amount: "40000", method: "CASH" }); // 60,000 overdue
  });

  it("goes to the parents of students who are overdue, once per child, with their own amount", async () => {
    const body = { kind: "FEE_REMINDER", title: "Fee reminder", bodyEn: "{student} owes {amount} since {due}. {school}", audience: { type: "ARREARS" } };
    const p = await comm.previewBroadcast(accountant, body);
    expect(p.recipients).toBeGreaterThan(0);
    expect(p.sample[0]).toMatch(/owes TZS [\d,]+ since \d{4}-\d{2}-\d{2}/);
    reminder = await comm.createBroadcast(accountant, body);
    const rows = await evs(reminder.id);
    expect(rows.some((e) => e.studentId === kids[0]!.id)).toBe(false); // paid in full
    const k1 = rows.find((e) => e.studentId === kids[1]!.id)!;
    expect((k1.payload as { vars: { amount: string } }).vars.amount).toBe("TZS 60,000");
    expect(rows.filter((e) => [kids[3]!.id, kids[4]!.id].includes(e.studentId))).toHaveLength(2); // siblings: one reminder each (different amounts)
    expect((await comm.previewBroadcast(accountant, body)).recentReminderAt).not.toBeNull(); // warns about a very recent reminder
  });

  it("the in-app copy links parents to the fees page and uses the right amount", async () => {
    await notifications.processPendingEvents({ schoolId: school.id, limit: 200 });
    const e = (await evs(reminder.id)).find((x) => x.studentId === kids[1]!.id)!;
    const n = await db.inAppNotification.findFirstOrThrow({ where: { eventId: e.id } });
    expect(n.link).toBe(`/family/${kids[1]!.id}/fees`);
    expect(n.body).toContain("TZS 60,000");
  });

  it("a minimum amount filters small balances", async () => {
    const r = await comm.resolveRecipients(db, school.id, "FEE_REMINDER", { type: "ARREARS", overdueOnly: true, minOutstanding: 7_000_000 });
    expect(r.every((x) => x.studentId !== kids[1]!.id)).toBe(true); // 60,000 TZS < 70,000 TZS
  });
});

describe("delivery reports", () => {
  const SECRET = "r".repeat(32);
  const env = { SMS_GATEWAY_WEBHOOK_SECRET: SECRET };
  const report = (body: object, o: { sign?: boolean; provider?: string; env?: Record<string, string> } = {}) => {
    const raw = JSON.stringify(body);
    return processSmsReport(o.provider ?? "gateway", raw, new Headers({ "x-signature": o.sign === false ? "00" : signBody(SECRET, raw) }), o.env ?? env);
  };
  let ref: string;
  beforeAll(async () => {
    sent.length = 0;
    setSmsAdapter(fakeSms);
    const b = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "Report test", bodyEn: "Test message.", audience: { type: "CLASS", classIds: [setup.cls.id], streamId: streamB.id } });
    await notifications.processPendingEvents({ schoolId: school.id });
    ref = (await db.notificationDelivery.findFirstOrThrow({ where: { channel: "SMS", event: { broadcastId: b.id } } })).providerRef!;
    setSmsAdapter(null);
  });
  it("refuses unknown, unconfigured and badly signed reports", async () => {
    expect((await report({ providerRef: ref, status: "DELIVERED" }, { provider: "nope" })).status).toBe(404);
    expect((await report({ providerRef: ref, status: "DELIVERED" }, { env: {} })).status).toBe(503);
    expect((await report({ providerRef: ref, status: "DELIVERED" }, { sign: false })).status).toBe(401);
    expect((await db.notificationDelivery.findFirstOrThrow({ where: { providerRef: ref } })).status).toBe("SUBMITTED");
  });
  it("a verified report confirms delivery, which can never go backwards; unknown references are ignored", async () => {
    expect(await report({ providerRef: "no-such-ref", status: "DELIVERED" })).toMatchObject({ status: 200, body: { matched: false } });
    expect(await report({ providerRef: ref, status: "DELIVERED" })).toMatchObject({ status: 200, body: { matched: true } });
    expect((await db.notificationDelivery.findFirstOrThrow({ where: { providerRef: ref } })).status).toBe("DELIVERED");
    expect(await report({ providerRef: ref, status: "FAILED" })).toMatchObject({ body: { matched: false } });
    expect((await db.notificationDelivery.findFirstOrThrow({ where: { providerRef: ref } })).status).toBe("DELIVERED");
  });
  it("a message nobody reported on becomes UNKNOWN (not delivered, not failed) and a late report still counts", async () => {
    const d = await db.notificationDelivery.findFirstOrThrow({ where: { providerRef: ref } });
    await db.$executeRaw`UPDATE notification_deliveries SET status = 'SUBMITTED', "updatedAt" = now() - interval '2 days' WHERE id = ${d.id}::uuid`;
    expect(await notifications.markStaleSubmissionsUnknown(24)).toBeGreaterThanOrEqual(1);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("UNKNOWN");
    expect(await report({ providerRef: ref, status: "UNDELIVERED", reason: "handset off" })).toMatchObject({ body: { matched: true } });
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("FAILED");
  });
});

describe("templates and results-ready notices", () => {
  it("only comms.manage edits wording, only known variables are allowed, and empty restores the default", async () => {
    expect(await code(comm.saveTemplate(teacherA, { key: "results", locale: "EN", body: "x" }))).toBe("FORBIDDEN");
    expect(await code(comm.saveTemplate(head, { key: "results", locale: "EN", body: "Hi {parent}" }))).toBe("VALIDATION");
    expect(await code(comm.saveTemplate(head, { key: "results", locale: "EN", body: "x".repeat(321) }))).toBe("VALIDATION");
    await comm.saveTemplate(head, { key: "results", locale: "EN", body: "{student}'s results for {term} are ready at {school}." });
    expect((await comm.listTemplates(head)).find((t) => t.key === "results" && t.locale === "EN")).toMatchObject({ custom: true });
    expect(await comm.resolveTemplate(db, school.id, "results", "EN")).toContain("are ready at");
  });
  it("publishing a report card queues one notice per guardian, deduped per card version, in the school's wording", async () => {
    const created = await db.$transaction((tx) => notifications.createResultsReadyEvents(tx, school.id, [{ id: randomUUID(), version: 1, studentId: kids[0]!.id, studentName: "Amina Test", termName: "Term 1, 2026" }]));
    expect(created).toBe(1);
    const card = { id: randomUUID(), version: 1, studentId: kids[1]!.id, studentName: "Baraka Test", termName: "Term 1, 2026" };
    expect(await db.$transaction((tx) => notifications.createResultsReadyEvents(tx, school.id, [card]))).toBe(1);
    expect(await db.$transaction((tx) => notifications.createResultsReadyEvents(tx, school.id, [card]))).toBe(0); // same version: no duplicate
    expect(await db.$transaction((tx) => notifications.createResultsReadyEvents(tx, school.id, [{ ...card, version: 2 }]))).toBe(1); // a regenerated card is news again
    await notifications.processPendingEvents({ schoolId: school.id, limit: 200 });
    const n = await db.inAppNotification.findFirst({ where: { userId: guardianUser[0]!.userId, body: { contains: "Amina Test" } } });
    expect(n?.body).toBe("Amina Test's results for Term 1, 2026 are ready at " + school.name + ".");
    expect(n?.link).toBe(`/family/${kids[0]!.id}`);
    await comm.saveTemplate(head, { key: "results", locale: "EN", body: "" });
    expect(await comm.resolveTemplate(db, school.id, "results", "EN")).not.toContain("are ready at");
  });
  it("preferences: each category and channel can be switched off, per user", async () => {
    await comm.setMyPreference(guardianUser[2]!, { category: "FEES", smsEnabled: false, inAppEnabled: true });
    const prefs = await comm.getMyPreferences(guardianUser[2]!);
    expect(prefs.find((p) => p.category === "FEES")).toMatchObject({ smsEnabled: false, inAppEnabled: true });
    expect(prefs.find((p) => p.category === "RESULTS")).toMatchObject({ smsEnabled: true, inAppEnabled: true });
    expect(await code(comm.setMyPreference(guardianUser[2]!, { category: "NOPE", smsEnabled: true, inAppEnabled: true }))).toBe("VALIDATION");
  });
});

describe("parent-teacher messaging", () => {
  let thread: { id: string }, office: { id: string };

  it("a parent writes about their own child to the class teacher, or to the office when there is none", async () => {
    thread = await msg.startThread(guardianUser[0]!, { studentId: kids[0]!.id, subject: "Homework", body: "Is there homework this weekend?" });
    expect((await db.messageThread.findUniqueOrThrow({ where: { id: thread.id } })).staffUserId).toBe(teacherA.userId);
    office = await msg.startThread(guardianUser[2]!, { studentId: kids[2]!.id, subject: "Transport", body: "Which bus does my child take?" });
    expect((await db.messageThread.findUniqueOrThrow({ where: { id: office.id } })).staffUserId).toBeNull();
    expect(await code(msg.startThread(guardianUser[0]!, { studentId: kids[1]!.id, subject: "Not mine", body: "x" }))).toBe("NOT_FOUND"); // someone else's child
    expect(await code(msg.startThread(guardianUser[0]!, { studentId: kids[0]!.id, subject: "", body: "x" }))).toBe("VALIDATION");
    expect(await code(msg.startThread(guardianUser[0]!, { studentId: kids[0]!.id, subject: "Long", body: "x".repeat(2001) }))).toBe("VALIDATION");
    expect(await code(msg.startThread(teacherA, { studentId: kids[0]!.id, subject: "x", body: "y" }))).toBe("FORBIDDEN"); // staff use the staff side
    expect(await db.inAppNotification.count({ where: { userId: teacherA.userId, link: `/communication/messages/${thread.id}` } })).toBe(1);
  });

  it("only the right people can open a conversation", async () => {
    expect((await msg.getStaffThread(teacherA, thread.id)).messages).toHaveLength(1);
    expect(await code(msg.getStaffThread(teacherB, thread.id))).toBe("NOT_FOUND"); // another teacher: not even visible
    expect(await code(msg.getMyThread(guardianUser[1]!, thread.id))).toBe("NOT_FOUND"); // another parent
    expect(await code(msg.getStaffThread(registrar, thread.id))).toBe("FORBIDDEN");
    expect((await msg.getStaffThread(head, thread.id)).canModerate).toBe(true);
    expect(await code(msg.listStaffThreads(teacherA, { box: "all" }))).toBe("FORBIDDEN");
    expect((await msg.listStaffThreads(teacherA, { box: "mine" })).map((t) => t.id)).toEqual([thread.id]);
    expect((await msg.listStaffThreads(head, { box: "office" })).map((t) => t.id)).toContain(office.id);
  });

  it("replies reach the other side with a notification; answering the office takes the conversation", async () => {
    await msg.replyAsStaff(teacherA, thread.id, { body: "Yes, pages 12 to 14." });
    expect(await db.inAppNotification.count({ where: { userId: guardianUser[0]!.userId, link: `/family/messages/${thread.id}` } })).toBe(1);
    expect((await msg.getMyThread(guardianUser[0]!, thread.id)).messages.map((m) => m.fromParent)).toEqual([true, false]);
    expect(await code(msg.replyAsStaff(teacherB, thread.id, { body: "I am not the teacher" }))).toBe("NOT_FOUND");
    expect(await code(msg.replyAsStaff(head, office.id, { body: "x".repeat(2001) }))).toBe("VALIDATION");
    await msg.replyAsStaff(head, office.id, { body: "Bus 4, leaves at 6:30." });
    expect((await db.messageThread.findUniqueOrThrow({ where: { id: office.id } })).staffUserId).toBe(head.userId);
  });

  it("a closed conversation takes no more messages until it is reopened", async () => {
    await msg.setThreadStatus(teacherA, thread.id, "CLOSED");
    expect(await code(msg.replyAsGuardian(guardianUser[0]!, thread.id, { body: "Thanks!" }))).toBe("CONFLICT");
    expect(await code(msg.replyAsStaff(teacherA, thread.id, { body: "x" }))).toBe("CONFLICT");
    await msg.setThreadStatus(teacherA, thread.id, "OPEN");
    await msg.replyAsGuardian(guardianUser[0]!, thread.id, { body: "Thanks!" });
  });

  it("moderation: flag, hide with a reason, hidden text is withheld from participants, nothing can be edited or deleted", async () => {
    const m = (await db.threadMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" } }));
    const fromParent = m[0]!;
    expect(await code(msg.flagMessage(guardianUser[0]!, fromParent.id, { reason: "own" }))).toBe("CONFLICT"); // not your own message
    expect(await code(msg.flagMessage(guardianUser[1]!, fromParent.id, { reason: "x" }))).toBe("NOT_FOUND"); // not a participant
    await msg.flagMessage(teacherA, fromParent.id, { reason: "Rude language" });
    expect((await msg.listStaffThreads(head, { box: "flagged" })).map((t) => t.id)).toEqual([thread.id]);
    expect(await code(msg.hideMessage(teacherA, fromParent.id, { reason: "x" }))).toBe("FORBIDDEN"); // moderation is a separate permission
    expect(await code(msg.hideMessage(head, fromParent.id, { reason: "" }))).toBe("VALIDATION");
    await msg.hideMessage(head, fromParent.id, { reason: "Abusive" });
    const forTeacher = (await msg.getStaffThread(teacherA, thread.id)).messages[0]!;
    expect(forTeacher).toMatchObject({ hidden: true, body: null, hiddenReason: null });
    expect((await msg.getMyThread(guardianUser[0]!, thread.id)).messages[0]).toMatchObject({ hidden: true, body: null });
    expect((await msg.getStaffThread(head, thread.id)).messages[0]).toMatchObject({ hidden: true, body: "Is there homework this weekend?", hiddenReason: "Abusive" });
    await expect(db.threadMessage.update({ where: { id: fromParent.id }, data: { body: "edited" } })).rejects.toThrow();
    await expect(db.threadMessage.delete({ where: { id: fromParent.id } })).rejects.toThrow();
    await msg.unhideMessage(head, fromParent.id);
    expect((await msg.getStaffThread(teacherA, thread.id)).messages[0]!.body).toBe("Is there homework this weekend?");
    await msg.flagMessage(teacherA, fromParent.id, { reason: "Again" });
    await msg.dismissFlag(head, fromParent.id);
    expect(await msg.listStaffThreads(head, { box: "flagged" })).toHaveLength(0);
  });

  it("teachers write to parents only of students they teach, and only when the parent has a portal account", async () => {
    const g0 = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kids[0]!.id } } } });
    const t = await msg.startThreadAsStaff(teacherA, { studentId: kids[0]!.id, guardianId: g0.id, subject: "Progress", body: "Your child is doing well." });
    expect(await db.inAppNotification.count({ where: { userId: guardianUser[0]!.userId, link: `/family/messages/${t.id}` } })).toBe(1);
    expect(await code(msg.startThreadAsStaff(teacherB, { studentId: kids[0]!.id, guardianId: g0.id, subject: "x", body: "y" }))).toBe("FORBIDDEN"); // not B's student
    const noAccount = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kids[3]!.id } } } });
    expect(await code(msg.startThreadAsStaff(head, { studentId: kids[3]!.id, guardianId: noAccount.id, subject: "x", body: "y" }))).toBe("CONFLICT");
    expect(await code(msg.startThreadAsStaff(head, { studentId: kids[0]!.id, guardianId: noAccount.id, subject: "x", body: "y" }))).toBe("NOT_FOUND"); // not that student's guardian
    expect(await code(msg.startThreadAsStaff(registrar, { studentId: kids[0]!.id, guardianId: g0.id, subject: "x", body: "y" }))).toBe("FORBIDDEN");
  });

  it("moderators can reassign a conversation", async () => {
    await msg.assignThread(head, office.id, teacherA.userId);
    expect((await msg.listStaffThreads(teacherA, { box: "mine" })).map((x) => x.id)).toContain(office.id);
    expect(await code(msg.assignThread(teacherA, office.id, null))).toBe("FORBIDDEN");
    expect(await code(msg.assignThread(head, office.id, guardianUser[0]!.userId))).toBe("VALIDATION"); // a parent is not staff
    await msg.assignThread(head, office.id, null);
  });

  it("sending is rate limited per user", async () => {
    const spammer = guardianUser[1]!;
    const t = await msg.startThread(spammer, { studentId: kids[1]!.id, subject: "Spam test", body: "first" });
    let limited: string | null = null;
    for (let i = 0; i < 40 && !limited; i++) limited = await code(msg.replyAsGuardian(spammer, t.id, { body: `m${i}` }));
    expect(limited).toBe("RATE_LIMITED");
  });

  it("another school sees none of it", async () => {
    const other = await createTestSchool("Other");
    const oHead = (await createTestUser(other.id, ["head_teacher"])).ctx;
    expect(await code(msg.getStaffThread(oHead, thread.id))).toBe("NOT_FOUND");
    expect((await msg.listStaffThreads(oHead, { box: "all" }))).toHaveLength(0);
    expect(await code(comm.getBroadcast(oHead, (await comm.listBroadcasts(head))[0]!.id))).toBe("NOT_FOUND");
  });
});

describe("calendar", () => {
  it("staff see internal events, parents only public ones, and term dates appear", async () => {
    await db.schoolEvent.createMany({ data: [
      { schoolId: school.id, title: "Open day", startsOn: new Date(`${setup.yearNo}-06-10`), isPublic: true, createdById: admin.userId },
      { schoolId: school.id, title: "Staff retreat", startsOn: new Date(`${setup.yearNo}-06-12`), isPublic: false, createdById: admin.userId },
    ] });
    const from = new Date(`${setup.yearNo}-01-01`), to = new Date(`${setup.yearNo}-12-31`);
    const staff = (await calendarFor(head, from, to)).map((i) => i.title);
    const parent = (await calendarFor(guardianUser[0]!, from, to)).map((i) => i.title);
    expect(staff).toEqual(expect.arrayContaining(["Open day", "Staff retreat"]));
    expect(parent).toContain("Open day");
    expect(parent).not.toContain("Staff retreat");
    expect(parent.some((t) => /starts$/.test(t))).toBe(true);
  });
});

async function studentName(id: string) {
  const s = await db.student.findUniqueOrThrow({ where: { id } });
  return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
}

describe("the printed letter", () => {
  it("uses the school's own words in the chosen language, names the audience and the sender", async () => {
    const all = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "Opening day", bodyEn: "Schools open on Monday.", bodySw: "Shule zinafunguliwa Jumatatu.", audience: { type: "ALL" } });
    const en = await letterDocument(head, all.id, "EN");
    expect(en).toMatchObject({ subject: "Opening day", body: "Schools open on Monday.", to: "All parents and guardians", signer: { name: head.fullName } });
    expect(en.reference).toMatch(/^LTR\/\d{4}\/[0-9A-F]{6}$/);
    expect((await letterDocument(head, all.id, "EN")).reference).toBe(en.reference); // stable
    const sw = await letterDocument(head, all.id, "SW");
    expect(sw).toMatchObject({ body: "Shule zinafunguliwa Jumatatu.", to: "Wazazi na Walezi wote" });
    const cls = await comm.createBroadcast(head, { kind: "ANNOUNCEMENT", title: "Class trip", bodyEn: "Trip on Friday.", audience: { type: "CLASS", classIds: [setup.cls.id] } });
    expect((await letterDocument(head, cls.id, "SW")).body).toBe("Trip on Friday."); // no Kiswahili text: the English text is used
    expect((await letterDocument(head, cls.id, "EN")).to).toContain((await db.schoolClass.findUniqueOrThrow({ where: { id: setup.cls.id }, select: { name: true } })).name);
    expect(Buffer.from(await letterPdf(head, all.id, "SW")).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("needs comms.read and never reads another school's message", async () => {
    const b = await db.broadcast.findFirstOrThrow({ where: { schoolId: school.id, title: "Opening day" } });
    expect(await code(letterDocument(teacherB, b.id, "EN"))).toBe("FORBIDDEN");
    const other = await createTestSchool();
    const otherHead = (await createTestUser(other.id, ["head_teacher"])).ctx;
    expect(await code(letterDocument(otherHead, b.id, "EN"))).toBe("NOT_FOUND");
  });
});
