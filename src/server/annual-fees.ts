import { z } from "zod";
import { db } from "@/lib/db";
import { notFound, invalid } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { isCleared, type ClearanceState } from "@/lib/lifecycle/rules";
import { defaultTargetYear } from "@/server/annual-registration";
import { generateTermInvoices } from "@/server/invoices";
import { loadGrades } from "@/server/lifecycle-data";
import { yearFinances, type YearFinance } from "@/server/lifecycle-data";
import { getLifecycleSettings } from "@/server/lifecycle-settings";
import { dateOnly, parse, uuid } from "@/lib/validation";

/*
 * Annual fee clearance for Finance: for every returning student, what the new year costs, what verified payments cover, and what is still owed
 * from earlier years (always shown on its own line, never mixed into the year's figures). Clearance is a fact about money; it never changes a
 * decision or a placement. Everything comes from the one balance calculation, so these numbers match the invoices and statements.
 */

const nameOf = (s: { firstName: string; middleName?: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
const PAGE = 50;

export type FeeRow = {
  registrationId: string; studentId: string; admissionNo: string; name: string; className: string | null; status: string;
  streamName: string | null; outcome: string; state: ClearanceState; firstTerm: YearFinance["firstTerm"]; year: YearFinance["year"]; previous: YearFinance["previous"]; previousOutstanding: number; exceptionReason: string | null;
};
export type FeeFilter = { yearId?: string; classId?: string; streamId?: string; outcome?: "PROMOTED" | "REPEAT"; regStatus?: "PENDING" | "REGISTERED" | "ACTIVE"; state?: "cleared" | "owing" | "not_billed" | "exception" | "previous"; q?: string; page?: number };

export async function annualFeeBoard(ctx: AuthContext, opts: FeeFilter = {}) {
  requirePermission(ctx, "fees.read");
  const { years, target } = await defaultTargetYear(db, ctx.schoolId);
  const year = (opts.yearId ? years.find((y) => y.id === opts.yearId) : null) ?? target;
  const settings = await getLifecycleSettings(db, ctx.schoolId);
  const empty = { year: null, years, rows: [] as FeeRow[], total: 0, page: 1, pages: 1, totals: { students: 0, expected: 0, collected: 0, outstanding: 0, previousOutstanding: 0, cleared: 0, owing: 0, notBilled: 0, exceptions: 0, withPreviousDebt: 0 }, needBilling: 0, firstTermName: null as string | null, settings, classes: [] as { id: string; name: string }[], streams: [] as { id: string; name: string }[] };
  if (!year) return empty;

  const grades = await loadGrades(db, ctx.schoolId);
  const className = new Map(grades.map((g) => [g.id, g.name]));
  const streamRows = await db.stream.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true, classId: true } });
  const streamName = new Map(streamRows.map((x) => [x.id, x.name]));
  const regs = await db.annualRegistration.findMany({
    where: { schoolId: ctx.schoolId, academicYearId: year.id, status: { not: "CANCELLED" } },
    include: { student: { select: { firstName: true, middleName: true, lastName: true, admissionNo: true } }, progression: { select: { toClassId: true, outcome: true } } },
  });
  const money = await yearFinances(db, ctx.schoolId, regs.map((r) => r.studentId), year.id, settings, new Set(regs.filter((r) => r.clearanceExceptionReason).map((r) => r.studentId)));
  const all: FeeRow[] = regs.map((r) => {
    const m = money.get(r.studentId)!;
    const cid = r.classId ?? r.progression.toClassId;
    return {
      registrationId: r.id, studentId: r.studentId, admissionNo: r.student.admissionNo, name: nameOf(r.student), className: cid ? className.get(cid) ?? null : null, streamName: r.streamId ? streamName.get(r.streamId) ?? null : null, outcome: r.progression.outcome, status: r.status,
      state: m.state, firstTerm: m.firstTerm, year: m.year, previous: m.previous, previousOutstanding: m.previousOutstanding, exceptionReason: r.clearanceExceptionReason,
    };
  });
  const totals = {
    students: all.length, expected: all.reduce((n, r) => n + r.year.charged, 0), collected: all.reduce((n, r) => n + r.year.paid, 0), outstanding: all.reduce((n, r) => n + r.year.outstanding, 0),
    previousOutstanding: all.reduce((n, r) => n + r.previousOutstanding, 0), cleared: all.filter((r) => isCleared(r.state)).length, owing: all.filter((r) => r.state === "OUTSTANDING").length,
    notBilled: all.filter((r) => r.state === "NOT_BILLED").length, exceptions: all.filter((r) => r.exceptionReason).length, withPreviousDebt: all.filter((r) => r.previousOutstanding > 0).length,
  };
  const q = opts.q?.trim().toLowerCase();
  const rows = all.filter((r) => {
    if (opts.classId && !regs.find((x) => x.id === r.registrationId && (x.classId ?? x.progression.toClassId) === opts.classId)) return false;
    if (opts.streamId && !regs.find((x) => x.id === r.registrationId && x.streamId === opts.streamId)) return false;
    if (opts.outcome && r.outcome !== opts.outcome) return false;
    if (opts.regStatus && r.status !== opts.regStatus) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.admissionNo.toLowerCase().includes(q)) return false;
    switch (opts.state) {
      case "cleared": return isCleared(r.state);
      case "owing": return r.state === "OUTSTANDING";
      case "not_billed": return r.state === "NOT_BILLED";
      case "exception": return r.exceptionReason !== null;
      case "previous": return r.previousOutstanding > 0;
      default: return true;
    }
  }).sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "") || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const firstTerm = await db.term.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: year.id }, orderBy: { sequence: "asc" }, select: { name: true } });
  return { year, years, rows: rows.slice((page - 1) * PAGE, page * PAGE), total: rows.length, page, pages, totals, needBilling: totals.notBilled, firstTermName: firstTerm?.name ?? null, settings, classes: grades.map((g) => ({ id: g.id, name: g.name })),
    streams: streamRows.filter((x) => !opts.classId || x.classId === opts.classId).map((x) => ({ id: x.id, name: `${className.get(x.classId) ?? ""} ${x.name}`.trim() })) };
}

const billSchema = z.object({ yearId: uuid(), dueDate: dateOnly() });

/**
 * Bills the first term of the year for returning students who are placed (and everybody else on the roster who has no invoice yet), using the
 * same fee structures and discounts as every other term invoice. Students already billed are skipped, so it can be repeated safely.
 */
export async function billReturningStudents(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "invoice.generate");
  const d = parse(billSchema, input);
  const year = await db.academicYear.findFirst({ where: { id: d.yearId, schoolId: ctx.schoolId } });
  if (!year) throw notFound("Academic year");
  const term = await db.term.findFirst({ where: { schoolId: ctx.schoolId, academicYearId: year.id }, orderBy: { sequence: "asc" } });
  if (!term) throw invalid("Set up the terms of this academic year first.", { yearId: "No terms" });
  return generateTermInvoices(ctx, { termId: term.id, dueDate: d.dueDate.toISOString().slice(0, 10), returning: "on" });
}
