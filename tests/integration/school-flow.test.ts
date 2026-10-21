import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import * as academics from "@/server/academics";
import * as admissions from "@/server/admissions";
import * as att from "@/server/attendance";
import * as documents from "@/server/documents";
import * as exams from "@/server/exams";
import * as grading from "@/server/grading";
import * as interviews from "@/server/interviews";
import * as invoices from "@/server/invoices";
import * as marks from "@/server/marks";
import * as offers from "@/server/admission-offers";
import * as payments from "@/server/payments";
import * as policy from "@/server/admission-policy";
import * as portal from "@/server/portal";
import * as pub from "@/server/public-applications";
import * as rc from "@/server/report-cards";
import * as recruitment from "@/server/recruitment";
import * as review from "@/server/admission-review";
import * as students from "@/server/students";
import * as website from "@/server/website";
import * as workflow from "@/server/workflow";
import { academicDesk } from "@/server/academic-office";
import { admissionOverview } from "@/server/admission-queues";
import { generateFinanceTasks } from "@/server/finance-tasks";
import { LocalDiskStorage } from "@/lib/storage/local";
import { setStorageForTests } from "@/lib/storage";
import { createCurrentYearAcademics, createTestSchool, createTestUser } from "../helpers";

/*
 * One school, start to finish: an online application becomes an enrolled, placed student whose teacher takes attendance and enters marks,
 * the Academic Office approves them, the report card is published and the parent reads it; a teacher is recruited and onboarded; Finance
 * works the instalments. Every hand-off between departments is checked on the task it leaves.
 */

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, registrar: AuthContext, academic: AuthContext, head: AuthContext, teacher: AuthContext, teacher2: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let math: { id: string };
let appId: string, appNo: string, studentId: string, parent: AuthContext;
let n = 61000 + Math.floor(Math.random() * 9_000_000); // phones and emails are unique across the persistent test database
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200, 0x20)]);
const inDays = (d: number, h = 9) => { const t = new Date(Date.now() + d * 86_400_000); t.setUTCHours(h, 0, 0, 0); return t.toISOString(); };
const tasksOf = (kind: string, relatedId: string) => db.workflowTask.findMany({ where: { schoolId: school.id, kind, relatedId } });

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  academic = (await createTestUser(school.id, ["academic_office"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacher = (await createTestUser(school.id, ["class_teacher"])).ctx;
  teacher2 = (await createTestUser(school.id, ["class_teacher"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A"] });
  math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id]);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: setup.streams[0]!.id, staffId: teacher.staffId });
  await grading.createScale(admin, { name: "Scale", bands: "A | 80 | 100 | 1\nB | 60 | 79 | 2\nC | 40 | 59 | 3\nD | 0 | 39 | 4", isDefault: "on" });
  setStorageForTests(new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), "sam-school-"))));
  await website.updateWebsiteSettings(admin, { applicationsOpen: "on" });
  await policy.updateAdmissionPolicy(admin, { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "100000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 });
});
afterAll(() => setStorageForTests(undefined));

describe("1-8: from an online application to an enrolled applicant", () => {
  it("1-2. a parent applies online and the Admissions Office receives it as a task", async () => {
    const k = n++;
    const { applicationNo } = await pub.submitOnlineApplication(school.id, { firstName: `Neema${k}`, lastName: `Family${k}`, dateOfBirth: "2019-03-03", gender: "FEMALE", classAppliedId: setup.cls.id, g1_fullName: `Mama ${k}`, g1_phone: `0744${String(k % 1_000_000).padStart(6, "0")}`, g1_relationship: "MOTHER", consent: "on", website: "" }, { ip: `10.${k % 250}.${(k >> 3) % 250}.9`, userAgent: "t" } as never);
    const app = await db.application.findFirstOrThrow({ where: { schoolId: school.id, applicationNo: applicationNo! } });
    appId = app.id; appNo = app.applicationNo;
    expect(app).toMatchObject({ source: "ONLINE", status: "APPLIED", studentId: null });
    const t = await tasksOf("APPLICATION_REVIEW", appId);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ department: "ADMISSIONS", status: "PENDING", sourceEvent: "application.received_online", relatedType: "Application" });
    expect((await workflow.listTasks(registrar, { department: "ADMISSIONS" })).items.some((x) => x.relatedId === appId)).toBe(true);
    expect(await code(workflow.listTasks(registrar, { department: "ACADEMIC" }))).toBe("FORBIDDEN"); // another department's tasks are not theirs to see
  });

  it("3. when the papers are in order the Academic Office is asked to arrange the assessment", async () => {
    const doc = await documents.uploadDocument(registrar, { applicationId: appId }, { docType: "BIRTH_CERTIFICATE", fileName: "bc.pdf", bytes: PDF });
    await review.verifyDocument(registrar, doc.id, { status: "VERIFIED" });
    await review.reviewApplication(registrar, appId, { decision: "VERIFIED" });
    expect((await tasksOf("APPLICATION_REVIEW", appId))[0]!.status).toBe("COMPLETED");
    const ask = await tasksOf("ASSESSMENT_COORDINATE", appId);
    expect(ask).toHaveLength(1);
    expect(ask[0]).toMatchObject({ department: "ACADEMIC", status: "PENDING" });
    expect((await workflow.listTasks(academic, { department: "ACADEMIC" })).items.some((x) => x.relatedId === appId)).toBe(true);
  });

  it("4. the Academic Office schedules the interview; the interviewer gets the assignment", async () => {
    const i = await interviews.scheduleInterview(academic, appId, { kind: "INTERVIEW", scheduledAt: inDays(2), interviewerId: head.userId, location: "Head's office" });
    expect((await tasksOf("ASSESSMENT_COORDINATE", appId))[0]!.status).toBe("COMPLETED");
    const mine = await workflow.listTasks(head, { department: "ACADEMIC", state: "mine" });
    expect(mine.items.map((x) => x.kind)).toContain("INTERVIEW_ASSIGNED");
    await db.interview.update({ where: { id: i.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
    // The interviewer records the result with an academic recommendation
    await interviews.recordInterviewResult(head, i.id, { status: "COMPLETED", outcome: "PASSED", score: 85, notes: "Reads fluently", recommendation: "RECOMMEND", recommendationNote: "Ready for Standard I" });
    const row = (await interviews.interviewsOfApplication(registrar, appId))[0]!;
    expect(row).toMatchObject({ kind: "INTERVIEW", outcome: "PASSED", recommendation: "RECOMMEND" });
    expect((await tasksOf("INTERVIEW_ASSIGNED", appId))[0]!.status).toBe("COMPLETED");
  });

  it("5-6. the decision-maker accepts; Admissions and Finance each receive their task, and the family gets the fee information", async () => {
    expect(await tasksOf("DECISION_REVIEW", appId)).toHaveLength(1);
    expect(await code(admissions.recordAdmissionDecision(teacher, appId, { outcome: "ACCEPTED" }))).toBe("FORBIDDEN"); // a teacher cannot decide admissions
    await admissions.recordAdmissionDecision(registrar, appId, { outcome: "ACCEPTED" });
    expect((await tasksOf("DECISION_REVIEW", appId))[0]!.status).toBe("COMPLETED");
    expect((await tasksOf("OFFER_COMMUNICATE", appId))[0]).toMatchObject({ department: "ADMISSIONS", status: "PENDING" });
    expect((await tasksOf("ADMISSION_PAYMENT", appId))[0]).toMatchObject({ department: "FINANCE", status: "PENDING" });
    const app = await admissions.getApplication(registrar, appId);
    expect(app.status).toBe("ACCEPTED"); // accepted, not enrolled
    expect(app.studentId).toBeNull();
    const tracked = await pub.trackApplication(school.id, { applicationNo: appNo, phone: String((app.guardians[0] as { phone: string }).phone) }, { ip: `10.77.${n % 250}.1`, userAgent: "t" } as never);
    expect(tracked.offer).toMatchObject({ feeCents: 10_000_000 });
  });

  it("7. Finance records and verifies the admission payment; only then can Admissions enrol", async () => {
    expect(await code(admissions.enrolApplication(registrar, appId, {}))).toBe("CONFLICT");
    const { payment } = await offers.recordAdmissionPayment(accountant, appId, { amount: "100000", method: "CASH" });
    expect(await code(offers.verifyAdmissionPayment(registrar, payment.id))).toBe("FORBIDDEN");
    expect(await code(offers.verifyAdmissionPayment(academic, payment.id))).toBe("FORBIDDEN"); // the Academic Office cannot touch a financial transaction
    const v1 = await offers.verifyAdmissionPayment(accountant, payment.id);
    expect((await offers.verifyAdmissionPayment(accountant, payment.id)).receiptNo).toBe(v1.receiptNo); // 24: a retry does not issue a second receipt
    expect((await tasksOf("ADMISSION_PAYMENT", appId))[0]!.status).toBe("COMPLETED");
    expect((await tasksOf("ENROL_APPLICANT", appId))[0]).toMatchObject({ department: "ADMISSIONS", status: "PENDING" });
  });

  it("8 and 24. enrolment creates exactly one student, and a repeated request creates neither a second student nor a second task", async () => {
    const results = await Promise.all([1, 2, 3].map(() => code(admissions.enrolApplication(registrar, appId, {}))));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    const app = await db.application.findUniqueOrThrow({ where: { id: appId } });
    studentId = app.studentId!;
    expect(await db.student.count({ where: { schoolId: school.id, id: studentId } })).toBe(1);
    expect((await tasksOf("ENROL_APPLICANT", appId))[0]!.status).toBe("COMPLETED");
    const place = await tasksOf("CLASS_PLACEMENT", studentId);
    expect(place).toHaveLength(1);
    expect(place[0]).toMatchObject({ department: "ACADEMIC", status: "PENDING", relatedType: "Student" });
    expect(await db.studentEnrollment.count({ where: { studentId } })).toBe(0); // not on any roster yet
    await workflow.openTask(db, { schoolId: school.id, kind: "CLASS_PLACEMENT", relatedType: "Student", relatedId: studentId, sourceEvent: "student.enrolled" }); // the same event again
    expect(await tasksOf("CLASS_PLACEMENT", studentId)).toHaveLength(1);
  });
});

describe("9-13: class placement, teacher access and attendance", () => {
  it("9-11. the Academic Office places the student; the right teacher sees them and the other does not", async () => {
    const desk = await academicDesk(academic);
    expect(desk.alerts.find((a) => a.key === "awaitingPlacement")?.count).toBeGreaterThanOrEqual(1);
    expect(await code(students.enrollStudent(teacher, studentId, { classId: setup.cls.id, streamId: setup.streams[0]!.id }))).toBe("FORBIDDEN"); // a teacher cannot place students
    await students.enrollStudent(academic, studentId, { classId: setup.cls.id, streamId: setup.streams[0]!.id });
    expect((await tasksOf("CLASS_PLACEMENT", studentId))[0]!.status).toBe("COMPLETED");
    const active = await db.studentEnrollment.findMany({ where: { studentId, status: "ACTIVE" } });
    expect(active).toHaveLength(1);
    expect((await students.listStudents(teacher, {})).items.some((s) => s.id === studentId)).toBe(true);
    expect((await students.listStudents(teacher2, {})).items.some((s) => s.id === studentId)).toBe(false); // 18: not their class
    expect(await code(students.getStudentProfile(teacher2, studentId))).toBe("NOT_FOUND");
  });

  it("12-13. the teacher takes attendance and the Academic Office sees the submission", async () => {
    const sessions = await att.listAttendanceSessions(admin);
    const sessionId = sessions[0]!.id;
    const sheet = { classId: setup.cls.id, streamId: setup.streams[0]!.id, sessionId, date: setup.today };
    await att.submitAttendance(teacher, { clientOpId: randomUUID(), kind: "FINALISE", ...sheet, entries: [{ studentId, status: "PRESENT" }] });
    const desk = await academicDesk(academic);
    expect(desk.attendance?.finalised).toBeGreaterThanOrEqual(1);
    expect(desk.attendance?.byClass.find((c) => c.classId === setup.cls.id)?.status).toBe("FINALISED");
    expect(desk.attendance?.missing.find((m) => m.classId === setup.cls.id)).toBeUndefined();
  });
});

describe("14-17: examination to published result", () => {
  it("14-16. the teacher enters marks, the Academic Office approves and locks, the report card is published", async () => {
    const exam = await exams.createExam(academic, { termId: setup.term.id, name: "Terminal", category: "TERMINAL", maxMarks: "100", weight: "100" });
    await exams.addExamSubjects(academic, exam.id, { classIds: [setup.cls.id] });
    const unit = (await marks.listSubmissions(teacher, { examId: exam.id }))[0]!;
    await marks.saveMarks(teacher, unit.id, { entries: [{ studentId, score: 78 }] });
    expect(await code(marks.approveMarks(teacher, unit.id))).toBe("FORBIDDEN"); // a teacher cannot approve their own results
    await marks.submitMarks(teacher, unit.id);
    const desk = await academicDesk(academic);
    expect(desk.alerts.find((a) => a.key === "resultsToApprove")?.count).toBe(1);
    await marks.approveMarks(academic, unit.id);
    await marks.lockMarks(academic, unit.id);
    expect((await rc.generateReportCards(academic, { termId: setup.term.id, classId: setup.cls.id })).generated).toBe(1);
    expect((await rc.publishReportCards(academic, { termId: setup.term.id, classId: setup.cls.id })).published).toBe(1);
  });

  it("17. the parent reads the published result of their own child, and nobody else's", async () => {
    const guardianId = (await db.studentGuardian.findFirstOrThrow({ where: { studentId }, select: { guardianId: true } })).guardianId;
    await portal.createGuardianAccount(registrar, guardianId);
    parent = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: guardianId } })).userId!);
    const progress = await portal.childProgress(parent, studentId);
    expect(progress.latest?.subjects[0]).toMatchObject({ name: "Mathematics", percent: 78 });
    const other = await db.student.findFirstOrThrow({ where: { schoolId: school.id, id: { not: studentId } } }).catch(() => null);
    if (other) expect(await code(portal.childProgress(parent, other.id))).toBe("NOT_FOUND");
    expect(await code(portal.childProgress(teacher, studentId))).toBe("FORBIDDEN");
  });
});

describe("20: Finance works the instalments", () => {
  it("creates one reminder per instalment, never twice, and closes it when the instalment is paid", async () => {
    const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const inv = await invoices.createOtherInvoice(accountant, { studentId, lines: "Trip | 30,000", dueDate: plus(30) });
    await invoices.setInstalments(accountant, inv.id, { items: [{ dueDate: plus(3), amount: "10000" }, { dueDate: plus(20), amount: "10000" }, { dueDate: plus(40), amount: "10000" }] });
    const first = await generateFinanceTasks(school.id);
    expect(first.due).toBeGreaterThanOrEqual(1);
    await generateFinanceTasks(school.id);
    const open = await db.workflowTask.findMany({ where: { schoolId: school.id, relatedId: inv.id, status: { in: ["PENDING", "IN_PROGRESS"] } } });
    expect(open).toHaveLength(1); // only the instalment due within a week
    expect(open[0]).toMatchObject({ kind: "INSTALMENT_DUE", department: "FINANCE" });
    expect((await workflow.listTasks(accountant, { department: "FINANCE" })).items.some((x) => x.relatedId === inv.id)).toBe(true);
    await payments.recordPayment(accountant, { studentId, amount: "10000", method: "CASH", targetInvoiceId: inv.id });
    await generateFinanceTasks(school.id);
    expect((await db.workflowTask.findMany({ where: { schoolId: school.id, relatedId: inv.id, status: { in: ["PENDING", "IN_PROGRESS"] } } }))).toHaveLength(0); // paid, so closed
    expect(await code(payments.recordPayment(academic, { studentId, amount: "10", method: "CASH" }))).toBe("FORBIDDEN"); // 19
  });
});

describe("21-22: a teacher is recruited and onboarded", () => {
  it("follows the configured process, and Finance receives the employee without any salary", async () => {
    await recruitment.updateRecruitmentSettings(admin, { docs: "Signed contract\nIdentity document" });
    const c = await recruitment.createCandidate(academic, { fullName: "Joseph Teacher", phone: `0711${String(n++ % 1_000_000).padStart(6, "0")}`, positionApplied: "Mathematics teacher", subjects: "Mathematics", qualifications: "Diploma in Education" });
    expect((await tasksOf("CANDIDATE_REVIEW", c.id))[0]).toMatchObject({ department: "HR", status: "PENDING" });
    await recruitment.scheduleCandidateInterview(academic, c.id, { interviewAt: inDays(1), interviewerId: head.userId });
    expect(await code(recruitment.scheduleCandidateInterview(registrar, c.id, { interviewAt: inDays(1) }))).toBe("FORBIDDEN");
    await db.staffCandidate.update({ where: { id: c.id }, data: { interviewAt: new Date(Date.now() - 3_600_000) } });
    await recruitment.recordCandidateResult(head, c.id, { outcome: "PASSED", score: 80, suitability: "Strong in Mathematics" });
    expect(await code(recruitment.decideCandidate(academic, c.id, { decision: "ACCEPT" }))).toBe("FORBIDDEN"); // the Academic Office recommends; management decides
    await recruitment.decideCandidate(head, c.id, { decision: "ACCEPT" });
    await recruitment.startOnboarding(admin, c.id, { startDate: plusDate(14) });
    expect(await code(recruitment.approveEmployment(admin, c.id))).toBe("CONFLICT"); // required papers are missing
    await recruitment.recordCandidateDocument(admin, c.id, { docType: "Signed contract", received: "on" });
    await recruitment.recordCandidateDocument(admin, c.id, { docType: "Identity document", received: "on" });
    await recruitment.approveEmployment(admin, c.id);
    const role = await db.role.findFirstOrThrow({ where: { schoolId: school.id, key: "subject_teacher" } });
    const r = await recruitment.activateEmployee(admin, c.id, { email: `new-${n++}@test.example`, roleIds: [role.id] });
    expect(r.temporaryPassword).toBeTruthy();
    expect(await code(recruitment.activateEmployee(admin, c.id, { email: `again-${n++}@test.example`, roleIds: [role.id] }))).toBe("CONFLICT"); // 24: no second account
    expect((await db.staffCandidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ACTIVE");
    const assign = await db.workflowTask.findMany({ where: { schoolId: school.id, relatedId: r.userId } });
    expect(assign.map((t) => `${t.kind}:${t.department}`).sort()).toEqual(["PAYROLL_ONBOARDING:FINANCE", "TEACHING_ASSIGNMENT:ACADEMIC"]);
    expect(assign.map((t) => t.relatedLabel).join(" ")).not.toMatch(/salary|pay|TZS/i); // payroll is not started and no pay is recorded
    expect((await workflow.listTasks(accountant, { department: "FINANCE" })).items.some((x) => x.kind === "PAYROLL_ONBOARDING")).toBe(true);
  });
});

const plusDate = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

describe("23: the administrator oversees the whole school", () => {
  it("sees school-wide figures, every department's tasks and the audit trail", async () => {
    const o = await admissionOverview(admin);
    expect(o.byStatus.ENROLLED).toBeGreaterThanOrEqual(1);
    expect(o.received.online).toBeGreaterThanOrEqual(1);
    const counts = await workflow.taskCounts(admin);
    expect(counts.map((c) => c.department).sort()).toEqual(["ACADEMIC", "ADMIN", "ADMISSIONS", "FINANCE", "HR"]);
    const actions = (await db.auditLog.findMany({ where: { schoolId: school.id }, select: { action: true } })).map((a) => a.action);
    for (const a of ["interview.schedule", "interview.result", "admission_payment.verify", "admission.enrol", "student.enroll", "candidate.activate", "marks.lock"]) expect(actions.some((x) => x === a || x.startsWith(a.split(".")[0]!))).toBe(true);
    expect(actions).toContain("admission_payment.verify");
    expect(actions).toContain("candidate.activate");
  });
});
