import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as admissions from "@/server/admissions";
import * as documents from "@/server/documents";
import * as interviews from "@/server/interviews";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as review from "@/server/admission-review";
import * as students from "@/server/students";
import * as website from "@/server/website";
import * as pub from "@/server/public-applications";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, head: AuthContext, accountant: AuthContext, teacher: AuthContext, finance2: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let n = 31000;
const next = () => ++n;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const guardian = (k: number) => ({ fullName: `Parent ${k}`, phone: `0764${String(k).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" });
const appInput = (k: number, extra: Record<string, unknown> = {}) => ({ firstName: `Cand${k}`, lastName: `Fam${k}`, dateOfBirth: "2019-05-04", gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [guardian(k)], ...extra });
const inDays = (d: number, hour = 9) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(hour, 0, 0, 0); return t.toISOString(); };
const tzs = (v: number) => v * 100;
const POLICY = { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "100000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 };

async function newApp(extra: Record<string, unknown> = {}) {
  return admissions.createApplication(registrar, appInput(next(), extra));
}
async function verifiedDocs(appId: string) {
  const doc = await documents.uploadDocument(registrar, { applicationId: appId }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
  await review.verifyDocument(registrar, doc.id, { status: "VERIFIED" });
}
/** Past the interview time so a result can be recorded (the test cannot wait for a real appointment). */
async function passed(appId: string, interviewerId?: string) {
  const i = await interviews.scheduleInterview(registrar, appId, { scheduledAt: inDays(2), ...(interviewerId ? { interviewerId } : {}) });
  await db.interview.update({ where: { id: i.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
  await interviews.recordInterviewResult(registrar, i.id, { status: "COMPLETED", outcome: "PASSED", score: 80, notes: "Confident reader" });
  return i;
}
/** An applicant with an issued offer, ready for the Finance step. */
async function offered(extra: Record<string, unknown> = {}) {
  const app = await newApp(extra);
  await verifiedDocs(app.id);
  await passed(app.id);
  await offers.issueOffer(registrar, app.id, {});
  return app;
}
async function payInFull(appId: string, who = accountant) {
  const { payment } = await offers.recordAdmissionPayment(who, appId, { amount: "100000", method: "CASH" });
  await offers.verifyAdmissionPayment(who, payment.id);
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  finance2 = (await createTestUser(school.id, ["accountant"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-flow-"))));
  await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
});
afterAll(() => setStorageForTests(undefined));

describe("policy", () => {
  it("is set by the administrator only and read back with defaults filled in", async () => {
    expect(await code(policy.updateAdmissionPolicy(registrar, POLICY))).toBe("FORBIDDEN");
    expect(await code(policy.updateAdmissionPolicy(admin, { ...POLICY, admissionFee: "abc" }))).toBe("VALIDATION");
    await policy.updateAdmissionPolicy(admin, POLICY);
    expect(await policy.getAdmissionPolicy(db, school.id)).toMatchObject({ requireInterview: true, requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFeeCents: tzs(100_000), offerValidDays: 14, offerNeedsApproval: false });
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "settings.admission_policy_update" } })).toBe(1);
  });
});

describe("applications: online and physical share one workflow", () => {
  it("an online application and a walk-in application land in the same queue, both as applicants and not as students", async () => {
    const k = next();
    const { applicationNo } = await pub.submitOnlineApplication(school.id, { firstName: `Web${k}`, lastName: `Child${k}`, dateOfBirth: "2019-02-02", gender: "MALE", classAppliedId: setup.cls.id, g1_fullName: `Web Parent ${k}`, g1_phone: `0733${String(k).padStart(6, "0")}`, g1_relationship: "MOTHER", consent: "on", website: "" }, { ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "test" } as never);
    const physical = await newApp({ submittedOn: new Date().toISOString().slice(0, 10) });
    const list = await admissions.listApplications(registrar, {});
    const online = list.items.find((a) => a.applicationNo === applicationNo)!;
    expect(online).toMatchObject({ source: "ONLINE", status: "APPLIED", reviewStatus: "PENDING", studentId: null });
    expect(list.items.find((a) => a.id === physical.id)).toMatchObject({ source: "STAFF", status: "APPLIED", reviewStatus: "PENDING", studentId: null });
    expect((await db.application.findUniqueOrThrow({ where: { id: physical.id } })).submittedOn).not.toBeNull();
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(0);
  });
});

describe("papers, interviews and decisions", () => {
  it("an application with missing papers cannot be scheduled; only an authorised exception lets it through", async () => {
    const app = await newApp();
    const when = inDays(3);
    expect(await code(interviews.scheduleInterview(registrar, app.id, { scheduledAt: when }))).toBe("CONFLICT");
    expect(await code(interviews.scheduleInterview(registrar, app.id, { scheduledAt: when, exceptionReason: "Papers to follow" }))).toBe("FORBIDDEN"); // the Admissions Office cannot excuse itself
    const doc = await documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
    expect(await code(interviews.scheduleInterview(registrar, app.id, { scheduledAt: when }))).toBe("CONFLICT"); // uploaded but not verified
    expect(await code(review.verifyDocument(teacher, doc.id, { status: "VERIFIED" }))).toBe("FORBIDDEN");
    expect(await code(review.verifyDocument(accountant, doc.id, { status: "VERIFIED" }))).toBe("FORBIDDEN");
    await review.verifyDocument(registrar, doc.id, { status: "NEEDS_CORRECTION", note: "Photo is blurred" });
    expect(await code(interviews.scheduleInterview(registrar, app.id, { scheduledAt: when }))).toBe("CONFLICT");
    await review.verifyDocument(registrar, doc.id, { status: "VERIFIED" });
    expect((await interviews.scheduleInterview(registrar, app.id, { scheduledAt: when })).status).toBe("SCHEDULED");
    const excepted = await newApp();
    await interviews.scheduleInterview(admin, excepted.id, { scheduledAt: inDays(4), exceptionReason: "Certificate is being replaced by the registry" });
    const row = await db.application.findUniqueOrThrow({ where: { id: excepted.id } });
    expect(row).toMatchObject({ docsExceptionById: admin.userId, docsExceptionReason: "Certificate is being replaced by the registry", status: "INTERVIEW" });
    expect(await db.auditLog.count({ where: { schoolId: school.id, entityId: excepted.id, action: "admission.exception_documents" } })).toBe(1);
  });

  it("an application returned for correction stays out of the interview and offer stages until verified again", async () => {
    const app = await newApp();
    await verifiedDocs(app.id);
    expect(await code(review.reviewApplication(registrar, app.id, { decision: "RETURNED" }))).toBe("VALIDATION"); // say what is wrong
    await review.reviewApplication(registrar, app.id, { decision: "RETURNED", note: "Add the parent's phone number" });
    expect(await code(interviews.scheduleInterview(registrar, app.id, { scheduledAt: inDays(3) }))).toBe("CONFLICT");
    await review.reviewApplication(registrar, app.id, { decision: "VERIFIED" });
    expect((await interviews.scheduleInterview(registrar, app.id, { scheduledAt: inDays(3) })).status).toBe("SCHEDULED");
  });

  it("refuses to double-book an interviewer, warns about a shared room, and keeps history when an interview is moved", async () => {
    const a = await newApp(), b = await newApp(), c = await newApp();
    for (const x of [a, b, c]) await verifiedDocs(x.id);
    const when = inDays(5, 10);
    const first = await interviews.scheduleInterview(registrar, a.id, { scheduledAt: when, interviewerId: head.userId, location: "Room 1", durationMinutes: 30 });
    expect(await code(interviews.scheduleInterview(registrar, b.id, { scheduledAt: when, interviewerId: head.userId }))).toBe("CONFLICT");
    expect(await code(interviews.scheduleInterview(registrar, b.id, { scheduledAt: when, location: "room 1" }))).toBe("CONFLICT"); // room already in use
    await interviews.scheduleInterview(registrar, b.id, { scheduledAt: when, location: "room 1", confirmLocationClash: "on" });
    await interviews.scheduleInterview(registrar, c.id, { scheduledAt: inDays(5, 11), interviewerId: head.userId }); // different hour is fine
    expect(await code(interviews.scheduleInterview(registrar, a.id, { scheduledAt: inDays(6) }))).toBe("CONFLICT"); // one live interview per applicant
    const moved = await interviews.rescheduleInterview(registrar, first.id, { scheduledAt: inDays(7, 10), reason: "Parent travelling" });
    expect(moved.rescheduledFromId).toBe(first.id);
    expect(await db.interview.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "CANCELLED", cancelReason: "Rescheduled: Parent travelling" });
    expect(await code(interviews.rescheduleInterview(registrar, first.id, { scheduledAt: inDays(8), reason: "again" }))).toBe("CONFLICT"); // already moved
    expect(await code(interviews.scheduleInterview(registrar, a.id, { scheduledAt: new Date(Date.now() - 86_400_000).toISOString() }))).toBe("VALIDATION"); // a time that has passed
    expect((await interviews.listInterviews(registrar, { status: "SCHEDULED" })).length).toBeGreaterThan(2);
  });

  it("records the result only after the interview, by the right people, and a result admits nobody", async () => {
    const app = await newApp();
    await verifiedDocs(app.id);
    const i = await interviews.scheduleInterview(registrar, app.id, { scheduledAt: inDays(2), interviewerId: head.userId });
    expect(await code(interviews.recordInterviewResult(registrar, i.id, { status: "COMPLETED", outcome: "PASSED" }))).toBe("CONFLICT"); // not yet held
    await db.interview.update({ where: { id: i.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    expect(await code(interviews.recordInterviewResult(accountant, i.id, { status: "COMPLETED", outcome: "PASSED" }))).toBe("FORBIDDEN"); // Finance cannot change interview results
    expect(await code(interviews.recordInterviewResult(teacher, i.id, { status: "COMPLETED", outcome: "PASSED" }))).toBe("FORBIDDEN");
    expect(await code(interviews.recordInterviewResult(registrar, i.id, { status: "COMPLETED" }))).toBe("VALIDATION"); // a result is needed
    await interviews.recordInterviewResult(head, i.id, { status: "COMPLETED", outcome: "PASSED", score: 88, notes: "Strong" }); // the assigned interviewer
    const row = (await interviews.interviewsOfApplication(registrar, app.id))[0]!;
    expect(row).toMatchObject({ status: "COMPLETED", outcome: "PASSED", score: 88, notes: "Strong" });
    // notes are hidden from staff without the permission
    const readerOnly = (await createTestUser(school.id, [])).ctx;
    expect(await code(interviews.interviewsOfApplication(readerOnly, app.id))).toBe("FORBIDDEN");
    const a = await admissions.getApplication(registrar, app.id);
    expect(a.status).toBe("INTERVIEW"); // passed is not accepted, and certainly not enrolled
    expect(a.studentId).toBeNull();
    expect(await db.admissionOffer.count({ where: { applicationId: app.id } })).toBe(0);
    expect(await db.student.count({ where: { schoolId: school.id, firstName: a.firstName } })).toBe(0);
  });

  it("when the school requires an interview, an offer needs a passed result or a recorded exception", async () => {
    const none = await newApp();
    await verifiedDocs(none.id);
    expect(await code(offers.issueOffer(registrar, none.id, {}))).toBe("CONFLICT");
    expect(await code(offers.issueOffer(registrar, none.id, { exceptionReason: "Sibling of a current pupil" }))).toBe("FORBIDDEN");
    await offers.issueOffer(admin, none.id, { exceptionReason: "Sibling of a current pupil" });
    expect(await db.auditLog.count({ where: { schoolId: school.id, entityId: none.id, action: "admission.exception_interview" } })).toBe(1);
    const failed = await newApp();
    await verifiedDocs(failed.id);
    const i = await interviews.scheduleInterview(registrar, failed.id, { scheduledAt: inDays(2) });
    await db.interview.update({ where: { id: i.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    await interviews.recordInterviewResult(registrar, i.id, { status: "COMPLETED", outcome: "NOT_PASSED" });
    expect(await code(offers.issueOffer(registrar, failed.id, {}))).toBe("CONFLICT");
  });
});

describe("the admission payment gate", () => {
  it("an applicant with an offer stays an applicant while the payment is unpaid, pending, partial or rejected", async () => {
    const app = await offered();
    const offer = await db.admissionOffer.findUniqueOrThrow({ where: { applicationId: app.id } });
    expect(offer).toMatchObject({ status: "ISSUED" });
    expect(offer.letterNo).toMatch(/^ADM\/\d{4}\/\d{5}$/);
    expect(Number(offer.feeAmount)).toBe(100000);
    const gate = async () => (await offers.enrolmentReadiness(db, school.id, await db.application.findUniqueOrThrow({ where: { id: app.id } })));
    expect((await gate()).ready).toBe(false);
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");

    // Who may do what
    expect(await code(offers.recordAdmissionPayment(registrar, app.id, { amount: "100000", method: "CASH" }))).toBe("FORBIDDEN");
    expect(await code(offers.recordAdmissionPayment(teacher, app.id, { amount: "100000", method: "CASH" }))).toBe("FORBIDDEN");
    expect(await code(offers.recordAdmissionPayment(accountant, app.id, { amount: "0", method: "CASH" }))).toBe("VALIDATION");
    expect(await code(offers.recordAdmissionPayment(accountant, app.id, { amount: "5000", method: "MOBILE_MONEY" }))).toBe("VALIDATION"); // reference needed

    // Recorded money is PENDING and counts for nothing
    const full = (await offers.recordAdmissionPayment(accountant, app.id, { amount: "100000", method: "BANK", reference: `SLIP-${next()}` })).payment;
    expect(full.status).toBe("PENDING");
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");
    expect((await gate()).account).toMatchObject({ status: "VERIFICATION_PENDING", verifiedCents: 0, pendingCents: tzs(100_000) });
    expect(await code(offers.verifyAdmissionPayment(registrar, full.id))).toBe("FORBIDDEN"); // Admissions cannot confirm money
    await offers.rejectAdmissionPayment(accountant, full.id, { reason: "Slip not found on the bank statement" });
    expect(await code(offers.verifyAdmissionPayment(accountant, full.id))).toBe("CONFLICT"); // rejected is final
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");

    // Partial then complete
    const part = (await offers.recordAdmissionPayment(accountant, app.id, { amount: "40000", method: "CASH" })).payment;
    const v1 = await offers.verifyAdmissionPayment(accountant, part.id);
    expect(v1.receiptNo).toMatch(/^ARC\/\d{4}\/\d{5}$/);
    expect((await offers.verifyAdmissionPayment(accountant, part.id)).receiptNo).toBe(v1.receiptNo); // a retry never issues a second receipt
    expect((await gate()).account).toMatchObject({ status: "PARTIAL", verifiedCents: tzs(40_000), balanceCents: tzs(60_000) });
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");
    const rest = (await offers.recordAdmissionPayment(accountant, app.id, { amount: "60000", method: "CASH" })).payment;
    await offers.verifyAdmissionPayment(accountant, rest.id);
    expect(await gate()).toMatchObject({ ready: true, account: { status: "PAID" } });
    expect(await db.admissionPayment.count({ where: { applicationId: app.id, receiptNo: { not: null } } })).toBe(2);
  });

  it("does not record the same bank slip twice, and replays an identical request instead of duplicating it", async () => {
    const app = await offered();
    const ref = `TX-${next()}`;
    const first = await offers.recordAdmissionPayment(accountant, app.id, { amount: "30000", method: "MOBILE_MONEY", reference: ref });
    expect(await code(offers.recordAdmissionPayment(accountant, app.id, { amount: "30000", method: "MOBILE_MONEY", reference: ref }))).toBe("CONFLICT");
    const a = await offers.recordAdmissionPayment(accountant, app.id, { amount: "20000", method: "CASH", idempotencyKey: "k-1" });
    const b = await offers.recordAdmissionPayment(accountant, app.id, { amount: "20000", method: "CASH", idempotencyKey: "k-1" });
    expect(b.replay).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    expect(await code(offers.recordAdmissionPayment(accountant, app.id, { amount: "99", method: "CASH", idempotencyKey: "k-1" }))).toBe("CONFLICT");
    expect(await db.admissionPayment.count({ where: { applicationId: app.id } })).toBe(2);
    expect(first.replay).toBe(false);
  });

  it("can require a second person to verify, and a verified payment can only be reversed with a reason", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, paymentNeedsSecondPerson: "on" });
    const app = await offered();
    const p = (await offers.recordAdmissionPayment(accountant, app.id, { amount: "100000", method: "CASH" })).payment;
    expect(await code(offers.verifyAdmissionPayment(accountant, p.id))).toBe("CONFLICT");
    await offers.verifyAdmissionPayment(finance2, p.id);
    await policy.updateAdmissionPolicy(admin, POLICY);
    expect(await code(offers.reverseAdmissionPayment(accountant, p.id, {}))).toBe("VALIDATION");
    await offers.reverseAdmissionPayment(accountant, p.id, { reason: "Cheque bounced" });
    const gate = await offers.enrolmentReadiness(db, school.id, await db.application.findUniqueOrThrow({ where: { id: app.id } }));
    expect(gate.ready).toBe(false); // the reversal takes the applicant back out of eligibility
    await expect(db.admissionPayment.update({ where: { id: p.id }, data: { amount: "1.00" } })).rejects.toThrow(); // database guard
    await expect(db.admissionPayment.delete({ where: { id: p.id } })).rejects.toThrow();
  });

  it("an offer past its date blocks payment and enrolment until it is extended", async () => {
    const app = await offered();
    await payInFull(app.id);
    await db.admissionOffer.update({ where: { applicationId: app.id }, data: { expiresOn: new Date(Date.now() - 3 * 86_400_000) } });
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");
    expect(await code(offers.recordAdmissionPayment(accountant, app.id, { amount: "1000", method: "CASH" }))).toBe("CONFLICT");
    await offers.reviseOffer(registrar, app.id, { expiresOn: inDays(10).slice(0, 10), reason: "Family asked for time" });
    expect((await admissions.enrolApplication(registrar, app.id, {})).admissionNo).toBeTruthy();
  });

  it("only an administrator can waive the payment, with a reason that is recorded", async () => {
    const app = await offered();
    expect(await code(offers.waiveAdmissionPayment(registrar, app.id, { reason: "Scholarship" }))).toBe("FORBIDDEN");
    expect(await code(offers.waiveAdmissionPayment(accountant, app.id, { reason: "Scholarship" }))).toBe("FORBIDDEN");
    expect(await code(offers.waiveAdmissionPayment(admin, app.id, {}))).toBe("VALIDATION");
    await offers.waiveAdmissionPayment(admin, app.id, { reason: "Board scholarship, minute 4" });
    const student = await admissions.enrolApplication(registrar, app.id, {});
    expect(student.id).toBeTruthy();
    const log = await db.auditLog.findFirstOrThrow({ where: { schoolId: school.id, entityId: app.id, action: "admission.enrol" } });
    expect(JSON.stringify(log.changes)).toContain("Board scholarship, minute 4");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.exception_payment" } })).toBeGreaterThan(0);
  });

  it("offers can require approval by a second person, and can be withdrawn only while no verified money is held", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, offerNeedsApproval: "on" });
    const app = await newApp();
    await verifiedDocs(app.id);
    await passed(app.id);
    await offers.issueOffer(registrar, app.id, {});
    expect((await admissions.getApplication(registrar, app.id)).status).toBe("INTERVIEW"); // not decided yet
    expect(await code(offers.approveOffer(registrar, app.id))).toBe("FORBIDDEN");
    expect(await code(offers.approveOffer(head, app.id)) ).toBe(null);
    expect((await admissions.getApplication(registrar, app.id)).status).toBe("ACCEPTED");
    await policy.updateAdmissionPolicy(admin, POLICY);
    const p = (await offers.recordAdmissionPayment(accountant, app.id, { amount: "10000", method: "CASH" })).payment;
    await offers.verifyAdmissionPayment(accountant, p.id);
    expect(await code(offers.withdrawOffer(registrar, app.id, { reason: "Changed our mind" }))).toBe("CONFLICT");
    await offers.reverseAdmissionPayment(accountant, p.id, { reason: "Refunded to the family" });
    await offers.withdrawOffer(registrar, app.id, { reason: "Changed our mind" });
    expect((await admissions.getApplication(registrar, app.id)).status).toBe("APPLIED");
  });
});

describe("enrolment and class placement", () => {
  it("creates exactly one student once the gate is open, who then waits for a class and is on no roster", async () => {
    const app = await offered();
    await payInFull(app.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => code(admissions.enrolApplication(registrar, app.id, {}))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    const after = await admissions.getApplication(registrar, app.id);
    expect(after.status).toBe("ENROLLED");
    expect(await db.student.count({ where: { schoolId: school.id, firstName: after.firstName } })).toBe(1);
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT"); // repeating changes nothing
    const student = await db.student.findUniqueOrThrow({ where: { id: after.studentId! } });
    expect(student.admissionNo).toBeTruthy();
    expect(await db.studentEnrollment.count({ where: { studentId: student.id } })).toBe(0); // class preference is not a placement
    expect(await code(admissions.transitionApplication(registrar, app.id, { to: "REJECTED", reason: "late" }))).toBe("CONFLICT");
  });

  it("places the student in a class that has room, refuses a full class, and records an authorised override", async () => {
    await academics.updateClass(admin, setup.cls.id, { levelId: setup.level.id, name: setup.cls.name, sortOrder: "1", isActive: "on", capacity: "1" });
    const place = (id: string, extra: Record<string, unknown> = {}) => students.enrollStudent(registrar, id, { classId: setup.cls.id, ...extra });
    const s1 = await students.createStudent(registrar, studentInput(next()));
    const s2 = await students.createStudent(registrar, studentInput(next()));
    await place(s1.id);
    expect(await code(place(s2.id))).toBe("CONFLICT"); // the class is full
    expect(await code(place(s2.id, { overrideCapacity: "on", overrideReason: "Sibling" }))).toBe("FORBIDDEN"); // the registrar may not exceed capacity
    expect(await code(students.enrollStudent(admin, s2.id, { classId: setup.cls.id, overrideCapacity: "on" }))).toBe("VALIDATION"); // reason needed
    await students.enrollStudent(admin, s2.id, { classId: setup.cls.id, overrideCapacity: "on", overrideReason: "Head teacher approved: sibling of a pupil" });
    const log = await db.auditLog.findFirstOrThrow({ where: { schoolId: school.id, entityId: s2.id, action: "student.enroll" } });
    expect(JSON.stringify(log.changes)).toContain("Head teacher approved");
    await academics.updateClass(admin, setup.cls.id, { levelId: setup.level.id, name: setup.cls.name, sortOrder: "1", isActive: "on", capacity: "" });
    expect((await db.schoolClass.findUniqueOrThrow({ where: { id: setup.cls.id } })).capacity).toBeNull();
  });

  it("the class teacher sees the student only after placement", async () => {
    const t2 = (await createTestUser(school.id, ["class_teacher"])).ctx;
    await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, staffId: t2.staffId });
    const app = await offered();
    await payInFull(app.id);
    const stu = await admissions.enrolApplication(registrar, app.id, {});
    const sees = async () => (await students.listStudents(t2, {})).items.some((s) => s.id === stu.id);
    expect(await sees()).toBe(false);
    await students.enrollStudent(head, stu.id, { classId: setup.cls.id }); // the Head Teacher places students too
    expect(await sees()).toBe(true);
  });

  it("direct registration can be switched off so students come only through admissions", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, allowDirectRegistration: "" });
    expect(await code(students.createStudent(registrar, studentInput(next())))).toBe("FORBIDDEN");
    expect((await students.createStudent(admin, studentInput(next()))).admissionNo).toBeTruthy();
    await policy.updateAdmissionPolicy(admin, POLICY);
    expect((await students.createStudent(registrar, studentInput(next()))).admissionNo).toBeTruthy();
  });

  it("closing an application sets aside its interview and offer, and other schools see none of it", async () => {
    const app = await offered();
    await admissions.transitionApplication(registrar, app.id, { to: "REJECTED", reason: "Place no longer available" });
    expect((await db.admissionOffer.findUniqueOrThrow({ where: { applicationId: app.id } })).status).toBe("WITHDRAWN");
    const other = await createTestSchool("Other school");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const otherAcc = (await createTestUser(other.id, ["accountant"])).ctx;
    expect(await code(offers.recordAdmissionPayment(otherAcc, app.id, { amount: "1000", method: "CASH" }))).toBe("NOT_FOUND");
    expect(await code(interviews.scheduleInterview(otherAdmin, app.id, { scheduledAt: inDays(2) }))).toBe("NOT_FOUND");
    expect(await code(review.reviewApplication(otherAdmin, app.id, { decision: "VERIFIED" }))).toBe("NOT_FOUND");
    expect((await interviews.listInterviews(otherAdmin, {})).length).toBe(0);
    expect(await offers.admissionPaymentQueue(otherAcc)).toEqual([]);
  });
});
