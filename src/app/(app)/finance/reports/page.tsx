import Link from "next/link";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { AGE_BUCKETS } from "@/lib/finance/ledger";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamClasses, listExamTerms } from "@/server/exams";
import { arrearsReport, classCollectionReport, collectionsReport, expensesReport } from "@/server/finance-reports";
import { Card, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Stat, Td } from "@/components/ui";
import { Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";

export const metadata: Metadata = { title: "Finance reports" };
type Search = { report?: string; termId?: string; classId?: string; from?: string; to?: string };
const REPORTS = ["arrears", "collections", "classes", "expenses"] as const;

export default async function FinanceReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ctx, t, money, unmatched, timezone } = await financePage();
  if (!hasAny(ctx, ["finance.reports"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const report = REPORTS.find((r) => r === sp.report) ?? "arrears";
  const [terms, classes, current] = await Promise.all([listExamTerms(ctx), listExamClasses(ctx), getCurrentAcademicContext(ctx.schoolId)]);
  const termId = terms.find((x) => x.id === sp.termId)?.id ?? (report === "classes" ? (current.term?.id ?? terms[0]?.id) : undefined);
  const classId = classes.find((c) => c.id === sp.classId)?.id;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const clean = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = clean(sp.from) ?? `${today.slice(0, 4)}-01-01`;
  const to = clean(sp.to) ?? today;

  let body: React.ReactNode = null;
  let exportHref = "";
  try {
    if (report === "arrears") {
      const a = await arrearsReport(ctx, { termId, classId });
      exportHref = `/api/finance/export?type=arrears&termId=${termId ?? ""}&classId=${classId ?? ""}`;
      body = (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("fin.outstanding")} value={money(a.outstandingTotal)} hint={t("fin.reports.owing", { count: a.studentsOwing })} />
            <Stat label={t("fin.overdue")} value={money(a.overdueTotal)} />
            {AGE_BUCKETS.slice(0, 2).map((b) => <Stat key={b} label={t("fin.reports.days", { range: b })} value={money(a.totals[b])} />)}
            {AGE_BUCKETS.slice(2).map((b) => <Stat key={b} label={t("fin.reports.days", { range: b })} value={money(a.totals[b])} />)}
          </div>
          {a.rows.length === 0 ? <EmptyState>{t("fin.reports.noArrears")}</EmptyState> : (
            <DataTable head={[t("marks.student"), t("exam.class"), t("fin.outstanding"), t("fin.overdue"), t("fin.reports.oldest"), t("fin.reports.contact")]}>
              {a.rows.map((r) => (
                <tr key={r.studentId}>
                  <Td><Link href={`/finance/students/${r.studentId}`} className="font-medium text-brand-800 hover:underline">{r.name}</Link><p className="text-xs text-muted">{r.admissionNo}</p></Td>
                  <Td>{r.className ?? "—"}</Td>
                  <Td className="tabular-nums font-medium">{money(r.outstanding)}</Td>
                  <Td className="tabular-nums">{r.overdue > 0 ? money(r.overdue) : "—"}</Td>
                  <Td className="whitespace-nowrap">{r.oldestDue ? displayDate(new Date(`${r.oldestDue}T00:00:00Z`), ctx.locale) : "—"}</Td>
                  <Td className="text-sm">{r.guardian ?? "—"}{r.phone && <p className="text-xs text-muted">{r.phone}</p>}</Td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      );
    } else if (report === "collections") {
      const c = await collectionsReport(ctx, { from, to });
      exportHref = `/api/finance/export?type=collections&from=${from}&to=${to}`;
      body = (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("fin.collected")} value={money(c.collected)} hint={t("fin.overview.payments", { count: c.count })} />
            <Stat label={t("fin.refundsPaid")} value={money(c.refundsPaid)} />
            <Stat label={t("fin.net")} value={money(c.net)} />
            <Stat label={t("fin.reports.reversed")} value={money(c.reversed)} hint={t("fin.overview.payments", { count: c.reversedCount })} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={t("fin.overview.byMethod")}><ul className="space-y-2 text-sm">{c.byMethod.map((m) => <li key={m.method} className="flex justify-between"><span>{tDynamic(t, "fin.method", m.method)} <span className="text-muted">({m.count})</span></span><span className="tabular-nums font-medium">{money(m.cents)}</span></li>)}{c.byMethod.length === 0 && <li className="text-muted">{t("fin.overview.noPayments")}</li>}</ul></Card>
            <Card title={t("fin.reports.byDay")}><ul className="max-h-80 space-y-1.5 overflow-auto text-sm">{c.byDay.map((d) => <li key={d.date} className="flex justify-between"><span>{displayDate(new Date(`${d.date}T00:00:00Z`), ctx.locale)} <span className="text-muted">({d.count})</span></span><span className="tabular-nums">{money(d.cents)}</span></li>)}{c.byDay.length === 0 && <li className="text-muted">{t("fin.overview.noPayments")}</li>}</ul></Card>
          </div>
        </>
      );
    } else if (report === "classes" && termId) {
      const rows = await classCollectionReport(ctx, { termId });
      exportHref = `/api/finance/export?type=classes&termId=${termId}`;
      body = rows.length === 0 ? <EmptyState>{t("fin.invoices.empty")}</EmptyState> : (
        <DataTable head={[t("exam.class"), t("fin.reports.students"), t("fin.billed"), t("fin.paid"), t("fin.outstanding"), t("fin.reports.rate")]}>
          {rows.map((r) => <tr key={r.classId}><Td className="font-medium">{r.className}</Td><Td className="tabular-nums">{r.students}</Td><Td className="tabular-nums">{money(r.billed)}</Td><Td className="tabular-nums">{money(r.paid)}</Td><Td className="tabular-nums font-medium">{money(r.outstanding)}</Td><Td className="tabular-nums">{r.ratePct === null ? "—" : `${r.ratePct}%`}</Td></tr>)}
        </DataTable>
      );
    } else if (report === "expenses") {
      const e = await expensesReport(ctx, { from, to });
      exportHref = `/api/finance/export?type=expenses&from=${from}&to=${to}`;
      body = e.rows.length === 0 ? <EmptyState>{t("fin.expenses.empty")}</EmptyState> : (
        <DataTable head={[t("fin.expenses.category"), t("fin.reports.entries"), t("fin.pdf.amount")]}>
          {e.rows.map((r) => <tr key={r.category}><Td className="font-medium">{r.category}</Td><Td className="tabular-nums">{r.count}</Td><Td className="tabular-nums">{money(r.cents)}</Td></tr>)}
          <tr className="bg-canvas font-semibold"><Td>{t("fin.total")}</Td><Td /><Td className="tabular-nums">{money(e.total)}</Td></tr>
        </DataTable>
      );
    }
  } catch (err) {
    if (err instanceof AppError) body = <EmptyState>{err.message}</EmptyState>;
    else throw err;
  }

  return (
    <>
      <PageHeader title={t("fin.reports.title")} subtitle={t("fin.reports.subtitle")} actions={exportHref ? <a href={exportHref} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-canvas">{t("fin.exportCsv")}</a> : undefined} />
      <FinanceNav ctx={ctx} t={t} current="/finance/reports" unmatched={unmatched} />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("fin.reports.title")}>
        {REPORTS.map((r) => <Link key={r} href={`/finance/reports?report=${r}`} aria-current={report === r ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${report === r ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white hover:bg-canvas"}`}>{t(`fin.report.${r}` as never)}</Link>)}
      </nav>
      <FilterBar t={t} resetHref={`/finance/reports?report=${report}`}>
        <input type="hidden" name="report" value={report} />
        {(report === "arrears" || report === "classes") && <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={termId ?? ""} placeholder={report === "arrears" ? t("common.all") : undefined} />}
        {report === "arrears" && <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={classId ?? ""} placeholder={t("common.all")} />}
        {(report === "collections" || report === "expenses") && <><Field name="from" type="date" label={t("fin.from")} defaultValue={from} /><Field name="to" type="date" label={t("fin.to")} defaultValue={to} /></>}
      </FilterBar>
      {body}
    </>
  );
}
