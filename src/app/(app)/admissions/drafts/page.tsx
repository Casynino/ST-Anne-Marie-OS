import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { getSchoolBasics } from "@/server/settings";
import { listOfficeDrafts } from "@/server/office-application";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Waiting for the application fee" };

/** Applications filled in at the office that are waiting for their application fee. Each moves to the applications list when Finance records the fee. */
export default async function DraftsPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const [rows, school] = await Promise.all([listOfficeDrafts(ctx), getSchoolBasics(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("adm.drafts.title")} subtitle={t("adm.drafts.sub")} actions={ctx.permissions.has("admission.create") ? <LinkButton href="/admissions/new"><Plus className="size-4" aria-hidden /> {t("adm.new")}</LinkButton> : undefined} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/drafts" />
      {rows.length === 0 ? <EmptyState>{t("adm.drafts.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted"><tr>{[t("adm.drafts.col.reference"), t("adm.drafts.col.child"), t("adm.classApplied"), t("adm.drafts.col.parent"), t("adm.drafts.col.fee"), t("adm.drafts.col.by"), ""].map((h, i) => <th key={i} className="px-3 py-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="px-3 py-3 font-mono">{r.reference}{r.status === "PAID_HOLD" && <span className="ml-2"><Badge tone="bad">{t("apf.status.PAID_HOLD")}</Badge></span>}</td>
                  <td className="px-3 py-3"><Link href={`/admissions/drafts/${r.id}`} className="font-semibold text-link hover:underline">{r.child}</Link></td>
                  <td className="px-3 py-3">{r.className ?? "—"}</td>
                  <td className="px-3 py-3"><span className="block">{r.guardian}</span><span className="block text-xs tabular-nums text-muted">{r.phone}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{formatMoney(r.feeCents, school.currency)}</td>
                  <td className="px-3 py-3 text-muted">{r.createdBy ?? "—"}<span className="block text-xs">{displayDate(r.createdAt, ctx.locale)}</span></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right"><a href={`/api/applications/${r.id}/form`} target="_blank" rel="noopener" className="mr-4 font-semibold text-link hover:underline">{t("adm.drafts.print")}</a><Link href={`/admissions/drafts/${r.id}`} className="font-semibold text-link hover:underline">{t("adm.drafts.open")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
