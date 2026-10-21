import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import * as admissions from "@/server/admissions";
import * as documents from "@/server/documents";
import * as flow from "@/server/admission-flow";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as fees from "@/server/fees";
import { getJoiningSettings, joiningView, updateJoiningSettings } from "@/server/joining";
import { joiningDocument, joiningPdf } from "@/server/joining-pdf";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser, ctxFor } from "../helpers";

/*
 * The joining instructions: what an accepted applicant (and their family) must pay and how, what to bring, when to report. Built from the offer,
 * Finance's verified payments and what the school typed; only the family that applied (and staff who read admissions) can open them.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, rehema: AuthContext, finance: AuthContext, parent: AuthContext, otherParent: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let n = 31000;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const zone = "Africa/Dar_es_Salaam";

async function accepted() {
  const a = await admissions.createApplication(rehema, { firstName: `Join${++n}`, lastName: `Case${n}`, dateOfBirth: "2018-05-04", gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [{ fullName: `Parent ${n}`, phone: `0763${String(n).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" }] });
  await documents.uploadDocument(rehema, { applicationId: a.id }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
  const d = new Date(`${todayInTimezone(zone)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 3);
  await flow.acceptReview(rehema, a.id, { papersChecked: true, scheduledAt: `${d.toISOString().slice(0, 10)}T10:00` });
  await db.interview.updateMany({ where: { applicationId: a.id, status: "SCHEDULED" }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
  expect(await flow.recordQuickResult(rehema, a.id, { outcome: "PASSED" })).toMatchObject({ landing: "payment" });
  return a;
}
/** The family's own record of an application (the draft that links it to their account). */
async function draftFor(user: AuthContext, applicationId: string) {
  return db.applicationDraft.create({ data: { schoolId: school.id, userId: user.userId, reference: `APF-T${++n}`, payload: {}, feeAmount: "0", status: "SUBMITTED", applicationId } });
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  rehema = (await createTestUser(school.id, ["registrar"])).ctx;
  finance = (await createTestUser(school.id, ["accountant"])).ctx;
  const p1 = await createTestUser(school.id, ["parent"]), p2 = await createTestUser(school.id, ["parent"]);
  await db.user.updateMany({ where: { id: { in: [p1.user.id, p2.user.id] } }, data: { type: "GUARDIAN" } });
  parent = await ctxFor(p1.user.id);
  otherParent = await ctxFor(p2.user.id);
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-join-"))));
  await policy.updateAdmissionPolicy(admin, { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "50000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 });
  await fees.updateFeeSettings(admin, { paymentInstructions: "Pay to the school account at the bank and keep the slip.", defaultDueDays: 14 });
});
afterAll(() => setStorageForTests(undefined));

describe("the school's joining settings", () => {
  it("are typed by the administrator only, one item per line, and read back as typed", async () => {
    expect(await code(updateJoiningSettings(rehema, { bringList: "Uniform" }))).toBe("FORBIDDEN");
    await updateJoiningSettings(admin, { reportingOn: "2027-01-12", reportingNote: "8:00 am at the school hall", bringList: "Two school uniforms\n- Exercise books\n\n  Birth certificate copy  ", notes: "Parents are welcome." });
    expect(await getJoiningSettings(db, school.id)).toEqual({ reportingOn: "2027-01-12", reportingNote: "8:00 am at the school hall", bringList: ["Two school uniforms", "Exercise books", "Birth certificate copy"], notes: "Parents are welcome." });
    expect(await code(updateJoiningSettings(admin, { reportingOn: "not a date" }))).toBe("VALIDATION");
  });
});

describe("the joining instructions of an accepted applicant", () => {
  it("show what to pay (from the offer and Finance), how to pay, what to bring and when to report; the family sees only its own; a payment updates what is owed", async () => {
    const a = await accepted();
    const v = await joiningView(rehema, a.id);
    expect(v).toMatchObject({ applicantName: `${a.firstName} ${a.lastName}`, applicationNo: a.applicationNo, className: "Standard I" });
    expect(v.fee).toMatchObject({ requiredCents: 5_000_000, verifiedCents: 0, balanceCents: 5_000_000, status: "AWAITING_PAYMENT", reference: a.applicationNo, howToPay: "Pay to the school account at the bank and keep the slip." });
    expect(v.settings.bringList).toHaveLength(3);
    expect(v.results).toEqual([]); // no entrance examination for this applicant: nothing invented

    // a payment recorded by Finance is pending until verified; verified money reduces what is owed
    const { payment } = await offers.recordAdmissionPayment(finance, a.id, { amount: "20000", method: "BANK", reference: `J-${a.id.slice(-6)}` });
    expect((await joiningView(rehema, a.id)).fee).toMatchObject({ verifiedCents: 0, pendingCents: 2_000_000, balanceCents: 5_000_000 });
    await offers.verifyAdmissionPayment(finance, payment.id);
    expect((await joiningView(rehema, a.id)).fee).toMatchObject({ verifiedCents: 2_000_000, balanceCents: 3_000_000, status: "PARTIAL" });

    // the family reads it with the id of its own application; another family, and the application id, are "not found"
    const draft = await draftFor(parent, a.id);
    expect((await joiningView(parent, draft.id)).applicantName).toBe(v.applicantName);
    expect(await code(joiningView(otherParent, draft.id))).toBe("NOT_FOUND");
    expect(await code(joiningView(parent, a.id))).toBe("NOT_FOUND");
    expect(await code(joiningView(finance, a.id))).toBe("FORBIDDEN"); // Finance does not read admissions

    // the document: English and Swahili, a real PDF, the figures formatted for reading
    const doc = await joiningDocument(parent, draft.id, "EN");
    expect(doc).toMatchObject({ className: "Standard I", reportingNote: "8:00 am at the school hall", bring: ["Two school uniforms", "Exercise books", "Birth certificate copy"] });
    expect(doc.fee.balance).toMatch(/30,000/);
    expect(doc.reportingDate).toMatch(/12 January 2027/);
    for (const lang of ["EN", "SW"] as const) {
      const bytes = await joiningPdf(parent, draft.id, lang);
      expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
      expect(bytes.length).toBeGreaterThan(2000);
    }
    expect(await code(joiningPdf(otherParent, draft.id, "EN"))).toBe("NOT_FOUND");
  });

  it("exists only once the applicant is accepted", async () => {
    const a = await admissions.createApplication(rehema, { firstName: "Not", lastName: `Yet${++n}`, dateOfBirth: "2018-05-04", gender: "MALE", classAppliedId: setup.cls.id, guardians: [{ fullName: "Parent X", phone: `0762${String(n).padStart(6, "0")}`, relationship: "FATHER", isPrimary: "on" }] });
    expect(await code(joiningView(rehema, a.id))).toBe("CONFLICT");
  });
});
