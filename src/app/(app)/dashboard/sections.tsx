import Link from "next/link";
import { ArrowRight, CheckCircle2, AlertTriangle, ClipboardCheck, GraduationCap, Inbox, UserCog, UserPlus, Wallet, FileCheck, Receipt } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";
import type { DashboardData } from "@/server/dashboard";
import type * as ovMod from "@/server/school-overview";
import type { classCollectionReport } from "@/server/finance-reports";
import { displayDate, displayDateTime } from "@/lib/dates";
import { Badge } from "@/components/ui";
import { ChartCard } from "@/components/charts";
import { Cell, DashSection, DashTable, DonutStat, EmptyLine, HBars, KpiCard, Panel, Pill, StackedBars, type PillTone } from "@/components/dash/parts";
import { AttentionTabs } from "@/components/dash/attention-tabs";
import type { AdmissionOverview, QueueItem } from "@/server/admission-queues";

/*
 * The building blocks of every staff home page. Each section is permission-driven by the data it is given (a panel the user may not see
 * arrives as null and the section renders nothing), so a role's home is simply a choice and an order of these sections.
 */

export type Overview = {
  byGender: Awaited<ReturnType<typeof ovMod.studentsByClassGender>> | null;
  attDaily: Awaited<ReturnType<typeof ovMod.attendanceDaily>> | null;
  absent: Awaited<ReturnType<typeof ovMod.absentToday>> | null;
  payments: Awaited<ReturnType<typeof ovMod.recentPayments>> | null;
  byMethod: Awaited<ReturnType<typeof ovMod.collectionByMethod>> | null;
  byClass: Awaited<ReturnType<typeof classCollectionReport>> | null;
  homework: Awaited<ReturnType<typeof ovMod.homeworkOverview>> | null;
  behaviour: Awaited<ReturnType<typeof ovMod.behaviourDaily>> | null;
  events: Awaited<ReturnType<typeof ovMod.upcomingEvents>> | null;
  staffRoles: Awaited<ReturnType<typeof ovMod.staffByRole>> | null;
};
export type DashEnv = { t: Translate; locale: Locale; money: (cents: number) => string; fmtDay: (iso: string) => string; school: { timezone: string; currency: string; name: string }; d: DashboardData; o: Overview; adm: { overview: AdmissionOverview | null; queues: QueueItem[] } };

export const KPI_ICON = { enrolled: GraduationCap, pipeline: UserPlus, attendanceToday: ClipboardCheck, staff: UserCog, enquiries: Inbox, collected: Wallet, outstanding: Receipt, resultsLocked: FileCheck } as const;
const STATUS_TONE = { APPLIED: "brand", INTERVIEW: "brand", ACCEPTED: "warn", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;

function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  if (type === "Student") return `/students/${id}`;
  if (type === "Application") return `/admissions/${id}`;
  return null;
}

export function KpiSection({ env }: { env: DashEnv }) {
  const { t, money, d, school } = env;
  return (
    <>
      {d.kpis.length > 0 && (
        <DashSection id="school" title={t("dash.sec.school")} subtitle={t("dash.sec.school.sub")}>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("dash.kpis")}>
            {d.kpis.map((k) => {
              const Icon = KPI_ICON[k.key as keyof typeof KPI_ICON];
              const money_ = k.key === "collected" || k.key === "outstanding";
              const caption = k.key === "collected" ? (k.hint ? t("dash.kpi.collected.hint", { pct: k.hint }) : undefined) : k.key === "outstanding" ? t("dash.kpi.outstanding.hint", { amount: money(Number(k.hint ?? 0)) }) : k.key === "resultsLocked" ? t("dash.kpi.resultsLocked.hint", { done: k.hint?.split("/")[0] ?? "0", total: k.hint?.split("/")[1] ?? "0" }) : k.key === "pipeline" ? t("dash.kpi.pipeline.hint", { count: Number(k.hint ?? 0) }) : k.key === "attendanceToday" ? (k.value === null ? t("dash.kpi.attendanceToday.none") : t("dash.kpi.attendanceToday.hint", { done: k.hint?.split("/")[0] ?? "0", total: k.hint?.split("/")[1] ?? "0" })) : undefined;
              const num = typeof k.value === "number" ? k.value : 0;
              const pill: { text: string; tone: PillTone } =
                k.key === "enrolled" ? { text: t("dash.pill.active"), tone: "brand" }
                : k.key === "pipeline" ? (Number(k.hint ?? 0) > 0 ? { text: t("dash.pill.new"), tone: "warn" } : { text: t("dash.pill.quiet"), tone: "neutral" })
                : k.key === "attendanceToday" ? (k.value === null ? { text: t("dash.pill.notStarted"), tone: "neutral" } : parseInt(String(k.value), 10) >= 90 ? { text: t("dash.pill.onTrack"), tone: "ok" } : { text: t("dash.pill.watch"), tone: "warn" })
                : k.key === "staff" ? { text: t("dash.pill.team"), tone: "info" }
                : k.key === "enquiries" ? (num > 0 ? { text: t("dash.pill.new"), tone: "warn" } : { text: t("dash.pill.quiet"), tone: "neutral" })
                : k.key === "collected" ? { text: t("dash.pill.collected"), tone: "ok" }
                : k.key === "outstanding" ? (Number(k.hint ?? 0) > 0 ? { text: t("dash.pill.overdue"), tone: "bad" } : { text: t("dash.pill.clear"), tone: "ok" })
                : { text: t("dash.pill.locked"), tone: "brand" };
              return (
                <li key={k.key}>
                  <KpiCard label={t(`dash.kpi.${k.key}` as "dash.kpi.enrolled")} icon={Icon} href={k.href} openLabel={t("dash.kpi.open")} caption={caption} pill={pill}
                    value={k.value === null ? <span aria-label={t("dash.unavailable")}>—</span> : money_ && typeof k.value === "number" ? money(k.value) : typeof k.value === "number" ? k.value.toLocaleString() : k.value} />
                </li>
              );
            })}
          </ul>
        </DashSection>
      )}
    </>
  );
}

export function AttentionSection({ env }: { env: DashEnv }) {
  const { t, d } = env;
  return (
    <>
      {d.attention.length > 0 && (
        <DashSection id="attention" title={t("dash.attention.title")} subtitle={t("dash.attention.count", { n: d.attention.length })}>
          <AttentionTabs allLabel={t("dash.attention.all")} areas={(["attendance", "admissions", "finance", "results", "messages", "system"] as const).map((x) => ({ id: x, label: t(`dash.area.${x}`) }))} rows={d.attention.map((a) => ({ key: a.key, area: a.area, href: a.href, text: t(`dash.attention.${a.key}` as "dash.attention.none", { count: a.count }) }))} />
        </DashSection>
      )}
    </>
  );
}

export function ClassesSection({ env }: { env: DashEnv }) {
  const { t, d } = env;
  return (
    <>
      {d.attendanceByClass && d.attendanceByClass.length > 0 && (() => {
        const sum = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, open: 0 };
        for (const r of d.attendanceByClass!) { if (r.status === "FINALISED") { sum.PRESENT += r.counts.PRESENT; sum.LATE += r.counts.LATE; sum.EXCUSED += r.counts.EXCUSED; sum.ABSENT += r.counts.ABSENT; } else sum.open += r.students; }
        const marked = sum.PRESENT + sum.LATE + sum.EXCUSED + sum.ABSENT;
        const rateKpi = d.kpis.find((k) => k.key === "attendanceToday")?.value;
        return (
          <DashSection id="classes" title={t("dash.sec.classes")} subtitle={t("dash.sec.classes.sub")}>
            <div className="grid gap-5 lg:grid-cols-[24rem_1fr]">
              <Panel title={t("dash.classes.tonight")} subtitle={t("dash.classes.tonight.sub", { n: marked })}>
                <DonutStat label={t("dash.classes.tonight")} center={rateKpi ? String(rateKpi) : "—"} caption={t("dash.classes.caption")} segments={[{ label: t("att.status.PRESENT"), value: sum.PRESENT, color: "#2fd08f" }, { label: t("att.status.LATE"), value: sum.LATE, color: "#f3b94c" }, { label: t("att.status.EXCUSED"), value: sum.EXCUSED, color: "#8b80ff" }, { label: t("att.status.ABSENT"), value: sum.ABSENT, color: "#ff8574" }, { label: t("dash.classes.notMarked"), value: sum.open, color: "#4b5a52" }]} />
              </Panel>
              <Panel title={t("dash.classes.every")} subtitle={t("dash.classes.every.sub")} right={<Link href="/attendance" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {d.attendanceByClass!.map((r, i) => {
                    const done = r.status === "FINALISED";
                    const pct = done && r.students > 0 ? Math.round((r.counts.PRESENT / r.students) * 100) : 0;
                    return (
                      <li key={i} className={`rounded-xl border bg-canvas/60 p-3.5 ${done ? "border-ok/30" : r.status === "DRAFT" ? "border-warn/40" : "border-line"}`}>
                        <div className="flex items-start justify-between gap-2"><div><p className="text-lg font-semibold leading-tight text-heading">{r.className}{r.streamName ? ` ${r.streamName}` : ""}</p><p className="text-xs text-muted">{t("dash.classes.students", { n: r.students })}</p></div><Pill tone={done ? "ok" : r.status === "DRAFT" ? "warn" : "neutral"}>{t(`dash.registers.${r.status}` as "dash.registers.DRAFT")}</Pill></div>
                        <div className="mt-3 flex items-center justify-between text-sm"><span className="text-ok">{done ? `${r.counts.PRESENT} ${t("att.status.PRESENT").toLowerCase()}` : "—"}</span><span className={r.counts.ABSENT > 0 && done ? "font-semibold text-bad" : "text-muted"}>{done ? `${r.counts.ABSENT} ${t("att.status.ABSENT").toLowerCase()}` : "—"}</span></div>
                        <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} /></div>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            </div>
          </DashSection>
        );
      })()}
    </>
  );
}

export function MyRegistersSection({ env }: { env: DashEnv }) {
  const { t, d } = env;
  return (
    <>
      {d.myRegisters.length > 0 && !d.attendanceByClass && (
        <ChartCard title={t("dash.registers.title")} subtitle={t("dash.registers.subtitle")} href="/attendance" hrefLabel={t("dash.table.viewAll")} className="mt-5">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {d.myRegisters.map((r) => (
              <li key={`${r.classId}-${r.streamId}`}>
                <Link href={`/attendance/take?classId=${r.classId}${r.streamId ? `&streamId=${r.streamId}` : ""}&sessionId=${r.sessionId}&date=${d.today}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line px-4 py-2 hover:bg-canvas">
                  <span><span className="block font-medium">{r.className}{r.streamName ? ` – ${r.streamName}` : ""}</span><span className="text-xs text-muted">{t("dash.registers.students", { count: r.students })}</span></span>
                  <Badge tone={r.status === "FINALISED" ? "ok" : r.status === "DRAFT" ? "warn" : "neutral"}>{t(`dash.registers.${r.status}` as "dash.registers.DRAFT")}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        </ChartCard>
      )}
    </>
  );
}

export function StudentsSection({ env }: { env: DashEnv }) {
  const { t, fmtDay, d } = env;
  const { byGender, attDaily, absent } = env.o;
  return (
    <>
      {(byGender || attDaily || d.attendanceByClass || absent) && (
        <DashSection id="students" title={t("dash.sec.students")} subtitle={t("dash.sec.students.sub")}>
          <div className="grid gap-5 lg:grid-cols-2">
            {byGender && (
              <Panel title={t("dash.chart.enrollment")} subtitle={t("dash.chart.enrollment.sub", { total: byGender.reduce((n, c) => n + c.female + c.male, 0) })} right={<Link href="/students" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.enrollment.link")}</Link>}>
                {byGender.length === 0 ? <EmptyLine>{t("dash.chart.enrollment.empty")}</EmptyLine> : <StackedBars points={byGender.map((c) => ({ key: c.classId, label: c.name, parts: { female: c.female, male: c.male } }))} series={[{ key: "female", label: t("student.female") }, { key: "male", label: t("student.male"), color: "#e0a100" }]} every={byGender.length > 9 ? 2 : 1} label={t("dash.chart.enrollment")} summary={t("dash.chart.enrollment.summary")} />}
              </Panel>
            )}
            {attDaily && (
              <Panel title={t("dash.chart.attendance")} subtitle={t("dash.chart.attendance.sub")} right={<Link href="/attendance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.attendance.link")}</Link>}>
                {attDaily.every((p) => Object.keys(p.parts).length === 0) ? <EmptyLine>{t("dash.chart.attendance.empty")}</EmptyLine> : <StackedBars points={attDaily.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "PRESENT", label: t("att.status.PRESENT") }, { key: "LATE", label: t("att.status.LATE"), color: "#e0a100" }, { key: "EXCUSED", label: t("att.status.EXCUSED"), color: "#4f46e5" }, { key: "ABSENT", label: t("att.status.ABSENT"), color: "#e5604d" }]} label={t("dash.chart.attendance")} summary={t("dash.chart.attendance.sub")} />}
              </Panel>
            )}
            {absent && (
              <Panel title={t("dash.absent.title")} subtitle={absent.total === 0 ? t("dash.absent.none") : t("dash.absent.sub", { n: absent.total })}>
                <DashTable empty={absent.rows.length === 0 ? t("dash.absent.none") : undefined} min="24rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("dash.absent.note") }]}>
                  {absent.rows.map((r) => (
                    <tr key={r.studentId}><Cell><Link href={`/students/${r.studentId}`} className="font-semibold text-link hover:underline">{r.name}</Link><span className="block text-xs text-muted">{r.admissionNo}</span></Cell><Cell>{r.className}</Cell><Cell className="text-muted">{r.note ?? "—"}</Cell></tr>
                  ))}
                </DashTable>
              </Panel>
            )}
          </div>
        </DashSection>
      )}
    </>
  );
}

export function FeesSection({ env }: { env: DashEnv }) {
  const { t, locale, money, fmtDay, d } = env;
  const { payments, byMethod, byClass } = env.o;
  const fin = d.finance;
  return (
    <>
      {fin && (
        <DashSection id="fees" title={t("dash.sec.fees")} subtitle={t("dash.finance.sub", { term: fin.term.name })}>
          <section aria-label={t("dash.money.title")} className="mb-5 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-end justify-between gap-3"><p className="text-[11px] font-bold uppercase tracking-[.2em] text-ok">● {t("dash.money.title")}</p><Link href="/finance" className="text-sm font-semibold text-link hover:underline">{t("dash.money.report")} ↗</Link></div>
            <p className="mt-2 flex flex-wrap items-baseline gap-3"><span className="text-4xl font-semibold tabular-nums text-heading sm:text-5xl">{money(fin.collected)}</span>{fin.ratePct !== null && <Pill tone={fin.ratePct >= 70 ? "ok" : "warn"}>{fin.ratePct}% {t("dash.money.ofBilled")}</Pill>}</p>
            <p className="mt-1 text-sm text-muted">{t("dash.money.sub")}</p>
            {fin.billed > 0 && (
              <div className="mt-4"><div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-ok" style={{ width: `${Math.min(100, (fin.collected / fin.billed) * 100)}%` }} /><div className="h-full bg-warn" style={{ width: `${Math.max(0, 100 - (fin.collected / fin.billed) * 100)}%` }} /></div>
                <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><span><span className="mr-1.5 inline-block size-2 rounded-full bg-ok" />{t("dash.money.received")} <strong className="text-ink">{money(fin.collected)}</strong></span><span><span className="mr-1.5 inline-block size-2 rounded-full bg-warn" />{t("dash.money.notYet")} <strong className="text-ink">{money(fin.outstanding)}</strong></span></p></div>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              {([["billed", fin.billed, "text-ink"], ["outstanding", fin.outstanding, fin.outstanding > 0 ? "text-sun" : "text-ok"], ["overdue", fin.overdue, fin.overdue > 0 ? "text-bad" : "text-ok"], ["credit", fin.credit, "text-ink"], ["expenses", fin.expenses, "text-ink"]] as const).map(([k, v, c]) => <div key={k} className="bg-surface p-4"><dt className="text-xs text-muted">{t(`dash.money.${k}`)}</dt><dd className={`mt-1 text-xl font-semibold tabular-nums ${c}`}>{money(v)}</dd></div>)}
            </dl>
            <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 lg:grid-cols-4">
              {([
                ["received.today", fin.received.today, "text-ink"], ["received.week", fin.received.week, "text-ink"], ["received.month", fin.received.month, "text-ink"],
                ["admission", fin.admissionFees.verified, "text-ink"], ["application", fin.admissionFees.application, "text-ink"], ["dueSoon", fin.dueSoon.amount, fin.dueSoon.amount > 0 ? "text-sun" : "text-ok"],
                ["net", fin.netOperating, fin.netOperating < 0 ? "text-bad" : "text-ok"],
              ] as const).map(([k, v, c]) => <div key={k} className="bg-surface p-4"><dt className="text-xs text-muted">{t(`dash.money.${k}` as "dash.money.net")}</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${c}`}>{money(v)}</dd>{k === "dueSoon" && <dd className="text-xs text-muted">{t("dash.money.dueSoon.n", { n: fin.dueSoon.students })}</dd>}{k === "admission" && fin.admissionFees.pending > 0 && <dd className="text-xs text-muted">{t("dash.money.admission.pending", { amount: money(fin.admissionFees.pending) })}</dd>}</div>)}
              <div className="bg-surface p-4"><dt className="text-xs text-muted">{t("dash.money.states")}</dt><dd className="mt-1 text-sm tabular-nums"><span className="text-ok">{fin.invoices.paid}</span> {t("dash.money.state.paid")} · <span className="text-sun">{fin.invoices.partial}</span> {t("dash.money.state.partial")} · <span className="text-bad">{fin.invoices.unpaid}</span> {t("dash.money.state.unpaid")}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">{t("dash.money.net.note")}</p>
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title={t("dash.finance.chart")} subtitle={t("dash.finance.chart.sub", { total: money(fin.trend.reduce((n, p) => n + p.cents, 0)) })} right={<Link href="/finance" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
              {fin.trend.every((p) => p.cents === 0) ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <StackedBars points={fin.trend.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: { n: p.cents / 100 } }))} series={[{ key: "n", label: t("dash.kpi.collected") }]} every={4} format={(n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))} label={t("dash.finance.chart")} summary={t("dash.finance.chart.sub", { total: money(fin.trend.reduce((n, p) => n + p.cents, 0)) })} />}
            </Panel>
            <Panel title={t("dash.fees.byMethod")} subtitle={t("dash.fees.byMethod.sub")}>
              {!byMethod || byMethod.length === 0 ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <HBars items={byMethod.map((m) => ({ label: t(`fin.method.${m.method}` as "fin.method.CASH"), value: m.cents }))} format={(c) => money(c)} label={t("dash.fees.byMethod")} summary={t("dash.fees.byMethod.sub")} tone="#14a3b8" />}
            </Panel>
            {byClass && (
              <Panel title={t("dash.fees.byClass")} subtitle={t("dash.fees.byClass.sub")} className="lg:col-span-2" right={<Link href="/finance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <DashTable empty={byClass.length === 0 ? t("dash.fees.byClass.none") : undefined} min="34rem" head={[{ label: t("learn.class") }, { label: t("dash.attToday.students"), right: true }, { label: t("fin.billed"), right: true }, { label: t("dash.fees.received"), right: true }, { label: t("dash.kpi.outstanding"), right: true }, { label: "%", right: true }]}>
                  {byClass.map((r) => (
                    <tr key={r.classId}><Cell className="font-semibold text-ink">{r.className}</Cell><Cell right>{r.students}</Cell><Cell right>{money(r.billed)}</Cell><Cell right>{money(r.paid)}</Cell><Cell right className={r.outstanding > 0 ? "text-bad" : ""}>{money(r.outstanding)}</Cell><Cell right>{r.ratePct === null ? "—" : `${r.ratePct}%`}</Cell></tr>
                  ))}
                </DashTable>
              </Panel>
            )}
            <Panel title={t("dash.finance.arrears")} subtitle={t("dash.fees.arrears.sub")} right={<Link href="/finance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.finance.allArrears")}</Link>}>
              <DashTable empty={fin.topArrears.length === 0 ? t("fin.reports.noArrears") : undefined} min="26rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("dash.kpi.outstanding"), right: true }]}>
                {fin.topArrears.map((a) => (
                  <tr key={a.studentId}><Cell><Link href={`/finance/students/${a.studentId}`} className="font-semibold text-link hover:underline">{a.name}</Link><span className="block text-xs text-muted">{a.admissionNo}</span></Cell><Cell>{a.className ?? "—"}</Cell><Cell right>{money(a.outstanding)}{a.overdue > 0 && <span className="block text-xs text-bad">{t("dash.finance.overdueAmount", { amount: money(a.overdue) })}</span>}</Cell></tr>
                ))}
              </DashTable>
            </Panel>
            {payments && (
              <Panel title={t("dash.fees.recent")} subtitle={t("dash.fees.recent.sub")} className="lg:col-span-2" right={<Link href="/finance/payments" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <DashTable empty={payments.length === 0 ? t("dash.finance.noPayments") : undefined} min="36rem" head={[{ label: t("audit.when") }, { label: t("learn.student") }, { label: t("fin.method") }, { label: t("dash.fees.receipt") }, { label: t("fin.amount"), right: true }]}>
                  {payments.map((p) => (
                    <tr key={p.id}><Cell className="whitespace-nowrap text-muted">{displayDate(p.receivedOn, locale)}</Cell><Cell><Link href={`/finance/students/${p.studentId}`} className="font-semibold text-link hover:underline">{p.name}</Link><span className="block text-xs text-muted">{p.admissionNo}</span></Cell><Cell>{t(`fin.method.${p.method}` as "fin.method.CASH")}</Cell><Cell className="font-mono text-xs text-muted">{p.receipt ?? "—"}</Cell><Cell right className="font-semibold">{money(p.cents)}</Cell></tr>
                  ))}
                </DashTable>
              </Panel>
            )}
          </div>
        </DashSection>
      )}
    </>
  );
}

export function ResultsSection({ env }: { env: DashEnv }) {
  const { t, d } = env;
  return (
    <>
      {d.exams && (
        <DashSection id="results" title={t("dash.sec.results")} subtitle={t("dash.sec.results.sub")}>
          <div className="grid gap-5 lg:grid-cols-2">
            {d.exams && (
              <Panel title={t("dash.exams.title")} subtitle={t("dash.exams.sub", { term: d.exams.term.name, total: d.exams.total })} right={<Link href="/marks" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
                {d.exams.total === 0 ? <EmptyLine>{t("dash.exams.none")}</EmptyLine> : <HBars items={(["DRAFT", "RETURNED", "SUBMITTED", "APPROVED", "LOCKED"] as const).map((k) => ({ label: t(`marks.status.${k}`), value: d.exams!.byStatus[k] }))} label={t("dash.exams.title")} summary={t("dash.exams.summary")} tone="#4f46e5" />}
              </Panel>
            )}
            {d.exams && d.exams.mine.length > 0 && (
              <Panel title={t("dash.exams.mine")} subtitle={t("dash.exams.mine.sub")}>
                <DashTable min="28rem" head={[{ label: t("learn.subject") }, { label: t("learn.class") }, { label: t("dash.exams.progress"), right: true }, { label: t("common.status") }]}>
                  {d.exams.mine.map((m) => <tr key={m.id}><Cell><Link href={`/marks/${m.id}`} className="font-semibold text-link hover:underline">{m.subjectName}</Link><span className="block text-xs text-muted">{m.examName}</span></Cell><Cell>{m.className}{m.streamName ? ` ${m.streamName}` : ""}</Cell><Cell right>{m.entered}/{m.roster}</Cell><Cell>{m.overdue ? <Pill tone="bad">{t("marks.overdue")}</Pill> : <Pill tone={m.status === "RETURNED" ? "warn" : "neutral"}>{t(`marks.status.${m.status}` as "marks.status.DRAFT")}</Pill>}</Cell></tr>)}
                </DashTable>
              </Panel>
            )}
          </div>
        </DashSection>
      )}
    </>
  );
}

/** What each person has waiting, from the real records (nothing here is a stored task that could be ticked without the work being done). */
export function QueueSection({ env }: { env: DashEnv }) {
  const { t, adm } = env;
  if (adm.queues.length === 0) return null;
  return (
    <DashSection id="queues" title={t("adm.q.title")}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("adm.q.title")}>
        {adm.queues.map((q) => (
          <li key={q.key}>
            <Link href={q.href} className="group flex h-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
              <span className="text-sm font-medium text-ink">{t(`adm.q.${q.key}` as "adm.q.new")}</span>
              <span className="text-2xl font-semibold tabular-nums text-link">{q.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </DashSection>
  );
}

/** The Administrator's admissions picture: every card opens the matching filtered list. */
export function AdmissionFlowSection({ env }: { env: DashEnv }) {
  const { t, adm } = env;
  const o = adm.overview;
  if (!o) return null;
  const cards: { icon: typeof Inbox; label: string; value: number; caption?: string; href: string; tone?: PillTone; pill?: string }[] = [
    { icon: Inbox, label: t("adm.ov.received"), value: o.received.total, caption: `${o.received.online} ${t("adm.ov.online")} · ${o.received.physical} ${t("adm.ov.physical")}`, href: "/admissions" },
    { icon: FileCheck, label: t("adm.q.new"), value: o.stages.new, href: "/admissions?stage=new", tone: o.stages.new > 0 ? "warn" : undefined, pill: o.stages.new > 0 ? t("dash.pill.new") : undefined },
    { icon: FileCheck, label: t("adm.q.docsPending"), value: o.stages.docs_pending, href: "/admissions?stage=docs_pending" },
    { icon: ClipboardCheck, label: t("adm.ov.upcoming"), value: o.interviews.upcoming, caption: o.interviews.today > 0 ? `${o.interviews.today} ${t("adm.iv.today").toLowerCase()}` : undefined, href: "/admissions/interviews" },
    { icon: ClipboardCheck, label: t("adm.q.awaitingResult"), value: o.interviews.awaitingResult, href: "/admissions?stage=awaiting_result", tone: o.interviews.awaitingResult > 0 ? "warn" : undefined },
    { icon: UserPlus, label: t("adm.q.awaitingDecision"), value: o.stages.awaiting_decision, href: "/admissions?stage=awaiting_decision" },
    { icon: Wallet, label: t("adm.q.awaitingPaymentView"), value: o.offers.awaitingPayment, caption: o.offers.paymentsToVerify > 0 ? `${o.offers.paymentsToVerify} ${t("adm.stage.verification_pending").toLowerCase()}` : undefined, href: "/admissions?stage=awaiting_payment" },
    { icon: CheckCircle2, label: t("adm.q.eligible"), value: o.offers.eligibleToEnrol, href: "/admissions?stage=eligible", tone: o.offers.eligibleToEnrol > 0 ? "ok" : undefined },
    { icon: GraduationCap, label: t("adm.ov.enrolled"), value: o.enrolled.total, caption: o.enrolled.awaitingPlacement > 0 ? `${o.enrolled.awaitingPlacement} ${t("adm.q.awaitingPlacement").toLowerCase()}` : undefined, href: o.enrolled.awaitingPlacement > 0 ? "/admissions/placement" : "/admissions?status=ENROLLED" },
    { icon: AlertTriangle, label: t("adm.ov.rejected"), value: (o.byStatus.REJECTED ?? 0) + (o.byStatus.WITHDRAWN ?? 0), href: "/admissions?status=REJECTED" },
  ];
  return (
    <DashSection id="admissions-flow" title={t("adm.ov.title")} subtitle={t("dash.sec.admissions.sub")}>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label={t("adm.ov.title")}>
        {cards.map((c) => (
          <li key={c.label}><KpiCard icon={c.icon} label={c.label} value={c.value.toLocaleString()} caption={c.caption} href={c.href} openLabel={t("dash.kpi.open")} pill={c.pill && c.tone ? { text: c.pill, tone: c.tone } : undefined} /></li>
        ))}
      </ul>
    </DashSection>
  );
}

export function AdmissionsSection({ env }: { env: DashEnv }) {
  const { t, locale, d } = env;
  const pipelineTotal = d.pipeline?.reduce((n, p) => n + p.value, 0) ?? 0;
  return (
    <>
      <AdmissionFlowSection env={env} />
      {(d.pipeline || d.recentApplications) && (
        <DashSection id="admissions" title={t("dash.sec.admissions")} subtitle={t("dash.sec.admissions.sub")}>
          <div className="grid gap-5 lg:grid-cols-2">
            {d.pipeline && (
              <Panel title={t("dash.chart.pipeline")} subtitle={t("dash.chart.pipeline.sub", { total: pipelineTotal })} right={<Link href="/admissions" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.pipeline.link")}</Link>}>
                {pipelineTotal === 0 ? <EmptyLine>{t("dash.chart.pipeline.empty")}</EmptyLine> : <HBars items={d.pipeline.map((p) => ({ label: t(`adm.status.${p.label}` as "adm.status.APPLIED"), value: p.value }))} label={t("dash.chart.pipeline")} summary={t("dash.chart.pipeline.summary")} />}
              </Panel>
            )}
            {d.recentApplications && (
              <Panel title={t("dash.table.applications")} right={<Link href="/admissions" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <DashTable empty={d.recentApplications.length === 0 ? t("dash.table.applications.empty") : undefined} min="28rem" head={[{ label: t("adm.applicant") }, { label: t("adm.classApplied") }, { label: t("common.status") }, { label: t("adm.appliedOn") }]}>
                  {d.recentApplications.map((a) => (
                    <tr key={a.id}><Cell><Link href={`/admissions/${a.id}`} className="font-semibold text-link hover:underline">{a.firstName} {a.lastName}</Link><span className="block text-xs text-muted">{a.applicationNo}{a.source === "ONLINE" ? ` · ${t("adm.online")}` : ""}</span></Cell><Cell>{a.className ?? "—"}</Cell><Cell><Badge tone={STATUS_TONE[a.status]}>{t(`adm.status.${a.status}` as "adm.status.APPLIED")}</Badge></Cell><Cell className="whitespace-nowrap text-muted">{displayDate(a.createdAt, locale)}</Cell></tr>
                  ))}
                </DashTable>
              </Panel>
            )}
          </div>
        </DashSection>
      )}
    </>
  );
}

export function LearningSection({ env }: { env: DashEnv }) {
  const { t, locale, fmtDay } = env;
  const { homework, behaviour } = env.o;
  return (
    <>
      {(homework || behaviour) && (
        <DashSection id="learning" title={t("dash.sec.learning")} subtitle={t("dash.sec.learning.sub")}>
          <div className="grid gap-5 lg:grid-cols-2">
            {homework && (
              <Panel title={t("dash.hw.title")} subtitle={t("dash.hw.sub", { open: homework.open, overdue: homework.overdue })} right={<Link href="/assignments" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <DashTable empty={homework.rows.length === 0 ? t("learn.asg.none") : undefined} min="32rem" head={[{ label: t("learn.title") }, { label: t("learn.class") }, { label: t("learn.asg.due") }, { label: t("learn.asg.handedIn"), right: true }]}>
                  {homework.rows.map((r) => <tr key={r.id}><Cell><Link href={`/assignments/${r.id}`} className="font-semibold text-link hover:underline">{r.title}</Link><span className="block text-xs text-muted">{r.subjectName}</span></Cell><Cell>{r.className}{r.streamName ? ` ${r.streamName}` : ""}</Cell><Cell className={`whitespace-nowrap ${r.overdue ? "text-bad" : "text-muted"}`}>{displayDate(r.dueAt, locale)}</Cell><Cell right>{r.handedIn}/{r.roster}</Cell></tr>)}
                </DashTable>
              </Panel>
            )}
            {behaviour && (
              <Panel title={t("dash.bh.title")} subtitle={t("dash.bh.sub", { n: behaviour.total })} right={<Link href="/behaviour" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                {behaviour.total === 0 ? <EmptyLine>{t("learn.bh.none")}</EmptyLine> : <StackedBars points={behaviour.days.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "POSITIVE", label: t("learn.bh.type.POSITIVE") }, { key: "CONCERN", label: t("learn.bh.type.CONCERN"), color: "#e0a100" }, { key: "INCIDENT", label: t("learn.bh.type.INCIDENT"), color: "#e5604d" }]} label={t("dash.bh.title")} summary={t("dash.bh.sub", { n: behaviour.total })} />}
              </Panel>
            )}
          </div>
        </DashSection>
      )}
    </>
  );
}

export function CalendarSection({ env }: { env: DashEnv }) {
  const { t, locale, school } = env;
  const { events, staffRoles } = env.o;
  return (
    <>
      {(events || staffRoles) && (
        <DashSection id="calendar" title={t("dash.sec.calendar")} subtitle={t("dash.sec.calendar.sub")}>
          <div className="grid gap-5 lg:grid-cols-2">
            {events && (
              <Panel title={t("dash.events.title")} subtitle={t("dash.events.sub")} right={<Link href="/school-calendar" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <DashTable empty={events.length === 0 ? t("dash.events.none") : undefined} min="24rem" head={[{ label: t("learn.date") }, { label: t("dash.events.what") }, { label: t("dash.events.where") }]}>
                  {events.map((e) => <tr key={e.id}><Cell className="whitespace-nowrap font-semibold text-ink">{displayDate(new Date(`${e.from}T00:00:00Z`), locale)}</Cell><Cell>{locale === "SW" && e.titleSw ? e.titleSw : e.title}{e.category && <span className="block text-xs text-muted">{e.category}</span>}</Cell><Cell className="text-muted">{e.location ?? "—"}</Cell></tr>)}
                </DashTable>
              </Panel>
            )}
            {staffRoles && (
              <Panel title={t("dash.staff.title")} subtitle={t("dash.staff.sub")} right={<Link href="/users" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                {staffRoles.length === 0 ? <EmptyLine>{t("dash.staff.none")}</EmptyLine> : <HBars items={staffRoles} label={t("dash.staff.title")} summary={t("dash.staff.sub")} tone="#a066d9" />}
              </Panel>
            )}
          </div>
        </DashSection>
      )}
    </>
  );
}

export function LatestSection({ env }: { env: DashEnv }) {
  const { t, locale, d, school } = env;
  return (
    <>
      {d.activity && (
        <DashSection id="latest" title={t("dash.sec.latest")} subtitle={t("dash.sec.latest.sub")}>
          <Panel title={t("dash.table.activity")} right={<Link href="/audit" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <DashTable empty={d.activity.length === 0 ? t("dash.table.activity.empty") : undefined} min="34rem" head={[{ label: t("audit.when") }, { label: t("audit.who") }, { label: t("audit.record") }]}>
              {d.activity.map((a) => {
                const href = entityHref(a.entityType, a.entityId);
                return <tr key={a.id}><Cell className="whitespace-nowrap text-muted">{displayDateTime(a.createdAt, school.timezone, locale)}</Cell><Cell className="font-semibold text-ink">{a.actorName ?? t("audit.system")}</Cell><Cell>{href ? <Link href={href} className="text-link hover:underline">{a.summary ?? a.action}</Link> : (a.summary ?? a.action)}<span className="block font-mono text-xs text-muted">{a.action}</span></Cell></tr>;
              })}
            </DashTable>
          </Panel>
        </DashSection>
      )}
    </>
  );
}

