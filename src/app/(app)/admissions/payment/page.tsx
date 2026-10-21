import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { acceptedCounts, acceptedList } from "@/server/admission-stages";
import { awaitingPlacement } from "@/server/admission-queues";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, EmptyState, NoAccess, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Awaiting school fee payment" };

/**
 * Accepted applicants who have not yet paid the school fee: the fee, what Finance has verified, what is still outstanding and the next step.
 * Finance owns verification, so an applicant leaves this list only when Finance verifies enough (or a recorded exception waives it).
 */
export default async function AwaitingPaymentPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const [rows, counts, waiting] = await Promise.all([acceptedList(ctx, "payment"), acceptedCounts(ctx), awaitingPlacement(ctx)]);
  const next = (r: (typeof rows)[number]) => (r.accountStatus === "VERIFICATION_PENDING" ? t("adm.acc.next.verify") : r.accountStatus === "PARTIAL" ? t("adm.acc.next.balance", { amount: formatMoney(r.balanceCents) }) : t("adm.acc.next.pay", { ref: r.applicationNo }));
  return (
    <>
      <PageHeader title={t("adm.awaiting.title")} subtitle={t("adm.awaiting.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/payment" badges={{ "/admissions/payment": counts.payment, "/admissions/registration": counts.registration, "/admissions/placement": waiting.length }} />
      {rows.length === 0 ? <EmptyState>{t("adm.awaiting.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-3 font-medium">{t("adm.applicant")}</th><th className="px-3 py-3 font-medium">{t("adm.classApplied")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.decided")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.fee")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.verified")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.outstanding")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.next")}</th><th className="px-3 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="px-3 py-3"><Link href={`/admissions/accepted/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span></td>
                  <td className="whitespace-nowrap px-3 py-3">{r.className ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3">{r.decidedAt ? displayDate(r.decidedAt, ctx.locale) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatMoney(r.feeCents)}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatMoney(r.verifiedCents)}{r.pendingCents > 0 && <span className="block text-xs text-muted">{t("adm.acc.pending", { amount: formatMoney(r.pendingCents) })}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums"><Badge tone="warn">{formatMoney(r.balanceCents)}</Badge></td>
                  <td className="px-3 py-3 text-muted">{next(r)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right"><Link href={`/admissions/accepted/${r.id}`} className="inline-flex min-h-8 items-center rounded-md border border-line px-2.5 text-[13px] font-medium hover:border-brand-500 hover:bg-tint">{t("common.view")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
