import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { AppError } from "@/lib/errors";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { getInvoice } from "@/server/invoices";
import { displayDateTime } from "@/lib/dates";
import { Badge, Card, DataTable, NoAccess, PageHeader, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage, STATE_TONE } from "../../_lib";
import { addInvoiceLineAction, setInstalmentsAction, voidInvoiceAction } from "../../actions";
import { centsOf } from "@/lib/finance/money";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, t, money, timezone, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getInvoice>>;
  try { d = await getInvoice(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const { invoice: inv, balance: b } = d;
  const live = inv.status === "ISSUED";
  const sName = [d.student.firstName, d.student.middleName, d.student.lastName].filter(Boolean).join(" ");
  const instalmentText = inv.instalments.map((x) => `${x.dueDate.toISOString().slice(0, 10)} | ${centsOf(x.amount) / 100}`).join("\n");
  return (
    <>
      <PageHeader
        title={inv.number}
        subtitle={`${sName} · ${d.student.admissionNo}${d.className ? ` · ${d.className}` : ""}${d.termName ? ` · ${d.termName}` : ""}`}
        actions={<><a href={`/api/invoices/${inv.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"><FileDown className="size-4" aria-hidden />{t("rc.pdf")}</a><Link href={`/finance/students/${d.student.id}`} className="text-sm font-medium text-link hover:underline">{t("fin.student.statement")}</Link></>}
      />
      <FinanceNav ctx={ctx} t={t} current="/finance/invoices" unmatched={unmatched} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {live ? b && <><Badge tone={STATE_TONE[b.state]}>{tDynamic(t, "fin.state", b.state)}</Badge>{b.overdueAmount > 0 && <Badge tone="bad">{t("fin.state.OVERDUE")} {money(b.overdueAmount)}</Badge>}</> : <Badge tone="neutral">{t("fin.state.VOID")}</Badge>}
        <span className="text-muted">{t("fin.pdf.issued")} {inv.issueDate.toISOString().slice(0, 10)} · {t("fin.pdf.due")} {inv.dueDate.toISOString().slice(0, 10)}</span>
      </div>
      {!live && inv.voidReason && <div role="note" className="mb-4 rounded-lg border border-bad/30 bg-red-50 px-4 py-3 text-sm"><p className="font-medium text-bad">{t("fin.invoice.voidTitle")}</p><p className="mt-1">{inv.voidReason}</p></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <DataTable head={[t("fin.pdf.description"), t("fin.pdf.amount")]}>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <Td>{l.description}{l.reason && <p className="text-xs text-muted">{t("fin.invoice.adjustment")}: {l.reason}</p>}</Td>
                <Td className={`text-right tabular-nums ${l.kind === "DISCOUNT" ? "text-ok" : ""}`}>{l.kind === "DISCOUNT" ? "-" : ""}{money(centsOf(l.amount))}</Td>
              </tr>
            ))}
            <tr className="bg-canvas font-semibold"><Td>{t("fin.total")}</Td><Td className="text-right tabular-nums">{money(d.total)}</Td></tr>
          </DataTable>
          {b && b.schedule.length > 0 && (
            <Card title={t("fin.pdf.schedule")}>
              <ul className="divide-y divide-line text-sm">
                {b.schedule.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"><span>{t("fin.pdf.due")} {s.dueDate}</span><span className="flex items-center gap-2 tabular-nums">{money(s.paid)} / {money(s.amount)}<Badge tone={s.state === "PAID" ? "ok" : s.state === "PARTIAL" ? "warn" : s.dueDate < new Date().toISOString().slice(0, 10) ? "bad" : "neutral"}>{tDynamic(t, "fin.sched", s.state)}</Badge></span></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {b && (
            <Card title={t("fin.invoice.balance")}>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">{t("fin.total")}</dt><dd className="tabular-nums">{money(b.total)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{t("fin.paid")}</dt><dd className="tabular-nums">{money(b.paid)}</dd></div>
                <div className="flex justify-between font-semibold"><dt>{t("fin.outstanding")}</dt><dd className="tabular-nums">{money(b.outstanding)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-muted">{t("fin.invoice.balanceHint")}</p>
            </Card>
          )}
          {live && hasAny(ctx, ["invoice.adjust"]) && (
            <Card title={t("fin.invoice.addLine")}>
              <ActionForm action={addInvoiceLineAction} submitLabel={t("fin.invoice.addLineButton")}>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field name="kind" type="select" label={t("fin.invoice.kind")} options={[{ value: "CHARGE", label: t("fin.invoice.kind.CHARGE") }, { value: "DISCOUNT", label: t("fin.invoice.kind.DISCOUNT") }]} defaultValue="DISCOUNT" required />
                <Field name="description" label={t("fin.pdf.description")} required />
                <Field name="amount" label={t("fin.pdf.amount")} required />
                <Field name="reason" type="textarea" rows={2} label={t("marks.reason")} required hint={t("fin.invoice.adjustHint")} />
              </ActionForm>
            </Card>
          )}
          {live && hasAny(ctx, ["invoice.generate"]) && (
            <Card title={t("fin.pdf.schedule")}>
              <ActionForm action={setInstalmentsAction} submitLabel={t("common.save")}>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field name="items" type="textarea" rows={4} label={t("fin.invoice.instalments")} defaultValue={instalmentText} required hint={t("fin.invoice.instalmentsHint", { total: money(d.total) })} />
              </ActionForm>
            </Card>
          )}
          {live && hasAny(ctx, ["invoice.void"]) && (
            <Card title={t("fin.invoice.void")}>
              <ActionForm action={voidInvoiceAction} submitLabel={t("fin.invoice.void")} tone="danger" confirm={t("fin.invoice.voidConfirm")}>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field name="reason" type="textarea" rows={2} label={t("marks.reason")} required hint={t("fin.invoice.voidHint")} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
      <p className="mt-6 text-xs text-muted">{t("fin.invoice.created", { when: displayDateTime(inv.createdAt, timezone) })}</p>
    </>
  );
}
