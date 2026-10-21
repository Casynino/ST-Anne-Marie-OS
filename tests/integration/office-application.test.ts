import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as admissions from "@/server/admissions";
import * as desk from "@/server/admission-desk";
import * as documents from "@/server/documents";
import * as fee from "@/server/application-fee";
import * as pdf from "@/server/application-pdf";
import * as interviews from "@/server/interviews";
import * as office from "@/server/office-application";
import * as policy from "@/server/admission-policy";
import * as review from "@/server/admission-review";
import * as website from "@/server/website";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/*
 * An application filled in at the office is the same application as an online one: same form, same checks, same fee, same receipt. It waits for
 * the fee as a draft with a payment reference, can be printed before and after, and reaches the Admissions Office when Finance records the fee
 * (or the payment provider confirms it).
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, accountant: AuthContext, teacher: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let n = 91000 + Math.floor(Math.random() * 800000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const POLICY = { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "100000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30, transferDocTypes: ["TRANSFER_LETTER"] };
const inDays = (d: number, hour = 9) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(hour, 0, 0, 0); return t.toISOString(); };

function form(extra: Record<string, unknown> = {}) {
  const k = n++;
  return { firstName: `Amani${k}`, lastName: `Office${k}`, dateOfBirth: "2019-03-03", gender: "FEMALE", classAppliedId: setup.cls.id, g1_fullName: `Mama ${k}`, g1_phone: `0755${String(k % 1_000_000).padStart(6, "0")}`, g1_relationship: "MOTHER", consent: "on", ...extra };
}
const make = (extra: Record<string, unknown> = {}, files: { docType: string; fileName: string; bytes: Buffer }[] = []) => office.createOfficeApplication(rehema, form(extra), files);

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  rehema = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-office-"))));
  await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
  await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
});
afterAll(() => setStorageForTests(undefined));

describe("filling the form at the office", () => {
  it("waits for the fee as a draft with a payment reference; no application exists yet; the same checks as online apply", async () => {
    const input = form();
    const r = await office.createOfficeApplication(rehema, input, []);
    expect(r).toMatchObject({ applicationId: null, applicationNo: null, feeCents: 1_000_000 });
    expect(r.reference).toMatch(/^APF-[A-Z0-9]{8}$/);
    const draft = await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } });
    expect(draft).toMatchObject({ channel: "OFFICE", userId: null, createdById: rehema.userId, status: "AWAITING_PAYMENT" });
    expect(await db.application.count({ where: { schoolId: school.id, firstName: input.firstName } })).toBe(0);
    // the same child again, whether typed again or as an online application, is refused while the first waits for its fee
    expect(await code(office.createOfficeApplication(rehema, { ...form(), firstName: input.firstName, lastName: input.lastName }, []))).toBe("CONFLICT");
    // the same rules as the online form
    expect(await code(office.createOfficeApplication(rehema, form({ consent: "" }), []))).toBe("VALIDATION");
    expect(await code(office.createOfficeApplication(rehema, form({ entryType: "TRANSFER" }), []))).toBe("VALIDATION"); // a transfer needs the previous school, class and reason
    expect(await code(office.createOfficeApplication(rehema, form({ dateOfBirth: "2999-01-01" }), []))).toBe("VALIDATION");
    expect(await code(office.createOfficeApplication(teacher, form(), []))).toBe("FORBIDDEN");
    expect(await code(office.createOfficeApplication(accountant, form(), []))).toBe("FORBIDDEN");
  });

  it("the photo and papers are optional now but still checked: a document that is not a picture is refused as the photo", async () => {
    const ok = await make({}, [{ docType: "PASSPORT_PHOTO", fileName: "p.png", bytes: PNG }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF }]);
    expect((await db.document.findMany({ where: { draftId: ok.draftId } })).map((d) => d.docType).sort()).toEqual(["BIRTH_CERTIFICATE", "PASSPORT_PHOTO"]);
    expect(await code(make({}, [{ docType: "PASSPORT_PHOTO", fileName: "p.pdf", bytes: PDF }]))).toBe("VALIDATION");
    const later = await make();
    await office.uploadOfficeDraftDocument(rehema, later.draftId, { docType: "PASSPORT_PHOTO", fileName: "p.png", bytes: PNG });
    await office.uploadOfficeDraftDocument(rehema, later.draftId, { docType: "PASSPORT_PHOTO", fileName: "p2.png", bytes: PNG }); // a new photo replaces the old
    expect(await db.document.count({ where: { draftId: later.draftId, docType: "PASSPORT_PHOTO", deletedAt: null } })).toBe(1);
  });

  it("can be corrected or cancelled while it waits, by people who may create applications", async () => {
    const r = await make();
    const input = form({ firstName: "Corrected" });
    await office.updateOfficeDraft(rehema, r.draftId, input);
    expect(((await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } })).payload as { firstName: string }).firstName).toBe("Corrected");
    expect(await code(office.updateOfficeDraft(teacher, r.draftId, input))).toBe("FORBIDDEN");
    expect(await code(office.cancelOfficeDraft(rehema, r.draftId, {}))).toBe("VALIDATION");
    await office.cancelOfficeDraft(rehema, r.draftId, { reason: "The family changed their mind" });
    expect((await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } })).status).toBe("CANCELLED");
    expect(await code(office.updateOfficeDraft(rehema, r.draftId, input))).toBe("CONFLICT");
    expect(await code(office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" }))).toBe("CONFLICT");
  });
});

describe("printing the form, before and after the fee", () => {
  it("the form can be printed before payment with the reference and how to pay, and after payment with the number and the fee paid", async () => {
    const r = await make({}, [{ docType: "PASSPORT_PHOTO", fileName: "p.png", bytes: PNG }]);
    const before = await pdf.applicationFormDocument(rehema, r.draftId, "EN");
    expect(before.pay).toMatchObject({ reference: r.reference });
    expect(before.applicationNo).toBe(r.reference);
    expect(before.fee).toBeNull();
    const bytes = await pdf.applicationFormPdf(rehema, r.draftId, "EN");
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(await code(pdf.applicationFormPdf(accountant, r.draftId, "EN"))).toBe("FORBIDDEN"); // only the Admissions Office reads applications
    await office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" });
    const after = await pdf.applicationFormDocument(rehema, r.draftId, "EN");
    expect(after.pay).toBeNull();
    expect(after.applicationNo).toMatch(/^APP\//);
    expect(after.fee).toMatchObject({ reference: r.reference });
    expect(after.photo).not.toBeNull();
  });

  it("any application can be printed from its own record, health notes only for people who may read medical notes", async () => {
    const legacy = await admissions.createApplication(rehema, { firstName: "Legacy", lastName: "Paper", dateOfBirth: "2019-01-01", gender: "MALE", classAppliedId: setup.cls.id, guardians: [{ fullName: "Old Parent", phone: "0788123123", relationship: "FATHER", isPrimary: "on" }] });
    await db.application.update({ where: { id: legacy.id }, data: { healthNotes: "Asthma" } });
    const doc = await pdf.applicationFormDocument(rehema, legacy.id, "EN");
    expect(doc).toMatchObject({ applicationNo: legacy.applicationNo, pay: null });
    expect(doc.child.healthNotes).toBe("Asthma");
    const clerk = (await createTestUser(school.id, [])).ctx;
    expect(await code(pdf.applicationFormDocument(clerk, legacy.id, "EN"))).toBe("FORBIDDEN");
  });
});

describe("the fee: recorded by Finance at the office, or confirmed by the provider", () => {
  it("only Finance records it; a wrong amount is refused; the right one issues the receipt and sends the application to the Admissions Office", async () => {
    const input = form();
    const r = await office.createOfficeApplication(rehema, input, [{ docType: "PASSPORT_PHOTO", fileName: "p.png", bytes: PNG }]);
    expect(await code(office.recordApplicationFeeAtOffice(rehema, r.draftId, { method: "CASH" }))).toBe("FORBIDDEN"); // Admissions cannot touch the money
    expect(await code(office.recordApplicationFeeAtOffice(teacher, r.draftId, { method: "CASH" }))).toBe("FORBIDDEN");
    expect(await code(office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH", amount: "5000" }))).toBe("VALIDATION");
    expect(await code(office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "BARTER" }))).toBe("VALIDATION");
    expect(await db.application.count({ where: { schoolId: school.id, firstName: input.firstName } })).toBe(0);
    const done = await office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "BANK", note: "Slip 4471" });
    expect(done).toMatchObject({ outcome: "SUBMITTED" });
    expect(done.receiptNo).toMatch(/^APR\//);
    const app = await db.application.findFirstOrThrow({ where: { schoolId: school.id, firstName: input.firstName } });
    expect(app).toMatchObject({ source: "STAFF", status: "APPLIED", createdById: rehema.userId });
    const draft = await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } });
    expect(draft).toMatchObject({ status: "SUBMITTED", applicationId: app.id, paymentMethod: "BANK", paymentNote: "Slip 4471", paymentRecordedById: accountant.userId, paymentProvider: "office" });
    expect(await db.document.count({ where: { applicationId: app.id, docType: "PASSPORT_PHOTO" } })).toBe(1); // the photo moved with it
    // it is on the desk, ready for review, and Finance's ledger shows how it was paid
    const row = (await desk.loadDesk(rehema, { q: app.applicationNo }, 1)).rows[0]!;
    expect(row).toMatchObject({ state: "NEW", source: "STAFF" });
    const led = (await fee.applicationFeeLedger(accountant)).rows.find((x) => x.id === r.draftId)!;
    expect(led).toMatchObject({ channel: "OFFICE", method: "BANK", status: "SUBMITTED" });
    // one application however many times it is pressed; the receipt names the method and who received it
    expect(await code(office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" }))).toBe("CONFLICT");
    expect(await db.application.count({ where: { schoolId: school.id, firstName: input.firstName } })).toBe(1);
    const receipt = await pdf.applicationReceiptDocument(rehema, r.draftId, "EN");
    expect(receipt).toMatchObject({ number: done.receiptNo, amountCents: 1_000_000, receivedBy: accountant.fullName });
    expect(receipt.method.toLowerCase()).toContain("bank");
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.application_fee_paid", entityId: r.draftId, actorId: accountant.userId } })).toBe(1);
  });

  it("two people recording the same fee together submit one application", async () => {
    const r = await make();
    const results = await Promise.all([office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" }).then(() => "ok", (e: AppError) => e.code), office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" }).then(() => "ok", (e: AppError) => e.code)]);
    expect(results.sort()).toEqual(["CONFLICT", "ok"]);
    expect(await db.application.count({ where: { schoolId: school.id, firstName: ((await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } })).payload as { firstName: string }).firstName } })).toBe(1);
  });

  it("paying by phone with the reference (the provider's confirmation) submits the same office application", async () => {
    const r = await make();
    const out = await fee.confirmApplicationFee({ schoolId: school.id, reference: r.reference, provider: "test-provider", providerEventId: `EV-${n++}`, amountCents: 1_000_000, currency: "TZS", meta: { ip: null, userAgent: null } });
    expect(out.outcome).toBe("SUBMITTED");
    const draft = await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } });
    expect(draft.applicationId).not.toBeNull();
    expect(await db.application.findUniqueOrThrow({ where: { id: draft.applicationId! } })).toMatchObject({ source: "STAFF", createdById: rehema.userId });
  });

  it("with no application fee set, the application is submitted at once and can be printed", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "0" });
    try {
      const r = await make();
      expect(r.applicationId).not.toBeNull();
      expect(r.applicationNo).toMatch(/^APP\//);
      expect((await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } })).status).toBe("SUBMITTED");
      expect((await desk.loadDesk(rehema, { q: r.applicationNo! }, 1)).rows[0]).toMatchObject({ source: "STAFF", state: "NEW" });
      expect((await pdf.applicationFormDocument(rehema, r.draftId, "EN")).pay).toBeNull();
    } finally {
      await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
    }
  });
});

describe("the waiting list and who can see it", () => {
  it("lists only applications filled in at the office that are waiting, for Admissions staff only", async () => {
    const r = await make();
    const rows = await office.listOfficeDrafts(rehema);
    expect(rows.find((x) => x.id === r.draftId)).toMatchObject({ reference: r.reference, status: "AWAITING_PAYMENT", feeCents: 1_000_000, createdBy: rehema.fullName });
    expect(rows.every((x) => x.status !== "SUBMITTED")).toBe(true);
    expect(await code(office.listOfficeDrafts(teacher))).toBe("FORBIDDEN");
    expect(await code(office.getOfficeDraft(accountant, r.draftId))).toBe("FORBIDDEN");
    const other = await createTestSchool();
    const outsider = (await createTestUser(other.id, ["registrar"])).ctx;
    expect(await code(office.getOfficeDraft(outsider, r.draftId))).toBe("NOT_FOUND");
    expect((await office.getOfficeDraft(rehema, r.draftId)).form.firstName).toBe(((await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } })).payload as { firstName: string }).firstName);
  });
});

describe("adding an applicant to an interview date already set", () => {
  async function ready() {
    const r = await make();
    await office.recordApplicationFeeAtOffice(accountant, r.draftId, { method: "CASH" });
    const app = await db.application.findUniqueOrThrow({ where: { id: (await db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId } })).applicationId! } });
    const doc = await documents.uploadDocument(rehema, { applicationId: app.id }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
    await review.verifyDocument(rehema, doc.id, { status: "VERIFIED" });
    return app;
  }
  it("several applicants can join one start time with the same interviewer (an interview day) only when asked to; an overlapping different start is still a clash", async () => {
    const a = await ready(), b = await ready(), c = await ready();
    const interviewer = rehema.userId;
    const day = inDays(6, 8);
    await interviews.scheduleInterview(rehema, a.id, { scheduledAt: day, interviewerId: interviewer });
    expect(await code(interviews.scheduleInterview(rehema, b.id, { scheduledAt: day, interviewerId: interviewer }))).toBe("CONFLICT"); // never double-booked by accident
    await interviews.scheduleInterview(rehema, b.id, { scheduledAt: day, interviewerId: interviewer, allowSharedSlot: "on" }); // joining the date already set is a choice
    const slots = await interviews.upcomingInterviewSlots(rehema);
    expect(slots.find((s) => s.at.getTime() === new Date(day).getTime())).toMatchObject({ count: 2 });
    expect(await code(interviews.scheduleInterview(rehema, c.id, { scheduledAt: inDays(6, 8).replace("T08:00", "T08:15"), interviewerId: interviewer, allowSharedSlot: "on" }))).toBe("CONFLICT"); // an overlapping different start is still a clash
    expect(await code(interviews.upcomingInterviewSlots(teacher))).toBe("FORBIDDEN");
  });
});
