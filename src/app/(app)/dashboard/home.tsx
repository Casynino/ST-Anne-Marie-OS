import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CheckCircle2, Circle, History } from "lucide-react";
import { displayDate, displayDateTime } from "@/lib/dates";
import { AttentionTabs, type AttentionRow } from "@/components/dash/attention-tabs";
import { AreaChart, BarLineChart } from "@/components/dash/charts-client";
import { Cell, DashTable, DeskCard, DonutStat, EmptyLine, HBars, Panel, PersonCell, Pill, SERIES_COLORS, StackedBars } from "@/components/dash/parts";
import { RateBars, Ring, Spark, StageBar } from "@/components/dash/viz";
import type { adminHome } from "@/server/admin-home";
import { compactMoney, type DashEnv } from "./sections";

/*
 * The panels of the staff home pages. Each one shows ONE thing, once: a figure that is on the headline row is not repeated in a chart below it,
 * a class appears in one table (not in three pictures), and a panel with nothing to show is left out or collapses to one line. The roles
 * (administrator, head teacher, accountant, registrar) differ only in which panels they get and in what order.
 */

const rateOf = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
const STATUS_COLOR = { PRESENT: "#2fd08f", LATE: "#f3b94c", EXCUSED: "#8b80ff", ABSENT: "#ff8574", NOT_MARKED: "#4b5a52" } as const;
const SEVERITY: Record<string, "bad" | "warn" | "info"> = { failedNotifications: "bad", backupStale: "bad", marksOverdue: "bad", unmatchedPayments: "warn", newEnquiries: "info", newApplications: "info", messagesWaiting: "info" };

const More = ({ href, label }: { href: string; label: string }) => <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{label}<ArrowRight className="size-4" aria-hidden /></Link>;
const Mini = ({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" }) => (
  <div className="min-w-0 rounded-lg bg-canvas/60 px-3 py-2.5">
    <dt className="truncate text-xs text-muted">{label}</dt>
    <dd className={`mt-0.5 truncate text-[15px] font-semibold tabular-nums ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</dd>
  </div>
);
const Quiet = ({ children }: { children: ReactNode }) => <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="size-4 shrink-0" aria-hidden />{children}</p>;

export { Row, W, N, H, T } from "@/components/dash/rows";

// ───────────────────────── What needs doing ─────────────────────────

export function AttentionPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d } = env;
  if (d.attention.length === 0) return <Panel title={t("dash.attention.title")} className={className}><Quiet>{t("home.clear")}</Quiet></Panel>;
  const rows: AttentionRow[] = d.attention.map((a) => ({ key: a.key, area: a.area, href: a.href, tone: SEVERITY[a.key], text: t(`dash.attention.${a.key}` as "dash.attention.none", { count: a.count }) }));
  return <AttentionTabs className={className} title={t("dash.attention.title")} subtitle={t("dash.attention.count", { n: d.attention.length })} allLabel={t("dash.attention.all")} areas={(["attendance", "admissions", "finance", "results", "messages", "system"] as const).map((x) => ({ id: x, label: t(`dash.area.${x}`) }))} rows={rows} />;
}

/** Set-up that is not finished yet, as one slim banner (a finished set-up shows nothing). */
export function SetupBanner({ env, setup }: { env: DashEnv; setup: Awaited<ReturnType<typeof adminHome>> | null }) {
  const { t } = env;
  if (!setup || setup.doneCount >= setup.items.length) return null;
  const todo = setup.items.filter((i) => !i.done);
  return (
    <section aria-label={t("setup.title")} className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-warn/35 bg-warn/10 px-5 py-4">
      <Ring value={Math.round((setup.doneCount / setup.items.length) * 100)} size={52} stroke={12} tone="warn" label={t("setup.ring")}><span className="text-[11px] font-semibold tabular-nums text-ink">{setup.doneCount}/{setup.items.length}</span></Ring>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{t("home.setup.banner", { done: setup.doneCount, total: setup.items.length })}</p>
        <ul className="mt-2 flex flex-wrap gap-2">{todo.slice(0, 5).map((i) => <li key={i.key}><Link href={i.href} className="btn-secondary inline-flex min-h-9 items-center gap-2 px-3 text-sm"><Circle className="size-3.5 text-warn" aria-hidden />{t(`setup.${i.key}`)}<span className="text-muted">· {t(`setup.by.${i.key}`)}</span></Link></li>)}</ul>
        <p className="mt-2 text-sm text-muted">{t("home.setup.who")} <Link href="/step-in" className="font-medium text-link underline-offset-2 hover:underline">{t("step.link")}</Link></p>
      </div>
    </section>
  );
}

// ───────────────────────── Attendance ─────────────────────────

/** Today in one picture: the share present, what the registers say, and who is absent (or one calm line when nobody is). */
export function TodayPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d, o } = env;
  const rows = d.attendanceByClass;
  if (!rows || rows.length === 0) return null;
  const sum = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, open: 0 };
  let finalised = 0;
  for (const r of rows) { if (r.status === "FINALISED") { finalised++; sum.PRESENT += r.counts.PRESENT; sum.LATE += r.counts.LATE; sum.EXCUSED += r.counts.EXCUSED; sum.ABSENT += r.counts.ABSENT; } else sum.open += r.students; }
  const rate = rateOf(d.kpis.find((k) => k.key === "attendanceToday")?.value);
  const legend = [[t("att.status.PRESENT"), sum.PRESENT, STATUS_COLOR.PRESENT], [t("att.status.LATE"), sum.LATE, STATUS_COLOR.LATE], [t("att.status.EXCUSED"), sum.EXCUSED, STATUS_COLOR.EXCUSED], [t("att.status.ABSENT"), sum.ABSENT, STATUS_COLOR.ABSENT], [t("dash.classes.notMarked"), sum.open, STATUS_COLOR.NOT_MARKED]] as const;
  const absent = o.absent;
  return (
    <Panel className={className} title={t("home.today")} subtitle={t("home.today.sub", { done: finalised, total: rows.length })} right={<More href="/attendance" label={t("dash.registers.open")} />}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Ring value={rate} size={116} stroke={11} tone={rate !== null && rate >= 90 ? "ok" : "warn"} label={t("home.today")}>
          <span><span className="block text-[1.7rem] font-semibold tabular-nums text-heading">{rate === null ? "—" : `${rate}%`}</span><span className="block text-[11px] text-muted">{t("dash.classes.caption")}</span></span>
        </Ring>
        <ul className="min-w-[10rem] flex-1 space-y-1.5 text-sm">
          {legend.map(([label, value, color]) => <li key={label} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: color }} />{label}</span><span className="font-semibold tabular-nums">{value}</span></li>)}
        </ul>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        {!absent || (absent.total === 0 && finalised === 0) ? <p className="text-sm text-muted">{t("home.noRegisters")}</p>
          : absent.total === 0 ? <Quiet>{t("home.noAbsent")}</Quiet>
          : (
            <>
              <p className="mb-2 text-sm font-medium text-ink">{t("dash.absent.sub", { n: absent.total })}</p>
              <ul className="space-y-2">{absent.rows.slice(0, 4).map((r) => <li key={r.studentId}><Link href={`/students/${r.studentId}`} className="block hover:opacity-90"><PersonCell name={r.name} sub={r.className} /></Link></li>)}</ul>
            </>
          )}
      </div>
    </Panel>
  );
}

export function AttendanceTrendPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
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
    <Panel className={`flex flex-col ${className}`} title={t("home.attendance14")} subtitle={t("dash.pulse.attendance.sub")} right={<More href="/attendance/reports" label={t("dash.chart.attendance.link")} />}>
      <AreaChart height={230} label={t("home.attendance14")} summary={t("dash.pulse.attendance.sub")} kind="percent" yMin={floor} yMax={100} goal={{ value: 90, label: t("dash.pulse.goal", { n: 90 }) }} points={tr.map((p) => ({ key: p.date, label: fmtDay(p.date), value: p.rate }))} />
      <dl className="mt-auto grid grid-cols-2 gap-2.5 pt-4 sm:grid-cols-4">
        <Mini label={t("dash.pulse.latest")} value={`${last.rate}%`} tone={last.rate >= 90 ? "ok" : "warn"} />
        <Mini label={t("dash.pulse.avg")} value={`${avg}%`} />
        <Mini label={t("dash.pulse.best")} value={`${best.rate}% · ${fmtDay(best.date)}`} tone="ok" />
        <Mini label={t("dash.pulse.low")} value={`${low.rate}% · ${fmtDay(low.date)}`} tone={low.rate >= 90 ? "ok" : low.rate >= 80 ? "warn" : "bad"} />
      </dl>
    </Panel>
  );
}

// ───────────────────────── Classes ─────────────────────────

/** Every class that has students, once: how many, how full, and whether today's register is done. Replaces the class tiles, the fill bars and the enrolment chart. */
export function ClassesPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d, o } = env;
  const gender = o.byGender;
  if (!gender || gender.length === 0) return null;
  const capacity = new Map((o.fill ?? []).map((f) => [f.name, f.capacity]));
  const regs = d.attendanceByClass ?? [];
  const rows = gender.filter((c) => c.female + c.male > 0).map((c) => {
    const mine = regs.filter((r) => r.className === c.name);
    const done = mine.filter((r) => r.status === "FINALISED");
    const rates = done.map((r) => r.rate).filter((x): x is number => x !== null);
    return { id: c.classId, name: c.name, girls: c.female, boys: c.male, total: c.female + c.male, cap: capacity.get(c.name) ?? null, streams: mine.length, done: done.length, rate: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null };
  });
  return (
    <Panel className={className} title={t("home.classes.title")} subtitle={t("home.classes.sub", { n: rows.reduce((n, r) => n + r.total, 0) })} right={<More href="/students" label={t("dash.table.viewAll")} />}>
      <DashTable min="30rem" head={[{ label: t("learn.class") }, { label: t("dash.attToday.students") }, { label: t("home.col.register") }, { label: t("att.status.PRESENT"), right: true }]}>
        {rows.map((r) => {
          return (
            <tr key={r.id}>
              <Cell className="font-medium text-ink"><Link href={`/students?classId=${r.id}`} className="hover:text-link hover:underline">{r.name}</Link></Cell>
              <Cell><span className="font-semibold tabular-nums">{r.total}</span><span className="ml-2 text-xs text-muted">{r.girls}♀ {r.boys}♂</span></Cell>
              <Cell>{r.streams === 0 ? <span className="text-muted">—</span> : r.done === r.streams ? <Pill tone="ok">{t("home.reg.done")}</Pill> : r.done > 0 ? <Pill tone="warn">{t("home.reg.some", { done: r.done, total: r.streams })}</Pill> : <Pill tone="neutral">{t("home.reg.none")}</Pill>}</Cell>
              <Cell right className={r.rate !== null && r.rate < 85 ? "text-warn" : ""}>{r.rate === null ? "—" : `${r.rate}%`}</Cell>
            </tr>
          );
        })}
      </DashTable>
    </Panel>
  );
}

// ───────────────────────── The students, in pictures ─────────────────────────

/** Every class with its girls and boys, as stacked bars. */
export function EnrollmentPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, o } = env;
  const by = o.byGender;
  if (!by) return null;
  const total = by.reduce((n, c) => n + c.female + c.male, 0);
  return (
    <Panel className={className} title={t("dash.chart.enrollment")} subtitle={t("dash.chart.enrollment.sub", { total })} right={<More href="/students" label={t("dash.chart.enrollment.link")} />}>
      {by.length === 0 ? <EmptyLine>{t("dash.chart.enrollment.empty")}</EmptyLine> : <StackedBars points={by.map((c) => ({ key: c.classId, label: c.name, parts: { female: c.female, male: c.male } }))} series={[{ key: "female", label: t("student.female") }, { key: "male", label: t("student.male"), color: "#e0a100" }]} every={by.length > 9 ? 2 : 1} label={t("dash.chart.enrollment")} summary={t("dash.chart.enrollment.summary")} />}
    </Panel>
  );
}

export function GenderPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d } = env;
  const girls = d.gender?.FEMALE ?? 0, boys = d.gender?.MALE ?? 0;
  if (girls + boys === 0) return null;
  return (
    <Panel className={className} title={t("dash.gender.title")} subtitle={t("dash.gender.sub")}>
      <DonutStat label={t("dash.gender.title")} center={(girls + boys).toLocaleString()} caption={t("dash.kpi.enrolled")} segments={[{ label: t("student.female"), value: girls, color: "#0f9462", text: `${girls} · ${Math.round((girls / (girls + boys)) * 100)}%` }, { label: t("student.male"), value: boys, color: "#e0a100", text: `${boys} · ${Math.round((boys / (girls + boys)) * 100)}%` }]} />
    </Panel>
  );
}

/** Present, late, excused and absent for each of the last 14 days, as stacked bars. */
export function AttendanceDailyPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, fmtDay, o } = env;
  const daily = o.attDaily;
  if (!daily) return null;
  return (
    <Panel className={className} title={t("dash.chart.attendance")} subtitle={t("dash.chart.attendance.sub")} right={<More href="/attendance/reports" label={t("dash.chart.attendance.link")} />}>
      {daily.every((p) => Object.keys(p.parts).length === 0) ? <EmptyLine>{t("dash.chart.attendance.empty")}</EmptyLine> : <StackedBars points={daily.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "PRESENT", label: t("att.status.PRESENT") }, { key: "LATE", label: t("att.status.LATE"), color: "#e0a100" }, { key: "EXCUSED", label: t("att.status.EXCUSED"), color: "#4f46e5" }, { key: "ABSENT", label: t("att.status.ABSENT"), color: "#e5604d" }]} label={t("dash.chart.attendance")} summary={t("dash.chart.attendance.sub")} />}
    </Panel>
  );
}

/** Who is marked absent today (a calm line, with how many registers are done, when nobody is). */
export function AbsentPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d, o } = env;
  const absent = o.absent;
  if (!absent) return null;
  const regs = d.attendanceByClass ?? [];
  const done = regs.filter((r) => r.status === "FINALISED").length;
  return (
    <Panel className={className} title={t("dash.absent.title")} subtitle={absent.total === 0 ? t("dash.absent.none") : t("dash.absent.sub", { n: absent.total })}>
      {absent.rows.length === 0 ? (
        <div className="space-y-4">
          <Quiet>{t("dash.absent.none")}</Quiet>
          {regs.length > 0 && <dl className="grid grid-cols-2 gap-2.5"><Mini label={t("home.today")} value={`${done}/${regs.length}`} tone={done === regs.length ? "ok" : "warn"} /><Mini label={t("dash.classes.notMarked")} value={regs.filter((r) => r.status !== "FINALISED").reduce((n, r) => n + r.students, 0)} /></dl>}
        </div>
      ) : (
        <DashTable min="24rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("dash.absent.note") }]}>
          {absent.rows.map((r) => <tr key={r.studentId}><Cell><Link href={`/students/${r.studentId}`} className="hover:opacity-90"><PersonCell name={r.name} sub={r.admissionNo} /></Link></Cell><Cell>{r.className}</Cell><Cell className="text-muted">{r.note ?? "—"}</Cell></tr>)}
        </DashTable>
      )}
    </Panel>
  );
}

/** How full each class is against its capacity. */
export function FillPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, o } = env;
  const fill = o.fill;
  if (!fill || fill.length === 0) return null;
  return (
    <Panel className={className} title={t("dash.fill.title")} subtitle={t("dash.fill.sub")}>
      <RateBars mode="fill" label={t("dash.fill.title")} summary={t("dash.fill.sub")} items={fill.map((c) => ({ label: c.name, value: Math.round((c.count / c.capacity) * 100), note: t("dash.cap.of", { n: c.count, cap: c.capacity }) }))} />
    </Panel>
  );
}

// ───────────────────────── Money ─────────────────────────

/**
 * The money, as one wide card (the Swift Cargo director's "The money"): what was collected this term with the collection ring and the
 * billed / owed / overdue lines on the left, and what came in today, this week and this month on the right. Same figures as the fees
 * screens; nothing is added up here that the finance service does not already give.
 */
export function MoneyCard({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, money, d } = env;
  const fin = d.finance;
  if (!fin) return null;
  const rate = fin.ratePct;
  const row = (label: string, value: string, tone?: "ok" | "warn" | "bad", sub?: string) => (
    <li key={label} className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-t-0">
      <span className="text-sm text-muted">{label}{sub && <span className="ml-2 text-xs">{sub}</span>}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</span>
    </li>
  );
  return (
    <section aria-label={t("dash.sec.fees")} className={`min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] ${className}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h3 className="text-[15px] font-semibold text-ink">{t("dash.sec.fees")} <span className="font-normal text-muted">· {fin.term.name}</span></h3>
        <More href="/finance" label={t("dash.kpi.open")} />
      </header>
      <div className="grid lg:grid-cols-[1.25fr_1fr]">
        <div className="p-5">
          <p className="text-xs text-muted">{t("dash.money.sub")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-heading sm:text-4xl">{money(fin.collected)}</p>
          <div className="mt-4 flex flex-wrap items-center gap-6">
            <Ring value={rate} size={116} stroke={10} tone={rate !== null && rate >= 70 ? "ok" : "warn"} label={t("dash.fees.rate")}>
              <span><span className="block text-2xl font-semibold tabular-nums text-heading">{rate === null ? "—" : `${rate}%`}</span><span className="block text-[10px] font-medium text-muted">{t("dash.money.ofBilled")}</span></span>
            </Ring>
            <ul className="min-w-[14rem] flex-1">
              {row(t("dash.money.billed"), money(fin.billed))}
              {row(t("dash.money.outstanding"), money(fin.outstanding), fin.outstanding > 0 ? "warn" : "ok")}
              {row(t("dash.money.overdue"), money(fin.overdue), fin.overdue > 0 ? "bad" : "ok")}
              {row(t("dash.money.credit"), money(fin.credit))}
              {row(t("dash.money.expenses"), money(fin.expenses))}
            </ul>
          </div>
        </div>
        <div className="border-t border-line p-5 lg:border-l lg:border-t-0">
          <p className="text-xs text-muted">{t("dash.money.received")}</p>
          <ul className="mt-1">
            {row(t("dash.money.received.today"), money(fin.received.today), "ok")}
            {row(t("dash.money.received.week"), money(fin.received.week), "ok")}
            {row(t("dash.money.received.month"), money(fin.received.month), "ok")}
            {row(t("dash.money.admission"), money(fin.admissionFees.verified), undefined, fin.admissionFees.pending > 0 ? t("dash.money.admission.pending", { amount: money(fin.admissionFees.pending) }) : undefined)}
            {row(t("dash.money.application"), money(fin.admissionFees.application))}
            {row(t("dash.money.dueSoon"), money(fin.dueSoon.amount), fin.dueSoon.amount > 0 ? "warn" : "ok", t("dash.money.dueSoon.n", { n: fin.dueSoon.students }))}
            {row(t("dash.money.net"), money(fin.netOperating), fin.netOperating < 0 ? "bad" : "ok")}
          </ul>
        </div>
      </div>
      <p className="border-t border-line px-5 py-2 text-xs text-muted">{t("dash.money.net.note")}</p>
    </section>
  );
}

// ───────────────────────── Admissions ─────────────────────────

const STAGE = { sky: "#14a3b8", violet: "#8b80ff", sun: "#f3b94c", ok: "#2fd08f", bad: "#ff8574", muted: "#4b5a52" } as const;
const STATUS_TONE = { APPLIED: "brand", INTERVIEW: "brand", ACCEPTED: "warn", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;

export function AdmissionsPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d } = env;
  if (!d.pipeline && !d.recentApplications) return null;
  const total = d.pipeline?.reduce((n, p) => n + p.value, 0) ?? 0;
  const COLOR: Record<string, string> = { APPLIED: STAGE.sky, INTERVIEW: STAGE.violet, ACCEPTED: STAGE.sun, ENROLLED: STAGE.ok, REJECTED: STAGE.bad, WITHDRAWN: STAGE.muted };
  return (
    <Panel className={className} title={t("dash.sec.admissions")} subtitle={t("dash.chart.pipeline.sub", { total })} right={<More href="/admissions" label={t("dash.chart.pipeline.link")} />}>
      {d.pipeline && total > 0 && <StageBar items={d.pipeline.filter((p) => p.value > 0).map((p) => ({ label: t(`adm.status.${p.label}` as "adm.status.APPLIED"), value: p.value, color: COLOR[p.label] ?? STAGE.muted }))} label={t("dash.chart.pipeline")} summary={t("dash.chart.pipeline.sub", { total })} />}
      {d.recentApplications && d.recentApplications.length > 0 ? (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {d.recentApplications.slice(0, 4).map((a) => (
            <li key={a.id}><Link href={`/admissions/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={`${a.firstName} ${a.lastName}`} sub={`${a.className ?? "—"} · ${a.applicationNo}`} /><Pill tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`adm.status.${a.status}` as "adm.status.APPLIED")}</Pill></Link></li>
          ))}
        </ul>
      ) : total === 0 ? <EmptyLine>{t("dash.chart.pipeline.empty")}</EmptyLine> : null}
    </Panel>
  );
}

// ───────────────────────── Results, learning, people ─────────────────────────

export function ResultsPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, d } = env;
  const ex = d.exams;
  if (!ex || ex.total === 0) return null;
  const locked = Math.round((ex.byStatus.LOCKED / ex.total) * 100);
  return (
    <Panel className={className} title={t("dash.exams.title")} subtitle={t("dash.exams.sub", { term: ex.term.name, total: ex.total })} right={<More href="/marks" label={t("dash.kpi.open")} />}>
      <div className="flex flex-wrap items-center gap-5">
        <Ring value={locked} size={96} stroke={11} tone="indigo" label={t("marks.status.LOCKED")}><span><span className="block text-xl font-semibold tabular-nums text-heading">{locked}%</span><span className="block text-[10px] text-muted">{t("marks.status.LOCKED")}</span></span></Ring>
        <ul className="min-w-[9rem] flex-1 space-y-1.5 text-sm">
          {([["DRAFT", "#4b5a52"], ["RETURNED", "#ff8574"], ["SUBMITTED", "#f3b94c"], ["APPROVED", "#14a3b8"], ["LOCKED", "#2fd08f"]] as const).map(([k, c]) => <li key={k} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: c }} />{t(`marks.status.${k}` as "marks.status.DRAFT")}</span><span className="font-semibold tabular-nums">{ex.byStatus[k]}</span></li>)}
        </ul>
      </div>
    </Panel>
  );
}

export function LearningPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, fmtDay } = env;
  const { homework, behaviour } = env.o;
  if (!homework && !behaviour) return null;
  return (
    <Panel className={className} title={t("dash.sec.learning")} subtitle={homework ? t("dash.hw.sub", { open: homework.open, overdue: homework.overdue }) : undefined} right={<More href="/assignments" label={t("dash.kpi.open")} />}>
      {homework && homework.rows.length > 0 ? (
        <ul className="divide-y divide-line">
          {homework.rows.slice(0, 4).map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><Link href={`/assignments/${r.id}`} className="min-w-0 hover:text-link"><span className="block truncate font-medium text-ink">{r.title}</span><span className="block truncate text-xs text-muted">{r.subjectName} · {r.className}</span></Link><span className="shrink-0 text-xs tabular-nums text-muted">{fmtDay(r.dueAt.toISOString().slice(0, 10))}</span></li>)}
        </ul>
      ) : <Quiet>{t("learn.asg.none")}</Quiet>}
      {behaviour && behaviour.total > 0 && <p className="mt-3 border-t border-line pt-3 text-sm text-muted">{t("dash.bh.sub", { n: behaviour.total })}</p>}
    </Panel>
  );
}

export function PeoplePanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t } = env;
  const roles = env.o.staffRoles;
  if (!roles || roles.length === 0) return null;
  return (
    <Panel className={className} title={t("dash.staff.title")} subtitle={t("dash.staff.sub")} right={<More href="/users" label={t("dash.table.viewAll")} />}>
      <HBars items={roles} label={t("dash.staff.title")} summary={t("dash.staff.sub")} tone={SERIES_COLORS[1]} />
    </Panel>
  );
}

// ───────────────────────── Activity and calendar ─────────────────────────

export function ActivityPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, locale, d, school } = env;
  if (!d.activity || d.activity.length === 0) return null;
  return (
    <Panel className={className} title={t("dash.table.activity")} subtitle={t("dash.sec.latest.sub")} right={<More href="/audit" label={t("dash.table.viewAll")} />}>
      <ol className="space-y-3">
        {d.activity.slice(0, 6).map((a, i, all) => (
          <li key={a.id} className="relative flex gap-3">
            {i < all.length - 1 && <span aria-hidden className="absolute left-[0.95rem] top-8 h-[calc(100%-0.25rem)] w-px bg-line" />}
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-canvas text-muted"><History className="size-4" aria-hidden /></span>
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{a.summary ?? a.action}</span><span className="block truncate text-xs text-muted">{a.actorName ?? t("audit.system")} · {displayDateTime(a.createdAt, school.timezone, locale)}</span></span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function CalendarPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, locale } = env;
  const events = env.o.events;
  if (!events || events.length === 0) return null;
  return (
    <Panel className={className} title={t("dash.events.title")} subtitle={t("dash.events.sub")} right={<More href="/school-calendar" label={t("dash.table.viewAll")} />}>
      <ul className="space-y-2.5">
        {events.slice(0, 5).map((e) => {
          const day = new Date(`${e.from}T00:00:00Z`);
          return (
            <li key={e.id} className="flex items-center gap-3">
              <span className="grid w-12 shrink-0 place-items-center rounded-lg bg-tint py-1.5 text-center leading-tight text-link"><span className="text-base font-semibold tabular-nums">{day.getUTCDate()}</span><span className="text-[10px] font-medium uppercase tracking-wide">{displayDate(day, locale).split(" ")[1] ?? ""}</span></span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</span><span className="block truncate text-xs text-muted">{e.category ?? ""}</span></span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ───────────────────────── The finance desk (accountant) ─────────────────────────

export function CollectionsPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, school, money, d } = env;
  const fin = d.finance;
  if (!fin) return null;
  const total30 = fin.trend.reduce((n, p) => n + p.cents, 0);
  const avg7 = fin.trend.map((_, i) => { const w = fin.trend.slice(Math.max(0, i - 6), i + 1); return Math.round(w.reduce((a, b) => a + b.cents, 0) / w.length); });
  return (
    <Panel className={className} title={t("dash.fees.daily")} subtitle={t("dash.finance.chart.sub", { total: money(total30) })} right={<More href="/finance/payments" label={t("dash.table.viewAll")} />}>
      {total30 === 0 ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <BarLineChart height={210} label={t("dash.fees.daily")} summary={t("dash.fees.daily.sub")} kind="money" currency={school.currency} barLabel={t("dash.kpi.collected")} lineLabel={t("dash.fees.avg7")} points={fin.trend.map((p, i) => ({ key: p.date, label: env.fmtDay(p.date), bar: p.cents, line: avg7[i]! }))} />}
    </Panel>
  );
}

export function MethodsPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, school, money } = env;
  const methods = (env.o.byMethod ?? []).map((m, i) => ({ label: t(`fin.method.${m.method}` as "fin.method.CASH"), value: m.cents, text: money(m.cents), color: SERIES_COLORS[i % SERIES_COLORS.length]! }));
  const total = methods.reduce((n, m) => n + m.value, 0);
  if (total === 0) return null;
  const compact = (cents: number) => { const n = cents / 100; return n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n)); };
  return (
    <Panel className={className} title={t("dash.fees.byMethod")} subtitle={t("dash.fees.byMethod.sub")}>
      <DonutStat label={t("dash.fees.byMethod")} center={compact(total)} caption={school.currency} segments={methods} />
    </Panel>
  );
}

export function ArrearsPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, money, d } = env;
  const fin = d.finance;
  if (!fin) return null;
  return (
    <Panel className={className} title={t("dash.finance.arrears")} subtitle={t("dash.fees.arrears.sub")} right={<More href="/finance/reports" label={t("dash.finance.allArrears")} />}>
      {fin.topArrears.length === 0 ? <Quiet>{t("fin.reports.noArrears")}</Quiet> : (
        <ul className="divide-y divide-line">
          {fin.topArrears.map((a) => <li key={a.studentId}><Link href={`/finance/students/${a.studentId}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={a.name} sub={`${a.className ?? "—"} · ${a.admissionNo}`} /><span className="shrink-0 text-right"><span className="block font-semibold tabular-nums text-warn">{money(a.outstanding)}</span>{a.overdue > 0 && <span className="block text-xs tabular-nums text-bad">{money(a.overdue)}</span>}</span></Link></li>)}
        </ul>
      )}
    </Panel>
  );
}

export function PaymentsPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, locale, money } = env;
  const payments = env.o.payments;
  if (!payments) return null;
  return (
    <Panel className={className} title={t("dash.fees.recent")} subtitle={t("dash.fees.recent.sub")} right={<More href="/finance/payments" label={t("dash.table.viewAll")} />}>
      {payments.length === 0 ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : (
        <ul className="divide-y divide-line">
          {payments.slice(0, 6).map((p) => <li key={p.id}><Link href={`/finance/students/${p.studentId}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={p.name} sub={`${t(`fin.method.${p.method}` as "fin.method.CASH")} · ${displayDate(p.receivedOn, locale)}`} /><span className="shrink-0 font-semibold tabular-nums text-ok">{money(p.cents)}</span></Link></li>)}
        </ul>
      )}
    </Panel>
  );
}

export function ClassCollectionPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, money } = env;
  const rows = env.o.byClass;
  if (!rows || rows.length === 0) return null;
  return (
    <Panel className={className} title={t("dash.fees.byClass")} subtitle={t("dash.fees.byClass.sub")} right={<More href="/finance/reports" label={t("dash.table.viewAll")} />}>
      <DashTable min="34rem" head={[{ label: t("learn.class") }, { label: t("fin.billed"), right: true }, { label: t("fin.collected"), right: true }, { label: t("fin.outstanding"), right: true }, { label: t("dash.fees.rate"), right: true }]}>
        {rows.map((r) => (
          <tr key={r.classId}>
            <Cell className="font-medium text-ink">{r.className}<span className="ml-2 text-xs text-muted">{r.students}</span></Cell>
            <Cell right className="whitespace-nowrap">{money(r.billed)}</Cell>
            <Cell right className="whitespace-nowrap text-ok">{money(r.paid)}</Cell>
            <Cell right className="whitespace-nowrap text-warn">{money(r.outstanding)}</Cell>
            <Cell right>{r.ratePct === null ? "—" : `${r.ratePct}%`}</Cell>
          </tr>
        ))}
      </DashTable>
    </Panel>
  );
}

export function InvoicesPanel({ env, className = "" }: { env: DashEnv; className?: string }) {
  const { t, money, d } = env;
  const fin = d.finance;
  if (!fin || fin.invoices.total === 0) return null;
  return (
    <Panel className={className} title={t("dash.fees.invoices")} subtitle={t("dash.fees.invoices.sub")}>
      <StageBar label={t("dash.fees.invoices")} summary={t("dash.fees.invoices.sub")} items={[
        { label: t("dash.money.state.paid"), value: fin.invoices.paid, color: "#2fd08f" }, { label: t("dash.money.state.partial"), value: fin.invoices.partial, color: "#f3b94c" },
        { label: t("dash.money.state.unpaid"), value: fin.invoices.unpaid, color: "#ff8574" }, { label: t("dash.money.state.noCharge"), value: fin.invoices.noCharge, color: "#4b5a52" },
      ]} />
      <dl className="mt-4 grid grid-cols-2 gap-2.5">
        <Mini label={t("dash.money.dueSoon")} value={money(fin.dueSoon.amount)} tone={fin.dueSoon.amount > 0 ? "warn" : "ok"} />
        <Mini label={t("dash.money.net")} value={money(fin.netOperating)} tone={fin.netOperating < 0 ? "bad" : "ok"} />
        <Mini label={t("dash.money.admission")} value={money(fin.admissionFees.verified)} />
        <Mini label={t("dash.money.application")} value={money(fin.admissionFees.application)} />
      </dl>
    </Panel>
  );
}

/** What each person has waiting (admissions, finance, academic): the queues as a row of tappable counters. */
export function QueueStrip({ env }: { env: DashEnv }) {
  const { t, adm } = env;
  if (adm.queues.length === 0) return null;
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label={t("adm.q.title")}>
      {adm.queues.map((q) => (
        <li key={q.key}>
          <Link href={q.href} className="group flex h-full flex-col justify-between gap-1 rounded-xl border border-line bg-surface px-4 py-3 shadow-[var(--shadow-card)] transition-[transform,border-color] hover:-translate-y-0.5 hover:border-link/40">
            <span className="text-sm text-muted">{t(`adm.q.${q.key}` as "adm.q.new")}</span>
            <span className="flex items-end justify-between"><span className="text-2xl font-semibold tabular-nums text-ink">{q.count}</span><ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Every desk, right now ─────────────────────────

/** One card per department the person may see: the number that matters most there, what it means, and the one thing to look at. */
export function DeskRow({ env }: { env: DashEnv }) {
  const { t, d, o, adm, money } = env;
  const cards: ReactNode[] = [];
  if (d.pipeline || adm.overview) {
    const waiting = d.pipeline?.find((p) => p.label === "APPLIED")?.value ?? 0;
    const iv = adm.overview?.interviews.upcoming ?? 0;
    cards.push(<DeskCard key="adm" tone="brand" href="/admissions" label={t("desk.admissions")} value={waiting} noun={t("desk.adm.noun")} note={t("desk.adm.note")} foot={iv > 0 ? { text: t("desk.adm.foot", { n: iv }), tone: "brand" } : { text: t("desk.adm.clear"), tone: "ok" }} />);
  }
  const regs = d.attendanceByClass;
  if (regs && regs.length > 0) {
    const done = regs.filter((r) => r.status === "FINALISED").length;
    const toApprove = d.exams?.toApprove ?? 0;
    cards.push(<DeskCard key="ac" tone="info" href="/attendance" label={t("desk.academic")} value={done} noun={t("desk.ac.noun")} note={t("desk.ac.note", { total: regs.length })} foot={toApprove > 0 ? { text: t("desk.ac.foot", { n: toApprove }), tone: "warn" } : { text: t("desk.ac.clear"), tone: "ok" }} />);
  }
  const f = d.finance;
  if (f) {
    const pct = f.billed > 0 ? Math.round((f.collected / f.billed) * 100) : 0;
    cards.push(<DeskCard key="fin" tone="warn" href="/finance" label={t("desk.finance")} value={compactMoney(f.outstanding)} noun={`${env.school.currency} ${t("desk.fin.noun")}`} note={t("desk.fin.note", { pct })} foot={f.overdue > 0 ? { text: t("desk.fin.foot", { amount: money(f.overdue) }), tone: "bad" } : { text: t("desk.fin.clear"), tone: "ok" }} />);
  }
  const hw = o.homework;
  if (hw) cards.push(<DeskCard key="teach" tone="ok" href="/assignments" label={t("desk.teaching")} value={hw.open} noun={t("desk.teach.noun")} note={t("desk.teach.note")} foot={hw.overdue > 0 ? { text: t("desk.teach.foot", { n: hw.overdue }), tone: "warn" } : { text: t("desk.teach.clear"), tone: "ok" }} />);
  if (cards.length === 0) return null;
  return (
    <section aria-label={t("desk.title")} className="mt-5">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[.16em] text-muted">{t("desk.title")}</h2>
      <ul className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">{cards.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </section>
  );
}
