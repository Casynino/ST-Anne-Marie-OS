import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as admissions from "@/server/admissions";
import * as desk from "@/server/admission-desk";
import * as documents from "@/server/documents";
import * as interviews from "@/server/interviews";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as review from "@/server/admission-review";
import * as website from "@/server/website";
import * as pub from "@/server/public-applications";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, esther: AuthContext, accountant: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let n = 52000;
const next = () => ++n;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const message = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.message ?? "";
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const guardian = (k: number) => ({ fullName: `Parent ${k}`, phone: `0764${String(k).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" });
const appInput = (k: number, extra: Record<string, unknown> = {}) => ({ firstName: `Cand${k}`, lastName: `Fam${k}`, dateOfBirth: "2019-05-04", gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [guardian(k)], ...extra });
const inDays = (d: number, hour = 9) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(hour, 0, 0, 0); return t.toISOString(); };
const fresh = () => ({ phone: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: `fam${Date.now()}${Math.floor(Math.random() * 1e6)}@example.test` });
const POLICY = { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "100000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 };

const newApp = (extra: Record<string, unknown> = {}) => admissions.createApplication(rehema, appInput(next(), extra));
async function verifiedDocs(appId: string) {
  const doc = await documents.uploadDocument(rehema, { applicationId: appId }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
  await review.verifyDocument(rehema, doc.id, { status: "VERIFIED" });
}
const row = async (id: string) => (await desk.loadDesk(rehema, {}, 1)).rows.find((r) => r.id === id) ?? (await desk.loadDesk(rehema, { q: (await db.application.findUniqueOrThrow({ where: { id } })).applicationNo }, 1)).rows[0]!;
const notices = (id: string) => db.applicationNotice.findMany({ where: { applicationId: id }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  rehema = (await createTestUser(school.id, ["registrar"])).ctx;
  esther = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-desk-"))));
  await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
  await policy.updateAdmissionPolicy(admin, POLICY);
});
afterAll(() => setStorageForTests(undefined));

describe("scenario 1: an online application is on the desk by itself", () => {
  it("shows up with the family's details, without anyone copying or retyping it, and tells the family nothing yet", async () => {
    const k = next();
    const c = fresh();
    const { applicationNo } = await pub.submitOnlineApplication(school.id, { firstName: `Web${k}`, lastName: `Child${k}`, dateOfBirth: "2019-02-02", gender: "MALE", classAppliedId: setup.cls.id, g1_fullName: `Web Parent ${k}`, g1_phone: c.phone, g1_email: c.email, g1_relationship: "MOTHER", consent: "on", website: "", password: "Learn-Safely-2026", password2: "Learn-Safely-2026" }, { ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "test" } as never);
    const r = (await desk.loadDesk(rehema, { q: applicationNo! }, 1)).rows[0]!;
    expect(r).toMatchObject({ applicationNo, source: "ONLINE", state: "NEW", className: setup.cls.name, guardianPhone: expect.stringContaining(c.phone.slice(1)), assignedTo: null });
    expect(r.completeness.missing).toContain("doc:BIRTH_CERTIFICATE");
    expect((await desk.loadDesk(rehema, {}, 1)).counts.NEW).toBeGreaterThanOrEqual(1);
    expect(await notices(r.id)).toHaveLength(0); // opening or listing never notifies anybody
  });
});

describe("review states", () => {
  it("starting a review assigns it to the person, is repeatable, and decides nothing", async () => {
    const a = await newApp();
    expect((await row(a.id)).state).toBe("NEW");
    expect(await review.startReview(rehema, a.id)).toEqual({ changed: true });
    expect(await review.startReview(rehema, a.id)).toEqual({ changed: false });
    const r = await row(a.id);
    expect(r).toMatchObject({ state: "UNDER_REVIEW", assignedToId: rehema.userId });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("APPLIED");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.review_started", entityId: a.id } })).toBe(1);
  });

  it("marking reviewed needs the papers verified; sending it back needs a message and tells the family once", async () => {
    const a = await newApp();
    expect(await code(review.reviewApplication(rehema, a.id, { decision: "VERIFIED" }))).toBe("CONFLICT");
    expect(await code(review.reviewApplication(rehema, a.id, { decision: "RETURNED" }))).toBe("VALIDATION");
    await review.reviewApplication(rehema, a.id, { decision: "RETURNED", note: "Please add the birth certificate" });
    await review.reviewApplication(rehema, a.id, { decision: "RETURNED", note: "Please add the birth certificate" }); // the same request saved again
    expect((await row(a.id)).state).toBe("NEEDS_INFO");
    const ns = await notices(a.id);
    expect(ns).toHaveLength(1); // not repeated
    expect(ns[0]).toMatchObject({ kind: "INFO_NEEDED", status: "NO_ACCOUNT" }); // an office-typed application has no family account: staff are shown they must phone
    await verifiedDocs(a.id);
    await review.reviewApplication(rehema, a.id, { decision: "VERIFIED" });
    expect((await row(a.id)).state).toBe("REVIEWED"); // an interview is still needed by the school's policy
  });
});

describe("scenario 2: schedule an interview", () => {
  it("is saved, shown on the desk and sent to the family's account; moving it keeps the old date and says so", async () => {
    const k = next();
    const c = fresh();
    const { applicationNo } = await pub.submitOnlineApplication(school.id, { firstName: `Fam${k}`, lastName: `Account${k}`, dateOfBirth: "2019-02-02", gender: "FEMALE", classAppliedId: setup.cls.id, g1_fullName: `Account Parent ${k}`, g1_phone: c.phone, g1_email: c.email, g1_relationship: "MOTHER", consent: "on", website: "", password: "Learn-Safely-2026", password2: "Learn-Safely-2026" }, { ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "test" } as never);
    const app = await db.application.findFirstOrThrow({ where: { schoolId: school.id, applicationNo: applicationNo! } });
    const familyUser = (await db.applicationDraft.findFirstOrThrow({ where: { applicationId: app.id } })).userId;
    await verifiedDocs(app.id);
    const iv = await interviews.scheduleInterview(rehema, app.id, { scheduledAt: inDays(3), location: "Room 2" });
    // a date that is set while the application is still under review shows in the Interview column, but the application stays in the review list
    let r = await row(app.id);
    expect(r).toMatchObject({ state: "NEW", interview: "SCHEDULED" });
    await review.reviewApplication(rehema, app.id, { decision: "VERIFIED" });
    r = await row(app.id);
    expect(r).toMatchObject({ state: "INTERVIEW_SCHEDULED", interview: "SCHEDULED" });
    expect(r.interviewAt?.getTime()).toBe(new Date(inDays(3)).getTime());
    expect((await notices(app.id)).map((x) => [x.kind, x.status])).toEqual([["INTERVIEW", "SENT_IN_APP"]]);
    expect(await db.inAppNotification.count({ where: { userId: familyUser!, title: { contains: "Interview" } } })).toBe(1);
    await interviews.rescheduleInterview(rehema, iv.id, { scheduledAt: inDays(5), reason: "Hall is booked" });
    r = await row(app.id);
    expect(r.interviewAt?.getTime()).toBe(new Date(inDays(5)).getTime());
    expect((await db.interview.findUniqueOrThrow({ where: { id: iv.id } })).status).toBe("CANCELLED"); // the old date is kept
    expect((await notices(app.id)).map((x) => x.kind)).toEqual(["INTERVIEW", "INTERVIEW_CHANGED"]);
    expect(await db.inAppNotification.count({ where: { userId: familyUser! } })).toBe(2);
  });
});

describe("scenario 3: the interview date already exists", () => {
  it("is recorded once; the same date again changes nothing and tells nobody; another date replaces it with history", async () => {
    const a = await newApp();
    const date = inDays(4, 10);
    const first = await interviews.confirmExistingInterview(rehema, a.id, { scheduledAt: date });
    expect(first.unchanged).toBe(false);
    const again = await interviews.confirmExistingInterview(rehema, a.id, { scheduledAt: date });
    expect(again).toEqual({ interviewId: first.interviewId, unchanged: true });
    expect(await db.interview.count({ where: { applicationId: a.id } })).toBe(1);
    expect((await db.interview.findUniqueOrThrow({ where: { id: first.interviewId } })).arrangement).toBe("EXISTING");
    expect((await notices(a.id)).length).toBe(1);
    const moved = await interviews.confirmExistingInterview(rehema, a.id, { scheduledAt: inDays(6, 10) });
    expect(moved.unchanged).toBe(false);
    expect((await db.interview.findMany({ where: { applicationId: a.id }, orderBy: { createdAt: "asc" } })).map((i) => i.status)).toEqual(["CANCELLED", "SCHEDULED"]);
    expect((await db.interview.findMany({ where: { applicationId: a.id, status: "SCHEDULED" } })).length).toBe(1); // never two live interviews
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "interview.confirm_existing", summary: { contains: a.applicationNo } } })).toBe(2);
    expect(await code(interviews.confirmExistingInterview(rehema, a.id, { scheduledAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }))).toBe("VALIDATION"); // a past date belongs to "already completed"
    expect(await code(interviews.confirmExistingInterview(teacher, a.id, { scheduledAt: inDays(7) }))).toBe("FORBIDDEN");
  });
});

describe("scenario 4: no interview is needed", () => {
  it("when the school asks for one, only a person who may authorise exceptions can waive it, and must say why", async () => {
    const a = await newApp();
    await verifiedDocs(a.id);
    await review.reviewApplication(rehema, a.id, { decision: "VERIFIED" });
    expect(await code(interviews.markInterviewNotRequired(rehema, a.id, { reason: "Known family" }))).toBe("FORBIDDEN");
    expect(await code(interviews.markInterviewNotRequired(admin, a.id, {}))).toBe("VALIDATION");
    expect(await interviews.markInterviewNotRequired(admin, a.id, { reason: "Sibling of a current pupil" })).toEqual({ changed: true });
    expect(await interviews.markInterviewNotRequired(admin, a.id, { reason: "again" })).toEqual({ changed: false });
    const r = await row(a.id);
    expect(r).toMatchObject({ state: "AWAITING_DECISION", interview: "WAIVED" });
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.exception_interview_waived", entityId: a.id } })).toBe(1);
    // scheduling one later takes the waiver back (the history keeps it)
    await interviews.scheduleInterview(rehema, a.id, { scheduledAt: inDays(3) });
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).interviewWaivedAt).toBeNull();
  });

  it("when the school does not require one, the Admissions Office can say so itself, with or without a reason", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, requireInterview: undefined });
    try {
      const a = await newApp();
      expect((await row(a.id)).interview).toBe("NOT_REQUIRED");
      expect(await interviews.markInterviewNotRequired(rehema, a.id, {})).toEqual({ changed: true });
      expect((await row(a.id)).interview).toBe("WAIVED");
      expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.interview_not_required", entityId: a.id } })).toBe(1);
    } finally {
      await policy.updateAdmissionPolicy(admin, POLICY);
    }
  });
});

describe("scenario 5: the interview already took place", () => {
  it("is recorded without a new date and the application can go to the decision; it cannot be recorded twice", async () => {
    const a = await newApp();
    await verifiedDocs(a.id);
    await review.reviewApplication(rehema, a.id, { decision: "VERIFIED" });
    const held = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(await code(interviews.recordCompletedInterview(rehema, a.id, { heldAt: inDays(3), outcome: "PASSED" }))).toBe("VALIDATION"); // not yet
    const { interviewId } = await interviews.recordCompletedInterview(rehema, a.id, { heldAt: held, outcome: "PASSED", score: 78, notes: "Done at the gate" });
    expect(await code(interviews.recordCompletedInterview(rehema, a.id, { heldAt: held, outcome: "PASSED" }))).toBe("CONFLICT"); // the same one again
    const i = await db.interview.findUniqueOrThrow({ where: { id: interviewId } });
    expect(i).toMatchObject({ status: "COMPLETED", outcome: "PASSED", arrangement: "RECORDED", score: 78 });
    expect(await row(a.id)).toMatchObject({ state: "AWAITING_DECISION", interview: "COMPLETED", interviewAt: null });
    expect(await db.interview.count({ where: { applicationId: a.id, status: "SCHEDULED" } })).toBe(0);
    const b = await newApp();
    await verifiedDocs(b.id);
    await interviews.scheduleInterview(rehema, b.id, { scheduledAt: inDays(3) });
    expect(await code(interviews.recordCompletedInterview(rehema, b.id, { heldAt: held, outcome: "PASSED" }))).toBe("CONFLICT"); // one is scheduled: record its result instead
  });
});

describe("scenarios 6, 7 and 8: accepting, the admission fee and enrolment", () => {
  it("scenario 8: an incomplete application cannot be accepted, says exactly why, and stays unchanged", async () => {
    const a = await newApp();
    const ready = await offers.acceptanceReadiness(db, school.id, { ...(await db.application.findUniqueOrThrow({ where: { id: a.id } })) });
    expect(ready.ready).toBe(false);
    expect(ready.hard.join(" ")).toMatch(/Required documents not verified: BIRTH_CERTIFICATE/);
    expect(ready.interview).toMatch(/requires a passed interview/);
    const msg = await message(offers.acceptApplication(rehema, a.id, {}));
    expect(msg).toMatch(/not ready for an offer.*BIRTH_CERTIFICATE/);
    const after = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.status).toBe("APPLIED");
    expect(await db.admissionOffer.count({ where: { applicationId: a.id } })).toBe(0);
    await verifiedDocs(a.id);
    expect(await message(offers.acceptApplication(rehema, a.id, {}))).toMatch(/requires a passed interview/); // papers fine, interview still missing
    expect(await code(offers.acceptApplication(teacher, a.id, {}))).toBe("FORBIDDEN");
    expect(await offers.acceptApplication(admin, a.id, { exceptionReason: "Decided by the Head Teacher" })).toMatchObject({ already: false, status: "ISSUED" }); // an authorised exception is recorded
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.exception_interview", entityId: a.id } })).toBe(1);
  });

  it("scenario 6: one action accepts, once; Finance and the family are told; the second press and two at once change nothing", async () => {
    const a = await newApp();
    await verifiedDocs(a.id);
    await interviews.recordCompletedInterview(rehema, a.id, { heldAt: new Date(Date.now() - 86_400_000).toISOString(), outcome: "PASSED" });
    const [x, y] = await Promise.all([offers.acceptApplication(rehema, a.id, { note: "Strong candidate" }), offers.acceptApplication(rehema, a.id, { note: "Strong candidate" })]);
    expect([x.already, y.already].sort()).toEqual([false, true]);
    expect(await offers.acceptApplication(rehema, a.id, {})).toMatchObject({ already: true });
    const app = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(app).toMatchObject({ status: "ACCEPTED", reviewStatus: "VERIFIED", decidedById: rehema.userId });
    expect(app.decidedAt).not.toBeNull();
    expect(await db.admissionOffer.count({ where: { applicationId: a.id } })).toBe(1);
    expect(await db.workflowTask.count({ where: { schoolId: school.id, relatedId: a.id, kind: "ADMISSION_PAYMENT" } })).toBe(1); // Finance is asked to collect the fee
    expect((await notices(a.id)).filter((m) => m.kind === "ACCEPTED")).toHaveLength(1);
    expect((await row(a.id)).state).toBe("ACCEPTED");
    expect(await db.student.count({ where: { schoolId: school.id, admissionNo: { not: "" }, createdAt: { gte: app.decidedAt! } } })).toBe(0); // accepted is not enrolled
  });

  it("scenario 7: accepted is not enrolled until Finance verifies the fee; Admissions cannot touch the money; then it enrols once", async () => {
    const a = await newApp();
    await verifiedDocs(a.id);
    await interviews.recordCompletedInterview(rehema, a.id, { heldAt: new Date(Date.now() - 86_400_000).toISOString(), outcome: "PASSED" });
    await offers.acceptApplication(rehema, a.id, {});
    expect(await code(admissions.enrolApplication(rehema, a.id, {}))).toBe("CONFLICT");
    expect(await db.application.findUniqueOrThrow({ where: { id: a.id } }).then((x) => x.status)).toBe("ACCEPTED");
    expect(await code(offers.recordAdmissionPayment(rehema, a.id, { amount: "100000", method: "CASH" }))).toBe("FORBIDDEN");
    const { payment } = await offers.recordAdmissionPayment(accountant, a.id, { amount: "100000", method: "CASH" });
    expect(await code(offers.verifyAdmissionPayment(rehema, payment.id))).toBe("FORBIDDEN"); // the Admissions Office cannot verify money
    await offers.verifyAdmissionPayment(accountant, payment.id);
    const results = await Promise.all([admissions.enrolApplication(rehema, a.id, {}).then(() => "ok", (e: AppError) => e.code), admissions.enrolApplication(rehema, a.id, {}).then(() => "ok", (e: AppError) => e.code)]);
    expect(results.sort()).toEqual(["CONFLICT", "ok"]);
    const done = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    expect(done.status).toBe("ENROLLED");
    expect(await db.student.count({ where: { id: done.studentId! } })).toBe(1);
    expect((await notices(a.id)).map((m) => m.kind)).toContain("ENROLLED");
    expect((await db.admissionPayment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("VERIFIED"); // untouched by Admissions
    // an enrolled applicant has left the working list; it is still found under Enrolled
    expect((await desk.loadDesk(rehema, {}, 1)).rows.map((r) => r.id)).not.toContain(a.id);
    expect((await desk.loadDesk(rehema, { state: "ENROLLED" }, 1)).rows.map((r) => r.id)).toContain(a.id);
  });

  it("not accepting tells the family neutrally and closes the application", async () => {
    const a = await newApp();
    await admissions.transitionApplication(rehema, a.id, { to: "REJECTED", reason: "No place in this class" });
    expect((await notices(a.id)).map((m) => m.kind)).toEqual(["NOT_ACCEPTED"]);
    expect((await row(a.id)).state).toBe("REJECTED");
  });

  it("a rejected application leaves the working list and the All count, and is still found under Closed or by searching", async () => {
    const a = await newApp();
    const before = (await desk.loadDesk(rehema, {}, 1)).counts;
    await admissions.transitionApplication(rehema, a.id, { to: "REJECTED", reason: "No place in this class" });
    const { applicationNo } = await db.application.findUniqueOrThrow({ where: { id: a.id } });
    const after = await desk.loadDesk(rehema, {}, 1);
    expect(after.rows.map((r) => r.id)).not.toContain(a.id);
    expect(after.counts.total).toBe(before.total - 1);
    expect(after.counts.closed).toBe(before.closed + 1);
    expect((await desk.loadDesk(rehema, { state: "CLOSED" }, 1)).rows.map((r) => r.id)).toContain(a.id);
    expect((await desk.loadDesk(rehema, { q: applicationNo }, 1)).rows.map((r) => r.id)).toContain(a.id);
    // the export follows the screen
    expect((await desk.deskTable(rehema, {})).rows.some((r) => r[0] === applicationNo)).toBe(false);
  });
});

describe("scenario 9: permissions are enforced on the server", () => {
  it("only people who work in admissions can read the desk or change it", async () => {
    const a = await newApp();
    for (const who of [teacher, accountant]) {
      expect(await code(desk.loadDesk(who, {}, 1))).toBe("FORBIDDEN");
      expect(await code(review.startReview(who, a.id))).toBe("FORBIDDEN");
      expect(await code(review.assignApplication(who, a.id, rehema.userId))).toBe("FORBIDDEN");
      expect(await code(desk.bulkDesk(who, { action: "START_REVIEW", ids: [a.id] }))).toBe("FORBIDDEN");
      expect(await code(interviews.recordCompletedInterview(who, a.id, { heldAt: new Date(Date.now() - 86_400_000).toISOString(), outcome: "PASSED" }))).toBe("FORBIDDEN");
      expect(await code(desk.deskTable(who, {}))).toBe("FORBIDDEN");
    }
  });

  it("another school's application is invisible", async () => {
    const other = await createTestSchool();
    const outsider = (await createTestUser(other.id, ["registrar"])).ctx;
    const a = await newApp();
    expect((await desk.loadDesk(outsider, {}, 1)).rows.find((r) => r.id === a.id)).toBeUndefined();
    expect(await code(review.startReview(outsider, a.id))).toBe("NOT_FOUND");
  });
});

describe("bulk review, assignment, filters and export", () => {
  it("reports what was done, what needed nothing and what could not be done; incomplete applications are never marked reviewed; accepting is not offered", async () => {
    const ok = await newApp(), bad1 = await newApp(), bad2 = await newApp();
    await verifiedDocs(ok.id);
    const out = await desk.bulkDesk(rehema, { action: "MARK_REVIEWED", ids: [ok.id, bad1.id, bad2.id] });
    expect(out.done.map((x) => x.id)).toEqual([ok.id]);
    expect(out.failed.map((x) => x.id).sort()).toEqual([bad1.id, bad2.id].sort());
    expect(out.failed[0]!.reason).toMatch(/documents/i);
    expect((await row(bad1.id)).state).toBe("NEW");
    const again = await desk.bulkDesk(rehema, { action: "MARK_REVIEWED", ids: [ok.id] });
    expect(again.done).toHaveLength(0);
    expect(again.unchanged[0]!.reason).toMatch(/Already reviewed/);
    const started = await desk.bulkDesk(rehema, { action: "START_REVIEW", ids: [bad1.id, bad2.id] });
    expect(started.done).toHaveLength(2);
    expect(await code(desk.bulkDesk(rehema, { action: "ACCEPT", ids: [ok.id] }))).toBe("VALIDATION");
    expect(await code(desk.bulkDesk(rehema, { action: "START_REVIEW", ids: [] }))).toBe("VALIDATION");
    expect(await code(desk.bulkDesk(rehema, { action: "START_REVIEW", ids: Array.from({ length: 101 }, () => ok.id) }))).toBe("VALIDATION");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.bulk_update" } })).toBeGreaterThanOrEqual(3);
  });

  it("assigns only to Admissions staff, and the filters find them", async () => {
    const a = await newApp();
    const refused = await desk.bulkDesk(rehema, { action: "ASSIGN", ids: [a.id], assigneeId: teacher.userId });
    expect(refused.failed[0]!.reason).toMatch(/Admissions Office/);
    expect(refused.done).toHaveLength(0);
    const given = await desk.bulkDesk(rehema, { action: "ASSIGN", ids: [a.id], assigneeId: esther.userId });
    expect(given.done).toHaveLength(1);
    expect((await desk.bulkDesk(rehema, { action: "ASSIGN", ids: [a.id], assigneeId: esther.userId })).unchanged).toHaveLength(1);
    expect((await row(a.id)).assignedToId).toBe(esther.userId);
    expect((await desk.loadDesk(rehema, { assigned: esther.userId }, 1)).rows.map((r) => r.id)).toContain(a.id);
    expect((await desk.loadDesk(rehema, { assigned: "me" }, 1)).rows.map((r) => r.id)).not.toContain(a.id);
    expect((await desk.loadDesk(rehema, { assigned: "none" }, 1)).rows.map((r) => r.id)).not.toContain(a.id);
    expect(await review.assignApplication(esther, a.id, rehema.userId)).toEqual({ changed: true }); // staff with review rights may reassign
  });

  it("filters by class, date, interview state and 'needs attention'; the counts stay school-wide", async () => {
    const cls2 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2 });
    const a = await newApp({ classAppliedId: cls2.id });
    const byClass = await desk.loadDesk(rehema, { classId: cls2.id }, 1);
    expect(byClass.rows.map((r) => r.id)).toEqual([a.id]);
    expect(byClass.counts.total).toBeGreaterThan(1); // the tiles do not shrink with the filter
    const day = new Date().toISOString().slice(0, 10);
    expect((await desk.loadDesk(rehema, { from: day, to: day, classId: cls2.id }, 1)).rows).toHaveLength(1);
    expect((await desk.loadDesk(rehema, { from: "2001-01-01", to: "2001-01-02", classId: cls2.id }, 1)).rows).toHaveLength(0);
    expect((await desk.loadDesk(rehema, { interview: "TO_ARRANGE", classId: cls2.id }, 1)).rows).toHaveLength(1);
    await db.application.update({ where: { id: a.id }, data: { createdAt: new Date(Date.now() - 6 * 86_400_000) } });
    const flagged = (await desk.loadDesk(rehema, { attention: true }, 1)).rows.find((r) => r.id === a.id);
    expect(flagged?.attention).toContain("OLD_UNREVIEWED");
  });

  it("changing the class applied for is recorded in the history and the audit log; nothing else moves it", async () => {
    const cls3 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard III", sortOrder: 3 });
    const a = await newApp();
    await admissions.updateApplication(rehema, a.id, { firstName: a.firstName, lastName: a.lastName, dateOfBirth: "2019-05-04", gender: "FEMALE", classAppliedId: cls3.id });
    const ev = await db.applicationEvent.findFirstOrThrow({ where: { applicationId: a.id, kind: "CLASS" } });
    expect(ev.reason).toMatch(/Standard I to Standard III/);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.update", entityId: a.id } })).toBe(1);
    await review.startReview(rehema, a.id);
    expect((await db.application.findUniqueOrThrow({ where: { id: a.id } })).classAppliedId).toBe(cls3.id);
  });

  it("the export has the same rows as the screen for the same filters, and only for staff who may read admissions", async () => {
    const f = { state: "NEW" };
    const onScreen = await desk.loadDesk(rehema, f, 1);
    const table = await desk.deskTable(rehema, f);
    expect(table.rows).toHaveLength(onScreen.total);
    expect(table.columns.map((c) => c.label)).toContain("Interview");
    expect(await code(desk.deskTable(teacher, f))).toBe("FORBIDDEN");
  });
});
