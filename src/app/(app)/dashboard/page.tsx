import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { CalendarDays, ClipboardCheck, GraduationCap, Inbox, UserCog, UserPlus, ArrowRight, CheckCircle2, AlertTriangle, Wallet, FileCheck, Receipt } from "lucide-react";
import { db } from "@/lib/db";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getDashboard } from "@/server/dashboard";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { BarList, ChartCard, Donut, EmptyChart, TrendChart } from "@/components/charts";
import { CollectionsChart } from "@/components/finance/collections-chart";
import { formatMoney } from "@/lib/finance/money";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Td } from "@/components/ui";
import { Cell, DashSection, DashTable, DonutStat, EmptyLine, HBars, KpiCard, Panel, Pill, StackedBars, type PillTone } from "@/components/dash/parts";
import { DashHero, Hi } from "@/components/dash/hero";
import { AttentionTabs } from "@/components/dash/attention-tabs";
import { TeacherDashboard } from "./teacher";
import { teacherHome } from "@/server/teacher-home";
import * as ov from "@/server/school-overview";
import { classCollectionReport } from "@/server/finance-reports";

export const metadata: Metadata = { title: "Dashboard" };

const KPI_ICON = { enrolled: GraduationCap, pipeline: UserPlus, attendanceToday: ClipboardCheck, staff: UserCog, enquiries: Inbox, collected: Wallet, outstanding: Receipt, resultsLocked: FileCheck } as const;
const STATUS_TONE = { APPLIED: "brand", INTERVIEW: "brand", ACCEPTED: "warn", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;

function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  if (type === "Student") return `/students/${id}`;
  if (type === "Application") return `/admissions/${id}`;
  return null;
}

/** The data panels are extras: if one cannot be built (for example a migration has not run yet) the rest of the dashboard still loads. */
async function optional<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) { console.error(JSON.stringify({ level: "error", msg: "dashboard_panel_failed", panel: name, error: e instanceof Error ? e.message.slice(0, 300) : String(e) })); return null; }
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  const [d, school, roles] = await Promise.all([
    getDashboard(ctx),
    getSchoolBasics(ctx.schoolId),
    db.role.findMany({ where: { schoolId: ctx.schoolId, key: { in: [...ctx.roleKeys] } }, select: { name: true } }),
  ]);
  // School data panels: each is gated by the permission of its detail screen and fails alone, never the whole page.
  const [byGender, attDaily, absent, payments, byMethod, byClass, homework, behaviour, events, staffRoles] = await Promise.all([
    optional("students", () => ov.studentsByClassGender(ctx)),
    optional("attendance", () => ov.attendanceDaily(ctx)),
    optional("absent", () => ov.absentToday(ctx)),
    optional("payments", () => ov.recentPayments(ctx)),
    optional("methods", () => ov.collectionByMethod(ctx)),
    d.finance ? optional("classes", () => classCollectionReport(ctx, { termId: d.finance!.term.id })) : null,
    optional("homework", () => ov.homeworkOverview(ctx)),
    optional("behaviour", () => ov.behaviourDaily(ctx)),
    optional("events", () => ov.upcomingEvents(ctx)),
    optional("staff", () => ov.staffByRole(ctx)),
  ]);
  const can = (p: string) => ctx.permissions.has(p as never);
  const first = ctx.fullName.split(" ")[0] ?? ctx.fullName;
  const nothingToShow = d.kpis.length === 0 && !d.finance && !d.exams && !d.enrollmentByClass && !d.pipeline && !d.attendanceTrend && !d.recentApplications && !d.activity && d.myRegisters.length === 0;
  const pipelineTotal = d.pipeline?.reduce((n, p) => n + p.value, 0) ?? 0;
  const enrolTotal = d.enrollmentByClass?.reduce((n, p) => n + p.value, 0) ?? 0;
  const fmtDay = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), locale).slice(0, 6);
  const money = (c: number) => formatMoney(c, school.currency);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: school.timezone }).format(new Date()));
  const enrolled = d.kpis.find((k) => k.key === "enrolled");
  const summary: ReactNode[] = [
    ...(enrolled ? [<><Hi>{Number(enrolled.value).toLocaleString()}</Hi> {t("dash.hero.students")}</>] : []),
    ...(d.attendanceByClass && d.attendanceByClass.length > 0 ? [d.kpis.find((k) => k.key === "attendanceToday")?.value ? <>{t("dash.hero.attendance")} <Hi tone={parseInt(String(d.kpis.find((k) => k.key === "attendanceToday")!.value), 10) >= 90 ? "ok" : "warn"}>{String(d.kpis.find((k) => k.key === "attendanceToday")!.value)}</Hi></> : <>{t("dash.hero.noRegister")}</>] : []),
    ...(d.finance ? [<><Hi>{money(d.finance.collected)}</Hi> {t("dash.hero.received")}</>, ...(d.finance.outstanding > 0 ? [<><Hi tone="warn">{money(d.finance.outstanding)}</Hi> {t("dash.hero.owed")}</>] : [])] : []),
    ...(d.pipeline && (d.pipeline.find((p) => p.label === "APPLIED")?.value ?? 0) > 0 ? [<><Hi tone="warn">{d.pipeline.find((p) => p.label === "APPLIED")!.value}</Hi> {t("dash.hero.applications")}</>] : []),
  ];
  const chips = [
    d.attention.length > 0 && { id: "attention", label: t("dash.attention.title") },
    d.attendanceByClass && d.attendanceByClass.length > 0 && { id: "classes", label: t("dash.sec.classes") },
    d.kpis.length > 0 && { id: "school", label: t("dash.sec.school") },
    (byGender || attDaily || absent) && { id: "students", label: t("dash.sec.students") },
    d.finance && { id: "fees", label: t("dash.sec.fees") },
    (d.exams || d.pipeline || d.recentApplications) && { id: "results", label: t("dash.sec.results") },
    (homework || behaviour) && { id: "learning", label: t("dash.sec.learning") },
    (events || staffRoles) && { id: "calendar", label: t("dash.sec.calendar") },
    d.activity && { id: "latest", label: t("dash.sec.latest") },
  ].filter(Boolean) as { id: string; label: string }[];

  // A teacher (class or subject) has no school-wide student access: show their own day instead of the school overview.
  if (!can("student.read") && (can("attendance.take") || can("marks.enter") || can("assignments.manage"))) {
    const th = await teacherHome(ctx);
    return <TeacherDashboard t={t} locale={locale} first={first} hour={hour} schoolName={school.name} roleNames={roles.map((r) => r.name).join(" · ")} today={d.today} d={d} th={th} />;
  }

  return (
    <>
      <DashHero eyebrow={`${school.name} · ${roles.map((r) => r.name).join(" · ")}`.toUpperCase()} title={t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: first })}>
        {summary.length > 0 ? summary.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>) : t("dash.hero.empty")}
      </DashHero>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {can("student.create") && <LinkButton href="/students/new"><UserPlus className="size-4" aria-hidden /> {t("dash.registerStudent")}</LinkButton>}
        {can("admission.create") && <LinkButton href="/admissions/new" variant="secondary">{t("dash.newApplication")}</LinkButton>}
        {can("attendance.take") && <LinkButton href="/attendance" variant="secondary"><ClipboardCheck className="size-4" aria-hidden /> {t("dash.takeAttendance")}</LinkButton>}
        <span className="ml-auto inline-flex items-center gap-2 text-sm text-muted"><CalendarDays className="size-4" aria-hidden />{displayDate(new Date(`${d.today}T00:00:00Z`), locale)}{d.year ? ` · ${d.year.name}` : ""}{d.term ? ` · ${d.term.name}` : ""}</span>
      </div>
      {chips.length > 0 && (
        <nav aria-label={t("dash.jump")} className="mt-4 flex flex-wrap gap-2">
          {chips.map((c) => <a key={c.id} href={`#${c.id}`} className="inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:border-brand-500 hover:text-link">{c.label}</a>)}
        </nav>
      )}

      {d.needsSetup && (
        <Card className="mb-5 border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-warn">{t("dash.setup.title")}</h2>
          <p className="mb-3 mt-1 text-sm">{t("dash.setup.body")}</p>
          <LinkButton href="/academic-setup">{t("dash.setup.cta")}</LinkButton>
        </Card>
      )}

      {nothingToShow && <EmptyState><p className="font-semibold text-ink">{t("dash.empty.title")}</p><p className="mt-1">{t("dash.empty.body")}</p></EmptyState>}

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

      {d.attention.length > 0 && (
        <DashSection id="attention" title={t("dash.attention.title")} subtitle={t("dash.attention.count", { n: d.attention.length })}>
          <AttentionTabs allLabel={t("dash.attention.all")} areas={(["attendance", "admissions", "finance", "results", "messages", "system"] as const).map((x) => ({ id: x, label: t(`dash.area.${x}`) }))} rows={d.attention.map((a) => ({ key: a.key, area: a.area, href: a.href, text: t(`dash.attention.${a.key}` as "dash.attention.none", { count: a.count }) }))} />
        </DashSection>
      )}

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

      {d.finance && (
        <DashSection id="fees" title={t("dash.sec.fees")} subtitle={t("dash.finance.sub", { term: d.finance.term.name })}>
          <section aria-label={t("dash.money.title")} className="mb-5 rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-end justify-between gap-3"><p className="text-[11px] font-bold uppercase tracking-[.2em] text-ok">● {t("dash.money.title")}</p><Link href="/finance" className="text-sm font-semibold text-link hover:underline">{t("dash.money.report")} ↗</Link></div>
            <p className="mt-2 flex flex-wrap items-baseline gap-3"><span className="text-4xl font-semibold tabular-nums text-heading sm:text-5xl">{money(d.finance.collected)}</span>{d.finance.ratePct !== null && <Pill tone={d.finance.ratePct >= 70 ? "ok" : "warn"}>{d.finance.ratePct}% {t("dash.money.ofBilled")}</Pill>}</p>
            <p className="mt-1 text-sm text-muted">{t("dash.money.sub")}</p>
            {d.finance.billed > 0 && (
              <div className="mt-4"><div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-ok" style={{ width: `${Math.min(100, (d.finance.collected / d.finance.billed) * 100)}%` }} /><div className="h-full bg-warn" style={{ width: `${Math.max(0, 100 - (d.finance.collected / d.finance.billed) * 100)}%` }} /></div>
                <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><span><span className="mr-1.5 inline-block size-2 rounded-full bg-ok" />{t("dash.money.received")} <strong className="text-ink">{money(d.finance.collected)}</strong></span><span><span className="mr-1.5 inline-block size-2 rounded-full bg-warn" />{t("dash.money.notYet")} <strong className="text-ink">{money(d.finance.outstanding)}</strong></span></p></div>
            )}
            <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
              {([["billed", d.finance.billed, "text-ink"], ["outstanding", d.finance.outstanding, d.finance.outstanding > 0 ? "text-sun" : "text-ok"], ["overdue", d.finance.overdue, d.finance.overdue > 0 ? "text-bad" : "text-ok"], ["credit", d.finance.credit, "text-ink"], ["expenses", d.finance.expenses, "text-ink"]] as const).map(([k, v, c]) => <div key={k} className="bg-surface p-4"><dt className="text-xs text-muted">{t(`dash.money.${k}`)}</dt><dd className={`mt-1 text-xl font-semibold tabular-nums ${c}`}>{money(v)}</dd></div>)}
            </dl>
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title={t("dash.finance.chart")} subtitle={t("dash.finance.chart.sub", { total: money(d.finance.trend.reduce((n, p) => n + p.cents, 0)) })} right={<Link href="/finance" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
              {d.finance.trend.every((p) => p.cents === 0) ? <EmptyLine>{t("dash.finance.noPayments")}</EmptyLine> : <StackedBars points={d.finance.trend.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: { n: p.cents / 100 } }))} series={[{ key: "n", label: t("dash.kpi.collected") }]} every={4} format={(n) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n))} label={t("dash.finance.chart")} summary={t("dash.finance.chart.sub", { total: money(d.finance.trend.reduce((n, p) => n + p.cents, 0)) })} />}
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
              <DashTable empty={d.finance.topArrears.length === 0 ? t("fin.reports.noArrears") : undefined} min="26rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("dash.kpi.outstanding"), right: true }]}>
                {d.finance.topArrears.map((a) => (
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

      {(d.exams || d.pipeline || d.recentApplications) && (
        <DashSection id="results" title={t("dash.sec.results")} subtitle={t("dash.sec.results.sub")}>
          <div className="grid gap-5 lg:grid-cols-2">
            {d.exams && (
              <Panel title={t("dash.exams.title")} subtitle={t("dash.exams.sub", { term: d.exams.term.name, total: d.exams.total })} right={<Link href="/marks" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
                {d.exams.total === 0 ? <EmptyLine>{t("dash.exams.none")}</EmptyLine> : <HBars items={(["DRAFT", "RETURNED", "SUBMITTED", "APPROVED", "LOCKED"] as const).map((k) => ({ label: t(`marks.status.${k}`), value: d.exams!.byStatus[k] }))} label={t("dash.exams.title")} summary={t("dash.exams.summary")} tone="#4f46e5" />}
              </Panel>
            )}
            {d.pipeline && (
              <Panel title={t("dash.chart.pipeline")} subtitle={t("dash.chart.pipeline.sub", { total: pipelineTotal })} right={<Link href="/admissions" className="text-sm font-semibold text-link hover:underline">{t("dash.chart.pipeline.link")}</Link>}>
                {pipelineTotal === 0 ? <EmptyLine>{t("dash.chart.pipeline.empty")}</EmptyLine> : <HBars items={d.pipeline.map((p) => ({ label: t(`adm.status.${p.label}` as "adm.status.APPLIED"), value: p.value }))} label={t("dash.chart.pipeline")} summary={t("dash.chart.pipeline.summary")} />}
              </Panel>
            )}
            {d.exams && d.exams.mine.length > 0 && (
              <Panel title={t("dash.exams.mine")} subtitle={t("dash.exams.mine.sub")}>
                <DashTable min="28rem" head={[{ label: t("learn.subject") }, { label: t("learn.class") }, { label: t("dash.exams.progress"), right: true }, { label: t("common.status") }]}>
                  {d.exams.mine.map((m) => <tr key={m.id}><Cell><Link href={`/marks/${m.id}`} className="font-semibold text-link hover:underline">{m.subjectName}</Link><span className="block text-xs text-muted">{m.examName}</span></Cell><Cell>{m.className}{m.streamName ? ` ${m.streamName}` : ""}</Cell><Cell right>{m.entered}/{m.roster}</Cell><Cell>{m.overdue ? <Pill tone="bad">{t("marks.overdue")}</Pill> : <Pill tone={m.status === "RETURNED" ? "warn" : "neutral"}>{t(`marks.status.${m.status}` as "marks.status.DRAFT")}</Pill>}</Cell></tr>)}
                </DashTable>
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
