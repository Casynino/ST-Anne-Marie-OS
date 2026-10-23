/**
 * MORE DEMO DATA for the LOCAL development database, on top of `seed-demo.ts`: it fills the screens that would otherwise be empty so every
 * department can be tried with real-looking work in progress:
 *   - end-of-year decisions (moving up / repeating / still waiting), next-year registrations at every step, next-year bills and first instalments
 *   - homework hand-ins and marking, schemes and lesson plans, portfolio, conduct records, concerns, class moves
 *   - parent messages and school announcements, website news and events, enquiries, more expenses
 *
 * Every name and amount is invented. Everything goes through the same services the screens use, so the business rules and audit trail are real.
 * It refuses to run on anything but a local database and never touches production. Safe to run again: each part is skipped once its data exists.
 *
 * Run: npm run db:seed-demo:more   (run `npm run db:seed-demo` first)
 */
import { db } from "../src/lib/db";
import { buildAuthContext, type AuthContext } from "../src/lib/auth/context";
import { todayInTimezone } from "../src/lib/dates";
import * as assignments from "../src/server/assignments";
import * as behaviour from "../src/server/behaviour";
import * as comms from "../src/server/communication";
import * as concerns from "../src/server/concerns";
import * as enquiries from "../src/server/enquiries";
import * as expenses from "../src/server/expenses";
import * as exams from "../src/server/exams";
import * as fees from "../src/server/fees";
import * as marks from "../src/server/marks";
import * as rc from "../src/server/report-cards";
import * as plans from "../src/server/lesson-plans";
import * as messaging from "../src/server/messaging";
import * as payments from "../src/server/payments";
import * as portal from "../src/server/portal";
import * as portfolio from "../src/server/portfolio";
import * as prog from "../src/server/progression";
import * as reg from "../src/server/annual-registration";
import * as transfers from "../src/server/transfers";
import * as website from "../src/server/website";
import { billReturningStudents } from "../src/server/annual-fees";
import { addRegistrationFollowUp } from "../src/server/registration-followups";
import { getLifecycleSettings } from "../src/server/lifecycle-settings";
import { yearFinances } from "../src/server/lifecycle-data";

const DOMAIN = "stannemarie.local";

function assertLocal() {
  const raw = process.env.DATABASE_URL ?? "";
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("DATABASE_URL is not set."); }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  const name = u.pathname.replace(/^\//, "");
  if (!local || !/^stanne_(dev|demo|smoke)$/.test(name)) throw new Error("Refusing to load demo data: this is not a local development database.");
  if (process.env.PRODUCTION_DATABASE_URL && process.env.PRODUCTION_DATABASE_URL === raw) throw new Error("Refusing to load demo data into the production database.");
}

let seed = 77123;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const at = (iso: string, hh = 10) => `${iso}T${String(hh).padStart(2, "0")}:00:00.000Z`;
const log = (...a: unknown[]) => console.log("•", ...a);
/** Runs one part; a failure is reported and the next part still runs. */
async function step(name: string, fn: () => Promise<unknown>) {
  try { const r = await fn(); log(name, r ?? ""); } catch (e) { console.log("✗", name, "—", (e as Error).message?.split("\n")[0], JSON.stringify((e as { fields?: unknown }).fields ?? "")); }
}

async function main() {
  assertLocal();
  const school = await db.school.findUniqueOrThrow({ where: { code: "SAM" } });
  const schoolId = school.id;
  const today = todayInTimezone(school.timezone);
  const ctxOf = async (email: string) => buildAuthContext((await db.user.findFirstOrThrow({ where: { schoolId, email } })).id);
  const admin = await ctxOf(`admin@${DOMAIN}`);
  const head = await ctxOf(`head@${DOMAIN}`), registrar = await ctxOf(`admissions@${DOMAIN}`), academic = await ctxOf(`academic@${DOMAIN}`), finance = await ctxOf(`finance@${DOMAIN}`);
  const t1 = await ctxOf(`teacher1@${DOMAIN}`), t2 = await ctxOf(`teacher2@${DOMAIN}`), t3 = await ctxOf(`teacher3@${DOMAIN}`), t4 = await ctxOf(`teacher4@${DOMAIN}`);
  const year = await db.academicYear.findFirstOrThrow({ where: { schoolId, isCurrent: true } });
  const nextYear = await db.academicYear.findFirst({ where: { schoolId, startsOn: { gt: year.startsOn } }, orderBy: { startsOn: "asc" } });
  const term = await db.term.findFirstOrThrow({ where: { schoolId, academicYearId: year.id, isCurrent: true } });

  // ───── 0. Results for the other classes: an earlier test, every sheet entered, approved and locked, report cards published ─────
  await step("results for the other classes", async () => {
    if (await db.exam.findFirst({ where: { schoolId, termId: term.id, name: "Opening Test" } })) return "skipped";
    const subj = async (code: string) => db.subject.findFirstOrThrow({ where: { schoolId, name: { contains: code, mode: "insensitive" } } });
    const subjects = [await subj("Math"), await subj("English"), await subj("Kiswahili")];
    const classes = await db.schoolClass.findMany({ where: { schoolId, name: { not: "Form I" }, enrollments: { some: { academicYearId: year.id, status: "ACTIVE" } } } });
    const exam = await exams.createExam(academic, { termId: term.id, name: "Opening Test", category: "MIDTERM", examDate: addDays(today, -35), maxMarks: "100", weight: "20", submissionDeadline: addDays(today, -28) });
    await exams.addExamSubjects(academic, exam.id, { classIds: classes.map((c) => c.id), subjectIds: subjects.map((x) => x.id) });
    let sheets = 0;
    for (const u of await db.resultSubmission.findMany({ where: { schoolId, examSubject: { examId: exam.id } }, include: { examSubject: true } })) {
      const roster = (await db.studentEnrollment.findMany({ where: { schoolId, classId: u.examSubject.classId, ...(u.streamId ? { streamId: u.streamId } : {}), status: "ACTIVE" }, select: { studentId: true } })).map((r) => r.studentId);
      if (!roster.length) continue;
      try {
        await marks.saveMarks(admin, u.id, { entries: roster.map((studentId) => ({ studentId, score: 30 + Math.floor(rnd() * 66) })) });
        await marks.submitMarks(admin, u.id);
        await marks.approveMarks(academic, u.id).catch(() => undefined);
        await marks.lockMarks(academic, u.id);
        sheets++;
      } catch { /* leaves the sheet as it is */ }
    }
    let cards = 0;
    for (const c of classes) {
      try { await rc.generateReportCards(academic, { termId: term.id, classId: c.id }); await rc.publishReportCards(academic, { termId: term.id, classId: c.id }); cards++; } catch { /* a later unfinished exam holds this class back */ }
    }
    return `${sheets} mark sheets, report cards for ${cards} classes`;
  });

  // ───── 0a. Every mark sheet of the term finished and locked (a report card can only be made when all of a class's results are locked) ─────
  await step("finish the open mark sheets", async () => {
    const open = await db.resultSubmission.findMany({ where: { schoolId, status: { not: "LOCKED" }, examSubject: { exam: { termId: term.id } } }, include: { examSubject: true } });
    let n = 0;
    for (const u of open) {
      try {
        if (u.status === "DRAFT" || u.status === "RETURNED") {
          const roster = (await db.studentEnrollment.findMany({ where: { schoolId, classId: u.examSubject.classId, ...(u.streamId ? { streamId: u.streamId } : {}), status: "ACTIVE" }, select: { studentId: true } })).map((r) => r.studentId);
          await marks.saveMarks(admin, u.id, { entries: roster.map((studentId, i) => ({ studentId, score: 20 + ((i * 7) % 28) })) });
          await marks.submitMarks(admin, u.id);
        }
        await marks.approveMarks(academic, u.id).catch(() => undefined);
        await marks.lockMarks(academic, u.id);
        n++;
      } catch { /* left as it is */ }
    }
    return `${n} locked`;
  });
  // ───── 0b. Teachers' comments on the report cards (the class teacher for every pupil, the head teacher for some) ─────
  await step("teachers' comments on report cards", async () => {
    const cards = await db.reportCard.findMany({ where: { schoolId, termId: term.id, status: { in: ["GENERATED", "PUBLISHED"] } } });
    const has = cards.some((c) => (c.snapshot as unknown as { remarks?: { class?: string | null } }).remarks?.class);
    if (cards.length === 0 || has) return has ? "skipped" : "no cards";
    const groups = new Map<string, typeof cards>();
    for (const c of cards) groups.set(`${c.classId}|${c.streamId ?? ""}`, [...(groups.get(`${c.classId}|${c.streamId ?? ""}`) ?? []), c]);
    const strong = ["An excellent term. Keeps a high standard in all subjects and helps others. Keep it up.", "Very good work and a positive attitude. Reading more will make the results even better.", "A hard-working pupil who is a good example to the class."];
    const middle = ["A good term. With more practice in Mathematics the results will improve further.", "Steady progress. Should hand in homework on time and ask questions when stuck.", "Works well when focused. Needs to revise a little every day at home."];
    const weak = ["Needs more effort and regular revision. Please check the exercise book at home each evening.", "Has the ability but is easily distracted. Extra help after school is advised.", "Results are below the class level. We ask the family to meet the class teacher."];
    const headSays = ["Well done. Continue to work hard and keep the school's values.", "Good progress this term. We expect more in the next term.", "Please see the class teacher about extra support."];
    let done = 0;
    for (const [key, list] of groups) {
      const [classId, streamId] = key.split("|") as [string, string];
      try {
        for (const c of list) await rc.withdrawReportCard(academic, c.id, { reason: "Demo: adding the teachers' comments" }).catch(() => undefined);
        const entries = list.map((c, i) => {
          const avg = (c.snapshot as unknown as { summary: { average: number | null } }).summary.average ?? 50;
          const pool = avg >= 70 ? strong : avg >= 50 ? middle : weak;
          return { studentId: c.studentId, classRemark: pool[i % pool.length]!, headRemark: i % 3 === 0 ? headSays[avg >= 70 ? 0 : avg >= 50 ? 1 : 2]! : "" };
        });
        await rc.saveRemarks(head, { termId: term.id, classId, ...(streamId ? { streamId } : {}), entries });
        await rc.generateReportCards(academic, { termId: term.id, classId, ...(streamId ? { streamId } : {}) });
        await rc.publishReportCards(academic, { termId: term.id, classId, ...(streamId ? { streamId } : {}) });
        done += list.length;
      } catch (e) { console.log("  comments:", (e as Error).message?.split("\n")[0]); }
    }
    return `${done} report cards`;
  });

  // ───── 1. End-of-year decisions: most move up, a few repeat, a few still wait for the Academic Office ─────
  await step("year decisions", async () => {
    const drafts = await db.studentProgression.findMany({ where: { schoolId, fromAcademicYearId: year.id, status: "DRAFT", outcome: "PENDING_REVIEW" }, include: { student: true }, orderBy: { createdAt: "asc" } });
    if (drafts.length < 12) return `skipped (${drafts.length} undecided left)`;
    const moving: string[] = [], repeating: string[] = [];
    drafts.forEach((d, i) => { if (i % 9 === 4) return; (i % 8 === 3 ? repeating : moving).push(d.studentId); }); // every 9th stays undecided
    const results: { ok: boolean }[] = [];
    for (const id of moving) results.push(...(await prog.decideProgressions(head, { yearId: year.id, studentIds: [id], outcome: "PROMOTED", exceptionReason: "Demo: decided by the school" })));
    for (const id of repeating) {
      const from = drafts.find((d) => d.studentId === id)!.fromClassId;
      results.push(...(await prog.decideProgressions(head, { yearId: year.id, studentIds: [id], outcome: "REPEAT", toClassId: from, exceptionReason: "Demo: decided by the school" })));
    }
    const live = await db.studentProgression.findMany({ where: { schoolId, fromAcademicYearId: year.id, status: "DRAFT", outcome: { in: ["PROMOTED", "REPEAT"] } }, select: { id: true }, orderBy: { createdAt: "asc" } });
    const toApprove = live.slice(0, Math.max(0, live.length - 4)).map((x) => x.id); // the last few stay as drafts, waiting for approval
    const ok = toApprove.length ? (await prog.approveProgressions(head, { ids: toApprove })).filter((r) => r.ok).length : 0;
    return `${results.filter((r) => r.ok).length} decided, ${ok} approved`;
  });

  // ───── 2. Next-year registrations at every step ─────
  if (nextYear) {
    await step("next-year registration records", async () => (await reg.createMissingRegistrations(registrar, { yearId: nextYear.id })).created);
    await step("first-instalment rule", async () => { await fees.updateFeeSettings(finance, { defaultDueDays: 30, clearanceMaxOutstanding: "0", initialPaymentPct: "50" }); return "50% (demo)"; });
    await step("placing and confirming", async () => {
      if (await db.annualRegistration.count({ where: { schoolId, academicYearId: nextYear.id, status: { in: ["REGISTERED", "ACTIVE"] } } }) > 0) return "skipped";
      const regs = await db.annualRegistration.findMany({ where: { schoolId, academicYearId: nextYear.id, status: "PENDING" }, include: { progression: true }, orderBy: { createdAt: "asc" } });
      let placed = 0, confirmed = 0;
      for (const [i, r] of regs.entries()) {
        if (i % 4 === 3 || !r.progression.toClassId) continue; // every 4th is not placed yet
        if (!r.classId) {
          const streams = await db.stream.findMany({ where: { classId: r.progression.toClassId }, orderBy: { name: "asc" } });
          try { await reg.placeReturning(registrar, { registrationId: r.id, classId: r.progression.toClassId, streamId: streams.length ? streams[i % streams.length]!.id : undefined }); placed++; } catch { continue; }
        }
        if (i % 3 !== 2) { try { await reg.confirmRegistration(registrar, { registrationId: r.id, confirmed: "on", note: "" }); confirmed++; } catch { /* waits */ } }
      }
      return `${placed} placed, ${confirmed} confirmed`;
    });
    await step("next-year bills", async () => (await billReturningStudents(finance, { yearId: nextYear.id, dueDate: addDays(today, 30) })) as unknown);
    await step("first instalments", async () => {
      const settings = await getLifecycleSettings(db, schoolId);
      const regs = await db.annualRegistration.findMany({ where: { schoolId, academicYearId: nextYear.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" } });
      const money = await yearFinances(db, schoolId, regs.map((r) => r.studentId), nextYear.id, settings, new Set());
      let n = 0;
      for (const [i, r] of regs.entries()) {
        const m = money.get(r.studentId);
        if (!m || !m.firstTerm.billed || m.firstTerm.paid > 0 || i % 3 === 2) continue; // every 3rd has paid nothing
        const pay = i % 3 === 0 ? Math.ceil(m.firstTerm.charged / 2) : Math.floor(m.firstTerm.charged / 5); // half = cleared, a fifth = still owing
        const inv = await db.invoice.findFirst({ where: { schoolId, studentId: r.studentId, academicYearId: nextYear.id, status: { not: "VOID" } }, orderBy: { createdAt: "asc" } });
        if (!inv || pay <= 0) continue;
        try {
          await payments.recordPayment(finance, { studentId: r.studentId, amount: (pay / 100).toFixed(2), method: i % 2 ? "MOBILE_MONEY" : "BANK", receivedOn: addDays(today, -(1 + (i % 6))), reference: `DEMO27-${String(i).padStart(3, "0")}`, targetInvoiceId: inv.id, payerName: "Parent" });
          n++;
        } catch { /* skipped */ }
      }
      return `${n} payments`;
    });
    await step("follow-up notes", async () => {
      if (await db.registrationFollowUp.count({ where: { schoolId } }) > 1) return "skipped";
      const pending = await db.annualRegistration.findMany({ where: { schoolId, academicYearId: nextYear.id, status: "PENDING" }, take: 4, orderBy: { createdAt: "desc" } });
      const notes = [["WILL_RETURN", "Mother will come on Monday with the form"], ["NO_ANSWER", "Phoned twice, no answer"], ["NOT_RETURNING", "Moving to another town, will bring the transfer letter"], ["OTHER", "Waiting for the school fees committee"]] as const;
      for (const [i, r] of pending.entries()) await addRegistrationFollowUp(registrar, { registrationId: r.id, outcome: notes[i % 4]![0], note: notes[i % 4]![1] });
      return `${pending.length} notes`;
    });
  }

  // ───── 3. Homework: more tasks, hand-ins on paper, marking, released results ─────
  await step("more homework", async () => {
    if ((await db.assignment.count({ where: { schoolId } })) > 4) return "skipped";
    const formI = await db.schoolClass.findFirstOrThrow({ where: { schoolId, name: "Form I" }, include: { streams: { orderBy: { name: "asc" } } } });
    const subj = async (name: string) => db.subject.findFirstOrThrow({ where: { schoolId, name: { contains: name } } });
    const [math, eng] = [await subj("Math"), await subj("English")];
    const mk = async (who: AuthContext, subjectId: string, streamId: string, title: string, dueIn: number, max = "20") => {
      const a = await assignments.createAssignment(who, { classId: formI.id, streamId, subjectId, title, instructions: "Show all your working in the exercise book.", dueAt: at(addDays(today, dueIn), 12), maxScore: max });
      await assignments.publishAssignment(who, a.id);
      return a;
    };
    await mk(t1, math.id, formI.streams[1]!.id, "Algebra: simplifying expressions", 1);
    await mk(t2, eng.id, formI.streams[1]!.id, "Essay: My best day at school", 2);
    await mk(t1, math.id, formI.streams[0]!.id, "Geometry: angles on a line", 5);
    return "3 added";
  });
  await step("hand-ins and marking", async () => {
    const done = new Set((await db.assignmentSubmission.findMany({ where: { schoolId }, select: { assignmentId: true }, distinct: ["assignmentId"] })).map((x) => x.assignmentId));
    const list = (await db.assignment.findMany({ where: { schoolId, publishedAt: { not: null } }, orderBy: { createdAt: "asc" } })).filter((a) => !done.has(a.id));
    if (list.length === 0) return "skipped";
    let n = 0, graded = 0;
    for (const [ai, a] of list.entries()) {
      const owner = (await db.user.findUnique({ where: { id: a.createdById ?? "" } }))?.email === `teacher2@${DOMAIN}` ? t2 : t1;
      const roster = await db.studentEnrollment.findMany({ where: { schoolId, classId: a.classId, ...(a.streamId ? { streamId: a.streamId } : {}), status: "ACTIVE" }, select: { studentId: true } });
      for (const [i, r] of roster.entries()) {
        if ((i + ai) % 4 === 3) continue; // some have not handed in
        try { await assignments.recordPaper(owner, a.id, r.studentId, { note: "Handed in on paper", late: i % 7 === 0 ? "on" : "" }); n++; } catch { continue; }
        if ((i + ai) % 3 !== 0) {
          const max = Number(a.maxScore ?? 10);
          try { await assignments.gradeSubmission(owner, a.id, r.studentId, { decision: "GRADE", score: String(Math.max(1, Math.round(max * (0.45 + rnd() * 0.5)))), feedback: i % 2 ? "Good work. Check your spelling." : "Well done, keep it up.", release: "" }); graded++; } catch { /* leaves it unmarked */ }
        }
      }
      if (ai === 0) await assignments.releaseResults(owner, a.id).catch(() => undefined);
    }
    return `${n} hand-ins, ${graded} marked`;
  });
  await step("hand-in from the demo student", async () => {
    const student = await ctxOf(`student@${DOMAIN}`);
    const me = await db.student.findFirstOrThrow({ where: { schoolId, admissionNo: "SAM/2026/0030" } });
    const en = await db.studentEnrollment.findFirstOrThrow({ where: { studentId: me.id, status: "ACTIVE" } });
    const open = await db.assignment.findFirst({ where: { schoolId, classId: en.classId, OR: [{ streamId: null }, { streamId: en.streamId }], publishedAt: { not: null }, closedAt: null, dueAt: { gt: new Date() }, submissions: { none: { studentId: me.id } } }, orderBy: { createdAt: "desc" } });
    if (!open) return "no open task";
    await assignments.submitWork(student, open.id, { text: "I have done all the exercises. The answers are in my exercise book." });
    return "1 hand-in";
  });

  // ───── 4. Schemes of work, lesson plans, portfolio, conduct, concerns ─────
  await step("schemes and lesson plans", async () => {
    if ((await db.lessonPlan.count({ where: { schoolId } })) > 0) return "skipped";
    const formI = await db.schoolClass.findFirstOrThrow({ where: { schoolId, name: "Form I" }, include: { streams: { orderBy: { name: "asc" } } } });
    const math = await db.subject.findFirstOrThrow({ where: { schoolId, name: { contains: "Math" } } });
    const eng = await db.subject.findFirstOrThrow({ where: { schoolId, name: { contains: "English" } } });
    const weeks = (topics: string[]) => topics.map((topic, i) => ({ weekNo: i + 1, topic, objectives: `Pupils understand ${topic.toLowerCase()}.`, activities: "Teacher explanation, group work, exercises.", periods: 4 }));
    const s1 = await plans.createScheme(t1, { classId: formI.id, subjectId: math.id, termId: term.id, title: "Mathematics Form I: scheme of work", weeks: weeks(["Whole numbers", "Fractions", "Decimals", "Percentages", "Algebra basics", "Angles"]) });
    await plans.submitScheme(t1, s1.id); await plans.reviewScheme(academic, s1.id, { decision: "APPROVE", note: "Clear and well paced." });
    const s2 = await plans.createScheme(t2, { classId: formI.id, subjectId: eng.id, termId: term.id, title: "English Form I: scheme of work", weeks: weeks(["Reading for meaning", "Grammar: tenses", "Letter writing", "Composition"]) });
    await plans.submitScheme(t2, s2.id); await plans.reviewScheme(academic, s2.id, { decision: "RETURN", note: "Add the assessment column for each week." });
    const topics: [AuthContext, string, string, string, number][] = [[t1, math.id, "Adding fractions", "Add fractions with different denominators", -6], [t1, math.id, "Subtracting fractions", "Subtract fractions and mixed numbers", -3], [t1, math.id, "Decimals to fractions", "Change decimals to fractions", 1], [t2, eng.id, "Past tense", "Use the simple past tense correctly", -2], [t2, eng.id, "Writing a letter", "Write a formal letter", 2]];
    let n = 0;
    for (const [i, [who, subjectId, topic, objectives, day]] of topics.entries()) {
      const p = await plans.createLessonPlan(who, { classId: formI.id, streamId: formI.streams[0]!.id, subjectId, lessonDate: addDays(today, day), topic, objectives, activities: "Introduction, worked examples, pair work, short quiz.", assessment: "Exercise 3 in the textbook", homework: "Finish the exercise" });
      if (i < 4) { await plans.submitLessonPlan(who, p.id); if (i < 2) await plans.reviewLessonPlan(academic, p.id, { decision: "APPROVE", note: "Approved." }); }
      n++;
    }
    return `2 schemes, ${n} plans`;
  });
  await step("portfolio", async () => {
    if ((await db.portfolioItem.count({ where: { schoolId } })) > 0) return "skipped";
    const kids = await db.studentEnrollment.findMany({ where: { schoolId, academicYearId: year.id, status: "ACTIVE", class: { name: "Form I" } }, select: { studentId: true }, take: 6 });
    const math = await db.subject.findFirstOrThrow({ where: { schoolId, name: { contains: "Math" } } });
    const titles = ["Fractions project poster", "My science fair model", "Poem: The rain at night", "Map of our school", "Reading journal, week 5", "Drawing of the school garden"];
    let n = 0;
    for (const [i, k] of kids.entries()) {
      await portfolio.addPortfolioItem(t1, k.studentId, { title: titles[i]!, description: "Work chosen by the teacher to show progress this term.", subjectId: i % 2 ? undefined : math.id, comment: "Well presented." });
      n++;
    }
    const waiting = await db.portfolioItem.findMany({ where: { schoolId, status: "PENDING" }, take: 4 });
    for (const w of waiting) await portfolio.reviewPortfolioItem(t1, w.id, { decision: "PUBLISH", comment: "Published for the family." }).catch(() => undefined);
    return `${n} items`;
  });
  await step("conduct records and concerns", async () => {
    if ((await db.behaviourRecord.count({ where: { schoolId } })) > 4) return "skipped";
    const kids = (await db.studentEnrollment.findMany({ where: { schoolId, academicYearId: year.id, status: "ACTIVE" }, select: { studentId: true }, take: 24 })).map((k) => k.studentId);
    const pos = ["Helped a new pupil settle in", "Led the class prayer", "Won the spelling quiz", "Kept the classroom clean all week", "Showed great kindness to a classmate"];
    const neg = ["Talking during lessons", "Came late three days this week", "Forgot homework twice", "Left the classroom without asking"];
    let n = 0;
    for (const [i, id] of kids.entries()) {
      const good = i % 3 !== 0;
      await behaviour.recordBehaviour(i % 2 ? t1 : t3, { studentId: id, occurredOn: addDays(today, -(1 + (i % 12))), type: good ? "POSITIVE" : "CONCERN", category: good ? "Character" : "Discipline", description: (good ? pos : neg)[i % (good ? pos.length : neg.length)]!, share: good ? "on" : "" }).then(() => n++, () => undefined);
    }
    return `${n} conduct records`;
  });
  await step("concerns", async () => {
    if ((await db.academicConcern.count({ where: { schoolId } })) > 2) return "skipped";
    const kids = (await db.studentEnrollment.findMany({ where: { schoolId, academicYearId: year.id, status: "ACTIVE" }, select: { studentId: true }, take: 24 })).map((k) => k.studentId);
    const cats = ["LOW_MARKS", "MISSING_WORK", "ABSENCE"] as const;
    let c = 0;
    for (const [i, id] of kids.slice(6, 10).entries()) await concerns.flagConcern(academic, { studentId: id, category: cats[i % 3]!, summary: ["Marks dropped in two subjects", "Has not handed in homework this week", "Absent four times this month", "Seems tired and quiet in class"][i]!, notes: "Please talk to the family." }).then(() => c++, (e) => console.log("  concern:", (e as Error).message));
    return `${c} concerns`;
  });

  // ───── 5. Class moves ─────
  await step("class moves", async () => {
    if ((await db.classTransfer.count({ where: { schoolId } })) > 0) return "skipped";
    const formI = await db.schoolClass.findFirstOrThrow({ where: { schoolId, name: "Form I" }, include: { streams: { orderBy: { name: "asc" } } } });
    const inA = await db.studentEnrollment.findMany({ where: { schoolId, academicYearId: year.id, status: "ACTIVE", classId: formI.id, streamId: formI.streams[0]!.id }, take: 2 });
    let n = 0;
    for (const [i, e] of inA.entries()) {
      const t = await transfers.requestTransfer(academic, { studentId: e.studentId, kind: "TRANSFER", toClassId: formI.id, toStreamId: formI.streams[1]!.id, effectiveOn: addDays(today, i ? 10 : 0), reason: i ? "Family asked for the other stream" : "Balancing the two streams" });
      if (i === 0) await transfers.decideTransfer(head, t.id, { decision: "APPROVE", note: "Approved." });
      n++;
    }
    return `${n} requests`;
  });

  // ───── 6. Communication: parent messages, announcements, website news and events, enquiries ─────
  await step("parent messages", async () => {
    if ((await db.messageThread.count({ where: { schoolId } })) > 0) return "skipped";
    const parent = await ctxOf(`parent@${DOMAIN}`);
    const kids = await portal.myChildren(parent);
    const kid = kids[0];
    if (!kid) return "no child";
    const th = await messaging.startThread(parent, { studentId: kid.id, subject: "Extra help in Mathematics", body: "Good afternoon. Josephat finds fractions hard. Can he join the extra class on Thursday?" });
    const row = await db.messageThread.findFirstOrThrow({ where: { id: (th as { id: string }).id } });
    const staff = row.staffUserId ? await buildAuthContext(row.staffUserId) : t3;
    await messaging.replyAsStaff(staff, row.id, { body: "Good afternoon. Yes, the extra class is on Thursday at 4pm in Room 1. I will keep a seat for him." });
    await messaging.replyAsGuardian(parent, row.id, { body: "Thank you very much, teacher. He will come." });
    await messaging.startThread(parent, { studentId: kid.id, subject: "Absent on Friday", body: "Josephat will be absent on Friday because of a clinic visit. Sorry for the short notice." });
    return "2 threads";
  });
  await step("announcements to parents", async () => {
    if ((await db.broadcast.count({ where: { schoolId, kind: "ANNOUNCEMENT" } })) === 0) await comms.createBroadcast(admin, { kind: "ANNOUNCEMENT", title: "Parents' meeting on Saturday", bodyEn: "Dear parents, there will be a parents' meeting on Saturday at 9:00 in the main hall. Please come on time.", bodySw: "Wazazi wapendwa, kutakuwa na mkutano wa wazazi Jumamosi saa 3:00 asubuhi katika ukumbi mkuu. Tafadhali fika kwa wakati.", audience: { type: "ALL" }, sendSms: false, sendInApp: true });
    if ((await db.broadcast.count({ where: { schoolId, kind: "FEE_REMINDER" } })) === 0) await step("fee reminder", () => comms.createBroadcast(finance, { kind: "FEE_REMINDER", title: "Fee reminder", bodyEn: "Dear parent, {student} has an unpaid school fee balance of {amount}, due {due}. Please pay at the school or by the bank account shown on your invoice.", audience: { type: "ARREARS", overdueOnly: false, minOutstanding: 1 }, sendSms: false, sendInApp: true }));
    return "announcement";
  });
  await step("website news and events", async () => {
    if ((await db.announcement.count({ where: { schoolId } })) > 3) return "skipped";
    const news: [string, string, string][] = [
      ["Terminal examinations begin next month", "Terminal examinations for all classes begin in four weeks. The timetable is on the calendar and a copy will be sent home with each pupil.", "Academics"],
      ["Science fair: well done to all pupils", "Pupils from Form I and Form II showed their science projects to parents and teachers. The best projects will take part in the district fair.", "School life"],
      ["New library books have arrived", "The school library has new reading books for Standard I to Standard VII and revision notes for the O-Level classes.", "Library"],
    ];
    for (const [title, body, category] of news) await website.createNews(admin, { title, body, category, excerpt: body.slice(0, 120), isPublic: "on" });
    const ev: [string, number, number | null, string][] = [
      ["Parents' meeting", 3, null, "Main hall"], ["Sports day", 14, null, "School grounds"], ["Mid-term break", 20, 24, ""], ["Career talk for Form IV", 9, null, "Room 4"], ["Terminal examinations begin", 30, 40, "Classrooms"], ["Closing day and prize giving", 55, null, "Main hall"],
    ];
    for (const [title, start, end, location] of ev) await website.createEvent(admin, { title, startsOn: addDays(today, start), endsOn: end ? addDays(today, end) : "", location, category: "School", description: `${title}. All parents and guardians are welcome.`, isPublic: "on" });
    return `${news.length} news, ${ev.length} events`;
  });
  await step("enquiries", async () => {
    if ((await db.enquiry.count({ where: { schoolId } })) > 0) return "skipped";
    const list: [string, string, string, string][] = [
      ["Anna Mwakyusa", "0712 345 601", "Admissions", "Good morning. Do you still take new pupils for Standard III this year? What documents are needed?"],
      ["John Massawe", "0754 221 908", "Fees", "Please send me the full fee table for Form I, including the exam fee and the bus."],
      ["Mary Kimambo", "0689 114 273", "Visit", "We would like to visit the school on a weekday before we decide. Who can we talk to?"],
      ["Peter Lyimo", "0765 880 412", "Boarding", "Does the school have boarding for girls? What is the monthly cost?"],
      ["Esther Mollel", "0713 667 520", "Admissions", "My son is in another school and wants to transfer to Form II in January. How do we apply?"],
    ];
    for (const [i, [name, phone, topic, message]] of list.entries()) await enquiries.submitEnquiry(schoolId, { name, phone, topic, message, consent: "on" }, { ip: `10.20.30.${i + 1}`, userAgent: "demo" });
    const rows = await db.enquiry.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } });
    await enquiries.updateEnquiry(registrar, rows[0]!.id, { status: "RESOLVED", internalNote: "Replied by phone. Sent the list of papers." }).catch(() => undefined);
    await enquiries.updateEnquiry(registrar, rows[1]!.id, { status: "IN_PROGRESS", internalNote: "Waiting for Finance to confirm the bus fee." }).catch(() => undefined);
    return `${list.length} enquiries`;
  });

  // ───── 7. Finance: more expenses ─────
  await step("more expenses", async () => {
    if ((await db.expense.count({ where: { schoolId } })) > 6) return "skipped";
    const cat = async (name: string) => (await db.expenseCategory.findFirst({ where: { schoolId, name } })) ?? (await expenses.createExpenseCategory(finance, { name }));
    const [salaries, transport, supplies] = [await cat("Salaries"), await cat("Transport"), await cat("Teaching materials")];
    const rows: [string, string, string, string, number, string][] = [
      [salaries.id, "4200000", "Staff payroll", "BANK", -12, "Teachers' salaries, last month"], [transport.id, "310000", "Fuel station", "CASH", -8, "Fuel for the school bus"],
      [supplies.id, "275000", "Local bookshop", "CASH", -5, "Textbooks for Form I"], [supplies.id, "88000", "Stationery shop", "CASH", -4, "Exam paper and printing"],
      [transport.id, "150000", "Garage", "BANK", -1, "Bus service and tyres"], [salaries.id, "1800000", "Support staff", "BANK", -12, "Support staff wages"],
    ];
    for (const [categoryId, amount, payee, method, day, description] of rows) {
      const e = await expenses.recordExpense(finance, { categoryId, amount, payee, method, spentOn: addDays(today, day), description, ...(method === "BANK" ? { reference: `BNK-${Math.floor(rnd() * 9000 + 1000)}` } : {}) });
      if (Number(amount) >= 200000 && day < -6) await expenses.approveExpense(head, e.id).catch(() => undefined);
    }
    return `${rows.length} expenses`;
  });

  console.log("\nDone. Sign in with any demo account (password StAnne2026), for example administrator@, head@, admissions@, academic@, finance@, teacher1@, parent@, student@ + stannemarie.local");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
