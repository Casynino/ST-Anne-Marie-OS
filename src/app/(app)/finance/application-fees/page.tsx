import type { Metadata } from "next";
import { displayDate } from "@/lib/dates";
import { hasAny } from "@/lib/auth/next";
import { applicationFeeLedger } from "@/server/application-fee";
import { Badge, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { recordApplicationFeeAction } from "../admission-actions";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../_lib";

export const metadata: Metadata = { title: "Application fees" };
const TONE = { AWAITING_PAYMENT: "warn", SUBMITTED: "ok", PAID_HOLD: "bad", CANCELLED: "neutral" } as const;

/** The fees families pay when they apply: online (confirmed by the payment provider), or at the office (Finance records it here and the receipt is issued). */
export default async function ApplicationFeesPage() {
  const { ctx, t, money, unmatched } = await financePage();
  if (!hasAny(ctx, ["finance.reports", "admission.payment.verify", "admission.payment.record"])) return <NoAccess t={t} />;
  const { rows } = await applicationFeeLedger(ctx);
  const received = rows.reduce((n, r) => n + r.paidCents, 0);
  const held = rows.filter((r) => r.status === "PAID_HOLD");
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  return (
    <>
      <PageHeader title={t("fin.appfee.title")} subtitle={t("fin.appfee.sub2")} />
      <FinanceNav ctx={ctx} t={t} current="/finance/application-fees" unmatched={unmatched} />
      <dl className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-4"><dt className="text-xs text-muted">{t("fin.appfee.received")}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{money(received)}</dd></div>
        <div className="rounded-xl border border-line bg-surface p-4"><dt className="text-xs text-muted">{t("fin.appfee.waiting")}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{rows.filter((r) => r.status === "AWAITING_PAYMENT").length}</dd></div>
        <div className="rounded-xl border border-line bg-surface p-4"><dt className="text-xs text-muted">{t("fin.appfee.held")}</dt><dd className={`mt-1 text-xl font-semibold tabular-nums ${held.length ? "text-bad" : ""}`}>{held.length}</dd></div>
      </dl>
      {held.length > 0 && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-bad">{t("fin.appfee.heldNote")}</p>}
      {rows.length === 0 ? <EmptyState>{t("fin.appfee.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-canvas text-left text-xs text-muted"><tr><th className="px-3 py-2">{t("fin.appfee.col.reference")}</th><th className="px-3 py-2">{t("fin.appfee.col.child")}</th><th className="px-3 py-2">{t("fin.appfee.col.status")}</th><th className="px-3 py-2 text-right">{t("fin.appfee.col.amount")}</th><th className="px-3 py-2">{t("fin.appfee.col.paid")}</th><th className="px-3 py-2">{t("fin.appfee.col.receipt")}</th><th className="px-3 py-2">{t("fin.appfee.col.action")}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-mono">{r.reference}</td>
                  <td className="px-3 py-2"><span className="font-medium">{r.child}</span><span className="block text-xs text-muted">{r.guardian}{r.applicationNo ? ` · ${r.applicationNo}` : ""} · {t(`fin.appfee.channel.${r.channel}` as "fin.appfee.channel.OFFICE")}{r.method ? ` · ${t(`fin.method.${r.method}` as "fin.method.CASH")}` : ""}</span></td>
                  <td className="px-3 py-2"><Badge tone={TONE[r.status]}>{t(`apf.status.${r.status}` as "apf.status.SUBMITTED")}</Badge>{r.provider === "sandbox" && <span className="ml-1 text-xs text-muted">({t("apf.test")})</span>}{r.holdNote && <span className="block text-xs text-bad">{r.holdNote}</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.paidCents || r.feeCents)}</td>
                  <td className="px-3 py-2">{r.paidAt ? displayDate(r.paidAt, ctx.locale) : "—"}</td>
                  <td className="px-3 py-2">{r.receiptNo ?? "—"}{r.receiptNo && <a href={`/api/applications/${r.id}/receipt`} target="_blank" rel="noopener" className="ml-2 text-link hover:underline">PDF</a>}</td>
                  <td className="px-3 py-2">
                    {r.status === "AWAITING_PAYMENT" && can("admission.payment.record") ? (
                      <details className="min-w-0">
                        <summary className="flex min-h-9 cursor-pointer items-center whitespace-nowrap font-medium text-link">{t("fin.appfee.record")}</summary>
                        <ActionForm action={recordApplicationFeeAction} submitLabel={t("fin.appfee.go")} className="w-64 max-w-full space-y-2 py-2">
                          <input type="hidden" name="draftId" value={r.id} />
                          <Field name="method" type="select" label={t("fin.appfee.method")} required defaultValue="CASH" options={(["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((m) => ({ value: m, label: t(`fin.method.${m}` as "fin.method.CASH") }))} />
                          <Field name="amount" label={t("fin.appfee.amount")} defaultValue={r.feeCents / 100} />
                          <Field name="note" label={t("fin.appfee.note")} optionalLabel={t("common.optional")} />
                        </ActionForm>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
