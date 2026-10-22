import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import { getStudentStatement } from "@/server/invoices";
import { listFeeItems, listStudentDiscounts } from "@/server/fees";
import { getCurrentAcademicContext } from "@/server/academics";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Stat, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage, STATE_TONE } from "../../_lib";
import { createOtherInvoiceAction, endDiscountAction, grantDiscountAction, requestRefundAction } from "../../actions";

export const metadata: Metadata = { title: "Student fees" };

export default async function StudentFeesPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getStudentStatement>>;
  try { d = await getStudentStatement(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const [discounts, items, current] = await Promise.all([listStudentDiscounts(ctx, id), hasAny(ctx, ["fees.discount"]) ? listFeeItems(ctx) : [], getCurrentAcademicContext(ctx.schoolId)]);
  const l = d.ledger;
  const s = d.student;
  const name = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
  const nextWeek = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title={name} subtitle={`${s.admissionNo} · ${t("fin.student.statement")}`} actions={<>
        {hasAny(ctx, ["payment.record"]) && <Link href={`/finance/payments/new?studentId=${s.id}`} className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 btn-primary">{t("fin.payments.record")}</Link>}
        {hasAny(ctx, ["student.read"]) && <Link href={`/students/${s.id}`} className="text-sm font-medium text-link hover:underline">{t("fin.student.profile")}</Link>}
      </>} />
      <FinanceNav ctx={ctx} t={t} current="/finance" unmatched={unmatched} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t("fin.billed")} value={money(l.billed)} />
        <Stat label={t("fin.paid")} value={money(l.applied)} hint={t("fin.student.appliedHint")} />
        <Stat label={t("fin.outstanding")} value={money(l.outstanding)} />
        <Stat label={t("fin.overdue")} value={money(l.overdue)} />
        <Stat label={t("fin.credit")} value={money(l.credit)} hint={t("fin.student.creditHint")} />
      </div>

      <section className="mt-8"><h2 className="mb-2 text-base font-semibold">{t("fin.nav.invoices")}</h2>
        {d.invoices.length === 0 ? <EmptyState>{t("fin.student.noInvoices")}</EmptyState> : (
          <DataTable head={[t("fin.pdf.invoiceNo"), t("fin.pdf.due"), t("fin.total"), t("fin.paid"), t("fin.outstanding"), t("marks.status")]}>
            {d.invoices.map((i) => (
              <tr key={i.id} className={i.status === "VOID" ? "text-muted" : undefined}>
                <Td><Link href={`/finance/invoices/${i.id}`} className="font-medium text-link hover:underline">{i.number}</Link></Td>
                <Td className="whitespace-nowrap">{displayDate(i.dueDate, ctx.locale)}</Td>
                <Td className="tabular-nums">{money(i.total)}</Td>
                <Td className="tabular-nums">{i.balance ? money(i.balance.paid) : "—"}</Td>
                <Td className="tabular-nums font-medium">{i.balance ? money(i.balance.outstanding) : "—"}</Td>
                <Td>{i.status === "VOID" ? <Badge>{t("fin.state.VOID")}</Badge> : i.balance && <Badge tone={STATE_TONE[i.balance.state]}>{tDynamic(t, "fin.state", i.balance.state)}</Badge>}</Td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      <section className="mt-8"><h2 className="mb-2 text-base font-semibold">{t("fin.nav.payments")}</h2>
        {d.payments.length === 0 ? <EmptyState>{t("fin.payments.empty")}</EmptyState> : (
          <DataTable head={[t("fin.pdf.date"), t("fin.pdf.receiptNo"), t("fin.pdf.method"), t("fin.pdf.reference"), t("fin.pdf.amount"), t("marks.status")]}>
            {d.payments.map((p) => (
              <tr key={p.id} className={p.status === "REVERSED" ? "text-muted" : undefined}>
                <Td className="whitespace-nowrap">{displayDate(p.receivedOn, ctx.locale)}</Td>
                <Td><Link href={`/finance/payments/${p.id}`} className="font-medium text-link hover:underline">{p.receipt?.number ?? "—"}</Link></Td>
                <Td>{tDynamic(t, "fin.method", p.method)}</Td>
                <Td className="text-xs">{p.reference ?? "—"}</Td>
                <Td className={`tabular-nums ${p.status === "REVERSED" ? "line-through" : "font-medium"}`}>{money(centsOf(p.amount))}</Td>
                <Td><Badge tone={p.status === "POSTED" ? "ok" : "bad"}>{t(`fin.pay.${p.status}` as never)}</Badge></Td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      {d.refunds.length > 0 && (
        <section className="mt-8"><h2 className="mb-2 text-base font-semibold">{t("fin.nav.refunds")}</h2>
          <DataTable head={[t("fin.pdf.date"), t("fin.pdf.amount"), t("marks.reason"), t("marks.status")]}>
            {d.refunds.map((r) => <tr key={r.id}><Td className="whitespace-nowrap">{displayDate(r.requestedAt, ctx.locale)}</Td><Td className="tabular-nums">{money(centsOf(r.amount))}</Td><Td>{r.reason}</Td><Td><Badge tone={r.status === "PAID" ? "ok" : r.status === "REJECTED" ? "bad" : "warn"}>{t(`fin.refund.${r.status}` as never)}</Badge></Td></tr>)}
          </DataTable>
        </section>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card title={t("fin.discounts.title")}>
          {discounts.length === 0 ? <p className="text-sm text-muted">{t("fin.discounts.none")}</p> : (
            <ul className="divide-y divide-line text-sm">
              {discounts.map((x) => (
                <li key={x.id} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div><p className="font-medium">{x.name} {!x.isActive && <Badge>{t("fin.discounts.ended")}</Badge>}</p><p className="text-xs text-muted">{x.kind === "PERCENT" ? `${Number(x.value)}%` : money(centsOf(x.value))} · {x.reason}</p></div>
                  {x.isActive && hasAny(ctx, ["fees.discount"]) && <ActionForm action={endDiscountAction} submitLabel={t("fin.discounts.end")} inline tone="danger" confirm={t("fin.discounts.endConfirm")} className="space-y-0"><input type="hidden" name="id" value={x.id} /></ActionForm>}
                </li>
              ))}
            </ul>
          )}
          {hasAny(ctx, ["fees.discount"]) && current.year && (
            <details className="mt-4 border-t border-line pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium text-link">{t("fin.discounts.grant")}</summary>
              <ActionForm action={grantDiscountAction} submitLabel={t("fin.discounts.grant")} className="mt-3 space-y-3">
                <input type="hidden" name="studentId" value={s.id} />
                <input type="hidden" name="academicYearId" value={current.year.id} />
                <Field name="name" label={t("grade.name")} required placeholder={t("fin.discounts.namePh")} />
                <Field name="kind" type="select" label={t("fin.discounts.kind")} options={[{ value: "PERCENT", label: t("fin.discounts.percent") }, { value: "FIXED", label: t("fin.discounts.fixed") }]} defaultValue="PERCENT" required />
                <Field name="value" label={t("fin.discounts.value")} required hint={t("fin.discounts.valueHint")} />
                <Field name="feeItemId" type="select" label={t("fin.discounts.appliesTo")} options={items.filter((i) => i.isActive).map((i) => ({ value: i.id, label: i.name }))} placeholder={t("fin.discounts.wholeInvoice")} />
                <Field name="reason" type="textarea" rows={2} label={t("marks.reason")} required hint={t("fin.discounts.reasonHint")} />
              </ActionForm>
            </details>
          )}
        </Card>

        <div className="space-y-6">
          {hasAny(ctx, ["refund.request"]) && l.credit > 0 && (
            <Card title={t("fin.refunds.request")}>
              <p className="mb-3 text-sm text-muted">{t("fin.refunds.available", { amount: money(l.credit) })}</p>
              <ActionForm action={requestRefundAction} submitLabel={t("fin.refunds.request")}>
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="amount" label={t("fin.pdf.amount")} required />
                <Field name="method" type="select" label={t("fin.pdf.method")} options={(["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((m) => ({ value: m, label: tDynamic(t, "fin.method", m) }))} defaultValue="CASH" required />
                <Field name="reason" type="textarea" rows={2} label={t("marks.reason")} required />
              </ActionForm>
            </Card>
          )}
          {hasAny(ctx, ["invoice.generate"]) && (
            <Card title={t("fin.invoices.oneOffTitle")}>
              <p className="mb-3 text-sm text-muted">{t("fin.invoices.oneOffHint")}</p>
              <ActionForm action={createOtherInvoiceAction} submitLabel={t("fin.invoices.createOneOff")}>
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="lines" type="textarea" rows={3} label={t("fin.invoices.lines")} required hint={t("fin.invoices.linesHint")} />
                <Field name="dueDate" type="date" label={t("fin.invoices.dueDate")} defaultValue={nextWeek} required />
                <Field name="notes" label={t("common.notes")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
