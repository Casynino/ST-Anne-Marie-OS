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
import { Cell, DashSection, DashTable, DonutStat, EmptyLine, HBars, KpiCard, Panel, PersonCell, Pill, SERIES_COLORS, StackedBars, type PillTone } from "@/components/dash/parts";
import { AreaChart, BarLineChart } from "@/components/dash/charts-client";
import { ClassGrid, type ClassCell } from "@/components/dash/class-grid";
import { MetricStrip, RateBars, Ring, StageBar } from "@/components/dash/viz";
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
  applications: Awaited<ReturnType<typeof ovMod.applicationsDaily>> | null;
  fill: Awaited<ReturnType<typeof ovMod.classFill>> | null;
};
export type DashEnv = { t: Translate; locale: Locale; money: (cents: number) => string; fmtDay: (iso: string) => string; school: { timezone: string; currency: string; name: string }; d: DashboardData; o: Overview; adm: { overview: AdmissionOverview | null; queues: QueueItem[] } };

export const KPI_ICON = { enrolled: GraduationCap, pipeline: UserPlus, attendanceToday: ClipboardCheck, staff: UserCog, enquiries: Inbox, collected: Wallet, outstanding: Receipt, resultsLocked: FileCheck } as const;
const STATUS_TONE = { APPLIED: "brand", INTERVIEW: "brand", ACCEPTED: "warn", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;


const rateOf = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
const running = (xs: number[]) => { let a = 0; return xs.map((x) => (a += x)); };
const movingAvg = (xs: number[], n: number) => xs.map((_, i) => { const w = xs.slice(Math.max(0, i - n + 1), i + 1); return Math.round(w.reduce((a, b) => a + b, 0) / w.length); });
const periods = (t: Translate, counts: number[]) => counts.map((n) => ({ label: t(`dash.period.${n}` as "dash.period.7"), count: n }));
const compactMoney = (cents: number) => { const n = cents / 100; return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)); };
const STAGE = { sky: "#14a3b8", violet: "#8b80ff", sun: "#f3b94c", ok: "#2fd08f", bad: "#ff8574", muted: "#4b5a52" } as const;

function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  if (type === "Student") return `/students/${id}`;
  if (type === "Application") return `/admissions/${id}`;
  return null;
}

export function KpiSection({ env }: { env: DashEnv }) {
  const { t, money, d, school } = env;
  const attSpark = d.attendanceTrend && d.attendanceTrend.length > 1 ? d.attendanceTrend.map((p) => p.rate) : undefined;
  const cashSpark = d.finance && d.finance.trend.some((p) => p.cents > 0) ? running(d.finance.trend.map((p) => p.cents)) : undefined;
  const appsSpark = env.o.applications && env.o.applications.some((p) => p.count > 0) ? env.o.applications.slice(-14).map((p) => p.count) : undefined;
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
                    spark={k.key === "attendanceToday" ? attSpark : k.key === "collected" ? cashSpark : k.key === "pipeline" ? appsSpark : undefined}
                    ring={k.key === "attendanceToday" ? rateOf(k.value) : k.key === "collected" ? (d.finance?.ratePct ?? null) : k.key === "resultsLocked" ? rateOf(k.value) : undefined}
                    tone={k.key === "attendanceToday" ? ((rateOf(k.value) ?? 0) >= 90 ? "ok" : "warn") : k.key === "pipeline" ? "sky" : k.key === "resultsLocked" ? "indigo" : "ok"}
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
  if (!d.attendanceByClass || d.attendanceByClass.length === 0) return null;
  const sum = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, open: 0 };
  for (const r of d.attendanceByClass) { if (r.status === "FINALISED") { sum.PRESENT += r.counts.PRESENT; sum.LATE += r.counts.LATE; sum.EXCUSED += r.counts.EXCUSED; sum.ABSENT += r.counts.ABSENT; } else sum.open += r.students; }
  const marked = sum.PRESENT + sum.LATE + sum.EXCUSED + sum.ABSENT;
  const rate = rateOf(d.kpis.find((k) => k.key === "attendanceToday")?.value);
  const legend = [[t("att.status.PRESENT"), sum.PRESENT, "#2fd08f"], [t("att.status.LATE"), sum.LATE, "#f3b94c"], [t("att.status.EXCUSED"), sum.EXCUSED, "#8b80ff"], [t("att.status.ABSENT"), sum.ABSENT, "#ff8574"], [t("dash.classes.notMarked"), sum.open, "#4b5a52"]] as const;
  const cells: ClassCell[] = d.attendanceByClass.map((r, i) => {
    const done = r.status === "FINALISED";
    return { key: String(i), name: `${r.className}${r.streamName ? ` ${r.streamName}` : ""}`, students: t("dash.classes.students", { n: r.students }), status: r.status, statusLabel: t(`dash.registers.${r.status}` as "dash.registers.DRAFT"), present: done ? `${r.counts.PRESENT} ${t("att.status.PRESENT").toLowerCase()}` : "—", absent: done ? `${r.counts.ABSENT} ${t("att.status.ABSENT").toLowerCase()}` : "—", absentCount: done ? r.counts.ABSENT : 0, pct: done && r.students > 0 ? Math.round((r.counts.PRESENT / r.students) * 100) : 0 };
  });
  return (
    <DashSection id="classes" title={t("dash.sec.classes")} subtitle={t("dash.sec.classes.sub")}>
      <div className="grid gap-5 lg:grid-cols-[24rem_1fr]">
        <Panel title={t("dash.classes.tonight")} subtitle={t("dash.classes.tonight.sub", { n: marked })}>
          <div className="flex flex-col items-center gap-6 sm:flex-row lg:flex-col">
            <Ring value={rate} size={168} stroke={9} tone={rate !== null && rate >= 90 ? "ok" : "warn"} label={t("dash.classes.tonight")}>
              <span><span className="block text-4xl font-semibold tabular-nums text-heading">{rate === null ? "—" : `${rate}%`}</span><span className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted">{t("dash.classes.caption")}</span></span>
            </Ring>
            <ul className="w-full space-y-2.5 text-sm">
              {legend.map(([label, value, color]) => <li key={label} className="flex items-center justify-between gap-4"><span className="inline-flex items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />{label}</span><span className="font-semibold tabular-nums text-ink">{value}</span></li>)}
            </ul>
          </div>
        </Panel>
        <Panel title={t("dash.classes.every")} subtitle={t("dash.classes.every.sub")} right={<Link href="/attendance" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
          <ClassGrid label={t("dash.classes.every")} cells={cells} tabs={[{ id: "all", label: t("dash.attention.all") }, { id: "FINALISED", label: t("dash.registers.FINALISED") }, { id: "DRAFT", label: t("dash.registers.DRAFT") }, { id: "NOT_STARTED", label: t("dash.registers.NOT_STARTED") }]} />
        </Panel>
      </div>
    </DashSection>
  );
}

/** How the school is doing over the last two weeks: the attendance rate as a smooth area against the 90% target, with the figures behind it. */
export function PulseSection({ env }: { env: DashEnv }) {
  const { t, fmtDay, d } = env;
  const tr = d.attendanceTrend;
  if (!tr || tr.length < 2) return null;
  const rates = tr.map((p) => p.rate);
  const avg = Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
  const best = tr.reduce((a, b) => (b.rate > a.rate ? b : a));
  const low = tr.reduce((a, b) => (b.rate < a.rate ? b : a));
  const last = tr[tr.length - 1]!;
  const floor = Math.max(0, Math.floor((Math.min(...rates) - 5) / 10) * 10);
  return (
    <DashSection id="pulse" title={t("dash.pulse.title")} subtitle={t("dash.pulse.sub")}>
      <Panel title={t("dash.pulse.attendance")} subtitle={t("dash.pulse.attendance.sub")} right={<Link href="/attendance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.attendance.link")}</Link>}>
        <AreaChart label={t("dash.pulse.attendance")} summary={t("dash.pulse.attendance.sub")} kind="percent" yMin={floor} yMax={100} goal={{ value: 90, label: t("dash.pulse.goal", { n: 90 }) }} periodLabel={t("dash.period.label")} periods={tr.length > 7 ? periods(t, [7, 14]) : undefined} points={tr.map((p) => ({ key: p.date, label: fmtDay(p.date), value: p.rate }))} />
      </Panel>
      <div className="mt-4">
        <MetricStrip label={t("dash.pulse.title")} items={[
          { label: t("dash.pulse.latest"), value: `${last.rate}%`, sub: fmtDay(last.date), tone: last.rate >= 90 ? "ok" : "warn" },
          { label: t("dash.pulse.avg"), value: `${avg}%` },
          { label: t("dash.pulse.best"), value: `${best.rate}%`, sub: fmtDay(best.date), tone: "ok" },
          { label: t("dash.pulse.low"), value: `${low.rate}%`, sub: fmtDay(low.date), tone: low.rate >= 90 ? "ok" : low.rate >= 80 ? "warn" : "bad" },
        ]} />
      </div>
    </DashSection>
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
  const { byGender, attDaily, absent, fill } = env.o;
  if (!(byGender || attDaily || d.attendanceByClass || absent)) return null;
  const girls = d.gender?.FEMALE ?? 0, boys = d.gender?.MALE ?? 0;
  return (
    <DashSection id="students" title={t("dash.sec.students")} subtitle={t("dash.sec.students.sub")}>
      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        {byGender && (
          <Panel title={t("dash.chart.enrollment")} subtitle={t("dash.chart.enrollment.sub", { total: byGender.reduce((n, c) => n + c.female + c.male, 0) })} right={<Link href="/students" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.enrollment.link")}</Link>}>
            {byGender.length === 0 ? <EmptyLine>{t("dash.chart.enrollment.empty")}</EmptyLine> : <StackedBars points={byGender.map((c) => ({ key: c.classId, label: c.name, parts: { female: c.female, male: c.male } }))} series={[{ key: "female", label: t("student.female") }, { key: "male", label: t("student.male"), color: "#e0a100" }]} every={byGender.length > 9 ? 2 : 1} label={t("dash.chart.enrollment")} summary={t("dash.chart.enrollment.summary")} />}
          </Panel>
        )}
        {girls + boys > 0 && (
          <Panel title={t("dash.gender.title")} subtitle={t("dash.gender.sub")}>
            <DonutStat label={t("dash.gender.title")} center={(girls + boys).toLocaleString()} caption={t("dash.kpi.enrolled")} segments={[{ label: t("student.female"), value: girls, color: "#0f9462", text: `${girls} · ${Math.round((girls / (girls + boys)) * 100)}%` }, { label: t("student.male"), value: boys, color: "#e0a100", text: `${boys} · ${Math.round((boys / (girls + boys)) * 100)}%` }]} />
          </Panel>
        )}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {attDaily && (
          <Panel title={t("dash.chart.attendance")} subtitle={t("dash.chart.attendance.sub")} right={<Link href="/attendance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.attendance.link")}</Link>}>
            {attDaily.every((p) => Object.keys(p.parts).length === 0) ? <EmptyLine>{t("dash.chart.attendance.empty")}</EmptyLine> : <StackedBars points={attDaily.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "PRESENT", label: t("att.status.PRESENT") }, { key: "LATE", label: t("att.status.LATE"), color: "#e0a100" }, { key: "EXCUSED", label: t("att.status.EXCUSED"), color: "#4f46e5" }, { key: "ABSENT", label: t("att.status.ABSENT"), color: "#e5604d" }]} label={t("dash.chart.attendance")} summary={t("dash.chart.attendance.sub")} />}
          </Panel>
        )}
        {absent && (
          <Panel title={t("dash.absent.title")} subtitle={absent.total === 0 ? t("dash.absent.none") : t("dash.absent.sub", { n: absent.total })}>
            <DashTable empty={absent.rows.length === 0 ? t("dash.absent.none") : undefined} min="24rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("dash.absent.note") }]}>
              {absent.rows.map((r) => (
                <tr key={r.studentId}><Cell><Link href={`/students/${r.studentId}`} className="hover:opacity-90"><PersonCell name={r.name} sub={r.admissionNo} /></Link></Cell><Cell>{r.className}</Cell><Cell className="text-muted">{r.note ?? "—"}</Cell></tr>
              ))}
            </DashTable>
          </Panel>
        )}
        {fill && fill.length > 0 && (
          <Panel title={t("dash.fill.title")} subtitle={t("dash.fill.sub")} className="lg:col-span-2">
            <RateBars mode="fill" label={t("dash.fill.title")} summary={t("dash.fill.sub")} items={fill.map((c) => ({ label: c.name, value: Math.round((c.count / c.capacity) * 100), note: t("dash.cap.of", { n: c.count, cap: c.capacity }) }))} />
          </Panel>
        )}
      </div>
    </DashSection>
  );
}

export function FeesSection({ env }: { env: DashEnv }) {
  const { t, locale, money, fmtDay, d, school } = env;
  const { payments, byMethod, byClass } = env.o;
  const fin = d.finance;
  if (!fin) return null;
  const avg7 = movingAvg(fin.trend.map((p) => p.cents), 7);
  const hasCash = fin.trend.some((p) => p.cents > 0);
  const total30 = fin.trend.reduce((n, p) => n + p.cents, 0);
  const methods = (byMethod ?? []).map((m, i) => ({ label: t(`fin.method.${m.method}` as "fin.method.CASH"), value: m.cents, text: money(m.cents), color: SERIES_COLORS[i % SERIES_COLORS.length]! }));
  const methodTotal = methods.reduce((n, m) => n + m.value, 0);
  const rate = fin.ratePct;
  return (
    <DashSection id="fees" title={t("dash.sec.fees")} subtitle={t("dash.finance.sub", { term: fin.term.name })}>
      <section aria-label={t("dash.money.title")} className="mb-5 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold uppercase tracking-[.2em] text-ok"><span>● {t("dash.money.title")}</span><Link href="/finance" className="text-sm font-semibold normal-case tracking-normal text-link hover:underline">{t("dash.money.report")} ↗</Link></p>
            <p className="mt-2 text-4xl font-semibold tabular-nums text-heading sm:text-5xl">{money(fin.collected)}</p>
            <p className="mt-1 text-sm text-muted">{t("dash.money.sub")}</p>
          </div>
          <Ring value={rate} size={128} stroke={9} tone={rate !== null && rate >= 70 ? "ok" : "warn"} label={t("dash.fees.rate")}>
            <span><span className="block text-3xl font-semibold tabular-nums text-heading">{rate === null ? "—" : `${rate}%`}</span><span className="block text-[10px] font-bold uppercase tracking-[.14em] text-muted">{t("dash.money.ofBilled")}</span></span>
          </Ring>
        </div>
        {fin.billed > 0 && (
          <div className="mt-5"><div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-ok" style={{ width: `${Math.min(100, (fin.collected / fin.billed) * 100)}%` }} /><div className="h-full bg-warn" style={{ width: `${Math.max(0, 100 - (fin.collected / fin.billed) * 100)}%` }} /></div>
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><span><span className="mr-1.5 inline-block size-2 rounded-full bg-ok" />{t("dash.money.received")} <strong className="text-ink">{money(fin.collected)}</strong></span><span><span className="mr-1.5 inline-block size-2 rounded-full bg-warn" />{t("dash.money.notYet")} <strong className="text-ink">{money(fin.outstanding)}</strong></span></p></div>
        )}
        <div className="mt-5">
          <MetricStrip label={t("dash.money.title")} items={[
            { label: t("dash.money.billed"), value: money(fin.billed) },
            { label: t("dash.money.outstanding"), value: money(fin.outstanding), tone: fin.outstanding > 0 ? "warn" : "ok" },
            { label: t("dash.money.overdue"), value: money(fin.overdue), tone: fin.overdue > 0 ? "bad" : "ok" },
            { label: t("dash.money.credit"), value: money(fin.credit) },
            { label: t("dash.money.expenses"), value: money(fin.expenses) },
          ]} />
        </div>
        <div className="mt-3">
          <MetricStrip label={t("dash.money.received")} items={[
            { label: t("dash.money.received.today"), value: money(fin.received.today) },
            { label: t("dash.money.received.week"), value: money(fin.received.week) },
            { label: t("dash.money.received.month"), value: money(fin.received.month) },
            { label: t("dash.money.admission"), value: money(fin.admissionFees.verified), sub: fin.admissionFees.pending > 0 ? t("dash.money.admission.pending", { amount: money(fin.admissionFees.pending) }) : undefined },
            { label: t("dash.money.application"), value: money(fin.admissionFees.application) },
            { label: t("dash.money.dueSoon"), value: money(fin.dueSoon.amount), sub: t("dash.money.dueSoon.n", { n: fin.dueSoon.students }), tone: fin.dueSoon.amount > 0 ? "warn" : "ok" },
            { label: t("dash.money.net"), value: money(fin.netOperating), tone: fin.netOperating < 0 ? "bad" : "ok" },
          ]} />
        </div>
        <p className="mt-2 text-xs text-muted">{t("dash.money.net.note")}</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={t("dash.fees.daily")} subtitle={t("dash.finance.chart.sub", { total: money(total30) })} right={<Link href="/finance/payments" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
          {!hasCash ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <BarLineChart label={t("dash.fees.daily")} summary={t("dash.fees.daily.sub")} kind="money" currency={school.currency} barLabel={t("dash.kpi.collected")} lineLabel={t("dash.fees.avg7")} periodLabel={t("dash.period.label")} periods={periods(t, [7, 14, 30])} points={fin.trend.map((p, i) => ({ key: p.date, label: fmtDay(p.date), bar: p.cents, line: avg7[i]! }))} />}
        </Panel>
        <Panel title={t("dash.fees.byMethod")} subtitle={t("dash.fees.byMethod.sub")}>
          {methods.length === 0 || methodTotal === 0 ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <DonutStat label={t("dash.fees.byMethod")} center={compactMoney(methodTotal)} caption={school.currency} segments={methods} />}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {byClass && (
          <Panel title={t("dash.fees.byClass")} subtitle={t("dash.fees.byClass.sub")} className="lg:col-span-2" right={<Link href="/finance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <DashTable empty={byClass.length === 0 ? t("dash.fees.byClass.none") : undefined} min="40rem" head={[{ label: t("learn.class") }, { label: t("dash.attToday.students"), right: true }, { label: t("fin.billed"), right: true }, { label: t("dash.fees.received"), right: true }, { label: t("dash.kpi.outstanding"), right: true }, { label: "%" }]}>
              {byClass.map((r) => (
                <tr key={r.classId}><Cell className="font-semibold text-ink">{r.className}</Cell><Cell right>{r.students}</Cell><Cell right className="whitespace-nowrap">{money(r.billed)}</Cell><Cell right className="whitespace-nowrap">{money(r.paid)}</Cell><Cell right className={`whitespace-nowrap ${r.outstanding > 0 ? "text-bad" : ""}`}>{money(r.outstanding)}</Cell><Cell className="w-36"><span className="flex items-center gap-2"><span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${r.ratePct ?? 0}%`, background: (r.ratePct ?? 0) >= 70 ? "var(--color-ok)" : (r.ratePct ?? 0) >= 40 ? "var(--color-warn)" : "var(--color-bad)" }} /></span><span className="w-10 text-right tabular-nums">{r.ratePct === null ? "—" : `${r.ratePct}%`}</span></span></Cell></tr>
              ))}
            </DashTable>
          </Panel>
        )}
        <Panel title={t("dash.fees.invoices")} subtitle={t("dash.fees.invoices.sub")} className={byClass ? "" : "lg:col-span-3"}>
          {fin.invoices.total === 0 ? <EmptyLine>{t("fin.reports.noArrears")}</EmptyLine> : <StageBar label={t("dash.fees.invoices")} summary={t("dash.fees.invoices.sub")} items={[{ label: t("dash.money.state.paid"), value: fin.invoices.paid, color: STAGE.ok }, { label: t("dash.money.state.partial"), value: fin.invoices.partial, color: STAGE.sun }, { label: t("dash.money.state.unpaid"), value: fin.invoices.unpaid, color: STAGE.bad }, ...(fin.invoices.noCharge > 0 ? [{ label: t("dash.money.state.noCharge"), value: fin.invoices.noCharge, color: STAGE.muted }] : [])]} />}
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title={t("dash.finance.arrears")} subtitle={t("dash.fees.arrears.sub")} right={<Link href="/finance/reports" className="text-sm font-semibold text-link hover:underline">{t("dash.finance.allArrears")}</Link>}>
          <DashTable empty={fin.topArrears.length === 0 ? t("fin.reports.noArrears") : undefined} min="26rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("dash.kpi.outstanding"), right: true }]}>
            {fin.topArrears.map((a) => (
              <tr key={a.studentId}><Cell><Link href={`/finance/students/${a.studentId}`} className="hover:opacity-90"><PersonCell name={a.name} sub={a.admissionNo} /></Link></Cell><Cell>{a.className ?? "—"}</Cell><Cell right><span className="font-semibold text-bad">{money(a.outstanding)}</span>{a.overdue > 0 && <span className="block text-xs text-bad">{t("dash.finance.overdueAmount", { amount: money(a.overdue) })}</span>}</Cell></tr>
            ))}
          </DashTable>
        </Panel>
        {payments && (
          <Panel title={t("dash.fees.recent")} subtitle={t("dash.fees.recent.sub")} right={<Link href="/finance/payments" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <DashTable empty={payments.length === 0 ? t("dash.finance.noPayments") : undefined} min="30rem" head={[{ label: t("learn.student") }, { label: t("fin.method") }, { label: t("audit.when") }, { label: t("fin.amount"), right: true }]}>
              {payments.map((p) => (
                <tr key={p.id}><Cell><Link href={`/finance/students/${p.studentId}`} className="hover:opacity-90"><PersonCell name={p.name} sub={p.receipt ?? p.admissionNo} /></Link></Cell><Cell>{t(`fin.method.${p.method}` as "fin.method.CASH")}</Cell><Cell className="whitespace-nowrap text-muted">{displayDate(p.receivedOn, locale)}</Cell><Cell right className="font-semibold text-ok">+{money(p.cents)}</Cell></tr>
              ))}
            </DashTable>
          </Panel>
        )}
      </div>
    </DashSection>
  );
}

export function ResultsSection({ env }: { env: DashEnv }) {
  const { t, d } = env;
  const ex = d.exams;
  if (!ex) return null;
  const locked = ex.total > 0 ? Math.round((ex.byStatus.LOCKED / ex.total) * 100) : null;
  return (
    <DashSection id="results" title={t("dash.sec.results")} subtitle={t("dash.sec.results.sub")}>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t("dash.exams.title")} subtitle={t("dash.exams.sub", { term: ex.term.name, total: ex.total })} right={<Link href="/marks" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
          {ex.total === 0 ? <EmptyLine>{t("dash.exams.none")}</EmptyLine> : (
            <div className="flex flex-wrap items-center gap-6">
              <Ring value={locked} size={124} stroke={9} tone="indigo" label={t("marks.status.LOCKED")}>
                <span><span className="block text-3xl font-semibold tabular-nums text-heading">{locked}%</span><span className="block text-[10px] font-bold uppercase tracking-[.14em] text-muted">{t("marks.status.LOCKED")}</span></span>
              </Ring>
              <div className="min-w-[15rem] flex-1">
                <StageBar label={t("dash.exams.title")} summary={t("dash.exams.summary")} items={[{ label: t("marks.status.DRAFT"), value: ex.byStatus.DRAFT, color: STAGE.muted }, { label: t("marks.status.RETURNED"), value: ex.byStatus.RETURNED, color: STAGE.sun }, { label: t("marks.status.SUBMITTED"), value: ex.byStatus.SUBMITTED, color: STAGE.sky }, { label: t("marks.status.APPROVED"), value: ex.byStatus.APPROVED, color: STAGE.violet }, { label: t("marks.status.LOCKED"), value: ex.byStatus.LOCKED, color: STAGE.ok }]} />
              </div>
            </div>
          )}
        </Panel>
        {ex.mine.length > 0 && (
          <Panel title={t("dash.exams.mine")} subtitle={t("dash.exams.mine.sub")}>
            <DashTable min="28rem" head={[{ label: t("learn.subject") }, { label: t("learn.class") }, { label: t("dash.exams.progress"), right: true }, { label: t("common.status") }]}>
              {ex.mine.map((m) => <tr key={m.id}><Cell><Link href={`/marks/${m.id}`} className="font-semibold text-link hover:underline">{m.subjectName}</Link><span className="block text-xs text-muted">{m.examName}</span></Cell><Cell>{m.className}{m.streamName ? ` ${m.streamName}` : ""}</Cell><Cell right>{m.entered}/{m.roster}</Cell><Cell>{m.overdue ? <Pill tone="bad">{t("marks.overdue")}</Pill> : <Pill tone={m.status === "RETURNED" ? "warn" : "neutral"}>{t(`marks.status.${m.status}` as "marks.status.DRAFT")}</Pill>}</Cell></tr>)}
            </DashTable>
          </Panel>
        )}
      </div>
    </DashSection>
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

export function AdmissionsSection({ env }: { env: DashEnv }) {
  const { t, locale, fmtDay, d } = env;
  const apps = env.o.applications;
  const pipelineTotal = d.pipeline?.reduce((n, p) => n + p.value, 0) ?? 0;
  const COLOR: Record<string, string> = { APPLIED: STAGE.sky, INTERVIEW: STAGE.violet, ACCEPTED: STAGE.sun, ENROLLED: STAGE.ok, REJECTED: STAGE.bad, WITHDRAWN: STAGE.muted };
  const last30 = apps ? apps.reduce((n, p) => n + p.count, 0) : 0;
  return (
    <>
      {(d.pipeline || d.recentApplications) && (
        <DashSection id="admissions" title={t("dash.sec.admissions")} subtitle={t("dash.sec.admissions.sub")}>
          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            {d.pipeline && (
              <Panel title={t("dash.chart.pipeline")} subtitle={t("dash.chart.pipeline.sub", { total: pipelineTotal })} right={<Link href="/admissions" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.pipeline.link")}</Link>}>
                {pipelineTotal === 0 ? <EmptyLine>{t("dash.chart.pipeline.empty")}</EmptyLine> : <StageBar items={d.pipeline.map((p) => ({ label: t(`adm.status.${p.label}` as "adm.status.APPLIED"), value: p.value, color: COLOR[p.label] ?? STAGE.muted }))} label={t("dash.chart.pipeline")} summary={t("dash.chart.pipeline.summary")} />}
              </Panel>
            )}
            {apps && (
              <Panel title={t("dash.apps.daily")} subtitle={t("dash.apps.daily.sub")}>
                {last30 === 0 ? <EmptyLine>{t("dash.chart.pipeline.empty")}</EmptyLine> : <AreaChart tone="sky" height={230} label={t("dash.apps.daily")} summary={t("dash.apps.daily.sub")} periodLabel={t("dash.period.label")} periods={periods(t, [7, 14, 30])} points={apps.map((p) => ({ key: p.date, label: fmtDay(p.date), value: p.count }))} />}
              </Panel>
            )}
            {d.recentApplications && (
              <Panel title={t("dash.table.applications")} className="lg:col-span-2" right={<Link href="/admissions" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
                <DashTable empty={d.recentApplications.length === 0 ? t("dash.table.applications.empty") : undefined} min="28rem" head={[{ label: t("adm.applicant") }, { label: t("adm.classApplied") }, { label: t("common.status") }, { label: t("adm.appliedOn") }]}>
                  {d.recentApplications.map((a) => (
                    <tr key={a.id}><Cell><Link href={`/admissions/${a.id}`} className="hover:opacity-90"><PersonCell name={`${a.firstName} ${a.lastName}`} sub={`${a.applicationNo}${a.source === "ONLINE" ? ` · ${t("adm.online")}` : ""}`} /></Link></Cell><Cell>{a.className ?? "—"}</Cell><Cell><Badge tone={STATUS_TONE[a.status]}>{t(`adm.status.${a.status}` as "adm.status.APPLIED")}</Badge></Cell><Cell className="whitespace-nowrap text-muted">{displayDate(a.createdAt, locale)}</Cell></tr>
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


/** Accounts grouped by what the person does: role, what it is for, and how many are active. */
export function PeopleSection({ env, accounts }: { env: DashEnv; accounts: Awaited<ReturnType<typeof import("@/server/admin-home").accountsByRole>> | null }) {
  const { t } = env;
  if (!accounts || accounts.length === 0) return null;
  const total = accounts.reduce((n, r) => n + r.total, 0), active = accounts.reduce((n, r) => n + r.active, 0);
  return (
    <DashSection id="people" title={t("dash.sec.people")} subtitle={t("dash.sec.people.sub")}>
      <Panel title={t("dash.people.title")} subtitle={t("dash.people.sub")} right={<Link href="/users" className="text-sm font-semibold text-link hover:underline">{t("acts.users")}</Link>}>
        <ul className="-mx-5 grid divide-y divide-line border-t border-line md:grid-cols-2 md:divide-y-0">
          {accounts.map((r) => (
            <li key={r.key} className="flex items-center gap-4 px-5 py-3.5 md:border-b md:border-line md:odd:border-r">
              <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">{r.name}</span>{r.description && <span className="block truncate text-xs text-muted">{r.description}</span>}</span>
              <Pill tone={r.active > 0 ? "ok" : "neutral"}>{t("dash.people.active", { n: r.active })}</Pill>
              <span className="w-8 text-right text-2xl font-semibold tabular-nums text-heading">{r.total}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">{t("dash.people.all", { n: total, active })}</p>
      </Panel>
    </DashSection>
  );
}
