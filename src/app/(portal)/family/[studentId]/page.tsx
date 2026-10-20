import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, FileDown } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { childFees, childOverview, myChildren } from "@/server/portal";
import { childAssignments } from "@/server/assignments";
import { ChildTiles } from "@/components/learning/child-tiles";
import { formatMoney } from "@/lib/finance/money";
import { Badge, Card, EmptyState, PageHeader, Stat } from "@/components/ui";

export const metadata: Metadata = { title: "My child" };
const TONE = { PRESENT: "ok", LATE: "warn", EXCUSED: "brand", ABSENT: "bad" } as const;

export default async function ChildPage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  let ov: Awaited<ReturnType<typeof childOverview>>;
  try {
    ov = await childOverview(ctx, studentId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [many, fees, homework] = await Promise.all([myChildren(ctx).then((c) => c.length > 1), childFees(ctx, studentId), childAssignments(ctx, studentId)]);
  const todo = homework.items.filter((i) => !i.closed && !i.submission).length;
  const latest = ov.reportCards[0];
  const { child, attendance: a } = ov;
  return (
    <>
      {many && <Link href="/family" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("fam.allChildren")}</Link>}
      <PageHeader title={child.name} subtitle={`${child.className ? `${child.className}${child.streamName ? ` ${child.streamName}` : ""}` : t("fam.notPlaced")} · ${child.admissionNo}`} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("fam.summary.attendance")} value={a.ratePct === null ? "—" : `${a.ratePct}%`} hint={ov.period?.label} />
        <Link href={`/family/${child.id}/fees`} className="block"><Stat label={t("fam.summary.fees")} value={fees.summary.outstanding > 0 ? formatMoney(fees.summary.outstanding, fees.currency) : t("fam.summary.nothingOwed")} hint={fees.summary.overdue > 0 ? t("fam.summary.overdue", { amount: formatMoney(fees.summary.overdue, fees.currency) }) : undefined} /></Link>
        <Stat label={t("fam.summary.report")} value={latest ? (latest.average === null ? "—" : latest.average.toFixed(1)) : "—"} hint={latest ? `${latest.term}${latest.position !== null ? ` · ${t("rc.position")} ${latest.position}/${latest.classSize}` : ""}` : t("fam.summary.noReport")} />
      </div>
      <ChildTiles tiles={[
        { key: "homework", href: `/family/${child.id}/assignments`, label: t("learn.fam.homework"), hint: todo > 0 ? t("learn.fam.todoCount", { count: todo }) : undefined, badge: todo },
        { key: "timetable", href: `/family/${child.id}/timetable`, label: t("learn.tt.title") },
        { key: "portfolio", href: `/family/${child.id}/portfolio`, label: t("learn.pf.title") },
        { key: "behaviour", href: `/family/${child.id}/behaviour`, label: t("learn.bh.familyTitle") },
        { key: "fees", href: `/family/${child.id}/fees`, label: t("fam.fees"), hint: t("fam.fees.hint") },
      ]} />

      <section aria-labelledby="rc-h" className="mb-8">
        <h2 id="rc-h" className="mb-3 text-lg font-semibold">{t("fam.reportCards")}</h2>
        {ov.reportCards.length === 0 ? (
          <EmptyState>{t("fam.noReportCards")}</EmptyState>
        ) : (
          <ul className="space-y-3">
            {ov.reportCards.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                <div>
                  <p className="font-semibold">{c.term} <span className="font-normal text-muted">· {c.className}</span></p>
                  <p className="mt-0.5 text-sm text-muted">
                    {t("res.average")}: <strong className="text-ink">{c.average === null ? "—" : c.average.toFixed(1)}</strong>
                    {c.grade ? <> · {t("rc.grade")}: <strong className="text-ink">{c.grade}</strong></> : null}
                    {c.division ? <> · {t("rc.division")}: <strong className="text-ink">{c.division}</strong></> : null}
                    {c.position !== null ? <> · {t("rc.position")}: <strong className="text-ink">{c.position}/{c.classSize}</strong></> : null}
                  </p>
                  <p className="text-xs text-muted">{t("fam.published", { date: displayDate(c.publishedAt, ctx.locale) })}</p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/family/report-cards/${c.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-canvas">{t("common.view")}</Link>
                  <a href={`/api/report-cards/${c.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"><FileDown className="size-4" aria-hidden />{t("rc.pdf")}</a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="att-h">
        <h2 id="att-h" className="mb-1 text-lg font-semibold">{t("att.title")}</h2>
        {ov.period && <p className="mb-3 text-sm text-muted">{ov.period.label}</p>}
        {a.recorded === 0 ? (
          <EmptyState>{t("fam.noAttendance")}</EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={t("rc.attRate")} value={a.ratePct === null ? "—" : `${a.ratePct}%`} />
              <Stat label={t("rc.attPresent")} value={a.counts.PRESENT} />
              <Stat label={t("rc.attAbsent")} value={a.counts.ABSENT} />
              <Stat label={t("rc.attLate")} value={a.counts.LATE} />
            </div>
            <Card title={t("fam.recentDays")} className="mt-4">
              <ul className="divide-y divide-line text-sm">
                {ov.recentAttendance.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0"><span>{displayDate(new Date(`${r.date}T00:00:00Z`), ctx.locale)}</span><Badge tone={TONE[r.status]}>{t(`att.status.${r.status}`)}</Badge></li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </section>
    </>
  );
}
