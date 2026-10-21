import { db } from "@/lib/db";
import { forbidden } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { AGE_BUCKETS } from "@/lib/finance/ledger";
import type { ExportFormat, Table } from "@/lib/export/table";
import { actorOf, writeAudit } from "@/server/audit";
import { classReport } from "@/server/attendance-reports";
import { listInvoices } from "@/server/invoices";
import { listStudents } from "@/server/students";
import { listPayments } from "@/server/payments";
import { listExpenses } from "@/server/expenses";
import { arrearsReport, classCollectionReport, collectionsReport, expensesReport } from "@/server/finance-reports";
import { getClassResults } from "@/server/results";
export { admissionsTable } from "@/server/admission-reports";

/*
 * Report data as tables. Every table is built with the same service, permission and scope as the screen it mirrors, so an
 * export can never show more than the page does. Each export is written to the audit log. Money is in major units.
 */

const major = (cents: number) => cents / 100;
const att = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

export async function auditExport(ctx: AuthContext, kind: string, format: ExportFormat, rows: number) {
  await writeAudit(db, actorOf(ctx), { action: "export.download", entityType: "Export", entityId: kind, summary: `${kind} (${format})`, changes: { rows, format } });
}

export async function studentsTable(ctx: AuthContext, f: { q?: string; classId?: string; streamId?: string; status?: string }): Promise<Table> {
  requireAnyPermission(ctx, ["student.read", "student.read_assigned"]);
  const { items, total } = await listStudents(ctx, { ...f, all: true });
  const withContacts = ctx.permissions.has("student.guardians.read");
  const contacts = withContacts
    ? new Map((await db.studentGuardian.findMany({ where: { schoolId: ctx.schoolId, studentId: { in: items.map((s) => s.id) }, isPrimary: true }, include: { guardian: { select: { fullName: true, phone: true } } } })).map((l) => [l.studentId, l.guardian]))
    : new Map();
  return {
    title: "Students", subtitle: total > items.length ? `First ${items.length} of ${total}` : `${items.length} students`,
    columns: [
      { key: "adm", label: "Admission no", width: 16 }, { key: "name", label: "Name", width: 30 }, { key: "sex", label: "Sex", width: 8 }, { key: "dob", label: "Date of birth", width: 13 }, { key: "class", label: "Class", width: 14 }, { key: "stream", label: "Stream", width: 8 }, { key: "status", label: "Status", width: 12 },
      ...(withContacts ? [{ key: "g", label: "Primary guardian", width: 24 }, { key: "p", label: "Guardian phone", width: 15 }] : []),
    ],
    rows: items.map((s) => [s.admissionNo, [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), s.gender === "MALE" ? "M" : "F", formatDateOnly(s.dateOfBirth), s.enrollments[0]?.class.name ?? "", s.enrollments[0]?.stream?.name ?? "", s.status, ...(withContacts ? [contacts.get(s.id)?.fullName ?? "", contacts.get(s.id)?.phone ?? ""] : [])]),
  };
}

export async function resultsTable(ctx: AuthContext, input: { termId: string; classId: string; streamId?: string; basis?: string }): Promise<Table> {
  const r = await getClassResults(ctx, input); // permission and class-teacher scope are checked here
  const d = r.policy.decimals;
  const division = !!r.scale?.divisionBestN;
  return {
    title: `Results - ${r.class.name}${r.stream ? ` ${r.stream}` : ""}`,
    subtitle: `${r.term.name} ${r.term.year} - ${r.basis === "OFFICIAL" ? "locked results (official)" : "approved and locked (provisional)"}${r.coverage.complete ? "" : " - INCOMPLETE"}`,
    columns: [
      { key: "pos", label: "Pos", kind: "int", width: 6 }, { key: "adm", label: "Admission no", width: 16 }, { key: "name", label: "Student", width: 28 }, ...(r.streams.length && !r.stream ? [{ key: "stream", label: "Stream", width: 8 }] : []),
      ...r.subjects.map((s) => ({ key: s.id, label: s.code || s.name, kind: "money" as const, width: 9 })),
      { key: "total", label: "Total", kind: "money", width: 10 }, { key: "avg", label: "Average", kind: "money", width: 10 }, { key: "grade", label: "Grade", width: 7 }, ...(division ? [{ key: "div", label: "Division", width: 9 }] : []),
    ],
    rows: r.rows.map((x) => [x.position, x.student.admissionNo, x.student.name, ...(r.streams.length && !r.stream ? [x.streamName ?? ""] : []), ...r.subjects.map((s) => x.subjects.find((l) => l.subjectId === s.id)?.percent ?? null), x.subjectCount ? x.total : null, x.average, x.grade ?? "", ...(division ? [x.subjectCount ? (x.division ?? "") : ""] : [])]),
    footnote: `Scale: ${r.scale?.name ?? "none"}. Absent: ${r.policy.absentAs === "EXCLUDE" ? "not counted" : "counted as zero"}. Ranked by ${r.policy.positionBy === "TOTAL" ? "total" : "average"}. Decimals: ${d}.`,
  };
}

export async function attendanceTable(ctx: AuthContext, input: { classId: string; streamId?: string; from: string; to: string }): Promise<Table> {
  const r = await classReport(ctx, input); // scope checked here
  return {
    title: `Attendance - ${r.className}`, subtitle: `${r.from} to ${r.to} - ${r.daysRecorded} days recorded`,
    columns: [{ key: "adm", label: "Admission no", width: 16 }, { key: "name", label: "Student", width: 30 }, ...att.map((a) => ({ key: a, label: a[0] + a.slice(1).toLowerCase(), kind: "int" as const, width: 9 })), { key: "rate", label: "Rate", kind: "percent", width: 9 }],
    rows: r.rows.map((x) => [x.admissionNo, x.name, ...att.map((a) => x.counts[a]), x.rate]),
    footnote: `Rate follows the school's policy for late and excused. Class rate: ${r.rate === null ? "n/a" : `${r.rate}%`}. Low attendance is below ${r.thresholdPct}%.`,
  };
}

export type FinanceExport = "arrears" | "collections" | "classes" | "expenses" | "payments" | "invoices";
export const FINANCE_EXPORTS: FinanceExport[] = ["arrears", "collections", "classes", "expenses", "payments", "invoices"];

export async function financeTable(ctx: AuthContext, type: FinanceExport, p: { termId?: string; classId?: string; from?: string; to?: string }): Promise<Table> {
  if (ctx.userType !== "STAFF") throw forbidden();
  if (type === "arrears") {
    const a = await arrearsReport(ctx, { termId: p.termId, classId: p.classId });
    return {
      title: "Fee arrears", subtitle: `As of ${a.asOf} - ${a.studentsOwing} students owe`,
      columns: [{ key: "adm", label: "Admission no", width: 16 }, { key: "name", label: "Student", width: 28 }, { key: "cls", label: "Class", width: 14 }, { key: "out", label: "Outstanding", kind: "money", width: 14 }, { key: "over", label: "Overdue", kind: "money", width: 14 }, ...AGE_BUCKETS.map((b) => ({ key: b, label: `${b} days`, kind: "money" as const, width: 12 })), { key: "old", label: "Oldest due", width: 12 }, { key: "g", label: "Guardian", width: 22 }, { key: "ph", label: "Phone", width: 15 }],
      rows: a.rows.map((r) => [r.admissionNo, r.name, r.className ?? "", major(r.outstanding), major(r.overdue), ...AGE_BUCKETS.map((b) => major(r.ageing[b])), r.oldestDue ?? "", r.guardian ?? "", r.phone ?? ""]),
      footnote: `Total outstanding ${major(a.outstandingTotal)}; overdue ${major(a.overdueTotal)}.`,
    };
  }
  if (type === "collections") {
    const c = await collectionsReport(ctx, { from: p.from ?? "", to: p.to ?? "" });
    return {
      title: "Collections", subtitle: `${c.from} to ${c.to}`,
      columns: [{ key: "d", label: "Date", width: 14 }, { key: "n", label: "Payments", kind: "int", width: 10 }, { key: "a", label: "Amount", kind: "money", width: 16 }],
      rows: c.byDay.map((d) => [d.date, d.count, major(d.cents)]),
      footnote: `Collected ${major(c.collected)} (${c.count} payments); refunds paid ${major(c.refundsPaid)}; net ${major(c.net)}. Reversed payments (${c.reversedCount}, ${major(c.reversed)}) are not counted. By method: ${c.byMethod.map((m) => `${m.method} ${major(m.cents)}`).join(", ") || "none"}.`,
    };
  }
  if (type === "classes") {
    const rows = await classCollectionReport(ctx, { termId: p.termId ?? "" });
    return { title: "Collection by class", columns: [{ key: "c", label: "Class", width: 18 }, { key: "s", label: "Students", kind: "int", width: 10 }, { key: "b", label: "Billed", kind: "money", width: 14 }, { key: "p", label: "Paid", kind: "money", width: 14 }, { key: "o", label: "Outstanding", kind: "money", width: 14 }, { key: "r", label: "Collected", kind: "percent", width: 11 }], rows: rows.map((r) => [r.className, r.students, major(r.billed), major(r.paid), major(r.outstanding), r.ratePct]) };
  }
  if (type === "expenses") {
    const e = await expensesReport(ctx, { from: p.from ?? "", to: p.to ?? "" });
    return { title: "Expenses", subtitle: `${e.from} to ${e.to}`, columns: [{ key: "c", label: "Category", width: 26 }, { key: "n", label: "Entries", kind: "int", width: 10 }, { key: "a", label: "Amount", kind: "money", width: 16 }], rows: e.rows.map((r) => [r.category, r.count, major(r.cents)]), footnote: `Total ${major(e.total)}. Voided entries are not counted.` };
  }
  if (type === "payments") {
    requirePermission(ctx, "fees.read");
    const rows: (string | number | null)[][] = [];
    for (let page = 1; page <= 100; page++) {
      const r = await listPayments(ctx, { from: p.from || undefined, to: p.to || undefined, page });
      for (const x of r.items) rows.push([formatDateOnly(x.receivedOn), x.receipt?.number ?? "", x.admissionNo, x.studentName, x.method, x.reference ?? "", x.status, x.source, major(x.amountCents)]);
      if (page * r.pageSize >= r.total) break;
    }
    return { title: "Payments", subtitle: p.from || p.to ? `${p.from ?? "start"} to ${p.to ?? "today"}` : "All dates", columns: [{ key: "d", label: "Date", width: 12 }, { key: "r", label: "Receipt", width: 16 }, { key: "a", label: "Admission no", width: 16 }, { key: "n", label: "Student", width: 26 }, { key: "m", label: "Method", width: 13 }, { key: "ref", label: "Reference", width: 18 }, { key: "s", label: "Status", width: 10 }, { key: "src", label: "Source", width: 10 }, { key: "amt", label: "Amount", kind: "money", width: 14 }], rows };
  }
  requirePermission(ctx, "fees.read");
  const rows: (string | number | null)[][] = [];
  for (let page = 1; page <= 200; page++) {
    const r = await listInvoices(ctx, { termId: p.termId || undefined, classId: p.classId || undefined, page });
    for (const i of r.items) rows.push([i.number, i.admissionNo, i.studentName, i.className ?? "", i.termName ?? "", i.issueDate, i.dueDate, major(i.balance?.total ?? 0), major(i.balance?.paid ?? 0), major(i.balance?.outstanding ?? 0), i.balance?.state ?? i.status]);
    if (page * r.pageSize >= r.total) break;
  }
  return { title: "Invoices", columns: [{ key: "n", label: "Number", width: 16 }, { key: "a", label: "Admission no", width: 16 }, { key: "s", label: "Student", width: 26 }, { key: "c", label: "Class", width: 12 }, { key: "t", label: "Term", width: 10 }, { key: "i", label: "Issued", width: 12 }, { key: "d", label: "Due", width: 12 }, { key: "tot", label: "Total", kind: "money", width: 13 }, { key: "p", label: "Paid", kind: "money", width: 13 }, { key: "o", label: "Outstanding", kind: "money", width: 13 }, { key: "st", label: "Status", width: 11 }], rows };
}
