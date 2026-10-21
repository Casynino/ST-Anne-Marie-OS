import { randomUUID } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import * as admissions from "@/server/admissions";
import * as offers from "@/server/admission-offers";
import * as documents from "@/server/documents";
import * as interviews from "@/server/interviews";
import * as students from "@/server/students";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import type { AuthContext } from "@/lib/auth/context";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, headTeacher: AuthContext, teacher: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let n = 8000;
let storageDir: string;

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const guardian = (k: number) => ({ fullName: `Applicant Parent ${k}`, phone: `0765${String(k).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" });
const appInput = (k: number, extra: Record<string, unknown> = {}) => ({ firstName: `Applicant${k}`, lastName: `Family${k}`, dateOfBirth: "2019-05-04", gender: "MALE", classAppliedId: setup.cls.id, guardians: [guardian(k)], ...extra });
const next = () => ++n;

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

async function accepted(k = next(), extra: Record<string, unknown> = {}) {
  const app = await admissions.createApplication(registrar, appInput(k, extra));
  await offers.issueOffer(registrar, app.id, {}); // the default policy needs no interview, papers or admission fee
  return app;
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  headTeacher = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: [] });
  storageDir = await mkdtemp(path.join(tmpdir(), "sam-docs-"));
  setStorageForTests(new LocalDiskStorage(storageDir));
});

afterAll(() => setStorageForTests(undefined));

describe("applications and duplicate prevention", () => {
  it("creates an application with a number, an audit entry and no student", async () => {
    const before = await db.student.count({ where: { schoolId: school.id } });
    const app = await admissions.createApplication(registrar, appInput(next()));
    expect(app.status).toBe("APPLIED");
    expect(app.applicationNo).toMatch(new RegExp(`^APP/${new Date().getUTCFullYear()}/\\d{4}$`));
    expect(await db.student.count({ where: { schoolId: school.id } })).toBe(before); // applied != student
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.create", entityId: app.id } })).toBe(1);
    expect(await code(admissions.createApplication(accountant, appInput(next())))).toBe("FORBIDDEN");
    expect(await code(admissions.createApplication(teacher, appInput(next())))).toBe("FORBIDDEN");
    expect(await code(admissions.createApplication(registrar, { ...appInput(next()), guardians: [] }))).toBe("VALIDATION");
    expect(await code(admissions.createApplication(registrar, appInput(next(), { dateOfBirth: "2999-01-01" })))).toBe("VALIDATION");
  });

  it("refuses a second open application for the same child (name, case/space-insensitive, or birth certificate)", async () => {
    const k = next();
    await admissions.createApplication(registrar, appInput(k, { birthCertificateNo: `BC-${k}` }));
    expect(await code(admissions.createApplication(registrar, appInput(next(), { firstName: `  APPLICANT${k} `, lastName: `family${k}` })))).toBe("CONFLICT");
    expect(await code(admissions.createApplication(registrar, appInput(next(), { birthCertificateNo: `bc-${k}` })))).toBe("CONFLICT");
    // confirmDuplicate does NOT override an open application.
    expect(await code(admissions.createApplication(registrar, appInput(next(), { firstName: `Applicant${k}`, lastName: `Family${k}`, confirmDuplicate: "on" })))).toBe("CONFLICT");
  });

  it("lets only one of many simultaneous identical submissions through (service check + database index)", async () => {
    const k = next();
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => code(admissions.createApplication(registrar, appInput(next(), { firstName: `Twin${k}`, lastName: `Same${k}` })).then(() => null))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === "CONFLICT")).toHaveLength(5);
    expect(await db.application.count({ where: { schoolId: school.id, firstName: `Twin${k}` } })).toBe(1);
  });

  it("the database refuses open duplicates even if the application layer is bypassed", async () => {
    const k = next();
    const a = await admissions.createApplication(registrar, appInput(k));
    await expect(
      db.application.create({ data: { schoolId: school.id, applicationNo: `X/${k}`, firstName: a.firstName.toUpperCase(), lastName: a.lastName, dateOfBirth: a.dateOfBirth, gender: "MALE", guardians: [], createdById: registrar.userId } }),
    ).rejects.toThrow();
  });

  it("allows a new application after the earlier one was rejected, and warns about an existing student", async () => {
    const k = next();
    const first = await admissions.createApplication(registrar, appInput(k));
    await admissions.transitionApplication(registrar, first.id, { to: "REJECTED", reason: "No place this year" });
    const again = await admissions.createApplication(registrar, appInput(next(), { firstName: `Applicant${k}`, lastName: `Family${k}` }));
    expect(again.id).not.toBe(first.id);
    const s = await students.createStudent(registrar, studentInput(next(), { firstName: "Existing", lastName: "Pupil", dateOfBirth: "2018-02-02" }));
    const dupInput = appInput(next(), { firstName: "existing", lastName: "PUPIL", dateOfBirth: "2018-02-02" });
    expect(await code(admissions.createApplication(registrar, dupInput))).toBe("CONFLICT"); // matches student
    expect(s.admissionNo).toBeTruthy();
    expect((await admissions.createApplication(registrar, { ...dupInput, confirmDuplicate: "on" })).status).toBe("APPLIED");
  });

  it("issues distinct application numbers under concurrency", async () => {
    const apps = await Promise.all(Array.from({ length: 8 }, () => admissions.createApplication(registrar, appInput(next()))));
    expect(new Set(apps.map((a) => a.applicationNo)).size).toBe(8);
  });
});

describe("workflow", () => {
  it("follows Applied → Interview → Accepted, requires reasons to reject/withdraw, and keeps a history", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    await interviews.scheduleInterview(registrar, app.id, { scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString() }); // moves the application to Interview
    expect((await admissions.getApplication(registrar, app.id)).status).toBe("INTERVIEW");
    expect(await code(offers.issueOffer(registrar, app.id, {}))).toBe("CONFLICT"); // an interview is still scheduled: record its result first
    await interviews.cancelInterview(registrar, (await db.interview.findFirstOrThrow({ where: { applicationId: app.id } })).id, { reason: "Family asked to wait" });
    expect((await admissions.getApplication(registrar, app.id)).status).toBe("APPLIED"); // nothing left scheduled, so back to review
    await offers.issueOffer(registrar, app.id, {});
    expect(await code(admissions.transitionApplication(registrar, app.id, { to: "REJECTED" }))).toBe("VALIDATION"); // reason required
    expect(await code(admissions.transitionApplication(registrar, app.id, { to: "ENROLLED" }))).toBe("VALIDATION"); // only via enrol
    expect(await code(admissions.transitionApplication(registrar, app.id, { to: "ACCEPTED" }))).toBe("VALIDATION"); // only by issuing an offer
    await admissions.transitionApplication(registrar, app.id, { to: "WITHDRAWN", reason: "Family moved away" });
    expect(await code(admissions.transitionApplication(registrar, app.id, { to: "REJECTED", reason: "x" }))).toBe("CONFLICT"); // closed
    const detail = await admissions.getApplication(registrar, app.id);
    expect(detail.events.filter((e) => e.kind === "STATUS").map((e) => e.toStatus)).toEqual(["APPLIED", "INTERVIEW", "APPLIED", "ACCEPTED", "WITHDRAWN"]);
    expect(detail.decisionReason).toBe("Family moved away");
    expect((await db.admissionOffer.findFirstOrThrow({ where: { applicationId: app.id } })).status).toBe("WITHDRAWN"); // the offer closes with the application
    expect(await db.auditLog.count({ where: { schoolId: school.id, entityId: app.id, reason: "Family moved away" } })).toBe(1);
  });

  it("enforces permissions: reviewers decide, teachers and accountants cannot even read", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    expect(await code(offers.issueOffer(teacher, app.id, {}))).toBe("FORBIDDEN");
    expect(await code(admissions.getApplication(accountant, app.id))).toBe("FORBIDDEN");
    await offers.issueOffer(headTeacher, app.id, {}); // head teacher holds admission.review
    expect(await code(admissions.enrolApplication(headTeacher, app.id, {}))).toBe("FORBIDDEN"); // but not admission.enrol
  });

  it("does not let one school see or change another school's applications", async () => {
    const other = await createTestSchool("Other");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    const app = await admissions.createApplication(registrar, appInput(next()));
    expect(await code(admissions.getApplication(otherAdmin, app.id))).toBe("NOT_FOUND");
    expect(await code(offers.issueOffer(otherAdmin, app.id, {}))).toBe("NOT_FOUND");
    expect(await code(admissions.enrolApplication(otherAdmin, app.id, {}))).toBe("NOT_FOUND");
    expect((await admissions.listApplications(otherAdmin)).total).toBe(0);
  });
});

describe("enrolment (accepted ≠ enrolled)", () => {
  it("creates the student only at the enrol step, with admission number, guardians and class placement", async () => {
    const app = await accepted();
    expect(await db.student.count({ where: { schoolId: school.id, firstName: app.firstName } })).toBe(0);
    const student = await admissions.enrolApplication(registrar, app.id, { classId: setup.cls.id });
    expect(student.admissionNo).toMatch(new RegExp(`^${school.code}/${new Date().getUTCFullYear()}/\\d{4}$`));
    const profile = await students.getStudentProfile(registrar, student.id);
    expect(profile.guardians).toHaveLength(1);
    expect(profile.enrollments.find((e) => e.status === "ACTIVE")?.classId).toBe(setup.cls.id);
    const after = await admissions.getApplication(registrar, app.id);
    expect(after).toMatchObject({ status: "ENROLLED", studentId: student.id });
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT"); // already enrolled
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "admission.enrol", entityId: app.id } })).toBe(1);
  });

  it("cannot enrol applicants who are not accepted", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");
    await admissions.transitionApplication(registrar, app.id, { to: "REJECTED", reason: "Over capacity" });
    expect(await code(admissions.enrolApplication(registrar, app.id, {}))).toBe("CONFLICT");
  });

  it("creates exactly one student when several people press Enrol at once", async () => {
    const app = await accepted();
    const results = await Promise.all(Array.from({ length: 4 }, () => code(admissions.enrolApplication(registrar, app.id, {}))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(await db.student.count({ where: { schoolId: school.id, firstName: app.firstName } })).toBe(1);
  });

  it("rolls everything back when enrolment fails: no student, no admission number consumed by a ghost, application stays accepted", async () => {
    const app = await accepted();
    const bad = randomUUID();
    expect(await code(admissions.enrolApplication(registrar, app.id, { classId: bad }))).toBe("NOT_FOUND");
    expect((await admissions.getApplication(registrar, app.id)).status).toBe("ACCEPTED");
    expect(await db.student.count({ where: { schoolId: school.id, firstName: app.firstName } })).toBe(0);
    expect((await admissions.enrolApplication(registrar, app.id, {})).admissionNo).toBeTruthy(); // can retry
  });

  it("asks for confirmation when the applicant matches an existing student, and for a shared guardian phone", async () => {
    const k = next();
    const first = await admissions.createApplication(registrar, appInput(k, { dateOfBirth: "2017-07-07" }));
    await offers.issueOffer(registrar, first.id, {});
    await admissions.enrolApplication(registrar, first.id, {});
    // A different child with the same guardian phone: needs explicit confirmation at enrolment.
    const sibling = await accepted(next(), { guardians: [{ ...guardian(k), fullName: "Someone Else" }] });
    expect(await code(admissions.enrolApplication(registrar, sibling.id, {}))).toBe("CONFLICT");
    const s2 = await admissions.enrolApplication(registrar, sibling.id, { confirmSharedPhone: "on" });
    expect(s2.id).toBeTruthy();
  });

  it("keeps admission numbers unique across direct registration, admissions and concurrent enrolments", async () => {
    const apps = await Promise.all(Array.from({ length: 5 }, () => accepted()));
    const [fromAdmissions, direct] = await Promise.all([
      Promise.all(apps.map((a) => admissions.enrolApplication(registrar, a.id, {}))),
      Promise.all(Array.from({ length: 5 }, () => students.createStudent(registrar, studentInput(next())))),
    ]);
    const all = [...fromAdmissions, ...direct].map((s) => s.admissionNo);
    expect(new Set(all).size).toBe(10);
    // Numbers are never reissued: withdrawing a student does not free the number.
    await students.changeStudentStatus(registrar, fromAdmissions[0]!.id, { status: "WITHDRAWN", reason: "Left", effectiveOn: new Date().toISOString().slice(0, 10) });
    const later = await students.createStudent(registrar, studentInput(next()));
    expect(all).not.toContain(later.admissionNo);
    // The database itself refuses a duplicate admission number.
    await expect(db.student.create({ data: { schoolId: school.id, admissionNo: all[0]!, firstName: "X", lastName: "Y", dateOfBirth: new Date("2018-01-01"), gender: "MALE", admissionDate: new Date() } })).rejects.toThrow();
  });
});

describe("documents", () => {
  it("stores allowed files under random keys and never trusts the client-supplied name or type", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    const doc = await documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "BIRTH_CERTIFICATE", fileName: "../../etc/passwd/birth cert.pdf", bytes: PDF });
    expect(doc.fileName).toBe("birth cert.pdf");
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.storageKey).not.toContain("birth");
    expect(doc.storageKey).toMatch(new RegExp(`^${school.id}/\\d{4}/[0-9a-f-]{36}\\.pdf$`));
    const files = await readdir(path.join(storageDir, school.id), { recursive: true });
    expect(files.some((f) => String(f).endsWith(".pdf"))).toBe(true);
    // PNG accepted; a script renamed to .pdf, an empty file, an unknown type and an oversize file are not.
    await documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "PASSPORT_PHOTO", fileName: "photo.png", bytes: PNG });
    expect(await code(documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "OTHER", fileName: "report.pdf", bytes: Buffer.from("#!/bin/sh\nrm -rf /\n") }))).toBe("VALIDATION");
    expect(await code(documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "OTHER", fileName: "empty.pdf", bytes: Buffer.alloc(0) }))).toBe("VALIDATION");
    expect(await code(documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "OTHER", fileName: "big.pdf", bytes: Buffer.concat([PDF, Buffer.alloc(documents.MAX_DOCUMENT_BYTES)]) }))).toBe("VALIDATION");
    expect(await code(documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "WEIRD", fileName: "a.pdf", bytes: PDF }))).toBe("VALIDATION");
    expect(await db.document.count({ where: { applicationId: app.id } })).toBe(2);
  });

  it("checks permissions and school on every access, and audits downloads and deletions", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    const doc = await documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "TRANSFER_LETTER", fileName: "letter.pdf", bytes: PDF });
    expect(await code(documents.uploadDocument(accountant, { applicationId: app.id }, { docType: "OTHER", fileName: "x.pdf", bytes: PDF }))).toBe("FORBIDDEN");
    expect(await code(documents.downloadDocument(teacher, doc.id))).toBe("FORBIDDEN");
    expect(await code(documents.downloadDocument(accountant, doc.id))).toBe("FORBIDDEN");
    const other = await createTestSchool("Other docs");
    const otherAdmin = (await createTestUser(other.id, ["super_admin"])).ctx;
    expect(await code(documents.downloadDocument(otherAdmin, doc.id))).toBe("NOT_FOUND");
    expect(await code(documents.listDocuments(otherAdmin, { applicationId: app.id }))).toBe("NOT_FOUND");

    const file = await documents.downloadDocument(registrar, doc.id);
    expect(file.bytes.equals(PDF)).toBe(true);
    expect(file).toMatchObject({ mimeType: "application/pdf", fileName: "letter.pdf" });
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "document.download", entityId: doc.id, actorId: registrar.userId } })).toBe(1);

    expect(await code(documents.deleteDocument(registrar, doc.id, "duplicate"))).toBe("FORBIDDEN"); // registrar lacks document.delete
    expect(await code(documents.deleteDocument(headTeacher, doc.id, ""))).toBe("VALIDATION");
    await documents.deleteDocument(headTeacher, doc.id, "Uploaded by mistake");
    expect(await code(documents.downloadDocument(registrar, doc.id))).toBe("NOT_FOUND");
    expect((await documents.listDocuments(registrar, { applicationId: app.id })).length).toBe(0);
    expect(await db.auditLog.count({ where: { schoolId: school.id, action: "document.delete", entityId: doc.id } })).toBe(1);
  });

  it("follows the applicant to the student record after enrolment and is limited by student access rules", async () => {
    const app = await accepted();
    const doc = await documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "PREVIOUS_REPORT", fileName: "report.pdf", bytes: PDF });
    const student = await admissions.enrolApplication(registrar, app.id, {});
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).studentId).toBe(student.id);
    expect((await documents.listDocuments(registrar, { studentId: student.id })).map((d) => d.id)).toEqual([doc.id]);
    // A teacher with only student.read_assigned and no assignment cannot reach the student's documents.
    const reader = (await createTestUser(school.id, ["class_teacher"])).ctx;
    expect(await code(documents.listDocuments(reader, { studentId: student.id }))).toBe("FORBIDDEN"); // no document.read
  });

  it("fails closed when storage is not configured", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    setStorageForTests(null);
    try {
      expect(await code(documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "OTHER", fileName: "a.pdf", bytes: PDF }))).toBe("VALIDATION");
    } finally {
      setStorageForTests(new LocalDiskStorage(storageDir));
    }
    expect(await db.document.count({ where: { applicationId: app.id } })).toBe(0);
  });

  it("caps the number of documents per owner", async () => {
    const app = await admissions.createApplication(registrar, appInput(next()));
    for (let i = 0; i < documents.MAX_DOCUMENTS_PER_OWNER; i++) await documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "OTHER", fileName: `d${i}.pdf`, bytes: PDF });
    expect(await code(documents.uploadDocument(registrar, { applicationId: app.id }, { docType: "OTHER", fileName: "one-more.pdf", bytes: PDF }))).toBe("CONFLICT");
  });
});
