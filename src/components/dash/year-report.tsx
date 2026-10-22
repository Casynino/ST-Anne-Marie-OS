import Link from "next/link";
import type { Translate } from "@/lib/i18n";
import type { YearReport } from "@/server/year-report";
import { Panel } from "@/components/dash/parts";

type Cell = { label: string; value: string | number; href?: string; tone?: "ok" | "warn" | "bad" };

/** One group of figures (a small heading and a row of number + label cells). Cells with nothing to do read quietly; ones that need somebody are coloured. */
function Group({ title, cells }: { title: string; cells: Cell[] }) {
  return (
    <div className="min-w-0 flex-[1_1_24rem]">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-[.08em] text-muted">{title}</h3>
      <dl className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-3">
        {cells.map((c) => {
          const inner = (
            <>
              <dd className={`text-xl font-semibold leading-tight tabular-nums ${c.tone === "ok" ? "text-ok" : c.tone === "warn" ? "text-warn" : c.tone === "bad" ? "text-bad" : "text-ink"}`}>{c.value}</dd>
              <dt className="text-xs leading-snug text-muted">{c.label}</dt>
            </>
          );
          return c.href ? <Link key={c.label} href={c.href} className="block rounded-md hover:bg-canvas/60 hover:underline">{inner}</Link> : <div key={c.label}>{inner}</div>;
        })}
      </dl>
    </div>
  );
}

const warn = (n: number) => (n > 0 ? ("warn" as const) : undefined);

/**
 * "Next year" at a glance: Academic decisions, registration and fees, each shown only to people who may see it. With `flat` it is a plain strip
 * (used at the top of the returning-students page); otherwise it is a panel for the school homes.
 */
export function YearReportPanel({ report, t, money, groups = ["academic", "admissions", "finance"], flat, className = "" }: { report: YearReport | null; t: Translate; money: (cents: number) => string; groups?: ("academic" | "admissions" | "finance")[]; flat?: boolean; className?: string }) {
  if (!report) return null;
  const a = groups.includes("admissions") ? report.admissions : null;
  const c = groups.includes("academic") ? report.academic : null;
  const f = groups.includes("finance") ? report.finance : null;
  if (!a && !c && !f) return null;
  const R = "/students/returning";
  const body = (
    <div className="flex flex-wrap gap-x-10 gap-y-6">
      {c && <Group title={t("yr.academic")} cells={[
        { label: t("yr.a.students"), value: c.students, href: "/academic-office/progression" },
        { label: t("yr.a.promoted"), value: c.promoted, tone: "ok", href: "/academic-office/progression?show=approved" },
        { label: t("yr.a.repeat"), value: c.repeat, href: "/academic-office/progression?show=approved" },
        { label: t("yr.a.results"), value: c.awaitingResults, tone: warn(c.awaitingResults), href: "/academic-office/progression?show=incomplete" },
        { label: t("yr.a.decision"), value: c.awaitingDecision, tone: warn(c.awaitingDecision), href: "/academic-office/progression?show=none" },
        { label: t("yr.a.review"), value: c.toReview, tone: warn(c.toReview), href: "/academic-office/progression?show=review" },
      ]} />}
      {a && <Group title={t("yr.admissions")} cells={[
        { label: t("lc.rep.adm.eligible"), value: a.eligible, href: `${R}?view=all` },
        { label: t("yr.r.registered"), value: a.registered, tone: "ok", href: `${R}?view=waiting` },
        { label: t("lc.rep.adm.payment"), value: a.awaitingPayment, tone: warn(a.awaitingPayment) },
        { label: t("lc.rep.adm.approval"), value: a.awaitingApproval, tone: warn(a.awaitingApproval), href: `${R}?view=todo&stage=NEEDS_REGISTRATION` },
        { label: t("lc.rep.adm.class"), value: a.awaitingClass, tone: warn(a.awaitingClass), href: `${R}?view=todo&stage=NEEDS_PLACEMENT` },
        { label: t("lc.rep.adm.not"), value: a.notRegistered, tone: warn(a.notRegistered), href: `${R}?view=notreg` },
        ...(c ? [] : [
          { label: t("lc.rep.adm.repeat"), value: a.repeat, href: `${R}?view=repeat` },
          { label: t("lc.rep.adm.undecided"), value: a.undecided, tone: warn(a.undecided) },
        ]),
      ]} />}
      {f && <Group title={t("yr.finance")} cells={[
        { label: t("lc.rep.expected"), value: money(f.expected), href: "/finance/annual" },
        { label: t("lc.rep.initialTotal"), value: f.initialRequired === null ? t("lc.rep.notSet") : money(f.initialRequired), href: "/finance/annual" },
        { label: t("lc.rep.collected"), value: money(f.collected), tone: "ok", href: "/finance/annual" },
        { label: t("yr.f.verified"), value: `${f.verified} / ${f.students}`, href: "/finance/annual" },
        { label: t("lc.fee.outstanding"), value: money(f.outstanding), tone: warn(f.outstanding), href: "/finance/annual" },
        { label: t("lc.fee.older"), value: money(f.older), tone: f.older > 0 ? "bad" : undefined, href: "/finance/annual?state=previous" },
        { label: t("lc.fee.notBilled"), value: f.notBilled, tone: warn(f.notBilled), href: "/finance/annual?state=not_billed" },
        ...(f.awaitingReconciliation > 0 ? [{ label: t("lc.rep.reconcile"), value: f.awaitingReconciliation, tone: "warn" as const }] : []),
      ]} />}
    </div>
  );
  if (flat) return <section aria-label={t("yr.title", { year: report.yearName })} className={`mb-4 rounded-2xl border border-line bg-surface px-5 py-4 ${className}`}>{body}</section>;
  return <Panel className={className} title={t("yr.title", { year: report.yearName })} subtitle={t("yr.sub")}>{body}</Panel>;
}
