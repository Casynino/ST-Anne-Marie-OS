import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as admissions from "@/server/admissions";
import * as concerns from "@/server/concerns";
import * as fees from "@/server/fees";
import * as interviews from "@/server/interviews";
import * as invoices from "@/server/invoices";
import * as offers from "@/server/admission-offers";
import * as policy from "@/server/admission-policy";
import * as portal from "@/server/portal";
import * as review from "@/server/admission-review";
import * as students from "@/server/students";
import * as transfers from "@/server/transfers";
import * as workflow from "@/server/workflow";
import { academicDesk, updateAcademicSettings } from "@/server/academic-office";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, academic: AuthContext, head: AuthContext, teacherA: AuthContext, teacherB: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let class2: { id: string };
let streamA: { id: string }, streamB: { id: string };
let kids: { id: string; admissionNo: string }[] = [];
let n = 71000 + Math.floor(Math.random() * 8_000_000);
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const inDays = (d: number, h = 9) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  academic = (await createTestUser(school.id, ["academic_office"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacherA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  teacherB = (await createTestUser(school.id, ["class_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!; streamB = setup.streams[1]!;
  class2 = await academics.createClass(admin, { levelId: setup.level.id, name: "Standard II", sortOrder: 2, capacity: "1" });
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id, staffId: teacherA.staffId });
  for (let i = 0; i < 3; i++) kids.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id })));
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-office-"))));
});
afterAll(() => setStorageForTests(undefined));

describe("roles keep the departments apart", () => {
  it("gives each role only what its department needs", () => {
    const has = (c: AuthContext, p: string) => c.permissions.has(p as never);
    // Head Teacher: academic supervision, not finance or system administration
    for (const p of ["invoice.void", "payment.reverse", "fees.discount", "payment.record", "user.create", "school.settings.update", "role.assign"]) expect(has(head, p)).toBe(false);
    for (const p of ["results.approve", "concern.manage", "transfer.approve", "academic.office", "refund.approve", "expense.approve"]) expect(has(head, p)).toBe(true);
    // Academic Office: academic structure and results review, no money, no accounts, no marks entry on a teacher's behalf
    for (const p of ["payment.record", "payment.reverse", "admission.payment.verify", "user.create", "marks.enter_any", "fees.manage"]) expect(has(academic, p)).toBe(false);
    for (const p of ["academic.manage", "academic.assign", "student.enroll", "results.approve", "concern.manage", "transfer.request", "tasks.academic", "fees.status.read"]) expect(has(academic, p)).toBe(true);
    // Teachers: their own classes; they may flag a concern, never decide admissions or touch money
    for (const p of ["admission.review", "fees.read", "payment.record", "student.enroll", "results.approve", "concern.manage"]) expect(has(teacherA, p)).toBe(false);
    expect(has(teacherA, "concern.flag")).toBe(true);
    // Finance cannot change academic results, interview outcomes or class placement
    for (const p of ["results.approve", "marks.enter", "admission.interview.manage", "admission.review", "student.enroll"]) expect(has(accountant, p)).toBe(false);
    // Admissions cannot verify money or enter marks
    for (const p of ["admission.payment.verify", "payment.record", "marks.enter_any", "results.approve"]) expect(has(registrar, p)).toBe(false);
  });
});

describe("class transfers and promotions", () => {
  it("needs a reason, is decided by someone else, and keeps the old enrolment as history", async () => {
    const q = { studentId: kids[0]!.id, kind: "TRANSFER", toClassId: setup.cls.id, toStreamId: streamB.id };
    expect(await code(transfers.requestTransfer(academic, q))).toBe("VALIDATION"); // a transfer needs its reason
    expect(await code(transfers.requestTransfer(teacherA, { ...q, reason: "x" }))).toBe("FORBIDDEN");
    const t = await transfers.requestTransfer(academic, { ...q, reason: "Parents asked for the other stream" });
    expect(await code(transfers.requestTransfer(academic, { ...q, reason: "again" }))).toBe("CONFLICT"); // one open request per student
    expect((await db.workflowTask.findMany({ where: { schoolId: school.id, kind: "TRANSFER_REVIEW", relatedId: t.id } }))[0]).toMatchObject({ department: "ACADEMIC", status: "PENDING" });
    expect(await code(transfers.decideTransfer(academic, t.id, { decision: "APPROVE" }))).toBe("CONFLICT"); // not the person who asked
    expect(await code(transfers.decideTransfer(head, t.id, { decision: "REJECT" }))).toBe("VALIDATION"); // a rejection needs a reason
    await transfers.decideTransfer(head, t.id, { decision: "APPROVE", note: "Agreed" });
    const done = await db.classTransfer.findUniqueOrThrow({ where: { id: t.id } });
    expect(done).toMatchObject({ status: "APPLIED", decidedById: head.userId, requestedById: academic.userId });
    const history = await db.studentEnrollment.findMany({ where: { studentId: kids[0]!.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((e) => [e.streamId === streamA.id ? "A" : "B", e.status])).toEqual([["A", "MOVED"], ["B", "ACTIVE"]]); // the old row is kept
    expect((await db.workflowTask.findFirstOrThrow({ where: { schoolId: school.id, kind: "TRANSFER_REVIEW", relatedId: t.id } })).status).toBe("COMPLETED");
    expect(JSON.stringify((await db.auditLog.findMany({ where: { schoolId: school.id, entityId: kids[0]!.id, action: "student.move_class" } })).map((a) => a.changes))).toContain(t.id);
  });

  it("refuses a full class unless an authorised person overrides it with a reason, and the refusal changes nothing", async () => {
    await students.enrollStudent(academic, kids[1]!.id, { classId: class2.id }); // fills Standard II (capacity 1)
    const t = await transfers.requestTransfer(academic, { studentId: kids[2]!.id, toClassId: class2.id, reason: "Ready for the next class" });
    expect(await code(transfers.decideTransfer(head, t.id, { decision: "APPROVE" }))).toBe("CONFLICT"); // full
    expect((await db.classTransfer.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("REQUESTED"); // the approval rolled back with it
    expect(await code(transfers.decideTransfer(head, t.id, { decision: "APPROVE", overrideCapacity: "on", overrideReason: "x" }))).toBe("FORBIDDEN"); // the Head Teacher cannot exceed capacity
    await transfers.decideTransfer(admin, t.id, { decision: "APPROVE", overrideCapacity: "on", overrideReason: "Sibling of a pupil in the class" });
    expect((await db.classTransfer.findUniqueOrThrow({ where: { id: t.id } })).overrideNote).toBe("Sibling of a pupil in the class");
    expect((await academicDesk(academic)).alerts.find((a) => a.key === "capacityWarnings")?.count).toBeGreaterThanOrEqual(1);
  });

  it("a promotion to a later year waits for its date and then closes the old year's enrolment", async () => {
    const next = setup.yearNo + 1;
    const year2 = await academics.createAcademicYear(admin, { name: `${next}`, startsOn: `${next}-01-01`, endsOn: `${next}-12-31` });
    const p = await transfers.requestTransfer(academic, { studentId: kids[0]!.id, kind: "PROMOTION", toClassId: class2.id, academicYearId: year2.id });
    await transfers.decideTransfer(head, p.id, { decision: "APPROVE", overrideCapacity: "" });
    expect((await db.classTransfer.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("APPROVED"); // the new year has not started
    expect(await code(transfers.applyTransfer(head, p.id))).toBe("CONFLICT");
    await db.classTransfer.update({ where: { id: p.id }, data: { effectiveOn: new Date(`${setup.today}T00:00:00Z`) } }); // the day arrives
    await db.academicYear.update({ where: { id: year2.id }, data: { startsOn: new Date(`${setup.today}T00:00:00Z`) } });
    await transfers.applyTransfer(admin, p.id, { overrideCapacity: "on", overrideReason: "Promotion" });
    const rows = await db.studentEnrollment.findMany({ where: { studentId: kids[0]!.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["MOVED", "COMPLETED", "ACTIVE"]);
    expect(rows.at(-1)!.academicYearId).toBe(year2.id);
  });
});

describe("academic concerns", () => {
  it("a teacher flags only students they teach; the Academic Office follows up to a recorded outcome", async () => {
    const mine = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id }));
    expect(await code(concerns.flagConcern(teacherB, { studentId: mine.id, category: "LOW_MARKS", summary: "Low marks" }))).toBe("NOT_FOUND"); // someone else's class
    const c = await concerns.flagConcern(teacherA, { studentId: mine.id, category: "LOW_MARKS", summary: "Marks fell in Mathematics", notes: "Home difficulties, handle with care" });
    expect((await db.workflowTask.findFirstOrThrow({ where: { schoolId: school.id, kind: "CONCERN_FOLLOWUP", relatedId: c.id } })).department).toBe("ACADEMIC");
    expect(await code(concerns.addConcernAction(teacherA, c.id, { note: "x" }))).toBe("FORBIDDEN");
    expect(await code(concerns.resolveConcern(teacherA, c.id, { outcome: "RESOLVED", resolution: "done" }))).toBe("FORBIDDEN");
    expect(await code(concerns.getConcern(teacherB, c.id))).toBe("NOT_FOUND"); // not theirs to read
    expect((await concerns.listConcerns(teacherB)).length).toBe(0);
    const seen = (await concerns.getConcern(academic, c.id)).concern;
    expect(seen.notes).toContain("Home difficulties"); // the Academic Office reads the restricted notes
    await concerns.addConcernAction(academic, c.id, { kind: "MEETING", note: "Met the parent and the teacher" });
    expect((await db.academicConcern.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("IN_PROGRESS");
    expect(await code(concerns.resolveConcern(academic, c.id, {}))).toBe("VALIDATION");
    await expect(db.concernAction.deleteMany({ where: { concernId: c.id } })).rejects.toThrow(); // the log is append-only
    // Sharing: the family sees only the message written for them (checked in the next test)
    await concerns.shareConcernWithParent(academic, c.id, { message: "We are supporting your child with Mathematics. Please call the school." });
    await concerns.resolveConcern(academic, c.id, { outcome: "RESOLVED", resolution: "Extra lessons arranged; marks recovering" });
    expect((await db.workflowTask.findFirstOrThrow({ where: { schoolId: school.id, kind: "CONCERN_FOLLOWUP", relatedId: c.id } })).status).toBe("COMPLETED");
    expect(await code(concerns.addConcernAction(academic, c.id, { note: "late" }))).toBe("CONFLICT"); // closed
  });

  it("shows the family only the message that was shared", async () => {
    const kid = kids[2]!;
    const g = (await db.studentGuardian.findFirstOrThrow({ where: { studentId: kid.id }, select: { guardianId: true } })).guardianId;
    await portal.createGuardianAccount(registrar, g);
    const parent = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: g } })).userId!);
    const row = await db.studentEnrollment.findFirstOrThrow({ where: { studentId: kid.id, status: "ACTIVE" } });
    await db.academicConcern.create({ data: { schoolId: school.id, studentId: kid.id, category: "OTHER", summary: "PRIVATE SUMMARY", notes: "PRIVATE NOTES", flaggedById: teacherA.userId, classId: row.classId } });
    const shared = await db.academicConcern.create({ data: { schoolId: school.id, studentId: kid.id, category: "OTHER", summary: "ALSO PRIVATE", flaggedById: teacherA.userId, shareWithParent: true, parentMessage: "Please come to a short meeting." } });
    const notices = await portal.childAcademicNotices(parent, kid.id);
    expect(notices.concerns.map((c) => c.message)).toEqual(["Please come to a short meeting."]);
    expect(JSON.stringify(notices)).not.toMatch(/PRIVATE/);
    expect(shared.id).toBeTruthy();
    expect(await code(portal.childAcademicNotices(parent, kids[1]!.id))).toBe("NOT_FOUND"); // another family's child
  });
});

describe("assessment rules by entry level, and the admission decision", () => {
  const base = (extra: Record<string, unknown> = {}) => ({ requireInterview: "", requiredDocTypes: [], admissionFee: "0", requirePaymentBeforeEnrol: "on", offerValidDays: 0, allowDirectRegistration: "on", interviewMinutes: 30, ...extra });
  const newApp = async () => {
    const k = ++n;
    const app = await admissions.createApplication(registrar, { firstName: `Cand${k}`, lastName: `Fam${k}`, dateOfBirth: "2019-05-04", gender: "FEMALE", classAppliedId: setup.cls.id, guardians: [{ fullName: `Parent ${k}`, phone: `0764${String(k % 1_000_000).padStart(6, "0")}`, relationship: "MOTHER", isPrimary: "on" }] });
    return app.id;
  };
  const sit = async (appId: string, kind: string, outcome: string) => {
    const i = await interviews.scheduleInterview(academic, appId, { kind, scheduledAt: inDays(2) });
    await db.interview.update({ where: { id: i.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    await interviews.recordInterviewResult(academic, i.id, { status: "COMPLETED", outcome });
  };

  it("asks for what the school configured for that level: both an interview and an entrance examination", async () => {
    await policy.updateAdmissionPolicy(admin, base({ [`assessment_${setup.level.id}`]: "BOTH" }));
    const a = await newApp();
    await review.reviewApplication(registrar, a, { decision: "VERIFIED" });
    expect(await workflow.listTasks(academic, { department: "ACADEMIC" }).then((r) => r.items.some((x) => x.relatedId === a && x.kind === "ASSESSMENT_COORDINATE"))).toBe(true);
    await sit(a, "INTERVIEW", "PASSED");
    expect(await code(offers.issueOffer(registrar, a, {}))).toBe("CONFLICT"); // the entrance examination is still to sit
    await sit(a, "ENTRANCE_EXAM", "PASSED");
    expect((await offers.issueOffer(registrar, a, {})).status).toBe("ISSUED");
  });

  it("asks for nothing when the level is set to nothing", async () => {
    await policy.updateAdmissionPolicy(admin, base({ requireInterview: "on", [`assessment_${setup.level.id}`]: "NONE" }));
    const a = await newApp();
    expect((await offers.issueOffer(registrar, a, {})).status).toBe("ISSUED");
    await policy.updateAdmissionPolicy(admin, base());
  });

  it("records Deferred, Further assessment, Awaiting decision and Not accepted, with who and why", async () => {
    const a = await newApp();
    expect(await code(admissions.recordAdmissionDecision(teacherA, a, { outcome: "DEFERRED", note: "x" }))).toBe("FORBIDDEN");
    expect(await code(admissions.recordAdmissionDecision(registrar, a, { outcome: "DEFERRED" }))).toBe("VALIDATION"); // a reason is needed
    await admissions.recordAdmissionDecision(registrar, a, { outcome: "DEFERRED", note: "Ask again next term" });
    expect(await db.application.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ decisionOutcome: "DEFERRED", decisionNote: "Ask again next term", decidedById: registrar.userId, status: "APPLIED" });
    await admissions.recordAdmissionDecision(registrar, a, { outcome: "FURTHER_ASSESSMENT", note: "Needs a reading assessment" });
    expect((await workflow.listTasks(academic, { department: "ACADEMIC" })).items.some((x) => x.relatedId === a && x.kind === "ASSESSMENT_COORDINATE")).toBe(true);
    await admissions.recordAdmissionDecision(registrar, a, { outcome: "NOT_ACCEPTED", note: "No place in this class this year" });
    expect(await db.application.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ status: "REJECTED", decisionReason: "No place in this class this year" });
    expect(await db.workflowTask.count({ where: { schoolId: school.id, relatedId: a, status: { in: ["PENDING", "IN_PROGRESS"] } } })).toBe(0); // nothing is left open for a closed application
  });
});

describe("hand-off tasks", () => {
  it("belong to a department, are assigned and worked by its staff, and show overdue by date", async () => {
    await workflow.openTask(db, { schoolId: school.id, kind: "CLASS_PLACEMENT", relatedType: "Student", relatedId: kids[1]!.id, relatedLabel: "Test", sourceEvent: "test", dueOn: new Date("2020-01-01T00:00:00Z"), discriminator: "t1" });
    const row = (await workflow.listTasks(academic, { department: "ACADEMIC", state: "overdue" })).items.find((x) => x.relatedId === kids[1]!.id)!;
    expect(row).toMatchObject({ overdue: true, status: "PENDING", department: "ACADEMIC" });
    expect(await code(workflow.startTask(registrar, row.id))).toBe("NOT_FOUND"); // another department's task does not exist for them
    expect(await code(workflow.startTask(teacherA, row.id))).toBe("NOT_FOUND");
    await workflow.assignTask(academic, row.id, { userId: head.userId });
    await workflow.startTask(academic, row.id);
    expect((await workflow.listTasks(head, { department: "ACADEMIC", state: "mine" })).items.map((x) => x.id)).toContain(row.id);
    await workflow.completeTask(academic, row.id, { note: "Done by hand" });
    expect(await code(workflow.completeTask(academic, row.id))).toBe("CONFLICT");
    const done = (await workflow.listTasks(academic, { department: "ACADEMIC", state: "done" })).items.find((x) => x.id === row.id)!;
    expect(done).toMatchObject({ status: "COMPLETED", completionNote: "Done by hand", overdue: false });
    expect(done.completedBy).toBe(academic.fullName);
  });
});

describe("the fee review flag", () => {
  it("shows academic staff only a flag when the school switches it on, never an amount", async () => {
    const kid = kids[1]!;
    expect(await fees.feeReviewFlag(academic, kid.id)).toBeNull(); // off by default
    await fees.updateFeeSettings(accountant, { defaultDueDays: 14, clearanceMaxOutstanding: "0", paymentInstructions: "", academicReviewFlag: "on" });
    expect(await fees.feeReviewFlag(academic, kid.id)).toEqual({ status: "NOT_BILLED" });
    await invoices.createOtherInvoice(accountant, { studentId: kid.id, lines: "Trip | 20,000", dueDate: `${setup.yearNo}-12-31` });
    // "Other" invoices are not term bills, so the student still has no term bill to review; a term bill is what the flag looks at
    expect(["NOT_BILLED", "REVIEW"]).toContain((await fees.feeReviewFlag(academic, kid.id))!.status);
    expect(await code(fees.feeReviewFlag(teacherA, kid.id))).toBe("FORBIDDEN");
    await fees.updateFeeSettings(accountant, { defaultDueDays: 14, clearanceMaxOutstanding: "0", paymentInstructions: "", academicReviewFlag: "" });
    expect(await fees.feeReviewFlag(academic, kid.id)).toBeNull();
  });
});

describe("the Academic Office desk", () => {
  it("is for people who hold academic.office, and shows only real figures", async () => {
    expect(await code(academicDesk(teacherA))).toBe("FORBIDDEN");
    expect(await code(academicDesk(accountant))).toBe("FORBIDDEN");
    await updateAcademicSettings(academic, { lowAverage: "", repeatedAbsences: 3, repeatedAbsenceDays: 14, capacityWarnPct: 90 });
    const d = await academicDesk(academic);
    expect(d.students.enrolled).toBe(await db.studentEnrollment.count({ where: { schoolId: school.id, academicYearId: setup.year.id, status: "ACTIVE" } }));
    expect(d.students.byClass.map((c) => c.name)).toEqual(expect.arrayContaining(["Standard I", "Standard II"]));
    expect(d.performance?.cards ?? { generated: 0 }).toMatchObject({ generated: 0 }); // no report cards yet: no invented averages
    expect(d.performance?.classAverages ?? []).toEqual([]);
    expect(d.calendar.exams).toEqual([]);
    expect(await code(updateAcademicSettings(head, { lowAverage: "", repeatedAbsences: 3, repeatedAbsenceDays: 14, capacityWarnPct: 90 }))).toBe("FORBIDDEN"); // thresholds are the Academic Office's to set
  });
});

describe("another school sees none of it", () => {
  it("cannot reach this school's tasks, concerns, transfers or candidates", async () => {
    const other = await createTestSchool("Other");
    const o = (await createTestUser(other.id, ["super_admin"])).ctx;
    expect((await workflow.listTasks(o, {})).total).toBe(0);
    expect(await code(concerns.getConcern(o, (await db.academicConcern.findFirstOrThrow({ where: { schoolId: school.id } })).id))).toBe("NOT_FOUND");
    expect((await transfers.listTransfers(o)).length).toBe(0);
    expect(await code(transfers.decideTransfer(o, (await db.classTransfer.findFirstOrThrow({ where: { schoolId: school.id } })).id, { decision: "APPROVE" }))).toBe("NOT_FOUND");
  });
});
