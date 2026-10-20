import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { buildAuthContext, type AuthContext } from "@/lib/auth/context";
import { verifyPassword } from "@/lib/auth/password";
import * as academics from "@/server/academics";
import * as students from "@/server/students";
import * as grading from "@/server/grading";
import * as exams from "@/server/exams";
import * as marks from "@/server/marks";
import * as rc from "@/server/report-cards";
import * as portal from "@/server/portal";
import { renderCardsPdf } from "@/server/report-card-pdf";
import { createCurrentYearAcademics, createTestSchool, createTestUser, studentInput } from "../helpers";

let school: Awaited<ReturnType<typeof createTestSchool>>;
let admin: AuthContext, head: AuthContext, teacherA: AuthContext, registrar: AuthContext, accountant: AuthContext;
let setup: Awaited<ReturnType<typeof createCurrentYearAcademics>>;
let streamA: { id: string }, streamB: { id: string };
let math: { id: string }, eng: { id: string };
let kidsA: { id: string }[] = [];
let kidB: { id: string };
let exam: { id: string };
let n = 100000 + Math.floor(Math.random() * 8_000_000); // phones and emails are unique across the persistent test database

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;
const target = () => ({ termId: setup.term.id, classId: setup.cls.id });

async function enterAndLock(subjectId: string, scoresA: number[], scoreB: number) {
  const subs = (await marks.listSubmissions(admin, { examId: exam.id })).filter((s) => s.subjectId === subjectId);
  for (const s of subs) {
    const entries = s.streamName === "A" ? kidsA.map((k, i) => ({ studentId: k.id, score: scoresA[i]! })) : [{ studentId: kidB.id, score: scoreB }];
    await marks.saveMarks(admin, s.id, { entries });
    await marks.submitMarks(admin, s.id);
    await marks.approveMarks(head, s.id);
  }
  return subs.map((s) => s.id);
}

beforeAll(async () => {
  school = await createTestSchool();
  admin = (await createTestUser(school.id, ["super_admin"])).ctx;
  head = (await createTestUser(school.id, ["head_teacher"])).ctx;
  teacherA = (await createTestUser(school.id, ["class_teacher"])).ctx;
  registrar = (await createTestUser(school.id, ["registrar"])).ctx;
  accountant = (await createTestUser(school.id, ["accountant"])).ctx;
  setup = await createCurrentYearAcademics(admin, { streams: ["A", "B"] });
  streamA = setup.streams[0]!; streamB = setup.streams[1]!;
  math = await academics.createSubject(admin, { code: "MATH", name: "Mathematics" });
  eng = await academics.createSubject(admin, { code: "ENG", name: "English" });
  await academics.setClassSubjects(admin, setup.cls.id, [math.id, eng.id]);
  await academics.setClassTeacher(admin, { academicYearId: setup.year.id, classId: setup.cls.id, streamId: streamA.id, staffId: teacherA.staffId });
  for (let i = 0; i < 4; i++) kidsA.push(await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamA.id })));
  kidB = await students.createStudent(registrar, studentInput(++n, { classId: setup.cls.id, streamId: streamB.id }));
  await grading.createScale(admin, { name: "Scale", bands: "A | 80 | 100 | 1\nB | 60 | 79 | 2\nC | 40 | 59 | 3\nD | 0 | 39 | 4", divisions: "I | 2 | 3\nII | 4 | 5\nIII | 6 | 8", divisionBestN: "2", isDefault: "on" });
  exam = await exams.createExam(head, { termId: setup.term.id, name: "Terminal", category: "TERMINAL", maxMarks: "100", weight: "100" });
  await exams.addExamSubjects(head, exam.id, { classIds: [setup.cls.id] });
});

describe("generating report cards", () => {
  it("refuses until every result of the class is locked", async () => {
    expect(await code(rc.generateReportCards(head, target()))).toBe("CONFLICT");
    const mathUnits = await enterAndLock(math.id, [90, 70, 50, 30], 75);
    for (const id of mathUnits) await marks.lockMarks(head, id);
    expect(await code(rc.generateReportCards(head, target()))).toBe("CONFLICT"); // English still open
    const engUnits = await enterAndLock(eng.id, [60, 80, 50, 40], 65);
    for (const id of engUnits) await marks.lockMarks(head, id);
  });

  it("only users with reportcard.generate can generate", async () => {
    expect(await code(rc.generateReportCards(teacherA, target()))).toBe("FORBIDDEN");
    expect(await code(rc.generateReportCards(registrar, target()))).toBe("FORBIDDEN");
  });

  it("builds a snapshot per student from locked results and is idempotent", async () => {
    const r = await rc.generateReportCards(head, target());
    expect(r).toMatchObject({ generated: 5, regenerated: 0, unchanged: 0 });
    const again = await rc.generateReportCards(head, target());
    expect(again).toMatchObject({ generated: 0, regenerated: 0, unchanged: 5 });

    const list = await rc.listClassReportCards(head, target());
    const row = list.rows.find((x) => x.studentId === kidsA[0]!.id)!;
    const card = await rc.getReportCard(head, row.card!.id);
    // Student 0: Math 90 (A), English 60 (B) → average 75, 2nd of 5 in class (80, 75, 65, 50, 45...), points 3 → Division I
    expect(card.snapshot.summary).toMatchObject({ average: 75, total: 150, grade: "B", division: "I", pointsSum: 3, classSize: 5 });
    expect(card.snapshot.subjects.map((s) => s.name).sort()).toEqual(["English", "Mathematics"]);
    expect(card.snapshot.subjects.find((s) => s.name === "Mathematics")).toMatchObject({ percent: 90, grade: "A", points: 1 });
    expect(card.snapshot.attendance).toMatchObject({ recorded: 0, ratePct: null });
    expect(card.snapshot.class.stream).toBe("A");
    expect(card.snapshot.summary.streamSize).toBe(4);
    expect(card.status).toBe("GENERATED");
  });
});

describe("remarks", () => {
  it("the class teacher writes remarks only for their own stream; head remarks need remarks.head", async () => {
    const q = { ...target(), streamId: streamA.id };
    const sheet = await rc.listRemarks(teacherA, q);
    expect(sheet.rows).toHaveLength(4);
    expect(sheet.can).toMatchObject({ class: true, head: false });
    await rc.saveRemarks(teacherA, { ...q, entries: [{ studentId: kidsA[0]!.id, classRemark: "Hardworking and polite.", headRemark: "SNEAKY" }] });
    const after = await rc.listRemarks(teacherA, q);
    expect(after.rows.find((r) => r.studentId === kidsA[0]!.id)).toMatchObject({ classRemark: "Hardworking and polite.", headRemark: "" }); // head field ignored for a teacher
    expect(await code(rc.listRemarks(teacherA, { ...target(), streamId: streamB.id }))).toBe("FORBIDDEN");
    expect(await code(rc.saveRemarks(teacherA, { ...target(), streamId: streamB.id, entries: [{ studentId: kidB.id, classRemark: "x" }] }))).toBe("FORBIDDEN");
    expect(await code(rc.saveRemarks(teacherA, { ...q, entries: [{ studentId: kidB.id, classRemark: "not on this list" }] }))).toBe("VALIDATION");
    await rc.saveRemarks(head, { ...q, entries: [{ studentId: kidsA[0]!.id, classRemark: "Hardworking and polite.", headRemark: "Keep it up." }] });
  });
});

describe("regenerate, publish, withdraw", () => {
  it("regenerating after a change keeps the old snapshot as a revision", async () => {
    const r = await rc.generateReportCards(head, target());
    expect(r).toMatchObject({ regenerated: 1, unchanged: 4 }); // only the student whose remarks changed
    const card = (await rc.listClassReportCards(head, target())).rows.find((x) => x.studentId === kidsA[0]!.id)!.card!;
    expect(card.version).toBe(2);
    const revs = await db.reportCardRevision.findMany({ where: { reportCardId: card.id } });
    expect(revs).toHaveLength(1);
    await expect(db.reportCardRevision.deleteMany({ where: { reportCardId: card.id } })).rejects.toThrow(); // append-only
  });

  it("refuses to publish a card that no longer matches today's data, then publishes after regeneration", async () => {
    await rc.saveRemarks(head, { ...target(), streamId: streamA.id, entries: [{ studentId: kidsA[1]!.id, headRemark: "Needs more focus." }] });
    const first = await rc.publishReportCards(head, target());
    expect(first.published).toBe(4);
    expect(first.stale).toHaveLength(1);
    await rc.generateReportCards(head, target());
    const second = await rc.publishReportCards(head, target());
    expect(second.published).toBe(1);
    const list = await rc.listClassReportCards(head, target());
    expect(list.rows.every((r) => r.card?.status === "PUBLISHED")).toBe(true);
  });

  it("publishing needs reportcard.publish", async () => {
    expect(await code(rc.publishReportCards(teacherA, target()))).toBe("FORBIDDEN");
    expect(await code(rc.withdrawReportCard(accountant, "00000000-0000-0000-0000-000000000000", { reason: "x" }))).toBe("FORBIDDEN");
  });

  it("a published card is frozen: remarks and regeneration leave it alone", async () => {
    expect(await code(rc.saveRemarks(head, { ...target(), streamId: streamA.id, entries: [{ studentId: kidsA[0]!.id, headRemark: "Changed later" }] }))).toBe("CONFLICT");
    const r = await rc.generateReportCards(head, target());
    expect(r.skippedPublished).toHaveLength(5);
    expect(r.generated + r.regenerated + r.unchanged).toBe(0);
  });

  it("withdraw needs a reason, hides the card, and allows regeneration", async () => {
    const card = (await rc.listClassReportCards(head, target())).rows.find((x) => x.studentId === kidsA[3]!.id)!.card!;
    expect(await code(rc.withdrawReportCard(head, card.id, { reason: "" }))).toBe("VALIDATION");
    await rc.withdrawReportCard(head, card.id, { reason: "Wrong remark" });
    expect(await code(rc.withdrawReportCard(head, card.id, { reason: "again" }))).toBe("CONFLICT");
    const row = await db.reportCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(row).toMatchObject({ status: "WITHDRAWN", withdrawReason: "Wrong remark" });
    const r = await rc.generateReportCards(head, { ...target(), studentIds: [kidsA[3]!.id] });
    expect(r.regenerated).toBe(1);
    expect((await db.reportCard.findUniqueOrThrow({ where: { id: card.id } })).status).toBe("GENERATED");
    await rc.publishReportCards(head, target());
  });

  it("unlocking a result stops publishing until it is locked and regenerated", async () => {
    const unit = (await marks.listSubmissions(admin, { examId: exam.id })).find((s) => s.subjectId === eng.id && s.streamName === "B")!;
    await marks.unlockMarks(head, unit.id, { reason: "Check student score" });
    expect(await code(rc.generateReportCards(head, target()))).toBe("CONFLICT");
    expect(await code(rc.publishReportCards(head, target()))).toBe("CONFLICT");
    await marks.submitMarks(admin, unit.id);
    await marks.approveMarks(head, unit.id);
    await marks.lockMarks(head, unit.id);
  });

  it("financial clearance, when required, blocks publishing unless fees confirm it", async () => {
    await db.reportCard.updateMany({ where: { schoolId: school.id }, data: { status: "GENERATED", publishedAt: null, publishedById: null } });
    await rc.updateReportCardSettings(head, { requireFinancialClearance: "on" });
    expect(await code(rc.publishReportCards(head, target()))).toBe("CONFLICT"); // no fee data available: nothing is assumed cleared
    rc.setClearanceProvider(async (_c, _s, _t, ids) => new Set(ids.slice(0, 2)));
    const r = await rc.publishReportCards(head, target());
    expect(r.published).toBe(2);
    expect(r.notCleared).toHaveLength(3);
    rc.setClearanceProvider(null);
    await rc.updateReportCardSettings(head, { requireFinancialClearance: "" });
    expect((await rc.publishReportCards(head, target())).published).toBe(3);
  });
});

describe("pdf", () => {
  it("renders a valid PDF with one page per card", async () => {
    const cards = await rc.cardsForClass(head, target());
    expect(cards).toHaveLength(5);
    const bytes = await renderCardsPdf(school.id, cards.map((c) => c.snapshot), "EN");
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
    const sw = await renderCardsPdf(school.id, [cards[0]!.snapshot], "SW");
    expect(sw.length).toBeGreaterThan(1000);
  });
});

describe("family portal", () => {
  let parentCtx: AuthContext, otherParentCtx: AuthContext, studentCtx: AuthContext;
  let kidCard: { id: string };

  it("creates a parent account for a linked guardian, with a one-time password and a forced change", async () => {
    const guardian = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kidsA[0]!.id } } } });
    expect(await code(portal.createGuardianAccount(teacherA, guardian.id))).toBe("FORBIDDEN");
    const r = await portal.createGuardianAccount(registrar, guardian.id);
    expect(r.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    expect(await code(portal.createGuardianAccount(registrar, guardian.id))).toBe("CONFLICT");
    const g = await db.guardian.findUniqueOrThrow({ where: { id: guardian.id }, include: { user: true } });
    expect(g.user).toMatchObject({ type: "GUARDIAN", mustChangePassword: true, status: "ACTIVE" });
    expect(await verifyPassword(r.temporaryPassword, g.user!.passwordHash)).toBe(true);
    parentCtx = await buildAuthContext(g.userId!);
    expect(parentCtx.userType).toBe("GUARDIAN");
    expect(parentCtx.permissions.size).toBe(0);

    const other = await db.guardian.findFirstOrThrow({ where: { schoolId: school.id, students: { some: { studentId: kidsA[1]!.id } } } });
    await portal.createGuardianAccount(registrar, other.id);
    otherParentCtx = await buildAuthContext((await db.guardian.findUniqueOrThrow({ where: { id: other.id } })).userId!);
  });

  it("a guardian without a linked student cannot be given an account", async () => {
    const lone = await db.guardian.create({ data: { schoolId: school.id, fullName: "Lone Guardian", phone: "+255700000001" } });
    expect(await code(portal.createGuardianAccount(registrar, lone.id))).toBe("CONFLICT");
  });

  it("parents see only their own children and only published cards", async () => {
    const kids = await portal.myChildren(parentCtx);
    expect(kids.map((k) => k.id)).toEqual([kidsA[0]!.id]);
    expect(kids[0]).toMatchObject({ className: setup.cls.name, streamName: "A" });
    expect(await code(portal.childOverview(parentCtx, kidsA[1]!.id))).toBe("NOT_FOUND"); // someone else's child
    expect(await code(portal.childOverview(parentCtx, kidB.id))).toBe("NOT_FOUND");
    const ov = await portal.childOverview(parentCtx, kidsA[0]!.id);
    expect(ov.reportCards).toHaveLength(1);
    expect(ov.reportCards[0]).toMatchObject({ average: 75, position: expect.any(Number) });
    kidCard = { id: ov.reportCards[0]!.id };
    expect((await portal.getMyReportCard(parentCtx, kidCard.id)).snapshot.student.id).toBe(kidsA[0]!.id);

    const otherKidCard = (await db.reportCard.findFirstOrThrow({ where: { studentId: kidsA[1]!.id } })).id;
    expect(await code(portal.getMyReportCard(parentCtx, otherKidCard))).toBe("NOT_FOUND");
    expect((await portal.myChildren(otherParentCtx)).map((k) => k.id)).toEqual([kidsA[1]!.id]);
  });

  it("an unpublished or withdrawn card disappears from the portal immediately", async () => {
    await rc.withdrawReportCard(head, kidCard.id, { reason: "Re-check" });
    expect((await portal.childOverview(parentCtx, kidsA[0]!.id)).reportCards).toHaveLength(0);
    expect(await code(portal.getMyReportCard(parentCtx, kidCard.id))).toBe("NOT_FOUND");
    await rc.generateReportCards(head, { ...target(), studentIds: [kidsA[0]!.id] });
    expect(await code(portal.getMyReportCard(parentCtx, kidCard.id))).toBe("NOT_FOUND"); // regenerated but not yet published
    await rc.publishReportCards(head, target());
    expect((await portal.getMyReportCard(parentCtx, kidCard.id)).id).toBe(kidCard.id);
  });

  it("staff accounts cannot use the family portal service", async () => {
    expect(await code(portal.myChildren(head))).toBe("FORBIDDEN");
    expect(await code(portal.getMyReportCard(admin, kidCard.id))).toBe("FORBIDDEN");
  });

  it("a student account sees only that student", async () => {
    expect(await code(portal.createStudentAccount(registrar, kidsA[0]!.id, {}))).toBe("VALIDATION"); // needs an email or phone
    const email = `kid-${n}@school.test`;
    const r = await portal.createStudentAccount(registrar, kidsA[0]!.id, { email });
    expect(r.temporaryPassword).toBeTruthy();
    expect(await code(portal.createStudentAccount(registrar, kidsA[0]!.id, { email: `other-${n}@school.test` }))).toBe("CONFLICT");
    const s = await db.student.findUniqueOrThrow({ where: { id: kidsA[0]!.id } });
    studentCtx = await buildAuthContext(s.userId!);
    expect(studentCtx.userType).toBe("STUDENT");
    expect((await portal.myChildren(studentCtx)).map((k) => k.id)).toEqual([kidsA[0]!.id]);
    expect(await code(portal.childOverview(studentCtx, kidsA[1]!.id))).toBe("NOT_FOUND");
    expect((await portal.getMyReportCard(studentCtx, kidCard.id)).id).toBe(kidCard.id);
  });

  it("disabling an account ends access; reset forces a new password and ends sessions", async () => {
    const g = await db.guardian.findFirstOrThrow({ where: { students: { some: { studentId: kidsA[1]!.id } } } });
    const userId = g.userId!;
    await db.session.create({ data: { userId, tokenHash: `t-${n}-${Math.random()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    const reset = await portal.resetPortalPassword(registrar, userId);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await verifyPassword(reset.temporaryPassword, (await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash)).toBe(true);
    await portal.setPortalAccountActive(registrar, userId, false);
    await expect(buildAuthContext(userId)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await portal.setPortalAccountActive(registrar, userId, true);
    expect((await buildAuthContext(userId)).userType).toBe("GUARDIAN");
    // Staff accounts are not portal accounts.
    expect(await code(portal.resetPortalPassword(registrar, head.userId))).toBe("NOT_FOUND");
  });

  it("another school cannot reach these records", async () => {
    const other = await createTestSchool("Other");
    const otherHead = (await createTestUser(other.id, ["head_teacher"])).ctx;
    expect(await code(rc.getReportCard(otherHead, kidCard.id))).toBe("NOT_FOUND");
    expect(await code(rc.withdrawReportCard(otherHead, kidCard.id, { reason: "x" }))).toBe("NOT_FOUND");
    expect(await code(rc.generateReportCards(otherHead, target()))).toBe("NOT_FOUND");
  });
});
