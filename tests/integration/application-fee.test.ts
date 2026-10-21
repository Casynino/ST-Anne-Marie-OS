import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { authenticate } from "@/lib/auth/login";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { signBody } from "@/lib/payments/providers";
import * as admissions from "@/server/admissions";
import * as draft from "@/server/application-draft";
import * as documents from "@/server/documents";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import * as fee from "@/server/application-fee";
import { applicationFormPdf, applicationReceiptPdf } from "@/server/application-pdf";
import * as policy from "@/server/admission-policy";
import { financeOverview } from "@/server/finance-reports";
import { processProviderEvent } from "@/server/payment-events";
import * as pub from "@/server/public-applications";
import * as website from "@/server/website";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/*
 * A family applies online: it gets an account, the application waits as a draft, and only the payment provider's confirmation of the
 * application fee sends it to the Admissions Office. The family can then download its form and receipt, and the account becomes the
 * guardian's portal account when the child is enrolled.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let n = 710000 + Math.floor(Math.random() * 8_000_000); // phones and emails are unique across the persistent test database
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const meta = () => ({ ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, userAgent: "t" });
const POLICY = { requireInterview: "", requiredDocTypes: [], admissionFee: "0", requirePaymentBeforeEnrol: "on", offerValidDays: 0, allowDirectRegistration: "on", interviewMinutes: 30, applicationPhotoRequired: "on" };
const PASSWORD = "Sunrise2026ok";
// A real 1x1 PNG and a minimal PDF, so the file type checks (decided from the bytes) are exercised.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);

function form(extra: Record<string, unknown> = {}) {
  const k = n++;
  return {
    firstName: `Neema${k}`, lastName: `Family${k}`, dateOfBirth: "2019-03-03", gender: "FEMALE", classAppliedId: setup.cls.id,
    g1_fullName: `Mama ${k}`, g1_phone: `0744${String(k % 1_000_000).padStart(6, "0")}`, g1_email: `fam-${k}@school.example`, g1_relationship: "MOTHER",
    password: PASSWORD, password2: PASSWORD, consent: "on", website: "", ...extra,
  };
}
const apply = (input: Record<string, unknown>, opts: { userId?: string | null } = {}) => pub.submitOnlineApplication(school.id, input, meta(), opts);
const draftOf = (id: string) => db.applicationDraft.findUniqueOrThrow({ where: { id } });
async function familyOf(draftId: string) {
  const d = await draftOf(draftId);
  return buildAuthContext(d.userId);
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
  await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
  delete process.env.PAYMENTS_SANDBOX;
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-apf-"))));
});
afterAll(() => { delete process.env.PAYMENTS_SANDBOX; setStorageForTests(undefined); });

describe("the fee and the account", () => {
  it("the form is not offered while no way to pay online exists", async () => {
    expect((await fee.applicationFeeInfo(school.id)).ready).toBe(false);
    expect(await code(apply(form()))).toBe("CONFLICT");
    expect(await db.user.count({ where: { schoolId: school.id, type: "GUARDIAN" } })).toBe(0); // nothing was created
    process.env.PAYMENTS_SANDBOX = "1";
    expect(await fee.applicationFeeInfo(school.id)).toMatchObject({ feeCents: 1_000_000, ready: true, sandbox: true });
  });

  it("applying creates the family's account and a draft; the Admissions Office sees nothing yet", async () => {
    const input = form();
    const r = await apply(input);
    expect(r).toMatchObject({ applicationNo: null, accountCreated: true });
    const d = await draftOf(r.draftId!);
    expect(d).toMatchObject({ status: "AWAITING_PAYMENT", paidAt: null, applicationId: null });
    expect(d.reference).toMatch(/^APF-[A-Z2-9]{8}$/);
    expect(Number(d.feeAmount)).toBe(10000);
    expect(JSON.stringify(d.payload)).not.toContain(PASSWORD); // the password is never kept with the application
    expect(await db.application.count({ where: { schoolId: school.id, firstName: input.firstName as string } })).toBe(0);
    expect(await db.workflowTask.count({ where: { schoolId: school.id, kind: "APPLICATION_REVIEW" } })).toBe(0);
    const user = await db.user.findUniqueOrThrow({ where: { id: d.userId }, include: { roles: { include: { role: true } } } });
    expect(user).toMatchObject({ type: "GUARDIAN", email: input.g1_email, mustChangePassword: false, status: "ACTIVE" });
    expect(user.roles.map((x) => x.role.key)).toEqual(["parent"]);
    const login = await authenticate(input.g1_email as string, PASSWORD, meta());
    expect(login).toMatchObject({ userType: "GUARDIAN", mustChangePassword: false });
  });

  it("checks the email, the password and the confirmation; a taken email never reveals who owns it", async () => {
    expect(await code(apply(form({ g1_email: "" })))).toBe("VALIDATION");
    expect(await code(apply(form({ password: "short", password2: "short" })))).toBe("VALIDATION");
    expect(await code(apply(form({ password2: "Different2026ok" })))).toBe("VALIDATION");
    const taken = form();
    await apply(taken);
    const again = await apply(form({ g1_email: taken.g1_email })).catch((e) => e as AppError);
    expect(again).toBeInstanceOf(AppError);
    expect((again as AppError).message).toMatch(/could not create an account/i);
    expect((again as AppError).message).not.toContain(String(taken.g1_email));
  });

  it("a family cannot open someone else's application or cancel it", async () => {
    const a = await apply(form()), b = await apply(form());
    const famA = await familyOf(a.draftId!), famB = await familyOf(b.draftId!);
    expect((await fee.getMyApplication(famA, a.draftId!)).childName).toMatch(/^Neema/);
    expect(await code(fee.getMyApplication(famB, a.draftId!))).toBe("NOT_FOUND");
    expect(await code(fee.cancelMyApplication(famB, a.draftId!))).toBe("NOT_FOUND");
    expect((await fee.myApplications(famA)).map((x) => x.id)).toEqual([a.draftId]);
  });
});

describe("paying: only the provider's confirmation submits the application", () => {
  let draftId: string, reference: string, input: ReturnType<typeof form>;

  it("nothing can be downloaded before the fee is paid", async () => {
    input = form();
    draftId = (await apply(input)).draftId!;
    reference = (await draftOf(draftId)).reference;
    const fam = await familyOf(draftId);
    expect(await code(applicationFormPdf(fam, draftId, "EN"))).toBe("CONFLICT");
    expect(await code(applicationReceiptPdf(fam, draftId, "EN"))).toBe("CONFLICT");
  });

  it("a wrong amount or currency changes nothing", async () => {
    const base = { schoolId: school.id, reference, provider: "selcom", providerEventId: `E-${randomUUID()}`, meta: meta() };
    expect(await fee.confirmApplicationFee({ ...base, amountCents: 500_000, currency: "TZS" })).toMatchObject({ outcome: "MISMATCH" });
    expect(await fee.confirmApplicationFee({ ...base, amountCents: 1_000_000, currency: "USD" })).toMatchObject({ outcome: "MISMATCH" });
    expect(await fee.confirmApplicationFee({ ...base, reference: "APF-ZZZZZZZZ", amountCents: 1_000_000, currency: "TZS" })).toMatchObject({ outcome: "UNKNOWN" });
    expect((await draftOf(draftId)).status).toBe("AWAITING_PAYMENT");
  });

  it("the confirmation submits the application, once, with a receipt number", async () => {
    const fam = await familyOf(draftId);
    const r = await fee.sandboxPay(fam, draftId, meta());
    expect(r.outcome).toBe("SUBMITTED");
    const d = await draftOf(draftId);
    expect(d).toMatchObject({ status: "SUBMITTED", paymentProvider: "sandbox" });
    expect(Number(d.paidAmount)).toBe(10000);
    expect(d.receiptNo).toMatch(/^APR\/\d{4}\/\d{5}$/);
    const app = await db.application.findUniqueOrThrow({ where: { id: d.applicationId! } });
    expect(app).toMatchObject({ status: "APPLIED", source: "ONLINE", firstName: input.firstName });
    expect(await db.workflowTask.count({ where: { schoolId: school.id, kind: "APPLICATION_REVIEW", relatedId: app.id } })).toBe(1);
    expect(await code(fee.sandboxPay(fam, draftId, meta()))).toBe("CONFLICT"); // not waiting any more
    // The same notification again changes nothing; a second payment for the same reference is reported, not absorbed.
    const same = { schoolId: school.id, reference, provider: "sandbox", providerEventId: d.paymentEventId!, amountCents: 1_000_000, currency: "TZS", meta: meta() };
    expect((await fee.confirmApplicationFee(same)).outcome).toBe("ALREADY");
    expect((await fee.confirmApplicationFee({ ...same, providerEventId: `E-${randomUUID()}` })).outcome).toBe("DUPLICATE_PAYMENT");
    expect(await db.application.count({ where: { schoolId: school.id, firstName: input.firstName as string } })).toBe(1);
  });

  it("a paid application can be downloaded as a form and a receipt, by its family and by admissions staff only", async () => {
    const fam = await familyOf(draftId);
    const formPdf = await applicationFormPdf(fam, draftId, "EN");
    const receipt = await applicationReceiptPdf(fam, draftId, "SW");
    for (const bytes of [formPdf, receipt]) expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await applicationFormPdf(registrar, draftId, "EN")).length).toBeGreaterThan(500);
    const other = await familyOf((await apply(form())).draftId!);
    expect(await code(applicationFormPdf(other, draftId, "EN"))).toBe("NOT_FOUND");
    expect(await code(applicationReceiptPdf(other, draftId, "EN"))).toBe("NOT_FOUND");
    const teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
    expect(await code(applicationFormPdf(teacher, draftId, "EN"))).toBe("FORBIDDEN");
  });

  it("the confirmed fee is part of the cash position, and the finance list shows it", async () => {
    const o = await financeOverview(admin, {});
    expect(o?.admissionFees.application).toBeGreaterThanOrEqual(1_000_000);
    const ledger = await fee.applicationFeeLedger(accountant);
    expect(ledger.rows.find((r) => r.reference === reference)).toMatchObject({ status: "SUBMITTED", paidCents: 1_000_000 });
    expect(await code(fee.applicationFeeLedger((await createTestUser(school.id, ["class_teacher"])).ctx))).toBe("FORBIDDEN");
  });

  it("a payment is never edited or erased in the database", async () => {
    await expect(db.applicationDraft.delete({ where: { id: draftId } })).rejects.toThrow();
    await expect(db.applicationDraft.update({ where: { id: draftId }, data: { paidAmount: "1.00" } })).rejects.toThrow();
  });
});

describe("the provider's signed notification", () => {
  it("confirms the fee by its reference, is idempotent and refuses a bad signature", async () => {
    const draftId = (await apply(form())).draftId!;
    const reference = (await draftOf(draftId)).reference;
    const env = { PAYMENTS_SELCOM_WEBHOOK_SECRET: "test-secret-1234567890", PAYMENTS_SCHOOL_CODE: school.code };
    const body = JSON.stringify({ eventId: `EV-${randomUUID()}`, status: "SUCCESS", amount: 10000, currency: "TZS", reference, msisdn: "255744000111" });
    const headers = (sig: string) => ({ get: (k: string) => (k.toLowerCase() === "x-signature" ? sig : null) });
    expect((await processProviderEvent("selcom", body, headers("bad"), meta(), env)).status).toBe(401);
    expect((await draftOf(draftId)).status).toBe("AWAITING_PAYMENT");
    const ok = await processProviderEvent("selcom", body, headers(signBody(env.PAYMENTS_SELCOM_WEBHOOK_SECRET, body)), meta(), env);
    expect(ok).toMatchObject({ status: 200, body: { status: "POSTED" } });
    expect((await draftOf(draftId)).status).toBe("SUBMITTED");
    const again = await processProviderEvent("selcom", body, headers(signBody(env.PAYMENTS_SELCOM_WEBHOOK_SECRET, body)), meta(), env);
    expect(again.body).toMatchObject({ duplicate: true });
    expect(await db.application.count({ where: { id: (await draftOf(draftId)).applicationId! } })).toBe(1);
    expect(await db.paymentEvent.findFirstOrThrow({ where: { schoolId: school.id, reference } })).toMatchObject({ status: "POSTED", paymentId: null });
    expect(await db.payment.count({ where: { schoolId: school.id, reference: { contains: reference } } })).toBe(0); // it is not a school-fee payment
  });

  it("a provider payment for the wrong amount waits for Finance and submits nothing", async () => {
    const draftId = (await apply(form())).draftId!;
    const reference = (await draftOf(draftId)).reference;
    const env = { PAYMENTS_SELCOM_WEBHOOK_SECRET: "test-secret-1234567890", PAYMENTS_SCHOOL_CODE: school.code };
    const body = JSON.stringify({ eventId: `EV-${randomUUID()}`, status: "SUCCESS", amount: 2000, currency: "TZS", reference });
    const r = await processProviderEvent("selcom", body, { get: () => signBody(env.PAYMENTS_SELCOM_WEBHOOK_SECRET, body) }, meta(), env);
    expect(r.body).toMatchObject({ status: "MISMATCH" });
    expect((await draftOf(draftId)).status).toBe("AWAITING_PAYMENT");
    expect(await db.paymentEvent.findFirstOrThrow({ where: { schoolId: school.id, reference } })).toMatchObject({ status: "UNMATCHED" });
  });
});

describe("edge cases", () => {
  it("a family can cancel before paying; a payment that still arrives is honoured, not lost", async () => {
    const draftId = (await apply(form())).draftId!;
    const fam = await familyOf(draftId);
    await fee.cancelMyApplication(fam, draftId);
    expect((await draftOf(draftId)).status).toBe("CANCELLED");
    expect(await code(fee.cancelMyApplication(fam, draftId))).toBe("CONFLICT");
    const r = await fee.confirmApplicationFee({ schoolId: school.id, reference: (await draftOf(draftId)).reference, provider: "selcom", providerEventId: `E-${randomUUID()}`, amountCents: 1_000_000, currency: "TZS", meta: meta() });
    expect(r.outcome).toBe("SUBMITTED");
  });

  it("if the money arrives but the application cannot be created, the payment is kept and Finance is told", async () => {
    const input = form();
    const draftId = (await apply(input)).draftId!;
    // Meanwhile the office registers the same child, so a second open application is not allowed.
    await admissions.createApplication(registrar, { firstName: input.firstName, lastName: input.lastName, dateOfBirth: "2019-03-03", gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [{ fullName: "Someone", phone: `0765${String(n++ % 1_000_000).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" }] });
    const reference = (await draftOf(draftId)).reference;
    const r = await fee.confirmApplicationFee({ schoolId: school.id, reference, provider: "selcom", providerEventId: `E-${randomUUID()}`, amountCents: 1_000_000, currency: "TZS", meta: meta() });
    expect(r.outcome).toBe("HOLD");
    const d = await draftOf(draftId);
    expect(d).toMatchObject({ status: "PAID_HOLD", applicationId: null });
    expect(Number(d.paidAmount)).toBe(10000);
    expect(d.receiptNo).toMatch(/^APR\//);
    expect(await db.workflowTask.count({ where: { schoolId: school.id, kind: "APPLICATION_FEE_HOLD", relatedId: draftId, status: "PENDING" } })).toBe(1);
    expect((await fee.applicationFeeLedger(accountant)).rows.find((x) => x.id === draftId)?.status).toBe("PAID_HOLD");
  });

  it("the same child cannot be started twice under one account", async () => {
    const input = form();
    const first = await apply(input);
    const fam = await familyOf(first.draftId!);
    expect(await code(apply({ ...input, g1_email: "", password: "", password2: "" }, { userId: fam.userId }))).toBe("CONFLICT");
  });

  it("a signed-in family adds another child to its own account without a new password", async () => {
    const fam = await familyOf((await apply(form())).draftId!);
    const second = await apply(form({ g1_email: "", password: "", password2: "" }), { userId: fam.userId });
    expect(second).toMatchObject({ applicationNo: null, accountCreated: false });
    expect((await fee.myApplications(fam)).length).toBe(2);
  });

  it("without a fee the application goes straight to the office, and the family still gets an account and its form", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "0" });
    try {
      const r = await apply(form());
      expect(r.applicationNo).toMatch(/^APP\//);
      const d = await draftOf(r.draftId!);
      expect(d).toMatchObject({ status: "SUBMITTED", paidAt: null });
      const fam = await familyOf(r.draftId!);
      expect((await applicationFormPdf(fam, r.draftId!, "EN")).length).toBeGreaterThan(500);
      expect(await code(applicationReceiptPdf(fam, r.draftId!, "EN"))).toBe("CONFLICT"); // nothing was paid
      // An old-style submission (no password) still works and creates no account.
      const legacy = await apply(form({ password: "", password2: "", g1_email: "" }));
      expect(legacy.applicationNo).toMatch(/^APP\//);
      expect(legacy.draftId).toBeUndefined();
    } finally {
      await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000" });
    }
  });
});

describe("enrolment", () => {
  it("the family's account becomes the guardian's portal account of the enrolled child", async () => {
    const input = form();
    const { draftId } = await apply(input);
    const fam = await familyOf(draftId!);
    await fee.sandboxPay(fam, draftId!, meta());
    const appId = (await draftOf(draftId!)).applicationId!;
    await admissions.recordAdmissionDecision(registrar, appId, { outcome: "ACCEPTED" });
    const student = await admissions.enrolApplication(registrar, appId, {});
    const guardian = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: student.id } } } });
    expect(guardian.userId).toBe(fam.userId);
    const children = await (await import("@/server/portal")).myChildren(await buildAuthContext(fam.userId));
    expect(children.map((c) => c.id)).toEqual([student.id]);
  });
});

describe("review, change, add the photo and papers, confirm", () => {
  const photoOf = (fam: AuthContext, id: string) => draft.uploadMyDocument(fam, id, { docType: "PASSPORT_PHOTO", fileName: "child.png", bytes: PNG });

  it("shows the full application and what is still missing", async () => {
    const input = form({ religion: "Christian", birthCertificateNo: "BC-77", previousSchool: "Little Stars", previousClass: "Standard VI", healthNotes: "Allergic to peanuts", g1_occupation: "Nurse", g2_fullName: "Baba Test", g2_phone: `0755${String(n++ % 1_000_000).padStart(6, "0")}`, g2_relationship: "FATHER", ec_name: "Aunt Joy", ec_phone: `0766${String(n++ % 1_000_000).padStart(6, "0")}`, ec_relationship: "Aunt" });
    const id = (await apply(input)).draftId!;
    const fam = await familyOf(id);
    const r = await draft.getApplicationReview(fam, id);
    expect(r.form).toMatchObject({ religion: "Christian", birthCertificateNo: "BC-77", previousClass: "Standard VI", healthNotes: "Allergic to peanuts", g1_occupation: "Nurse", g2_fullName: "Baba Test", ec_name: "Aunt Joy" });
    expect(r.checklist).toMatchObject({ complete: false, photo: { required: true, present: false } });
    expect(r.confirmedAt).toBeNull();
    expect(await code(draft.getApplicationReview(await familyOf((await apply(form())).draftId!), id))).toBe("NOT_FOUND");
  });

  it("the family cannot confirm until the photo is added; the photo must be a picture", async () => {
    const id = (await apply(form())).draftId!;
    const fam = await familyOf(id);
    expect(await code(draft.confirmMyApplication(fam, id))).toBe("VALIDATION");
    expect(await code(draft.uploadMyDocument(fam, id, { docType: "PASSPORT_PHOTO", fileName: "scan.pdf", bytes: PDF }))).toBe("VALIDATION"); // a PDF is not a photo
    expect(await code(draft.uploadMyDocument(fam, id, { docType: "PASSPORT_PHOTO", fileName: "x.png", bytes: Buffer.from("not a file at all") }))).toBe("VALIDATION");
    await photoOf(fam, id);
    expect((await draft.getApplicationReview(fam, id)).checklist.complete).toBe(true);
    await draft.confirmMyApplication(fam, id);
    expect((await draftOf(id)).confirmedAt).not.toBeNull();
  });

  it("a new photo replaces the old one; changing a detail or removing a file takes the confirmation back", async () => {
    const input = form();
    const id = (await apply(input)).draftId!;
    const fam = await familyOf(id);
    const first = await photoOf(fam, id);
    const second = await photoOf(fam, id);
    expect((await draft.getApplicationReview(fam, id)).documents.map((d) => d.id)).toEqual([second.id]);
    await draft.confirmMyApplication(fam, id);
    await draft.updateMyApplication(fam, id, { ...input, previousSchool: "New School" });
    const after = await draft.getApplicationReview(fam, id);
    expect(after.form.previousSchool).toBe("New School");
    expect(after.confirmedAt).toBeNull();
    await draft.confirmMyApplication(fam, id);
    await draft.removeMyDocument(fam, second.id);
    expect((await draftOf(id)).confirmedAt).toBeNull();
    expect((await draft.getApplicationReview(fam, id)).checklist.complete).toBe(false);
    void first;
    expect(await code(draft.updateMyApplication(fam, id, { ...input, dateOfBirth: "1990-01-01" }))).toBe("VALIDATION");
  });

  it("only the family can open, remove or download its files", async () => {
    const id = (await apply(form())).draftId!;
    const fam = await familyOf(id);
    const other = await familyOf((await apply(form())).draftId!);
    const doc = await photoOf(fam, id);
    expect((await draft.downloadMyDocument(fam, doc.id)).mimeType).toBe("image/png");
    expect(await code(draft.downloadMyDocument(other, doc.id))).toBe("NOT_FOUND");
    expect(await code(draft.removeMyDocument(other, doc.id))).toBe("NOT_FOUND");
    expect(await code(draft.uploadMyDocument(other, id, { docType: "OTHER", fileName: "a.pdf", bytes: PDF }))).toBe("NOT_FOUND");
    expect(await code(draft.updateMyApplication(other, id, form()))).toBe("NOT_FOUND");
    expect(await code(draft.confirmMyApplication(other, id))).toBe("NOT_FOUND");
  });

  it("the papers the school requires must be added too, and the photo requirement can be switched off", async () => {
    await policy.updateAdmissionPolicy(admin, { ...POLICY, requiredDocTypes: ["BIRTH_CERTIFICATE"], applicationFee: "10000", applicationPhotoRequired: "" });
    try {
      const id = (await apply(form())).draftId!;
      const fam = await familyOf(id);
      expect((await draft.getApplicationReview(fam, id)).checklist).toMatchObject({ complete: false, photo: { required: false }, papers: [{ docType: "BIRTH_CERTIFICATE", present: false }] });
      expect(await code(draft.confirmMyApplication(fam, id))).toBe("VALIDATION");
      await draft.uploadMyDocument(fam, id, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
      await draft.confirmMyApplication(fam, id); // no photo needed
      expect((await draftOf(id)).confirmedAt).not.toBeNull();
    } finally {
      await policy.updateAdmissionPolicy(admin, { ...POLICY, applicationFee: "10000", applicationPhotoRequired: "on" });
    }
  });

  it("after payment the files belong to the application, staff see them, health notes stay private, and the enrolment carries the contact over", async () => {
    const input = form({ healthNotes: "Asthma", ec_name: "Uncle Sam", ec_phone: `0777${String(n++ % 1_000_000).padStart(6, "0")}`, ec_relationship: "Uncle" });
    const id = (await apply(input)).draftId!;
    const fam = await familyOf(id);
    await photoOf(fam, id);
    await draft.uploadMyDocument(fam, id, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
    await draft.confirmMyApplication(fam, id);
    expect((await fee.sandboxPay(fam, id, meta())).outcome).toBe("SUBMITTED");
    const d = await draftOf(id);
    const docs = await db.document.findMany({ where: { draftId: id, deletedAt: null } });
    expect(docs).toHaveLength(2);
    expect(docs.every((x) => x.applicationId === d.applicationId)).toBe(true);
    expect((await documents.listDocuments(registrar, { applicationId: d.applicationId! })).map((x) => x.docType).sort()).toEqual(["BIRTH_CERTIFICATE", "PASSPORT_PHOTO"]);
    expect(await code(draft.updateMyApplication(fam, id, input))).toBe("CONFLICT"); // sent: the office owns it now
    expect(await code(draft.removeMyDocument(fam, docs[0]!.id))).toBe("FORBIDDEN");
    await draft.uploadMyDocument(fam, id, { docType: "OTHER", fileName: "extra.pdf", bytes: PDF }); // more papers can still be added
    expect((await db.document.findFirstOrThrow({ where: { draftId: id, fileName: "extra.pdf" } })).applicationId).toBe(d.applicationId);
    const academic = (await createTestUser(school.id, ["academic_office"])).ctx; // may read applications, not medical notes
    expect((await admissions.getApplication(academic, d.applicationId!)).healthNotes).toBeNull();
    expect((await admissions.getApplication(admin, d.applicationId!)).healthNotes).toBe("Asthma");
    expect(Buffer.from(await applicationFormPdf(fam, id, "EN")).subarray(0, 5).toString()).toBe("%PDF-");

    await admissions.recordAdmissionDecision(registrar, d.applicationId!, { outcome: "ACCEPTED" });
    const student = await admissions.enrolApplication(admin, d.applicationId!, {}); // the administrator may write medical notes
    const full = await db.student.findUniqueOrThrow({ where: { id: student.id }, include: { emergencyContacts: true } });
    expect(full.emergencyContacts.map((c) => c.name)).toEqual(["Uncle Sam"]);
    expect(full.medicalNotes).toBe("Asthma");
  });

  it("the registrar, who may write medical notes, carries them over; the application keeps its own copy", async () => {
    const id = (await apply(form({ healthNotes: "Eczema" }))).draftId!;
    const fam = await familyOf(id);
    await fee.sandboxPay(fam, id, meta());
    const appId = (await draftOf(id)).applicationId!;
    await admissions.recordAdmissionDecision(registrar, appId, { outcome: "ACCEPTED" });
    const student = await admissions.enrolApplication(registrar, appId, {});
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).medicalNotes).toBe("Eczema");
    expect((await db.application.findUniqueOrThrow({ where: { id: appId } })).healthNotes).toBe("Eczema");
  });
});
