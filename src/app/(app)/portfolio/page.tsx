import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { pendingPortfolio, portfolioStudents } from "@/server/portfolio";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { inputClass } from "@/components/form";

export const metadata: Metadata = { title: "Portfolios" };

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["portfolio.manage"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [pending, students] = await Promise.all([pendingPortfolio(ctx), portfolioStudents(ctx, sp.q ?? "")]);
  return (
    <>
      <PageHeader title={t("learn.pf.title")} subtitle={t("learn.pf.subtitle")} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t("learn.pf.waiting")}>
          {pending.length === 0 ? <p className="text-sm text-muted">{t("learn.pf.noneWaiting")}</p> : (
            <ul className="divide-y divide-line">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <div><p className="font-medium">{p.title}</p><p className="text-sm text-muted">{p.studentName} · {displayDate(p.createdAt, ctx.locale)}</p></div>
                  <Link href={`/portfolio/${p.studentId}`} className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-canvas">{t("learn.pf.review")}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("learn.pf.students")}>
          <form className="flex gap-2" role="search">
            <input name="q" defaultValue={sp.q ?? ""} placeholder={t("learn.bh.searchPh")} aria-label={t("learn.bh.findStudent")} className={inputClass} />
            <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold hover:bg-canvas">{t("common.search")}</button>
          </form>
          {students.length === 0 ? <div className="mt-4"><EmptyState>{t("learn.bh.noStudents")}</EmptyState></div> : (
            <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto">
              {students.map((s) => <li key={s.id}><Link href={`/portfolio/${s.id}`} className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-link"><span className="font-medium">{s.name}</span><span className="text-sm text-muted">{s.admissionNo}</span></Link></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
