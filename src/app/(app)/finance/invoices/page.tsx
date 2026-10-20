import Link from "next/link";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamClasses, listExamTerms } from "@/server/exams";
import { getFeeSettings } from "@/server/fees";
import { listInvoices, previewTermInvoices, type InvoiceFilter } from "@/server/invoices";
import { db } from "@/lib/db";
import { Badge, Card, DataTable, EmptyState, FilterBar, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage, STATE_TONE } from "../_lib";
import { generateInvoicesAction } from "../actions";

export const metadata: Metadata = { title: "Invoices" };
type Search = { termId?: string; classId?: string; state?: string; q?: string; page?: string; preview?: string; due?: string };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [terms, classes, current, settings] = await Promise.all([listExamTerms(ctx), listExamClasses(ctx), getCurrentAcademicContext(ctx.schoolId), getFeeSettings(db, ctx.schoolId)]);
  const termId = sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : (sp.termId === "" ? undefined : current.term?.id);
  const classId = classes.some((c) => c.id === sp.classId) ? sp.classId : undefined;
  const state = (["UNPAID", "PARTIAL", "PAID", "NO_CHARGE", "OVERDUE", "VOID"] as const).find((s) => s === sp.state);
  const page = Math.max(1, Number(sp.page) || 1);
  const canGenerate = hasAny(ctx, ["invoice.generate"]);
  const filter: InvoiceFilter = { termId, classId, state, q: sp.q, page };
  const data = await listInvoices(ctx, filter);
  const defaultDue = new Date(Date.now() + settings.defaultDueDays * 86_400_000).toISOString().slice(0, 10);
  const due = sp.due && /^\d{4}-\d{2}-\d{2}$/.test(sp.due) ? sp.due : defaultDue;

  let preview: Awaited<ReturnType<typeof previewTermInvoices>> | null = null;
  let previewError: string | null = null;
  if (canGenerate && sp.preview && termId) {
    try { preview = await previewTermInvoices(ctx, { termId, classId, dueDate: due }); } catch (e) { if (e instanceof AppError) previewError = e.message; else throw e; }
  }
  const q = new URLSearchParams(Object.entries({ termId: termId ?? "", classId: classId ?? "", state: state ?? "", q: sp.q ?? "" }).filter(([, v]) => v));

  return (
    <>
      <PageHeader title={t("fin.invoices.title")} subtitle={t("fin.invoices.subtitle")} actions={<a href={`/api/finance/export?type=invoices&${q}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-canvas">{t("fin.exportCsv")}</a>} />
      <FinanceNav ctx={ctx} t={t} current="/finance/invoices" unmatched={unmatched} />

      {canGenerate && termId && (
        <Card title={t("fin.invoices.generate")} className="mb-6">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="termId" value={termId} />
            <input type="hidden" name="preview" value="1" />
            <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={classId ?? ""} placeholder={t("fin.invoices.allClasses")} />
            <Field name="due" type="date" label={t("fin.invoices.dueDate")} defaultValue={due} required />
            <button className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-canvas">{t("fin.invoices.preview")}</button>
          </form>
          {previewError && <p role="alert" className="mt-3 text-sm text-bad">{previewError}</p>}
          {preview && (
            <div className="mt-4 space-y-3 rounded-xl border border-line bg-canvas p-4 text-sm">
              <p><strong>{t("fin.invoices.willCreate", { count: preview.willCreate })}</strong> · {t("fin.invoices.willBill", { amount: money(preview.billedCents) })}</p>
              {preview.zeroTotal > 0 && <p className="text-muted">{t("fin.invoices.zeroTotal", { count: preview.zeroTotal })}</p>}
              {preview.alreadyInvoiced > 0 && <p className="text-muted">{t("fin.invoices.alreadyInvoiced", { count: preview.alreadyInvoiced })}</p>}
              {preview.notEnrolled > 0 && <p className="text-muted">{t("fin.invoices.notEnrolled", { count: preview.notEnrolled })}</p>}
              {preview.noStructure.length > 0 && <p role="alert" className="text-warn">{t("fin.invoices.noStructure", { classes: preview.noStructure.join(", ") })}</p>}
              {preview.willCreate > 0 && (
                <ActionForm action={generateInvoicesAction} submitLabel={t("fin.invoices.confirmGenerate", { count: preview.willCreate })} confirm={t("fin.invoices.confirmText", { count: preview.willCreate, amount: money(preview.billedCents) })} className="space-y-0">
                  <input type="hidden" name="termId" value={termId} />
                  {classId && <input type="hidden" name="classId" value={classId} />}
                  <input type="hidden" name="dueDate" value={due} />
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}

      <FilterBar t={t} resetHref="/finance/invoices">
        <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={termId ?? ""} placeholder={t("common.all")} />
        <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={classId ?? ""} placeholder={t("common.all")} />
        <Field name="state" type="select" label={t("marks.status")} options={(["UNPAID", "PARTIAL", "PAID", "NO_CHARGE", "OVERDUE", "VOID"] as const).map((s) => ({ value: s, label: tDynamic(t, "fin.state", s) }))} defaultValue={state ?? ""} placeholder={t("common.all")} />
        <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("fin.invoices.search")} className="min-w-48 flex-1" />
      </FilterBar>

      {data.items.length === 0 ? (
        <EmptyState>{t("fin.invoices.empty")}</EmptyState>
      ) : (
        <DataTable head={[t("fin.pdf.invoiceNo"), t("marks.student"), t("exam.class"), t("fin.total"), t("fin.paid"), t("fin.outstanding"), t("marks.status")]}>
          {data.items.map((i) => (
            <tr key={i.id}>
              <Td><Link href={`/finance/invoices/${i.id}`} className="font-medium text-brand-800 hover:underline">{i.number}</Link><p className="text-xs text-muted">{i.termName ?? t("fin.invoices.oneOff")} · {t("fin.pdf.due")} {i.dueDate}</p></Td>
              <Td><Link href={`/finance/students/${i.studentId}`} className="hover:underline">{i.studentName}</Link><p className="text-xs text-muted">{i.admissionNo}</p></Td>
              <Td>{i.className ?? "—"}</Td>
              <Td className="tabular-nums">{i.balance ? money(i.balance.total) : "—"}</Td>
              <Td className="tabular-nums">{i.balance ? money(i.balance.paid) : "—"}</Td>
              <Td className="tabular-nums font-medium">{i.balance ? money(i.balance.outstanding) : "—"}</Td>
              <Td>
                {i.status === "VOID" ? <Badge tone="neutral">{t("fin.state.VOID")}</Badge> : i.balance && <><Badge tone={STATE_TONE[i.balance.state]}>{tDynamic(t, "fin.state", i.balance.state)}</Badge>{i.balance.overdueAmount > 0 && <> <Badge tone="bad">{t("fin.state.OVERDUE")}</Badge></>}</>}
              </Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/finance/invoices" params={{ termId: termId ?? "", classId, state, q: sp.q }} t={t} />

    </>
  );
}
