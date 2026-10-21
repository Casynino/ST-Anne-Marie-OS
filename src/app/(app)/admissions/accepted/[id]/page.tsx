import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { acceptedDetail, type AcceptedDetail } from "@/server/admission-stages";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { QuickBar } from "../../quick-actions";
import { missingLabels, quickActs, quickLabels } from "../../quick-line";
import { quickDecisionAction } from "../../actions";

export const metadata: Metadata = { title: "Admission and payment" };
const PAY_TONE = { VERIFIED: "ok", PENDING: "warn", REJECTED: "bad", REVERSED: "bad" } as const;

/**
 * The admission and payment view of an accepted applicant: the decision, the school fee and what Finance has verified, and what still has to
 * be true before registration. Registering is a separate step (the official student record and Student ID); a class is given after that.
 */
export default async function AcceptedPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: AcceptedDetail;
  try {
    d = await acceptedDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const row = d.row;
  return (
    <>
      <PageHeader title={d.name} subtitle={`${d.applicationNo} · ${t(d.after === "payment" ? "adm.awaiting.title" : "adm.reg.title")}`} actions={<LinkButton href={`/admissions/${id}`} variant="secondary">{t("adm.iw.details")}</LinkButton>} />
      <AdmissionsNav ctx={ctx} t={t} current={d.after === "payment" ? "/admissions/payment" : "/admissions/registration"} />
      <div className="mb-5">
        <QuickBar
          line={{ id, name: d.name, className2: d.className ?? t("adm.noClass"), classId: row.classAppliedId, acts: quickActs(row, t, can, Date.now()), afterReview: row.afterReview, pendingDocs: row.pendingDocs, missing: missingLabels(row, t), interviewDetail: null }}
          labels={quickLabels(t)} dismiss={t("adm.bulk.dismiss")} quick={quickDecisionAction} slots={[]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title={t("adm.acc.registerChecks")}>
            <ul className="space-y-2 text-sm">
              {d.items.map((i) => (
                <li key={i.key} className="flex items-start gap-2">
                  {i.ok ? <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />}
                  <span className={i.ok ? "" : "font-medium"}>{i.message}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted">{t("adm.acc.registerNote")}</p>
          </Card>

          <Card title={t("adm.acc.payment")} actions={d.accountStatus ? <Badge tone={d.accountStatus === "PAID" || d.accountStatus === "NOT_REQUIRED" || d.accountStatus === "WAIVED" ? "ok" : "warn"}>{t(`adm.pay.status.${d.accountStatus}` as "adm.pay.status.PAID")}</Badge> : undefined}>
            <DefList items={[
              { label: t("adm.acc.fee"), value: formatMoney(d.feeCents) },
              { label: t("adm.acc.verified"), value: formatMoney(d.verifiedCents) },
              { label: t("adm.acc.outstanding"), value: formatMoney(d.balanceCents) },
              { label: t("adm.acc.reference"), value: d.reference },
            ]} />
            {d.instructions && <div className="mt-4"><h3 className="text-xs uppercase tracking-wide text-muted">{t("adm.acc.howToPay")}</h3><p className="mt-1 whitespace-pre-line text-sm">{d.instructions}</p></div>}
            {d.payments.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="border-b border-line text-xs uppercase tracking-wide text-muted"><tr><th className="py-2 pr-3 font-medium">{t("adm.pay.paidOn")}</th><th className="py-2 pr-3 font-medium">{t("adm.pay.amount")}</th><th className="py-2 pr-3 font-medium">{t("common.status")}</th><th className="py-2 font-medium">{t("adm.pay.receipt")}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {d.payments.map((p) => (
                      <tr key={p.id}><td className="py-2 pr-3">{displayDate(p.paidOn, ctx.locale)}</td><td className="py-2 pr-3 tabular-nums">{formatMoney(p.amountCents)}</td><td className="py-2 pr-3"><Badge tone={PAY_TONE[p.status as keyof typeof PAY_TONE] ?? "neutral"}>{t(`adm.pay.row.${p.status}` as "adm.pay.row.VERIFIED")}</Badge></td><td className="py-2 tabular-nums">{p.receiptNo ?? "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-sm text-muted">{t("adm.acc.financeOwns")}{(can("admission.payment.record") || can("admission.payment.verify")) && <> <Link href="/finance/admissions" className="font-medium text-link hover:underline">{t("adm.acc.financeLink")}</Link></>}</p>
          </Card>
        </div>
        <Card title={t("adm.acc.decision")}>
          <DefList items={[
            { label: t("adm.acc.decided"), value: d.decidedAt ? displayDate(d.decidedAt, ctx.locale) : null },
            { label: t("adm.acc.grade"), value: d.classOffered ?? d.className },
            { label: t("adm.acc.offerNo"), value: d.letterNo },
            { label: t("adm.col.complete"), value: `${d.percent}%` },
            { label: t("adm.acc.papers"), value: d.docsRequired ? `${d.docsVerified}/${d.docsRequired}` : null },
          ]} />
        </Card>
      </div>
    </>
  );
}
