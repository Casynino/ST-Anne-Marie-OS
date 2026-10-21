import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { acceptedCounts, acceptedList } from "@/server/admission-stages";
import { awaitingPlacement } from "@/server/admission-queues";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, EmptyState, NoAccess, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Registration pending" };

/**
 * Accepted applicants whose school fee is cleared (or not required) and who are waiting to be registered: the official student record and the
 * permanent Student ID are made here. What still stops registration is shown on the row.
 */
export default async function RegistrationPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const [rows, counts, waiting] = await Promise.all([acceptedList(ctx, "registration"), acceptedCounts(ctx), awaitingPlacement(ctx)]);
  return (
    <>
      <PageHeader title={t("adm.reg.title")} subtitle={t("adm.reg.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/registration" badges={{ "/admissions/payment": counts.payment, "/admissions/registration": counts.registration, "/admissions/placement": waiting.length }} />
      {rows.length === 0 ? <EmptyState>{t("adm.reg.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[52rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-3 font-medium">{t("adm.applicant")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.grade")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.decided")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.clearance")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.papers")}</th><th className="px-3 py-3 font-medium">{t("adm.acc.remaining")}</th><th className="px-3 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="px-3 py-3"><Link href={`/admissions/accepted/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span></td>
                  <td className="whitespace-nowrap px-3 py-3">{r.className ?? "—"}<span className="block text-xs text-muted">{t("adm.acc.noClassYet")}</span></td>
                  <td className="whitespace-nowrap px-3 py-3">{r.decidedAt ? displayDate(r.decidedAt, ctx.locale) : "—"}</td>
                  <td className="px-3 py-3"><Badge tone="ok">{t(`adm.pay.status.${r.accountStatus ?? "NOT_REQUIRED"}` as "adm.pay.status.PAID")}</Badge></td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{r.docsRequired === 0 ? "—" : `${r.docsVerified}/${r.docsRequired}`}</td>
                  <td className="px-3 py-3">{r.remaining.length === 0 ? <Badge tone="ok">{t("adm.acc.ready")}</Badge> : <ul className="space-y-0.5 text-muted">{r.remaining.map((m) => <li key={m}>{m}</li>)}</ul>}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right"><Link href={`/admissions/accepted/${r.id}`} className="inline-flex min-h-8 items-center rounded-md border border-line px-2.5 text-[13px] font-medium hover:border-brand-500 hover:bg-tint">{r.remaining.length === 0 ? t("adm.q.enrol") : t("common.view")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
