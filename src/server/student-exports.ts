import type { AuthContext } from "@/lib/auth/context";
import type { Table } from "@/lib/export/table";
import { formatDateOnly } from "@/lib/dates";
import { ageOn } from "@/lib/dates";
import { getStudentProfile } from "@/server/students";
import { studentInsights } from "@/server/student-profile";
import { getStudentStatement } from "@/server/invoices";
import { childProgress, childOrThrow } from "@/server/portal";
import { db } from "@/lib/db";

/*
 * One student's reports as downloads (Excel, PDF, CSV). The student must be visible to the person (same check as the student's page), and each
 * table holds only what that person may see on the page: marks need report-card or results access, attendance needs attendance access, fees
 * need fee access. Money is in major units.
 */

const major = (c: number) => c / 100;
const nameOf = (s: { firstName: string; middleName?: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** The progress report on one page: who the student is, the latest results, attendance, fees, homework and conduct, as far as the person may see them. */
export async function studentSummaryTable(ctx: AuthContext, studentId: string): Promise<Table> {
  const s = await getStudentProfile(ctx, studentId);
  const ins = await studentInsights(ctx, studentId).catch(() => null);
  const rows: [string, string, string | number][] = [];
  const cur = s.enrollments.find((e) => e.status === "ACTIVE");
  rows.push(["Student", "Name", nameOf(s)], ["Student", "Student ID", s.admissionNo], ["Student", "Class", cur ? `${cur.class.name}${cur.stream ? ` ${cur.stream.name}` : ""}` : "Not in a class"], ["Student", "Status", s.status], ["Student", "Age", ageOn(s.dateOfBirth)]);
  const terms = ins?.performance?.terms ?? [];
  const last = terms.at(-1);
  if (last) {
    rows.push(["Results", "Latest term", last.term]);
    if (last.average !== null) rows.push(["Results", "Average", `${r1(last.average)}%`], ["Results", "Grade", last.grade ?? ""], ["Results", "Position in class", last.position === null ? "" : `${last.position} of ${last.classSize}`]);
    if (last.division) rows.push(["Results", "Division", last.division]);
    const sorted = [...last.subjects].sort((a, b) => b.percent - a.percent);
    if (sorted.length) rows.push(["Results", "Strongest subject", `${sorted[0]!.name} (${Math.round(sorted[0]!.percent)}%)`]);
    if (sorted.length > 1) rows.push(["Results", "Weakest subject", `${sorted.at(-1)!.name} (${Math.round(sorted.at(-1)!.percent)}%)`]);
    if (terms.length > 1) rows.push(["Results", "Average by term", terms.filter((x) => x.average !== null).map((x) => `${x.term}: ${r1(x.average)}%`).join(" · ")]);
  }
  const att = ins?.attendance;
  if (att) rows.push(["Attendance", "Rate (last 6 months)", att.rate === null ? "" : `${att.rate}%`], ["Attendance", "Present", att.counts.PRESENT], ["Attendance", "Late", att.counts.LATE], ["Attendance", "Excused", att.counts.EXCUSED], ["Attendance", "Absent", att.counts.ABSENT]);
  const f = ins?.fees;
  if (f) rows.push(["Fees", "Billed", major(f.billed).toLocaleString("en-US")], ["Fees", "Paid", major(f.applied).toLocaleString("en-US")], ["Fees", "Still owed", major(f.outstanding).toLocaleString("en-US")], ["Fees", "Overdue", major(f.overdue).toLocaleString("en-US")]);
  const hw = ins?.homework;
  if (hw) rows.push(["Homework", "Handed in", hw.handedIn], ["Homework", "Handed in late", hw.late], ["Homework", "Marked", hw.marked], ["Homework", "Average mark", hw.averagePct === null ? "" : `${hw.averagePct}%`]);
  return { title: `Progress report ${s.admissionNo}`, subtitle: nameOf(s), columns: [{ key: "a", label: "Area", width: 16 }, { key: "f", label: "Figure", width: 26 }, { key: "v", label: "Value", width: 46 }], rows };
}

/** Every subject result of every report card the person may see, term by term, with the class average and position. */
export async function studentMarksTable(ctx: AuthContext, studentId: string): Promise<Table> {
  const s = await getStudentProfile(ctx, studentId);
  const ins = await studentInsights(ctx, studentId).catch(() => null);
  const terms = ins?.performance?.terms ?? [];
  const rows: (string | number | null)[][] = [];
  for (const t of terms) {
    for (const x of t.subjects) rows.push([t.term, x.name, Math.round(x.percent * 10) / 10, x.grade ?? "", x.classMean === null ? null : Math.round(x.classMean * 10) / 10, x.position === null ? "" : `${x.position} of ${x.classCount}`, x.change]);
    if (t.average !== null) rows.push([t.term, "AVERAGE", r1(t.average), t.grade ?? "", null, t.position === null ? "" : `${t.position} of ${t.classSize}`, null]);
  }
  return {
    title: `Marks ${s.admissionNo}`, subtitle: nameOf(s),
    columns: [{ key: "t", label: "Term", width: 18 }, { key: "s", label: "Subject", width: 22 }, { key: "p", label: "Score", kind: "percent", width: 10 }, { key: "g", label: "Grade", width: 8 }, { key: "m", label: "Class average", kind: "percent", width: 14 }, { key: "pos", label: "Position", width: 12 }, { key: "c", label: "Change since last term", width: 20 }],
    rows, footnote: "Marks are those printed on the report cards.",
  };
}

/** The attendance record of the last six months, day by day. */
export async function studentAttendanceTable(ctx: AuthContext, studentId: string): Promise<Table> {
  const s = await getStudentProfile(ctx, studentId);
  const ins = await studentInsights(ctx, studentId).catch(() => null);
  const att = ins?.attendance;
  return {
    title: `Attendance ${s.admissionNo}`, subtitle: `${nameOf(s)}${att?.rate != null ? ` · ${att.rate}% present` : ""}`,
    columns: [{ key: "d", label: "Date", width: 14 }, { key: "s", label: "Session", width: 14 }, { key: "st", label: "Status", width: 12 }, { key: "n", label: "Note", width: 36 }],
    rows: (att?.records ?? []).map((r) => [r.date, r.session, r.status.charAt(0) + r.status.slice(1).toLowerCase(), r.note ?? ""]),
  };
}

/** The fee statement: invoices and payments with dates and balances. Needs fee access. */
export async function studentFeesTable(ctx: AuthContext, studentId: string): Promise<Table> {
  const st = await getStudentStatement(ctx, studentId);
  const rows: (string | number | null)[][] = [
    ...st.invoices.map((i) => ["Invoice", i.number, formatDateOnly(i.issueDate), `Due ${formatDateOnly(i.dueDate)}${i.status === "VOID" ? " (void)" : ""}`, major(i.total), i.balance ? major(i.balance.outstanding) : null]),
    ...st.payments.map((p) => ["Payment", p.receipt?.number ?? p.reference ?? "", formatDateOnly(p.receivedOn), `${p.method}${p.status !== "POSTED" ? ` (${p.status.toLowerCase()})` : ""}`, major(Number(p.amount) * 100), null]),
  ];
  return {
    title: `Fee statement ${st.student.admissionNo}`, subtitle: `${nameOf(st.student)} · owed ${major(st.ledger.outstanding).toLocaleString("en-US")}`,
    columns: [{ key: "t", label: "Type", width: 10 }, { key: "n", label: "Number / receipt", width: 20 }, { key: "d", label: "Date", width: 14 }, { key: "x", label: "Details", width: 28 }, { key: "a", label: "Amount", kind: "money", width: 14 }, { key: "b", label: "Balance", kind: "money", width: 14 }],
    rows, footnote: "Money in the school's currency.",
  };
}

/** For parents and students: the progress of their own child from the PUBLISHED report cards only, term by term. */
export async function childProgressTable(ctx: AuthContext, studentId: string): Promise<Table> {
  const child = await childOrThrow(ctx, studentId);
  const p = await childProgress(ctx, studentId);
  const cards = await db.reportCard.findMany({ where: { schoolId: ctx.schoolId, studentId, status: "PUBLISHED" }, orderBy: { publishedAt: "asc" }, take: 12 });
  const rows: (string | number | null)[][] = [];
  for (const c of cards) {
    const s = c.snapshot as unknown as import("@/lib/results/report-types").ReportSnapshot;
    const term = `${s.term.name} · ${s.term.year}`;
    for (const x of s.subjects) rows.push([term, x.name, Math.round(x.percent * 10) / 10, x.grade ?? "", x.classMean === null ? null : Math.round(x.classMean * 10) / 10, x.position === null ? "" : `${x.position} of ${x.classCount}`]);
    if (s.summary.average !== null) rows.push([term, "AVERAGE", r1(s.summary.average), s.summary.grade ?? "", null, s.summary.position === null ? "" : `${s.summary.position} of ${s.summary.classSize}`]);
  }
  void p;
  return {
    title: `Progress report ${child.admissionNo}`, subtitle: child.name,
    columns: [{ key: "t", label: "Term", width: 18 }, { key: "s", label: "Subject", width: 22 }, { key: "p", label: "Score", kind: "percent", width: 10 }, { key: "g", label: "Grade", width: 8 }, { key: "m", label: "Class average", kind: "percent", width: 14 }, { key: "pos", label: "Position", width: 12 }],
    rows, footnote: "From the report cards the school has published.",
  };
}
