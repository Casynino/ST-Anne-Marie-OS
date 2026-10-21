/**
 * DEMO SCHOOL for local testing. Fills the LOCAL development database with a small, made-up school so every department can be tried:
 * staff accounts (one per department), classes and teachers, students with guardians, fees and payments, attendance, exams and marks,
 * admissions applicants at every stage, recruitment candidates, concerns, homework and a timetable.
 *
 * Every name, phone number and amount here is invented. All records go through the same services the screens use, so the business
 * rules and the audit trail are real. It refuses to run against anything but a local database and never touches production.
 * Safe to run again: each part is skipped when its data is already there.
 *
 * Run: npm run db:seed-demo
 */
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "../src/lib/db";
import { buildAuthContext, type AuthContext } from "../src/lib/auth/context";
import { hashPassword } from "../src/lib/auth/password";
import { todayInTimezone } from "../src/lib/dates";
import * as academics from "../src/server/academics";
import * as admissions from "../src/server/admissions";
import * as assignments from "../src/server/assignments";
import * as fee from "../src/server/application-fee";
import * as att from "../src/server/attendance";
import * as behaviour from "../src/server/behaviour";
import * as concerns from "../src/server/concerns";
import * as documents from "../src/server/documents";
import * as exams from "../src/server/exams";
import * as expenses from "../src/server/expenses";
import * as fees from "../src/server/fees";
import * as grading from "../src/server/grading";
import * as interviews from "../src/server/interviews";
import * as invoices from "../src/server/invoices";
import * as marks from "../src/server/marks";
import * as offers from "../src/server/admission-offers";
import * as payments from "../src/server/payments";
import * as policy from "../src/server/admission-policy";
import * as portal from "../src/server/portal";
import * as pub from "../src/server/public-applications";
import * as recruitment from "../src/server/recruitment";
import * as rc from "../src/server/report-cards";
import * as review from "../src/server/admission-review";
import * as students from "../src/server/students";
import * as timetable from "../src/server/timetable";
import * as users from "../src/server/users";
import * as website from "../src/server/website";
import { generateFinanceTasks } from "../src/server/finance-tasks";

const PASSWORD = "StAnne2026";
const DOMAIN = "stannemarie.local";

// ───────────────────────── safety: local databases only ─────────────────────────
function assertLocal() {
  const raw = process.env.DATABASE_URL ?? "";
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("DATABASE_URL is not set."); }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  const name = u.pathname.replace(/^\//, "");
  if (!local || !/^stanne_(dev|demo|smoke)$/.test(name)) throw new Error("Refusing to load demo data: this is not a local development database.");
  if (process.env.PRODUCTION_DATABASE_URL && process.env.PRODUCTION_DATABASE_URL === raw) throw new Error("Refusing to load demo data into the production database.");
}

// ───────────────────────── small helpers ─────────────────────────
let seedNo = 20261021;
const rnd = () => (seedNo = (seedNo * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const at = (iso: string, hh = 10) => `${iso}T${String(hh).padStart(2, "0")}:00:00.000Z`;
const log = (...a: unknown[]) => console.log("•", ...a);
let phoneNo = 0;
const phone = (series = "0699") => `${series}${String(100000 + ++phoneNo).slice(-6)}`;

const FEMALE = ["Neema", "Rehema", "Zawadi", "Amina", "Fatuma", "Mariam", "Rose", "Lucy", "Happy", "Grace", "Joyce", "Upendo", "Furaha", "Asha", "Salma", "Witness", "Beatrice", "Tumaini", "Irene", "Esther"] as const;
const MALE = ["Baraka", "Emmanuel", "Kelvin", "Jonas", "Hassan", "Peter", "Daniel", "Juma", "Elia", "Godfrey", "Isaya", "Samson", "Rajabu", "Michael", "Josephat", "Frank", "Vincent", "Yusuf", "Amani", "Dickson"] as const;
const SURNAMES = ["Mwakasege", "Mushi", "Kimaro", "Massawe", "Mbwambo", "Kileo", "Juma", "Salum", "Mrema", "Mwita", "Tarimo", "Kessy", "Ali", "Msuya", "Haji", "Lyimo", "Ngowi", "Rashid", "Mollel", "Swai", "Komba", "Mtui", "Shayo", "Temba", "Urassa", "Nyerere", "Chacha", "Mafuru", "Sanga", "Bakari"] as const;

async function samplePdf(title: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title, { x: 30, y: 230, size: 16, font });
  page.drawText("Sample document for local testing only.", { x: 30, y: 200, size: 11, font });
  return Buffer.from(await doc.save());
}

async function main() {
  assertLocal();
  const school = await db.school.findUniqueOrThrow({ where: { code: "SAM" } });
  const schoolId = school.id;
  const today = todayInTimezone(school.timezone);
  const yearNo = Number(today.slice(0, 4));
  const ctxOf = async (email: string) => buildAuthContext((await db.user.findFirstOrThrow({ where: { schoolId, email } })).id);
  const admin = await ctxOf(`admin@${DOMAIN}`);

  // ───── 1. Staff: one account per department, all with the same demo password ─────
  const STAFF = [
    { email: `administrator@${DOMAIN}`, fullName: "Samuel Mollel", department: "admin", jobTitle: "School Administrator" },
    { email: `head@${DOMAIN}`, fullName: "Grace Mwakasege", department: "head", jobTitle: "Head Teacher" },
    { email: `admissions@${DOMAIN}`, fullName: "Rehema Mushi", department: "admissions", jobTitle: "Admissions Officer" },
    { email: `academic@${DOMAIN}`, fullName: "Daniel Kimaro", department: "academic", jobTitle: "Academic Master" },
    { email: `finance@${DOMAIN}`, fullName: "Joyce Massawe", department: "finance", jobTitle: "Accountant" },
    { email: `teacher1@${DOMAIN}`, fullName: "Peter Mbwambo", department: "teaching", jobTitle: "Mathematics Teacher" },
    { email: `teacher2@${DOMAIN}`, fullName: "Neema Kileo", department: "teaching", jobTitle: "English Teacher" },
    { email: `teacher3@${DOMAIN}`, fullName: "Hassan Juma", department: "teaching", jobTitle: "Class Teacher" },
    { email: `teacher4@${DOMAIN}`, fullName: "Amina Salum", department: "teaching", jobTitle: "Class Teacher" },
  ] as const;
  for (const s of STAFF) {
    if (await db.user.findFirst({ where: { schoolId, email: s.email } })) continue;
    await users.createStaffUser(admin, { fullName: s.fullName, email: s.email, department: s.department, jobTitle: s.jobTitle, password: PASSWORD });
    log("staff", s.email);
  }
  const head = await ctxOf(`head@${DOMAIN}`), registrar = await ctxOf(`admissions@${DOMAIN}`), academic = await ctxOf(`academic@${DOMAIN}`), finance = await ctxOf(`finance@${DOMAIN}`);
  const t1 = await ctxOf(`teacher1@${DOMAIN}`), t2 = await ctxOf(`teacher2@${DOMAIN}`), t3 = await ctxOf(`teacher3@${DOMAIN}`), t4 = await ctxOf(`teacher4@${DOMAIN}`);

  // ───── 2. Academic year, terms, classes, subjects, grading ─────
  let year = await db.academicYear.findFirst({ where: { schoolId, name: String(yearNo) } });
  if (!year) {
    year = await academics.createAcademicYear(admin, { name: String(yearNo), startsOn: `${yearNo}-01-01`, endsOn: `${yearNo}-12-31` });
    log("academic year", yearNo);
  }
  await academics.setCurrentAcademicYear(admin, year.id);
  let term1 = await db.term.findFirst({ where: { schoolId, academicYearId: year.id, sequence: 1 } });
  let term2 = await db.term.findFirst({ where: { schoolId, academicYearId: year.id, sequence: 2 } });
  term1 ??= await academics.createTerm(admin, { academicYearId: year.id, name: "Term 1", sequence: 1, startsOn: `${yearNo}-01-05`, endsOn: `${yearNo}-06-26` });
  term2 ??= await academics.createTerm(admin, { academicYearId: year.id, name: "Term 2", sequence: 2, startsOn: `${yearNo}-07-13`, endsOn: `${yearNo}-12-18` });
  const term = today <= `${yearNo}-06-26` ? term1 : term2;
  await academics.setCurrentTerm(admin, term.id);

  const levelNamed = async (name: string, sortOrder: number) => (await db.academicLevel.findFirst({ where: { schoolId, name } })) ?? (await academics.createLevel(admin, { name, sortOrder }));
  const nursery = await levelNamed("Nursery", 1), primary = await levelNamed("Primary", 2), olevel = await levelNamed("O-Level", 3);
  const ensureClasses = async (levelId: string, names: string[]) => {
    const have = new Set((await db.schoolClass.findMany({ where: { schoolId, name: { in: names } }, select: { name: true } })).map((c) => c.name));
    const missing = names.filter((n) => !have.has(n));
    if (missing.length) await academics.createClassesBulk(admin, levelId, missing);
  };
  await ensureClasses(nursery.id, ["Baby Class", "Middle Class", "Pre-Unit"]);
  await ensureClasses(primary.id, ["Standard I", "Standard II", "Standard III", "Standard IV", "Standard V", "Standard VI", "Standard VII"]);
  const cls = async (name: string) => db.schoolClass.findFirstOrThrow({ where: { schoolId, name } });
  const formI = await cls("Form I");
  for (const s of ["A", "B"]) if (!(await db.stream.findFirst({ where: { classId: formI.id, name: s } }))) await academics.createStream(admin, formI.id, s);
  const streamOf = async (classId: string, name: string) => db.stream.findFirstOrThrow({ where: { classId, name } });

  const SUBJECTS: Record<string, string> = { MATH: "Mathematics", ENG: "English", KISW: "Kiswahili", SCI: "Science", SST: "Social Studies", CIV: "Civics", PHY: "Physics", CHEM: "Chemistry", BIO: "Biology", GEO: "Geography", HIST: "History" };
  for (const [code, name] of Object.entries(SUBJECTS)) if (!(await db.subject.findFirst({ where: { schoolId, code } }))) await academics.createSubject(admin, { code, name });
  const subj = async (code: string) => db.subject.findFirstOrThrow({ where: { schoolId, code } });
  const SET: Record<string, string[]> = {
    "Baby Class": ["ENG", "KISW", "MATH"], "Middle Class": ["ENG", "KISW", "MATH"], "Pre-Unit": ["ENG", "KISW", "MATH"],
    ...Object.fromEntries(["Standard I", "Standard II", "Standard III", "Standard IV", "Standard V", "Standard VI", "Standard VII"].map((n) => [n, ["MATH", "ENG", "KISW", "SCI", "SST", "CIV"]])),
    ...Object.fromEntries(["Form I", "Form II", "Form III", "Form IV"].map((n) => [n, ["MATH", "ENG", "KISW", "PHY", "CHEM", "BIO", "GEO", "HIST", "CIV"]])),
  };
  for (const [name, codes] of Object.entries(SET)) {
    const c = await cls(name);
    if ((await academics.getClassSubjectIds(admin, c.id)).length) continue;
    await academics.setClassSubjects(admin, c.id, await Promise.all(codes.map(async (k) => (await subj(k)).id)));
  }
  if (!(await grading.listScales(admin)).length) {
    await grading.createScale(admin, { name: "Standard scale", bands: "A | 75 | 100 | 1\nB | 65 | 74 | 2\nC | 45 | 64 | 3\nD | 30 | 44 | 4\nF | 0 | 29 | 5", isDefault: "on" });
  }

  // ───── 3. Teachers' classes and subjects ─────
  const pre = await cls("Pre-Unit"), std1 = await cls("Standard I"), std4 = await cls("Standard IV"), std7 = await cls("Standard VII"), form2 = await cls("Form II"), form4 = await cls("Form IV");
  const sA = await streamOf(formI.id, "A"), sB = await streamOf(formI.id, "B");
  if (!(await db.classTeacher.count({ where: { schoolId, academicYearId: year.id } }))) {
    for (const [c, stream, who] of [[formI, sA, t1], [formI, sB, t2], [std4, null, t3], [std1, null, t4]] as const) {
      await academics.setClassTeacher(admin, { academicYearId: year.id, classId: c.id, streamId: stream?.id, staffId: who.staffId! });
    }
    const math = await subj("MATH"), eng = await subj("ENG");
    for (const [c, stream, sj, who] of [[formI, sA, math, t1], [formI, sB, math, t1], [form2, null, math, t1], [form4, null, math, t1], [formI, sA, eng, t2], [formI, sB, eng, t2], [form2, null, eng, t2], [form4, null, eng, t2]] as const) {
      await academics.addSubjectTeacher(admin, { academicYearId: year.id, classId: c.id, streamId: stream?.id, subjectId: sj.id, staffId: who.staffId! });
    }
    log("teacher assignments");
  }

  // ───── 4. Students and guardians ─────
  if (!(await db.student.count({ where: { schoolId } }))) {
    const PLAN = [
      { c: pre, n: 6, born: 2021 }, { c: std1, n: 8, born: 2019 }, { c: std4, n: 8, born: 2016 }, { c: std7, n: 6, born: 2013 },
      { c: formI, stream: sA, n: 8, born: 2012 }, { c: formI, stream: sB, n: 8, born: 2012 }, { c: form2, n: 6, born: 2011 }, { c: form4, n: 6, born: 2009 },
    ];
    let made = 0;
    for (const p of PLAN) {
      for (let i = 0; i < p.n; i++) {
        const female = rnd() < 0.5;
        const last = pick(SURNAMES);
        const g1Female = rnd() < 0.7;
        const guardians: Record<string, unknown>[] = [{ fullName: `${pick(g1Female ? FEMALE : MALE)} ${last}`, phone: phone(), relationship: g1Female ? "MOTHER" : "FATHER", isPrimary: "on", receivesNotifications: "on" }];
        if (i % 3 === 0) guardians.push({ fullName: `${pick(g1Female ? MALE : FEMALE)} ${last}`, phone: phone(), relationship: g1Female ? "FATHER" : "MOTHER", receivesNotifications: "on" });
        for (let attempt = 0; ; attempt++) {
          try {
            await students.createStudent(registrar, {
              firstName: pick(female ? FEMALE : MALE), lastName: last, gender: female ? "FEMALE" : "MALE",
              dateOfBirth: `${p.born}-${String(1 + Math.floor(rnd() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
              admissionDate: `${yearNo}-01-12`, classId: p.c.id, streamId: p.stream?.id, guardians,
            });
            made++;
            break;
          } catch (e) { if (attempt > 5) throw e; }
        }
      }
    }
    log("students", made);
  }
  const enrolled = async (classId: string, streamId?: string) =>
    (await db.studentEnrollment.findMany({ where: { schoolId, academicYearId: year.id, classId, ...(streamId ? { streamId } : {}), status: "ACTIVE" }, select: { studentId: true }, orderBy: { studentId: "asc" } })).map((e) => e.studentId);

  // ───── 5. Parent and student sign-in ─────
  if (!(await db.user.findFirst({ where: { schoolId, email: `parent@${DOMAIN}` } }))) {
    const kidId = (await enrolled(formI.id, sA.id))[0]!;
    const guardian = await db.guardian.findFirstOrThrow({ where: { schoolId, students: { some: { studentId: kidId, isPrimary: true } } } });
    await portal.createGuardianAccount(registrar, guardian.id, { email: `parent@${DOMAIN}` });
    await portal.createStudentAccount(registrar, (await enrolled(formI.id, sA.id))[1]!, { email: `student@${DOMAIN}` });
    for (const email of [`parent@${DOMAIN}`, `student@${DOMAIN}`]) {
      await db.user.update({ where: { id: (await db.user.findFirstOrThrow({ where: { schoolId, email } })).id }, data: { passwordHash: await hashPassword(PASSWORD), mustChangePassword: false } });
    }
    log("parent and student sign-in");
  }

  // ───── 6. Fees, invoices and payments ─────
  if (!(await db.feeStructure.count({ where: { schoolId } }))) {
    await fees.updateFeeSettings(finance, { defaultDueDays: 30, clearanceMaxOutstanding: "0", expenseApprovalAbove: "200000" });
    const tuition = await fees.createFeeItem(finance, { name: "Tuition", category: "TUITION" });
    const exam = await fees.createFeeItem(finance, { name: "Examination fee", category: "EXAM" });
    await fees.createFeeItem(finance, { name: "School bus", category: "TRANSPORT" });
    await fees.createFeeItem(finance, { name: "Admission", category: "ADMISSION" });
    const alev = await levelNamed("A-Level", 4);
    for (const [lvl, tu] of [[nursery, 250_000], [primary, 350_000], [olevel, 450_000], [alev, 550_000]] as const) {
      await fees.createStructure(finance, { academicYearId: year.id, name: `${lvl.name} fees ${yearNo}`, levelId: lvl.id, lines: [{ feeItemId: tuition.id, amount: String(tu), termSequence: null }, { feeItemId: exam.id, amount: "20000", termSequence: null }] });
    }
    log("fee items and structures");
  }
  if (!(await db.invoice.count({ where: { schoolId } }))) {
    const gen = await invoices.generateTermInvoices(finance, { termId: term.id, dueDate: addDays(today, 21) });
    log("term invoices", gen.created);
    const invs = await db.invoice.findMany({ where: { schoolId, termId: term.id, type: "TERM_FEES" }, include: { lines: true }, orderBy: { number: "asc" } });
    const METHODS = ["CASH", "MOBILE_MONEY", "BANK"] as const;
    let k = 0;
    for (const inv of invs) {
      const total = inv.lines.reduce((n, l) => n + (l.kind === "CHARGE" ? Number(l.amount) : -Number(l.amount)), 0);
      const slot = k++ % 10;
      if (slot >= 8) continue; // two in ten have paid nothing yet
      const amount = slot <= 5 ? total : Math.round((total * 0.4) / 1000) * 1000;
      const method = METHODS[k % 3]!;
      await payments.recordPayment(finance, { studentId: inv.studentId, amount: String(amount), method, receivedOn: addDays(today, -(1 + Math.floor(rnd() * 25))), reference: method === "CASH" ? undefined : `${method === "BANK" ? "BNK" : "MM"}${200000 + k}`, targetInvoiceId: inv.id, payerName: "Parent" });
    }
    const stu = await db.student.findMany({ where: { schoolId }, take: 8, orderBy: { admissionNo: "asc" } });
    for (const s of stu.slice(0, 5)) await invoices.createOtherInvoice(finance, { studentId: s.id, lines: "School bus (this term) | 120,000", dueDate: addDays(today, 14) });
    const trip = await invoices.createOtherInvoice(finance, { studentId: stu[5]!.id, lines: "Science trip | 30,000", dueDate: addDays(today, 40) });
    await invoices.setInstalments(finance, trip.id, { items: [{ dueDate: addDays(today, 3), amount: "10000" }, { dueDate: addDays(today, 20), amount: "10000" }, { dueDate: addDays(today, 40), amount: "10000" }] });
    await generateFinanceTasks(schoolId);
    log("payments, bus and trip invoices");
  }
  if (!(await db.expense.count({ where: { schoolId } }))) {
    const cat = async (name: string) => (await db.expenseCategory.findFirst({ where: { schoolId, name } })) ?? (await expenses.createExpenseCategory(finance, { name }));
    const util = await cat("Utilities"), stat = await cat("Stationery"), maint = await cat("Maintenance");
    await expenses.recordExpense(finance, { categoryId: util.id, amount: "180000", payee: "Electricity supplier", method: "BANK", reference: "BNK-ELEC-01", spentOn: addDays(today, -6), description: "Electricity, last month" });
    await expenses.recordExpense(finance, { categoryId: stat.id, amount: "95000", payee: "Local bookshop", method: "CASH", spentOn: addDays(today, -3), description: "Chalk, exercise books and marker pens" });
    const roof = await expenses.recordExpense(finance, { categoryId: maint.id, amount: "650000", payee: "Roofing contractor", method: "BANK", reference: "BNK-ROOF-02", spentOn: addDays(today, -2), description: "Repair of the classroom roof" });
    const water = await expenses.recordExpense(finance, { categoryId: util.id, amount: "420000", payee: "Water supplier", method: "BANK", reference: "BNK-WATER-03", spentOn: addDays(today, -9), description: "Water bill and tank cleaning" });
    try { await expenses.approveExpense(head, water.id); } catch (e) { log("expense approval skipped:", (e as Error).message); }
    void roof; // left waiting for a second person to approve
    log("expenses");
  }

  // ───── 7. Attendance: the last five school days ─────
  if (!(await db.attendanceRegister.count({ where: { schoolId } }))) {
    const session = (await att.listAttendanceSessions(admin))[0]!;
    const days: string[] = [];
    for (let d = today; days.length < 5; d = addDays(d, -1)) if (dow(d) >= 1 && dow(d) <= 5 && d >= `${yearNo}-01-12`) days.push(d);
    const SHEETS: { c: { id: string }; stream?: { id: string }; by: AuthContext; todayToo: boolean }[] = [
      { c: formI, stream: sA, by: t1, todayToo: true }, { c: formI, stream: sB, by: t2, todayToo: true }, { c: std4, by: t3, todayToo: true }, { c: std1, by: t4, todayToo: false },
      { c: std7, by: admin, todayToo: false }, { c: form4, by: admin, todayToo: false }, { c: pre, by: admin, todayToo: false },
    ];
    for (const sh of SHEETS) {
      const ids = await enrolled(sh.c.id, sh.stream?.id);
      for (const d of days) {
        if (d === today && !sh.todayToo) continue;
        const entries = ids.map((studentId) => { const r = rnd(); return { studentId, status: r < 0.07 ? "ABSENT" : r < 0.12 ? "LATE" : r < 0.14 ? "EXCUSED" : "PRESENT" }; });
        await att.submitAttendance(sh.by, { clientOpId: randomUUID(), kind: "FINALISE", classId: sh.c.id, streamId: sh.stream?.id, sessionId: session.id, date: d, entries });
      }
    }
    log("attendance registers");
  }

  // ───── 8. Examinations, marks and report cards ─────
  {
    const math = await subj("MATH"), eng = await subj("ENG"), kisw = await subj("KISW");
    const examNamed = (name: string) => db.exam.findFirst({ where: { schoolId, termId: term.id, name } });
    // Midterm test of Form I: every sheet entered, approved and locked, so report cards can be made.
    let mid = await examNamed("Midterm Test");
    if (!mid) {
      mid = await exams.createExam(academic, { termId: term.id, name: "Midterm Test", category: "MIDTERM", examDate: addDays(today, -14), maxMarks: "100", weight: "40", submissionDeadline: addDays(today, -7) });
      await exams.addExamSubjects(academic, mid.id, { classIds: [formI.id], subjectIds: [math.id, eng.id] });
    }
    for (const u of await db.resultSubmission.findMany({ where: { schoolId, examSubject: { examId: mid.id }, status: { not: "LOCKED" } }, include: { examSubject: true } })) {
      const who = u.examSubject.subjectId === math.id ? t1 : t2;
      if (u.status === "DRAFT") {
        const roster = await enrolled(formI.id, u.streamId ?? undefined);
        await marks.saveMarks(who, u.id, { entries: roster.map((studentId) => ({ studentId, score: 35 + Math.floor(rnd() * 60) })) });
        await marks.submitMarks(who, u.id);
      }
      await marks.approveMarks(academic, u.id).catch(() => undefined);
      await marks.lockMarks(academic, u.id);
    }
    if (!(await db.reportCard.count({ where: { schoolId, termId: term.id } }))) {
      const early = await examNamed("Terminal Examination"); // a later, unfinished examination of the same class would hold the report cards back
      if (early) await exams.deleteExam(academic, early.id);
      await rc.generateReportCards(academic, { termId: term.id, classId: formI.id });
      await rc.publishReportCards(academic, { termId: term.id, classId: formI.id });
      log("report cards (Form I)");
    }
    // A monthly test: Form IV Mathematics is past its deadline with nothing entered; Form II English is entered and waits for approval.
    let monthly = await examNamed("Monthly Test");
    if (!monthly) {
      monthly = await exams.createExam(academic, { termId: term.id, name: "Monthly Test", category: "MONTHLY", examDate: addDays(today, -6), maxMarks: "50", weight: "10", submissionDeadline: addDays(today, -3) });
      await exams.addExamSubjects(academic, monthly.id, { classIds: [form4.id], subjectIds: [math.id] });
    }
    if (!(await db.resultSubmission.count({ where: { schoolId, examSubject: { examId: monthly.id, classId: form2.id } } }))) {
      await exams.addExamSubjects(academic, monthly.id, { classIds: [form2.id], subjectIds: [eng.id] });
      const unit = await db.resultSubmission.findFirstOrThrow({ where: { schoolId, examSubject: { examId: monthly.id, classId: form2.id } } });
      await marks.saveMarks(t2, unit.id, { entries: (await enrolled(form2.id)).map((studentId) => ({ studentId, score: 15 + Math.floor(rnd() * 32) })) });
      await marks.submitMarks(t2, unit.id);
    }
    // The terminal examination is still ahead: its timetable is published to the families.
    if (!(await examNamed("Terminal Examination"))) {
      const terminal = await exams.createExam(academic, { termId: term.id, name: "Terminal Examination", category: "TERMINAL", examDate: addDays(today, 30), maxMarks: "100", weight: "50", submissionDeadline: addDays(today, 40) });
      await exams.addExamSubjects(academic, terminal.id, { classIds: [formI.id], subjectIds: [math.id, eng.id, kisw.id] });
      let day = 30;
      for (const sitting of await db.examSubject.findMany({ where: { examId: terminal.id }, orderBy: { subjectId: "asc" } })) {
        await exams.scheduleSitting(academic, sitting.id, { sittingOn: addDays(today, day), startsAt: "09:00", venue: "Main hall" });
        day += 1;
      }
    }
  }

  // ───── 9. Admissions: applicants at every stage ─────
  if (!(await db.application.count({ where: { schoolId } }))) {
    await policy.updateAdmissionPolicy(admin, { requireInterview: "on", requiredDocTypes: ["BIRTH_CERTIFICATE"], admissionFee: "50000", requirePaymentBeforeEnrol: "on", offerValidDays: 14, allowDirectRegistration: "on", interviewMinutes: 30 });
    const online = async (first: string, last: string, born: string, classId: string) => {
      const k = ++phoneNo;
      const r = await pub.submitOnlineApplication(schoolId, { firstName: first, lastName: last, dateOfBirth: born, gender: "FEMALE", classAppliedId: classId, g1_fullName: `Mama ${last}`, g1_phone: phone("0698"), g1_relationship: "MOTHER", consent: "on", website: "" }, { ip: `10.20.${k % 250}.${(k * 7) % 250}`, userAgent: "demo" } as never);
      return db.application.findFirstOrThrow({ where: { schoolId, applicationNo: r.applicationNo! } });
    };
    const walkIn = (first: string, last: string, born: string, classId: string, gender = "MALE") =>
      admissions.createApplication(registrar, { firstName: first, lastName: last, dateOfBirth: born, gender, classAppliedId: classId, guardians: [{ fullName: `Baba ${last}`, phone: phone("0698"), relationship: "FATHER", isPrimary: "on" }] });
    const papers = async (appId: string, label: string) => {
      const doc = await documents.uploadDocument(registrar, { applicationId: appId }, { docType: "BIRTH_CERTIFICATE", fileName: "birth-certificate.pdf", bytes: await samplePdf(`Birth certificate - ${label}`) });
      await review.verifyDocument(registrar, doc.id, { status: "VERIFIED" });
      await review.reviewApplication(registrar, appId, { decision: "VERIFIED" });
    };
    const interviewed = async (appId: string, outcome: string) => {
      const i = await interviews.scheduleInterview(academic, appId, { kind: "INTERVIEW", scheduledAt: at(addDays(today, 2)), interviewerId: head.userId, location: "Head teacher's office" });
      await db.interview.update({ where: { id: i.id }, data: { scheduledAt: new Date(Date.now() - 3_600_000) } });
      await interviews.recordInterviewResult(head, i.id, { status: "COMPLETED", outcome, score: 82, notes: "Confident and ready to learn", recommendation: outcome === "PASSED" ? "RECOMMEND" : "NOT_RECOMMENDED", recommendationNote: "Suitable for the class applied" });
    };

    await online("Zawadi", "Mrema", "2019-04-18", std1.id);                                  // new, waiting for review
    await online("Baraka", "Mwita", "2021-08-02", pre.id);                                    // new, waiting for review
    const c = await walkIn("Lucy", "Tarimo", "2016-02-11", std4.id, "FEMALE"); await papers(c.id, "Lucy Tarimo"); // papers fine, waiting for the Academic Office
    const d = await walkIn("Emmanuel", "Kessy", "2012-06-09", formI.id); await papers(d.id, "Emmanuel Kessy");
    await interviews.scheduleInterview(academic, d.id, { kind: "INTERVIEW", scheduledAt: at(addDays(today, 3)), interviewerId: head.userId, location: "Head teacher's office" }); // interview booked
    const e = await walkIn("Fatuma", "Ali", "2019-11-23", std1.id, "FEMALE"); await papers(e.id, "Fatuma Ali"); await interviewed(e.id, "PASSED"); // waiting for the decision
    const f = await walkIn("Kelvin", "Msuya", "2013-03-30", std7.id); await papers(f.id, "Kelvin Msuya"); await interviewed(f.id, "PASSED");
    await admissions.recordAdmissionDecision(registrar, f.id, { outcome: "ACCEPTED" });     // offered, waiting for the admission fee
    const g = await walkIn("Mariam", "Haji", "2021-01-14", pre.id, "FEMALE"); await papers(g.id, "Mariam Haji"); await interviewed(g.id, "PASSED");
    await admissions.recordAdmissionDecision(registrar, g.id, { outcome: "ACCEPTED" });
    const gp = await offers.recordAdmissionPayment(finance, g.id, { amount: "50000", method: "CASH" });
    await offers.verifyAdmissionPayment(finance, gp.payment.id);                             // paid, ready to enrol
    const h = await walkIn("Jonas", "Lyimo", "2012-09-05", formI.id); await papers(h.id, "Jonas Lyimo"); await interviewed(h.id, "PASSED");
    await admissions.recordAdmissionDecision(registrar, h.id, { outcome: "ACCEPTED" });
    const hp = await offers.recordAdmissionPayment(finance, h.id, { amount: "50000", method: "CASH" });
    await offers.verifyAdmissionPayment(finance, hp.payment.id);
    await admissions.enrolApplication(registrar, h.id, {});                                  // enrolled, waiting for a class
    const i = await walkIn("Rose", "Kimaro", "2019-07-21", std1.id, "FEMALE"); await papers(i.id, "Rose Kimaro"); await interviewed(i.id, "NOT_PASSED");
    await admissions.recordAdmissionDecision(registrar, i.id, { outcome: "NOT_ACCEPTED", note: "Did not meet the entry requirements this year" });
    log("admissions applicants");
  }

  // ───── 10. Recruitment ─────
  if (!(await db.staffCandidate.count({ where: { schoolId } }))) {
    await recruitment.updateRecruitmentSettings(admin, { docs: "Signed contract\nIdentity document\nCertificates" });
    await recruitment.createCandidate(academic, { fullName: "Salma Rashid", phone: phone("0697"), positionApplied: "Kiswahili teacher", subjects: "Kiswahili", qualifications: "Diploma in Education" });
    const b = await recruitment.createCandidate(academic, { fullName: "Michael Ngowi", phone: phone("0697"), positionApplied: "Science teacher", subjects: "Physics, Chemistry", qualifications: "Bachelor of Education (Science)" });
    await recruitment.scheduleCandidateInterview(academic, b.id, { interviewAt: at(addDays(today, 2), 9), interviewerId: head.userId });
    const c = await recruitment.createCandidate(academic, { fullName: "Josephat Mrema", phone: phone("0697"), positionApplied: "Mathematics teacher", subjects: "Mathematics", qualifications: "Bachelor of Education (Mathematics)" });
    await recruitment.scheduleCandidateInterview(academic, c.id, { interviewAt: at(addDays(today, 1), 9), interviewerId: head.userId });
    await db.staffCandidate.update({ where: { id: c.id }, data: { interviewAt: new Date(Date.now() - 3_600_000) } });
    await recruitment.recordCandidateResult(head, c.id, { outcome: "PASSED", score: 84, suitability: "Strong subject knowledge" });
    await recruitment.decideCandidate(head, c.id, { decision: "ACCEPT" });
    await recruitment.startOnboarding(admin, c.id, { startDate: addDays(today, 21) });
    await recruitment.recordCandidateDocument(admin, c.id, { docType: "Identity document", received: "on" });
    log("recruitment candidates");
  }

  // ───── 11. Teachers' daily work: concerns, behaviour, homework, timetable, calendar ─────
  if (!(await db.academicConcern.count({ where: { schoolId } }))) {
    const a = await enrolled(formI.id, sA.id), s4 = await enrolled(std4.id);
    await concerns.flagConcern(t1, { studentId: a[2]!, category: "LOW_MARKS", summary: "Marks dropped in Mathematics this term", notes: "Needs extra practice at home" });
    await concerns.flagConcern(t3, { studentId: s4[1]!, category: "MISSING_WORK", summary: "Has not handed in the last three exercises" });
    await behaviour.recordBehaviour(t1, { studentId: a[0]!, occurredOn: addDays(today, -2), type: "POSITIVE", category: "Helpfulness", description: "Helped classmates with the fractions exercise", share: "on" });
    await behaviour.recordBehaviour(t1, { studentId: a[3]!, occurredOn: addDays(today, -1), type: "CONCERN", category: "Late to class", description: "Late three days this week" });
    const math = await subj("MATH"), eng = await subj("ENG");
    for (const [who, stream, sj, title] of [[t1, sA, math, "Fractions: exercise 4"], [t1, sB, math, "Fractions: exercise 4"], [t2, sA, eng, "Write a letter to a friend"]] as const) {
      const hw = await assignments.createAssignment(who, { classId: formI.id, streamId: stream.id, subjectId: sj.id, title, instructions: "Do the work neatly in your exercise book.", dueAt: at(addDays(today, 3), 12), maxScore: "10" });
      await assignments.publishAssignment(who, hw.id);
    }
    log("concerns, behaviour, homework");
  }
  if (!(await db.timetablePeriod.count({ where: { schoolId } }))) {
    const P = [["P1", "08:00", "08:40"], ["P2", "08:40", "09:20"], ["P3", "09:20", "10:00"]] as const;
    const periods = [];
    for (const [name, startTime, endTime] of P) periods.push(await timetable.createPeriod(admin, { name, startTime, endTime }));
    await timetable.createPeriod(admin, { name: "Break", startTime: "10:00", endTime: "10:20", isBreak: "on" });
    const math = await subj("MATH"), eng = await subj("ENG"), kisw = await subj("KISW");
    for (let day = 1; day <= 5; day++) {
      await timetable.setTimetableEntry(admin, { classId: formI.id, streamId: sA.id, dayOfWeek: day, periodId: periods[0]!.id, subjectId: math.id, teacherStaffId: t1.staffId, room: "Room 1" });
      await timetable.setTimetableEntry(admin, { classId: formI.id, streamId: sA.id, dayOfWeek: day, periodId: periods[1]!.id, subjectId: eng.id, teacherStaffId: t2.staffId, room: "Room 1" });
      await timetable.setTimetableEntry(admin, { classId: formI.id, streamId: sA.id, dayOfWeek: day, periodId: periods[2]!.id, subjectId: kisw.id, room: "Room 1" });
      await timetable.setTimetableEntry(admin, { classId: formI.id, streamId: sB.id, dayOfWeek: day, periodId: periods[0]!.id, subjectId: eng.id, teacherStaffId: t2.staffId, room: "Room 2" });
      await timetable.setTimetableEntry(admin, { classId: formI.id, streamId: sB.id, dayOfWeek: day, periodId: periods[1]!.id, subjectId: math.id, teacherStaffId: t1.staffId, room: "Room 2" });
    }
    log("timetable");
  }
  if (!(await db.schoolEvent.count({ where: { schoolId, isPublic: false } }))) {
    // Staff-only events, so nothing invented appears on the public website.
    await website.createEvent(admin, { title: "Staff meeting", startsOn: addDays(today, 4), isPublic: "" });
    await website.createEvent(admin, { title: "Parents' meeting (Form I)", startsOn: addDays(today, 12), isPublic: "" });
    await website.createEvent(admin, { title: "Sports day", startsOn: addDays(today, 20), isPublic: "" });
  }

  // ───── 12. Online application fee: one family has paid, one has not ─────
  if (!(await db.applicationDraft.count({ where: { schoolId } }))) {
    process.env.PAYMENTS_SANDBOX = "1"; // local testing only: lets this script stand in for the payment provider
    const p = await policy.getAdmissionPolicy(db, schoolId);
    const levels = await db.academicLevel.findMany({ where: { schoolId }, select: { id: true } });
    await policy.updateAdmissionPolicy(admin, {
      requireInterview: p.requireInterview ? "on" : "", requiredDocTypes: p.requiredDocTypes, admissionFee: String(p.admissionFeeCents / 100), requirePaymentBeforeEnrol: p.requirePaymentBeforeEnrol ? "on" : "",
      offerValidDays: p.offerValidDays, offerNeedsApproval: p.offerNeedsApproval ? "on" : "", allowDirectRegistration: p.allowDirectRegistration ? "on" : "", interviewMinutes: p.interviewMinutes,
      paymentNeedsSecondPerson: p.paymentNeedsSecondPerson ? "on" : "", applicationFee: "10000", applicationPhotoRequired: p.applicationPhotoRequired ? "on" : "", ...Object.fromEntries(levels.map((l) => [`assessment_${l.id}`, p.assessmentByLevel[l.id] ?? ""])),
    });
    const meta = () => ({ ip: `10.30.${Math.floor(rnd() * 250)}.${Math.floor(rnd() * 250)}`, userAgent: "demo" });
    const family = async (n: number, first: string, last: string, born: string, classId: string) => {
      const r = await pub.submitOnlineApplication(schoolId, { firstName: first, lastName: last, dateOfBirth: born, gender: "FEMALE", classAppliedId: classId, g1_fullName: `Mama ${last}`, g1_phone: phone("0697"), g1_email: `applicant${n}@${DOMAIN}`, g1_relationship: "MOTHER", password: PASSWORD, password2: PASSWORD, consent: "on", website: "" }, meta());
      return db.applicationDraft.findUniqueOrThrow({ where: { id: r.draftId! } });
    };
    const paid = await family(1, "Happiness", "Swai", "2019-09-12", std1.id);
    await fee.confirmApplicationFee({ schoolId, reference: paid.reference, provider: "sandbox", providerEventId: `SBX-${randomUUID()}`, amountCents: 1_000_000, currency: school.currency, meta: meta() }); // paid: the office has it
    await family(2, "Elias", "Komba", "2012-05-20", formI.id); // saved, waiting for payment
    log("online application fee (one paid, one waiting)");
  }

  console.log(`\nDemo school is ready. Every account below uses the password: ${PASSWORD}`);
  console.table([
    { department: "(owner)", signIn: `admin@${DOMAIN}`, note: "your own admin account, password unchanged" },
    ...STAFF.map((s) => ({ department: s.jobTitle, signIn: s.email, note: s.fullName })),
    { department: "Parent", signIn: `parent@${DOMAIN}`, note: "parent of a Form I A student" },
    { department: "Student", signIn: `student@${DOMAIN}`, note: "a Form I A student" },
    { department: "Applicant (paid)", signIn: `applicant1@${DOMAIN}`, note: "applied online and paid the fee" },
    { department: "Applicant (not paid)", signIn: `applicant2@${DOMAIN}`, note: "applied online, fee still to pay" },
  ]);
}

main().catch((e) => { console.error(e instanceof Error ? `${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}` : e); process.exitCode = 1; }).finally(() => db.$disconnect());
