import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { listExams } from "@/server/admission-exams";
import { Badge, EmptyState, NoAccess, PageHeader, segClass } from "@/components/ui";

export const metadata: Metadata = { title: "Applicant examinations" };
const TONE = { SCHEDULED: "neutral", AWAITING_MARKING: "warn", MARKING: "brand", SUBMITTED: "ok", AWAITING_REVIEW: "warn", RETURNED: "bad", APPROVED: "ok", CANCELLED: "neutral" } as const;

/**
 * The examinations of applicants. A teacher sees only the ones assigned to them (to mark and submit); the Admissions and Academic Offices see
 * all of them, with who marks what, what is submitted and what is waiting for approval.
 */
export default async function ApplicantExamsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const has = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!has("admission.exam.mark") && !has("admission.exam.review") && !has("admission.exam.assign") && !has("admission.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const view = sp.view === "all" || sp.view === "review" ? sp.view : "open";
  const [{ rows, approval, all }, school] = await Promise.all([listExams(ctx, { view }), getSchoolBasics(ctx.schoolId)]);
  const tabs = [
    { key: "open", label: t("exam.tab.open") },
    ...(approval && has("admission.exam.review") ? [{ key: "review", label: t("exam.tab.review") }] : []),
    { key: "all", label: t("exam.tab.all") },
  ];
  return (
    <>
      <PageHeader title={t("appexam.title")} subtitle={all ? t("exam.sub.all") : t("exam.sub.mine")} />
      <nav aria-label={t("appexam.title")} className="mb-4 flex flex-wrap gap-2">
        {tabs.map((x) => (
          <Link key={x.key} href={x.key === "open" ? "/applicant-exams" : `/applicant-exams?view=${x.key}`} aria-current={view === x.key ? "page" : undefined} className={segClass(view === x.key)}>{x.label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState>{view === "review" ? t("exam.none.review") : t("appexam.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-3 font-medium">{t("adm.applicant")}</th><th className="px-3 py-3 font-medium">{t("exam.col.subject")}</th><th className="px-3 py-3 font-medium">{t("exam.col.interview")}</th><th className="px-3 py-3 font-medium">{t("exam.col.due")}</th>{all && <th className="px-3 py-3 font-medium">{t("exam.col.teacher")}</th>}<th className="px-3 py-3 font-medium">{t("common.status")}</th><th className="px-3 py-3 font-medium">{t("exam.col.mark")}</th><th className="px-3 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-canvas">
                  <td className="px-3 py-3"><Link href={`/applicant-exams/${r.id}`} className="font-semibold text-link hover:underline">{r.applicant}</Link><span className="block text-xs tabular-nums text-muted">{r.applicationNo}{r.className ? ` · ${r.className}` : ""}</span></td>
                  <td className="px-3 py-3">{r.subject}</td>
                  <td className="whitespace-nowrap px-3 py-3">{displayDateTime(r.interviewAt, school.timezone, ctx.locale)}{r.venue && <span className="block text-xs text-muted">{r.venue}</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3">{r.dueOn ? displayDate(r.dueOn, ctx.locale) : "—"}</td>
                  {all && <td className="px-3 py-3">{r.teacher}</td>}
                  <td className="px-3 py-3"><Badge tone={TONE[r.label]}>{t(`exam.st.${r.label}` as "exam.st.SUBMITTED")}</Badge></td>
                  <td className="px-3 py-3 tabular-nums">{r.mark !== null ? `${r.mark} / ${r.maxMark}` : r.outcome ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right"><Link href={`/applicant-exams/${r.id}`} className="inline-flex min-h-8 items-center rounded-md border border-line px-2.5 text-[13px] font-medium hover:border-brand-500 hover:bg-tint">{r.mine && (r.label === "AWAITING_MARKING" || r.label === "MARKING" || r.label === "RETURNED") ? t("exam.mark") : t("common.view")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
