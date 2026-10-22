import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FileDown } from "lucide-react";
import { AppError } from "@/lib/errors";
import { hasAny } from "@/lib/auth/next";
import { tDynamic } from "@/lib/i18n";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getPayment } from "@/server/payments";
import { Badge, Card, DefList, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { FinanceNav } from "@/components/finance/subnav";
import { financePage } from "../../_lib";
import { reversePaymentAction } from "../../actions";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx, t, money, timezone, unmatched } = await financePage();
  if (!hasAny(ctx, ["fees.read"])) return <NoAccess t={t} />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getPayment>>;
  try { d = await getPayment(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const { payment: p, snapshot: s } = d;
  const name = [d.student.firstName, d.student.middleName, d.student.lastName].filter(Boolean).join(" ");
  return (
    <>
      <PageHeader
        title={p.receipt?.number ?? t("fin.payment")}
        subtitle={`${name} · ${d.student.admissionNo}`}
        actions={<>
          <Badge tone={p.status === "POSTED" ? "ok" : "bad"}>{t(`fin.pay.${p.status}` as never)}</Badge>
          {p.receipt && <a href={`/api/receipts/${p.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 btn-primary"><FileDown className="size-4" aria-hidden />{t("fin.pdf.receipt")}</a>}
          <Link href={`/finance/students/${d.student.id}`} className="text-sm font-medium text-link hover:underline">{t("fin.student.statement")}</Link>
        </>}
      />
      <FinanceNav ctx={ctx} t={t} current="/finance/payments" unmatched={unmatched} />
      {p.status === "REVERSED" && <div role="note" className="mb-4 rounded-lg border border-bad/30 bg-red-50 px-4 py-3 text-sm"><p className="font-medium text-bad">{t("fin.payment.reversedTitle")}</p><p className="mt-1">{p.reverseReason} · {d.reversedBy} · {p.reversedAt ? displayDateTime(p.reversedAt, timezone) : ""}</p></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <DefList items={[
            { label: t("fin.pdf.amount"), value: <strong className="text-lg tabular-nums">{money(d.amountCents)}</strong> },
            { label: t("fin.pdf.method"), value: <>{tDynamic(t, "fin.method", p.method)}{p.provider ? ` (${p.provider})` : ""}</> },
            { label: t("fin.pdf.reference"), value: p.reference },
            { label: t("fin.pdf.date"), value: displayDate(p.receivedOn, ctx.locale) },
            { label: t("fin.pdf.receivedFrom"), value: p.payerName },
            { label: t("fin.payment.recordedBy"), value: p.source === "PROVIDER" && !d.recordedBy ? t("fin.payment.byProvider") : d.recordedBy },
            { label: t("common.notes"), value: p.notes },
          ]} />
          {s && s.appliedTo.length > 0 && (
            <div className="mt-5 border-t border-line pt-4"><h3 className="text-sm font-semibold">{t("fin.pdf.appliedTo")} <span className="font-normal text-muted">({t("fin.payment.atTheTime")})</span></h3>
              <ul className="mt-2 space-y-1 text-sm">{s.appliedTo.map((a) => <li key={a.number} className="flex justify-between"><span>{a.number}</span><span className="tabular-nums">{money(a.amountCents)}</span></li>)}{s.creditAddedCents > 0 && <li className="flex justify-between"><span>{t("fin.pdf.credit")}</span><span className="tabular-nums">{money(s.creditAddedCents)}</span></li>}</ul>
              <p className="mt-3 text-xs text-muted">{t("fin.pdf.balanceBefore")}: {money(s.outstandingBeforeCents)} → {t("fin.pdf.balanceAfter")}: {money(s.outstandingAfterCents)}</p>
            </div>
          )}
        </Card>
        {p.status === "POSTED" && hasAny(ctx, ["payment.reverse"]) && (
          <Card title={t("fin.payment.reverse")} className="h-fit">
            <ActionForm action={reversePaymentAction} submitLabel={t("fin.payment.reverse")} tone="danger" confirm={t("fin.payment.reverseConfirm")}>
              <input type="hidden" name="paymentId" value={p.id} />
              <Field name="reason" type="textarea" rows={3} label={t("marks.reason")} required hint={t("fin.payment.reverseHint")} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
