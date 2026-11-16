import Link from "next/link";
import { Banknote, Briefcase, FileText, GraduationCap, Percent, Receipt, Scale, UserCheck, UserPlus, Users, Wallet } from "lucide-react";
import { displayDate } from "@/lib/dates";
import { AttentionBlock, standardRows } from "./attention";
import { AdmissionsPanel, ActivityPanel, AttendanceTrendPanel, CalendarPanel, EnrollmentPanel, FillPanel, H, N, ResultsPanel, Row, SetupBanner, W } from "./home";
import { compactMoney, type DashEnv } from "./sections";
import { Cell, DashSection, DashTable, EmptyLine, GradientTile, HBars, Panel, Pill, SERIES_COLORS } from "@/components/dash/parts";
import { BarLineChart } from "@/components/dash/charts-client";
import { YearReportPanel } from "@/components/dash/year-report";
import type { AttentionRow } from "@/components/dash/attention-tabs";
import type { Executive } from "@/server/executive";
import type { HeadHome } from "@/server/head-home";
import type { adminHome } from "@/server/admin-home";

/*
 * The owner's home (the ZELab layout, St Anne's colours): what needs the owner, where the money stands, how the school is doing, and how each
 * department is keeping up. The owner watches and decides; the daily work stays with the department that owns it, so there are no
 * registers, queues or payment lists here. Every figure comes from `executiveOverview` or the services the other homes already use.
 */

const GRID = "grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]";
const METHOD_COLOR = ["#0f9462", "#4f46e5", "#e0a100", "#14a3b8", "#e5604d"] as const;

/** A thin bordered bar of figures, like the ZELab "This week" strip: each cell a small caps label, a figure and one line under it. */
function Strip({ cells, label }: { cells: { label: string; value: string; note?: string; tone?: "ok" | "warn" | "bad" }[]; label: string }) {
  const tone = { ok: "text-ok", warn: "text-warn", bad: "text-bad" } as const;
  return (
    <dl aria-label={label} className="mt-2.5 grid overflow-hidden rounded-xl border border-line bg-surface [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))] divide-line sm:divide-x">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 border-t border-line px-4 py-3 first:border-t-0 sm:border-t-0">
          <dt className="text-[11px] font-semibold uppercase leading-snug tracking-[.1em] text-muted">{c.label}</dt>
          <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${c.tone ? tone[c.tone] : "text-ink"}`}>{c.value}</dd>
          {c.note && <p className="truncate text-xs text-muted">{c.note}</p>}
        </div>
      ))}
    </dl>
  );
}

export function ownerRows(env: DashEnv, x: Executive): AttentionRow[] {
  const { t } = env;
  const rows: AttentionRow[] = [];
  if (x.ownerQueue.expenses > 0) rows.push({ key: "ownerExpenses", area: "owner", href: "/finance/expenses", tone: "warn", text: t("exec.att.expenses", { n: x.ownerQueue.expenses }), detail: t("exec.att.expenses.d") });
  if (x.ownerQueue.refunds > 0) rows.push({ key: "ownerRefunds", area: "owner", href: "/finance/refunds", tone: "warn", text: t("exec.att.refunds", { n: x.ownerQueue.refunds }), detail: t("exec.att.refunds.d") });
  if (x.ownerQueue.recruitment > 0) rows.push({ key: "ownerRecruit", area: "owner", href: "/tasks?department=ADMIN", tone: "info", text: t("exec.att.recruit", { n: x.ownerQueue.recruitment }), detail: t("exec.att.recruit.d") });
  if (x.discrepancies.unmatchedEvents > 0) rows.push({ key: "unmatched", area: "finance", href: "/finance/reconciliation", tone: "warn", text: t("exec.att.unmatched", { n: x.discrepancies.unmatchedEvents }), detail: t("exec.att.unmatched.d") });
  if (x.discrepancies.reversals.count > 0) rows.push({ key: "reversed", area: "finance", href: "/finance/payments", tone: "info", text: t("exec.att.reversed", { n: x.discrepancies.reversals.count }), detail: t("exec.att.reversed.d") });
  for (const d of x.departments) {
    if (d.overdue === 0) continue;
    rows.push({
      key: `dept-${d.department}`, area: "departments", href: `/tasks?department=${d.department}`, tone: (d.oldest?.daysLate ?? 0) > 7 ? "bad" : "warn", count: d.overdue,
      text: t("exec.att.dept", { dept: t(`task.dept.${d.department}` as "task.dept.ADMISSIONS"), n: d.overdue }),
      detail: d.oldest ? t("exec.att.dept.d", { label: d.oldest.label, days: d.oldest.daysLate, who: d.oldest.assignedTo ?? t("exec.dept.nobody") }) : undefined,
    });
  }
  // The few system rows that are the owner's to know about (a stale backup, failed messages); the rest of the long list stays with the departments.
  for (const a of env.d.attention) if (a.key === "backupStale" || a.key === "failedNotifications") rows.push(...standardRows({ ...env, d: { ...env.d, attention: [a] } }));
  return rows;
}

export function ExecutiveBody({ env, x, setup, head }: { env: DashEnv; x: Executive; setup: Awaited<ReturnType<typeof adminHome>> | null; head: HeadHome | null }) {
  const { t, locale, money, school, d } = env;
  const cm = (c: number) => `${school.currency} ${compactMoney(c)}`;
  const fmt = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), locale);
  const months = x.money.trend;
  const anyMoney = months.some((m) => m.income > 0 || m.expenses > 0);
  const incomeTotal = x.money.byMethod.reduce((n, m) => n + m.cents, 0);
  const periods = (["term", "month", "year"] as const).map((p) => ({ p, label: t(`exec.period.${p}`) }));
  const adm = env.year?.admissions;
  const tot = head?.totals;
  const lim = x.limits;

  return (
    <>
      <SetupBanner env={env} setup={setup} />
      <AttentionBlock t={t} rows={ownerRows(env, x)} />

      {/* Collected, by the way it was paid: one slim strip. */}
      <section aria-label={t("exec.income")} className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-line bg-surface px-5 py-4">
        <div className="min-w-[11rem]">
          <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-muted">{t("exec.income")} · {t(`exec.period.${x.period}`)}</p>
          <p className="mt-1 text-[1.7rem] font-semibold leading-8 tabular-nums text-ink">{money(x.money.income)}</p>
          <p className="mt-0.5 text-xs text-muted">{fmt(x.from)} – {fmt(x.to)}</p>
        </div>
        <div className="min-w-[14rem] flex-1">
          {incomeTotal > 0 ? (
            <>
              <div aria-hidden className="flex h-2 overflow-hidden rounded-sm bg-line">{x.money.byMethod.map((m, i) => <div key={m.method} style={{ width: `${(m.cents / incomeTotal) * 100}%`, background: METHOD_COLOR[i % METHOD_COLOR.length] }} />)}</div>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">{x.money.byMethod.map((m, i) => <li key={m.method} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: METHOD_COLOR[i % METHOD_COLOR.length] }} />{t(`fin.method.${m.method}` as "fin.method.CASH")} <strong className="font-semibold text-ink">{money(m.cents)}</strong> <span>{Math.round((m.cents / incomeTotal) * 100)}%</span></li>)}</ul>
            </>
          ) : <p className="text-sm text-muted">{t("dash.finance.noPayments")}</p>}
        </div>
        <Link href="/finance" className="text-sm font-medium text-link hover:underline">{t("dash.kpi.open")} →</Link>
      </section>

      <DashSection id="money" title={t("exec.money.title")} subtitle={t("exec.money.sub")} link={{ href: "/finance/reports", label: t("dash.money.report") }}>
        <nav aria-label={t("exec.money.title")} className="mb-2.5 flex flex-wrap gap-1 text-sm">
          {periods.map((o) => <Link key={o.p} href={`/dashboard?period=${o.p}`} aria-current={x.period === o.p ? "true" : undefined} className={`rounded-md px-3 py-1 font-medium transition-colors ${x.period === o.p ? "bg-canvas text-ink ring-1 ring-line" : "text-muted hover:text-ink"}`}>{o.label}</Link>)}
        </nav>
        <ul className={GRID}>
          <li><GradientTile icon={Banknote} tone="green" label={t("exec.income")} value={cm(x.money.income)} caption={t("exec.income.cap")} /></li>
          <li><GradientTile icon={Receipt} tone="rose" label={t("exec.expenses")} value={cm(x.money.expenses)} caption={t("exec.expenses.cap")} /></li>
          <li><GradientTile icon={Scale} tone="indigo" label={t("exec.net")} value={`${x.money.net < 0 ? "−" : ""}${cm(Math.abs(x.money.net))}`} caption={t("exec.net.cap")} /></li>
          {x.fees && <li><GradientTile icon={Wallet} tone="orange" label={t("exec.owed")} value={cm(x.fees.outstanding)} caption={x.fees.overdue > 0 ? `${money(x.fees.overdue)} ${t("dash.money.overdue").toLowerCase()}` : t("exec.owed.cap")} href="/finance/reports" /></li>}
          {x.fees && <li><GradientTile icon={Percent} tone="teal" label={t("exec.rate")} value={x.fees.ratePct === null ? "—" : `${x.fees.ratePct}%`} caption={`${x.fees.termName}: ${t("exec.rate.cap")}`} /></li>}
          {x.fees && <li><GradientTile icon={Users} tone="violet" label={t("exec.owing")} value={x.fees.studentsOwing.toLocaleString()} caption={t("exec.owing.cap")} href="/finance/reports" /></li>}
        </ul>
        <Strip label={t("exec.verify.title")} cells={[
          { label: t("exec.verify.posted"), value: String(x.verification.posted) },
          { label: t("exec.verify.admission"), value: String(x.verification.admissionPending.count), note: x.verification.admissionPending.count > 0 ? money(x.verification.admissionPending.cents) : undefined, tone: x.verification.admissionPending.count > 0 ? "warn" : undefined },
          { label: t("exec.verify.unmatched"), value: String(x.verification.unmatched.count), note: x.verification.unmatched.count > 0 ? money(x.verification.unmatched.cents) : undefined, tone: x.verification.unmatched.count > 0 ? "warn" : undefined },
          { label: t("exec.verify.reversed"), value: String(x.discrepancies.reversals.count), note: x.discrepancies.reversals.count > 0 ? money(x.discrepancies.reversals.cents) : undefined, tone: x.discrepancies.reversals.count > 0 ? "warn" : undefined },
        ]} />
        <Row>
          <Panel className={W} title={t("exec.trend.title")} subtitle={t("exec.trend.sub")}>
            {!anyMoney ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <BarLineChart kind="money" currency={school.currency} label={t("exec.trend.title")} summary={t("exec.trend.sub")} barLabel={t("exec.trend.in")} lineLabel={t("exec.trend.out")} points={months.map((m) => ({ key: m.month, label: m.month.slice(5) + "/" + m.month.slice(2, 4), bar: m.income, line: m.expenses }))} />}
          </Panel>
          <Panel className={N} title={t("exec.category.title")} subtitle={`${fmt(x.from)} – ${fmt(x.to)}`}>
            {x.money.byCategory.length === 0 ? <EmptyLine>{t("exec.category.empty")}</EmptyLine> : <HBars label={t("exec.category.title")} summary={t("exec.category.title")} tone={SERIES_COLORS[4]} format={(n) => cm(n)} items={x.money.byCategory.slice(0, 8).map((c) => ({ label: c.name, value: c.cents }))} />}
          </Panel>
        </Row>
        {x.money.terms.length > 1 && (
          <Row>
            <Panel className="flex-[1_1_100%]" title={t("exec.terms.title")} subtitle={t("exec.terms.sub")}>
              <DashTable min="26rem" head={[{ label: t("exec.col.term") }, { label: t("exec.col.collected"), right: true }, { label: t("exec.col.spent"), right: true }, { label: t("exec.col.net"), right: true }]}>
                {x.money.terms.map((r) => <tr key={r.id}><Cell><span className={r.current ? "font-semibold text-ink" : ""}>{r.name}</span></Cell><Cell right>{money(r.collected)}</Cell><Cell right>{money(r.expenses)}</Cell><Cell right className={r.collected - r.expenses < 0 ? "text-bad" : "text-ok"}>{money(r.collected - r.expenses)}</Cell></tr>)}
              </DashTable>
            </Panel>
          </Row>
        )}
      </DashSection>

      <DashSection id="school" title={t("exec.school.title")} subtitle={t("exec.school.sub")}>
        <ul className={GRID}>
          <li><GradientTile icon={GraduationCap} tone="green" label={t("exec.students")} value={x.school.students.toLocaleString()} href="/students" /></li>
          <li><GradientTile icon={UserPlus} tone="teal" label={t("exec.newStudents")} value={x.school.newStudents.toLocaleString()} caption={t("exec.newStudents.cap")} /></li>
          <li><GradientTile icon={FileText} tone="violet" label={t("exec.applications")} value={x.school.applications.toLocaleString()} caption={t("exec.applications.cap")} href="/admissions" /></li>
          {adm && <li><GradientTile icon={UserCheck} tone="indigo" label={t("adm.reg.registered")} value={adm.registered.toLocaleString()} caption={`${adm.eligible.toLocaleString()} ${t("lc.rep.adm.eligible").toLowerCase()}`} href="/students/returning" /></li>}
          {adm && <li><GradientTile icon={Users} tone="orange" label={t("lc.rep.adm.not")} value={adm.notRegistered.toLocaleString()} href="/students/returning" /></li>}
          <li><GradientTile icon={Briefcase} tone="rose" label={t("exec.staff")} value={x.school.staff.toLocaleString()} caption={t("exec.staff.cap", { n: x.school.teachers })} href="/users" /></li>
        </ul>
        <Row><AttendanceTrendPanel env={env} className={H} /><ResultsPanel env={env} className={H} /></Row>
        <Row><EnrollmentPanel env={env} className={W} /><FillPanel env={env} className={N} /></Row>
        <Row><YearReportPanel report={env.year} t={t} money={money} className="flex-[1_1_100%]" /></Row>
        <Row><AdmissionsPanel env={env} className="flex-[1_1_100%]" /></Row>
      </DashSection>

      <DashSection id="departments" title={t("exec.dept.title")} subtitle={t("exec.dept.sub")}>
        <Panel className="flex-[1_1_100%]" title={t("exec.dept.title")}>
          <DashTable min="56rem" head={[{ label: t("exec.dept.col") }, { label: t("exec.dept.open"), right: true }, { label: t("exec.dept.overdue"), right: true }, { label: t("exec.dept.unassigned"), right: true }, { label: t("exec.dept.done"), right: true }, { label: t("exec.dept.onTime"), right: true }, { label: t("exec.dept.avg"), right: true }, { label: t("exec.dept.oldest") }, { label: t("exec.dept.holder") }]}>
            {x.departments.map((r) => (
              <tr key={r.department}>
                <Cell><Link href={`/tasks?department=${r.department}`} className="font-medium text-link hover:underline">{t(`task.dept.${r.department}` as "task.dept.ADMISSIONS")}</Link></Cell>
                <Cell right>{r.open}</Cell>
                <Cell right>{r.overdue > 0 ? <Pill tone="bad">{r.overdue}</Pill> : <span className="text-muted">0</span>}</Cell>
                <Cell right className={r.unassigned > 0 ? "text-warn" : "text-muted"}>{r.unassigned}</Cell>
                <Cell right>{r.completed30}</Cell>
                <Cell right>{r.onTimePct === null ? "—" : `${r.onTimePct}%`}</Cell>
                <Cell right>{r.avgDays === null ? "—" : r.avgDays}</Cell>
                <Cell className="text-sm">{r.oldest ? <>{r.oldest.label}<span className="block text-xs text-bad">{t("exec.dept.days", { n: r.oldest.daysLate })}</span></> : <span className="text-muted">{t("exec.dept.clear")}</span>}</Cell>
                <Cell className="text-sm">{r.responsible.length > 0 ? r.responsible.map((p) => `${p.name} (${p.overdue})`).join(", ") : r.oldest && !r.oldest.assignedTo ? <span className="text-warn">{t("exec.dept.nobody")}</span> : <span className="text-muted">—</span>}</Cell>
              </tr>
            ))}
          </DashTable>
        </Panel>
        {tot && tot.teachers > 0 && (
          <Strip label={t("exec.teach.title")} cells={[
            { label: t("exec.teach.registers"), value: `${tot.registersFinalised}/${tot.registersTotal}`, tone: tot.registersTotal > 0 && tot.registersFinalised < tot.registersTotal ? "warn" : "ok" },
            { label: t("exec.teach.sheets"), value: String(tot.sheetsOverdue), tone: tot.sheetsOverdue > 0 ? "bad" : "ok" },
            { label: t("exec.teach.plans"), value: String(tot.plansAwaiting), tone: tot.plansAwaiting > 0 ? "warn" : "ok" },
            { label: t("exec.teach.never"), value: String(tot.neverSignedIn), tone: tot.neverSignedIn > 0 ? "warn" : "ok" },
          ]} />
        )}
      </DashSection>

      <Row>
        <Panel className={H} title={t("exec.limits.title")} subtitle={t("exec.limits.sub")} right={<Link href="/settings/approvals" className="text-sm font-medium text-link hover:underline">{t("exec.limits.change")}</Link>}>
          <dl className="divide-y divide-line text-sm">
            <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0"><dt className="text-muted">{t("exec.limits.expense")}</dt><dd className="font-semibold tabular-nums text-ink">{lim.expenseOwnerAboveCents > 0 ? money(lim.expenseOwnerAboveCents) : <span className="font-normal text-muted">{t("exec.limits.none")}</span>}</dd></div>
            <div className="flex items-baseline justify-between gap-4 py-2.5 last:pb-0"><dt className="text-muted">{t("exec.limits.refund")}</dt><dd className="font-semibold tabular-nums text-ink">{lim.refundOwnerAboveCents > 0 ? money(lim.refundOwnerAboveCents) : <span className="font-normal text-muted">{t("exec.limits.none")}</span>}</dd></div>
          </dl>
        </Panel>
        <CalendarPanel env={env} className={H} />
      </Row>
      <Row><ActivityPanel env={env} className="flex-[1_1_100%]" /></Row>
    </>
  );
}
