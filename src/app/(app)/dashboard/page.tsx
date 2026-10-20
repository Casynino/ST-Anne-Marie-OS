import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, ClipboardCheck, GraduationCap, Inbox, UserCog, UserPlus, ArrowRight, CheckCircle2, AlertTriangle, Wallet, FileCheck, Receipt, Activity, LogIn, ShieldAlert, Bug, Timer, DatabaseBackup, Gauge, Users } from "lucide-react";
import { db } from "@/lib/db";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getDashboard } from "@/server/dashboard";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { BarList, ChartCard, Donut, EmptyChart, TrendChart } from "@/components/charts";
import { CollectionsChart } from "@/components/finance/collections-chart";
import { formatMoney } from "@/lib/finance/money";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Td } from "@/components/ui";
import { activityPanel, securityPanel, systemPanel } from "@/server/ops";
import { DashSection, EmptyLine, HBars, KpiCard, Panel, PersonCell, Pill, StackedBars, type PillTone } from "@/components/dash/parts";

export const metadata: Metadata = { title: "Dashboard" };

const KPI_ICON = { enrolled: GraduationCap, pipeline: UserPlus, attendanceToday: ClipboardCheck, staff: UserCog, enquiries: Inbox, collected: Wallet, outstanding: Receipt, resultsLocked: FileCheck } as const;
const STATUS_TONE = { APPLIED: "brand", INTERVIEW: "brand", ACCEPTED: "warn", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;

function entityHref(type: string, id: string | null): string | null {
  if (!id) return null;
  if (type === "Student") return `/students/${id}`;
  if (type === "Application") return `/admissions/${id}`;
  return null;
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  const [d, school, roles, act, sec, sys] = await Promise.all([
    getDashboard(ctx),
    getSchoolBasics(ctx.schoolId),
    db.role.findMany({ where: { schoolId: ctx.schoolId, key: { in: [...ctx.roleKeys] } }, select: { name: true } }),
    ctx.permissions.has("audit.read") ? activityPanel(ctx) : null,
    ctx.permissions.has("audit.read") ? securityPanel(ctx) : null,
    ctx.permissions.has("backup.read") ? systemPanel(ctx) : null,
  ]);
  const can = (p: string) => ctx.permissions.has(p as never);
  const first = ctx.fullName.split(" ")[0] ?? ctx.fullName;
  const nothingToShow = d.kpis.length === 0 && !d.finance && !d.exams && !d.enrollmentByClass && !d.pipeline && !d.attendanceTrend && !d.recentApplications && !d.activity && d.myRegisters.length === 0;
  const pipelineTotal = d.pipeline?.reduce((n, p) => n + p.value, 0) ?? 0;
  const enrolTotal = d.enrollmentByClass?.reduce((n, p) => n + p.value, 0) ?? 0;
  const fmtDay = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), locale).slice(0, 6);
  const money = (c: number) => formatMoney(c, school.currency);
  const ago = (when: Date) => { const m = Math.round((Date.now() - when.getTime()) / 60000); return m < 1 ? t("dash.ago.now") : m < 60 ? t("dash.ago.min", { n: m }) : m < 48 * 60 ? t("dash.ago.hours", { n: Math.round(m / 60) }) : t("dash.ago.days", { n: Math.round(m / 1440) }); };
  const bytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <>
      <PageHeader
        title={t("dash.welcome", { name: first })}
        subtitle={`${roles.map((r) => r.name).join(" · ")}`}
        actions={
          <>
            {can("student.create") && <LinkButton href="/students/new"><UserPlus className="size-4" aria-hidden /> {t("dash.registerStudent")}</LinkButton>}
            {can("admission.create") && <LinkButton href="/admissions/new" variant="secondary">{t("dash.newApplication")}</LinkButton>}
            {can("attendance.take") && <LinkButton href="/attendance" variant="secondary"><ClipboardCheck className="size-4" aria-hidden /> {t("dash.takeAttendance")}</LinkButton>}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5"><CalendarDays className="size-4 text-brand-600" aria-hidden /><span className="text-muted">{t("dash.year")}:</span><strong>{d.year?.name ?? t("dash.notSet")}</strong></span>
        {d.term && <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5"><span className="text-muted">{t("dash.term")}:</span><strong>{d.term.name}</strong></span>}
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-muted">{displayDate(new Date(`${d.today}T00:00:00Z`), locale)}</span>
      </div>

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

      {(d.attention.length > 0 || d.kpis.length > 0) && (
        <section className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]" aria-labelledby="attention-h">
          <h2 id="attention-h" className="text-base font-semibold">{t("dash.attention.title")}</h2>
          {d.attention.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted"><CheckCircle2 className="size-4 text-ok" aria-hidden />{t("dash.attention.none")}</p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {d.attention.map((a) => (
                <li key={a.key}><Link href={a.href} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-line px-4 py-2 text-sm hover:bg-canvas"><span className="flex items-center gap-2"><AlertTriangle className="size-4 text-warn" aria-hidden />{t(`dash.attention.${a.key}` as "dash.attention.none", { count: a.count })}</span><ArrowRight className="size-4 text-muted" aria-hidden /></Link></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <DashSection id="trends" title={t("dash.sec.trends")} subtitle={t("dash.sec.trends.sub")}>
      {(d.finance || d.exams) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {d.finance && (
            <ChartCard title={t("dash.finance.title")} subtitle={t("dash.finance.sub", { term: d.finance.term.name })} href="/finance" hrefLabel={t("dash.kpi.open")} className="lg:col-span-2">
              <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                <div>
                  {d.finance.trend.every((p) => p.cents === 0) ? <EmptyChart>{t("dash.finance.noPayments")}</EmptyChart> : <CollectionsChart points={d.finance.trend} label={t("dash.finance.chart")} summary={t("dash.finance.chart.sub", { total: money(d.finance.trend.reduce((n, p) => n + p.cents, 0)) })} format={money} dayLabel={fmtDay} />}
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">{t("dash.finance.arrears")}</h3>
                  {d.finance.topArrears.length === 0 ? <p className="text-sm text-muted">{t("fin.reports.noArrears")}</p> : (
                    <ul className="divide-y divide-line text-sm">
                      {d.finance.topArrears.map((a) => (
                        <li key={a.studentId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"><Link href={`/finance/students/${a.studentId}`} className="min-w-0 truncate font-medium text-brand-800 hover:underline">{a.name}<span className="block text-xs font-normal text-muted">{a.className ?? ""} · {a.admissionNo}</span></Link><span className="shrink-0 text-right tabular-nums">{money(a.outstanding)}{a.overdue > 0 && <span className="block text-xs text-bad">{t("dash.finance.overdueAmount", { amount: money(a.overdue) })}</span>}</span></li>
                      ))}
                    </ul>
                  )}
                  <Link href="/finance/reports" className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline">{t("dash.finance.allArrears")}</Link>
                </div>
              </div>
            </ChartCard>
          )}
          {d.exams && (
            <ChartCard title={t("dash.exams.title")} subtitle={t("dash.exams.sub", { term: d.exams.term.name, total: d.exams.total })} href="/marks" hrefLabel={t("dash.kpi.open")} className={d.exams.mine.length > 0 && d.exams.overall ? "" : "lg:col-span-2"}>
              {d.exams.total === 0 ? <EmptyChart>{t("dash.exams.none")}</EmptyChart> : (
                <BarList items={([["DRAFT", "muted"], ["RETURNED", "warn"], ["SUBMITTED", "sun"], ["APPROVED", "indigo"], ["LOCKED", "brand"]] as const).map(([k, tone]) => ({ label: t(`marks.status.${k}`), value: d.exams!.byStatus[k], tone }))} label={t("dash.exams.title")} summary={t("dash.exams.summary")} />
              )}
            </ChartCard>
          )}
          {d.exams && d.exams.mine.length > 0 && (
            <ChartCard title={t("dash.exams.mine")} subtitle={t("dash.exams.mine.sub")} href="/marks" hrefLabel={t("dash.table.viewAll")}>
              <ul className="space-y-2">
                {d.exams.mine.map((m) => (
                  <li key={m.id}><Link href={`/marks/${m.id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line px-4 py-2 hover:bg-canvas"><span className="min-w-0"><span className="block truncate font-medium">{m.subjectName} · {m.className}{m.streamName ? ` ${m.streamName}` : ""}</span><span className="text-xs text-muted">{m.examName} · {m.entered}/{m.roster}</span></span>{m.overdue ? <Badge tone="bad">{t("marks.overdue")}</Badge> : <Badge tone={m.status === "RETURNED" ? "warn" : "neutral"}>{t(`marks.status.${m.status}` as "marks.status.DRAFT")}</Badge>}</Link></li>
                ))}
              </ul>
            </ChartCard>
          )}
        </div>
      )}

      {d.myRegisters.length > 0 && (
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

      {(d.enrollmentByClass || d.pipeline || d.attendanceTrend) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {d.enrollmentByClass && (
            <ChartCard title={t("dash.chart.enrollment")} subtitle={t("dash.chart.enrollment.sub", { total: enrolTotal })} href="/students" hrefLabel={t("dash.chart.enrollment.link")}>
              {d.enrollmentByClass.length === 0 ? <EmptyChart>{t("dash.chart.enrollment.empty")}</EmptyChart> : (
                <div className="space-y-5">
                  <StackedBars points={d.enrollmentByClass.map((b) => ({ key: b.label, label: b.label, parts: { n: b.value } }))} series={[{ key: "n", label: t("dash.kpi.enrolled") }]} every={d.enrollmentByClass.length > 9 ? 2 : 1} label={t("dash.chart.enrollment")} summary={t("dash.chart.enrollment.summary")} />
                  {d.gender && (d.gender.MALE ?? 0) + (d.gender.FEMALE ?? 0) > 0 && <div className="border-t border-line pt-4"><Donut label={t("dash.chart.gender")} summary={t("dash.chart.gender")} segments={[{ label: t("student.female"), value: d.gender.FEMALE ?? 0, tone: "brand" }, { label: t("student.male"), value: d.gender.MALE ?? 0, tone: "sun" }]} /></div>}
                </div>
              )}
            </ChartCard>
          )}
          {d.pipeline && (
            <ChartCard title={t("dash.chart.pipeline")} subtitle={t("dash.chart.pipeline.sub", { total: pipelineTotal })} href="/admissions" hrefLabel={t("dash.chart.pipeline.link")}>
              {pipelineTotal === 0 ? <EmptyChart>{t("dash.chart.pipeline.empty")}</EmptyChart> : <BarList items={d.pipeline.map((p) => ({ ...p, label: t(`adm.status.${p.label}` as "adm.status.APPLIED") }))} label={t("dash.chart.pipeline")} summary={t("dash.chart.pipeline.summary")} />}
            </ChartCard>
          )}
          {d.attendanceTrend && (
            <ChartCard title={t("dash.chart.attendance")} subtitle={t("dash.chart.attendance.sub")} href="/attendance/reports" hrefLabel={t("dash.chart.attendance.link")} className="lg:col-span-2">
              {d.attendanceTrend.length === 0 ? <EmptyChart>{t("dash.chart.attendance.empty")}</EmptyChart> : <TrendChart points={d.attendanceTrend} label={t("dash.chart.attendance")} summary={t("dash.chart.attendance.summary", { days: d.attendanceTrend.length })} formatDate={fmtDay} />}
            </ChartCard>
          )}
        </div>
      )}

      </DashSection>

      {(d.recentApplications || d.activity) && (
        <DashSection id="latest" title={t("dash.sec.latest")} subtitle={t("dash.sec.latest.sub")}>
        <div className="grid gap-5 xl:grid-cols-2">
          {d.recentApplications && (
            <section aria-labelledby="recent-apps" className="min-w-0">
              <div className="mb-3 flex items-center justify-between"><h2 id="recent-apps" className="text-base font-semibold">{t("dash.table.applications")}</h2><Link href="/admissions" className="text-sm font-medium text-brand-700 hover:underline">{t("dash.table.viewAll")}</Link></div>
              {d.recentApplications.length === 0 ? <EmptyState>{t("dash.table.applications.empty")}</EmptyState> : (
                <DataTable head={[t("adm.applicant"), t("adm.classApplied"), t("common.status"), t("adm.appliedOn")]}>
                  {d.recentApplications.map((a) => (
                    <tr key={a.id} className="hover:bg-canvas">
                      <Td><Link href={`/admissions/${a.id}`} className="font-medium text-brand-700 hover:underline">{a.firstName} {a.lastName}</Link>{a.source === "ONLINE" && <span className="ml-2 align-middle"><Badge tone="brand">{t("adm.online")}</Badge></span>}<p className="text-xs text-muted">{a.applicationNo}</p></Td>
                      <Td>{a.className ?? "—"}</Td>
                      <Td><Badge tone={STATUS_TONE[a.status]}>{t(`adm.status.${a.status}` as "adm.status.APPLIED")}</Badge></Td>
                      <Td className="whitespace-nowrap text-muted">{displayDate(a.createdAt, locale)}</Td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </section>
          )}
          {d.activity && (
            <section aria-labelledby="recent-activity" className="min-w-0">
              <div className="mb-3 flex items-center justify-between"><h2 id="recent-activity" className="text-base font-semibold">{t("dash.table.activity")}</h2><Link href="/audit" className="text-sm font-medium text-brand-700 hover:underline">{t("dash.table.viewAll")}</Link></div>
              {d.activity.length === 0 ? <EmptyState>{t("dash.table.activity.empty")}</EmptyState> : (
                <DataTable head={[t("audit.when"), t("audit.who"), t("audit.record")]}>
                  {d.activity.map((a) => {
                    const href = entityHref(a.entityType, a.entityId);
                    return (
                      <tr key={a.id}>
                        <Td className="whitespace-nowrap text-muted">{displayDateTime(a.createdAt, school.timezone, locale)}</Td>
                        <Td>{a.actorName ?? t("audit.system")}</Td>
                        <Td>{href ? <Link href={href} className="text-brand-700 hover:underline">{a.summary ?? a.action}</Link> : (a.summary ?? a.action)}<p className="text-xs text-muted"><code>{a.action}</code></p></Td>
                      </tr>
                    );
                  })}
                </DataTable>
              )}
            </section>
          )}
        </div>
        </DashSection>
      )}

      {act && (
        <DashSection id="activity" title={t("dash.sec.activity")} subtitle={t("dash.sec.activity.sub")}>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <li><KpiCard icon={Users} label={t("dash.act.signedInToday")} value={act.signedInToday} caption={t("dash.act.signedInToday.cap")} pill={{ text: t("dash.pill.live"), tone: "ok" }} /></li>
            <li><KpiCard icon={Activity} label={t("dash.act.actions14")} value={act.actions14.toLocaleString()} caption={t("dash.act.actions14.cap")} pill={{ text: t("dash.pill.activity"), tone: "info" }} /></li>
            <li><KpiCard icon={LogIn} label={t("dash.act.signIns14")} value={act.signIns14.toLocaleString()} caption={t("dash.act.signIns14.cap")} pill={{ text: t("dash.pill.signIns"), tone: "info" }} /></li>
            <li><KpiCard icon={ShieldAlert} label={t("dash.act.failed24")} value={sec?.failed24 ?? act.failed24} caption={t("dash.act.failed24.cap")} pill={((sec?.failed24 ?? act.failed24) === 0 ? { text: t("dash.pill.normal"), tone: "ok" } : (sec?.failed24 ?? act.failed24) <= 5 ? { text: t("dash.pill.watch"), tone: "warn" } : { text: t("dash.pill.alert"), tone: "bad" })} /></li>
          </ul>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Panel title={t("dash.act.signInsPerDay")} subtitle={t("dash.act.signInsPerDay.sub")}>
              <StackedBars points={act.signInsByRole.days.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={act.signInsByRole.series.map((r) => ({ key: r, label: r }))} label={t("dash.act.signInsPerDay")} summary={t("dash.act.signInsPerDay.sub")} />
            </Panel>
            <Panel title={t("dash.act.actionsPerDay")} subtitle={t("dash.act.actionsPerDay.sub")}>
              <StackedBars points={act.actionsByKind.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "staff", label: t("dash.act.kind.staff") }, { key: "family", label: t("dash.act.kind.family") }, { key: "visitor", label: t("dash.act.kind.visitor") }]} label={t("dash.act.actionsPerDay")} summary={t("dash.act.actionsPerDay.sub")} />
            </Panel>
            <Panel title={t("dash.act.busiest")} subtitle={act.peakHour === null ? t("dash.act.busiest.none") : t("dash.act.busiest.sub", { hour: `${String(act.peakHour).padStart(2, "0")}:00` })}>
              <StackedBars points={act.hours.map((n, h) => ({ key: String(h), label: `${h}h`, parts: { n } }))} series={[{ key: "n", label: t("dash.act.actions14") }]} every={3} label={t("dash.act.busiest")} summary={t("dash.act.busiest")} />
            </Panel>
            <Panel title={t("dash.act.where")} subtitle={t("dash.act.where.sub")}>
              {act.areas.length === 0 ? <EmptyLine>{t("dash.act.none")}</EmptyLine> : <HBars items={act.areas} label={t("dash.act.where")} summary={t("dash.act.where.sub")} />}
            </Panel>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Panel title={t("dash.act.recent")} subtitle={t("dash.act.recent.sub")} className="overflow-hidden">
              {act.recentSignIns.length === 0 ? <EmptyLine>{t("dash.act.none")}</EmptyLine> : (
                <div className="-mx-5 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead><tr className="border-y border-line text-left text-[11px] font-bold uppercase tracking-[.12em] text-muted"><th className="px-5 py-2.5">{t("dash.act.person")}</th><th className="px-3 py-2.5">{t("dash.act.device")}</th><th className="px-3 py-2.5">{t("dash.act.from")}</th><th className="px-5 py-2.5 text-right">{t("audit.when")}</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {act.recentSignIns.map((r, i) => (
                        <tr key={i}>
                          <td className="px-5 py-3"><PersonCell name={r.name} sub={r.role} /></td>
                          <td className="px-3 py-3 text-ink/80">{r.device.label}</td>
                          <td className="px-3 py-3 font-mono text-xs text-muted">{r.ip ?? "—"}</td>
                          <td className="whitespace-nowrap px-5 py-3 text-right text-muted">{ago(r.at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
            <div className="space-y-5">
              <Panel title={t("dash.act.online")} subtitle={t("dash.act.online.sub")} right={<span className="rounded-md bg-canvas px-2 py-0.5 text-xs font-semibold tabular-nums text-muted">{act.online.length}</span>}>
                {act.online.length === 0 ? <p className="text-sm text-muted">{t("dash.act.online.none")}</p> : <ul className="space-y-3">{act.online.slice(0, 6).map((o, i) => <li key={i}><PersonCell name={o.name} sub={o.role} /></li>)}</ul>}
              </Panel>
              <Panel title={t("dash.act.mostActive")} subtitle={t("dash.act.mostActive.sub")}>
                {act.mostActive.length === 0 ? <EmptyLine>{t("dash.act.none")}</EmptyLine> : <HBars items={act.mostActive.map((m) => ({ label: m.name, value: m.count }))} label={t("dash.act.mostActive")} summary={t("dash.act.mostActive.sub")} tone="#14a3b8" />}
              </Panel>
              <Panel title={t("dash.act.notUsing")} subtitle={t("dash.act.notUsing.sub")}>
                {act.inactive.length === 0 ? <p className="text-sm text-muted">{t("dash.act.notUsing.none")}</p> : (
                  <ul className="space-y-2.5 text-sm">{act.inactive.map((u, i) => <li key={i} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate"><span className="font-semibold text-ink">{u.name}</span> <span className="text-muted">· {u.role}</span></span>{u.lastLoginAt ? <span className="shrink-0 text-muted">{ago(u.lastLoginAt)}</span> : <Pill tone="warn">{t("dash.act.never")}</Pill>}</li>)}</ul>
                )}
                {act.portalNeverSignedIn > 0 && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">{t("dash.act.portalNever", { n: act.portalNeverSignedIn })}</p>}
              </Panel>
            </div>
          </div>
        </DashSection>
      )}

      {sec && (
        <DashSection id="security" title={t("dash.sec.security")} subtitle={t("dash.sec.security.sub")}>
          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Panel title={t("dash.sec2.perDay")} subtitle={t("dash.sec2.perDay.sub", { n: sec.failed14 })}>
              <StackedBars points={sec.perDay.map((p) => ({ key: p.date, label: fmtDay(p.date), parts: p.parts }))} series={[{ key: "failed", label: t("dash.sec2.failed"), color: "#e0a100" }]} label={t("dash.sec2.perDay")} summary={t("dash.sec2.perDay.sub", { n: sec.failed14 })} />
            </Panel>
            <Panel title={t("dash.sec2.latest")} subtitle={t("dash.sec2.latest.sub")}>
              {sec.latest.length === 0 ? <EmptyLine>{t("dash.sec2.none")}</EmptyLine> : (
                <ul className="divide-y divide-line">
                  {sec.latest.map((l, i) => <li key={i} className="py-2.5 first:pt-0 last:pb-0"><p className="break-all font-medium text-ink">{l.identifier}{l.repeats > 1 && <span className="ml-2 rounded bg-canvas px-1.5 py-0.5 text-xs font-semibold text-muted">×{l.repeats}</span>}</p><p className="text-xs text-muted">{ago(l.at)} · <span className="font-mono">{l.ip ?? "—"}</span></p></li>)}
                </ul>
              )}
            </Panel>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Panel title={t("dash.sec2.byAddress")} subtitle={t("dash.sec2.byAddress.sub")} className="overflow-hidden">
              {sec.byAddress.length === 0 ? <EmptyLine>{t("dash.sec2.none")}</EmptyLine> : (
                <div className="-mx-5 overflow-x-auto"><table className="w-full min-w-[26rem] text-sm"><thead><tr className="border-y border-line text-left text-[11px] font-bold uppercase tracking-[.12em] text-muted"><th className="px-5 py-2.5">{t("dash.act.from")}</th><th className="px-3 py-2.5 text-right">{t("dash.sec2.tries")}</th><th className="px-3 py-2.5 text-right">{t("dash.sec2.accounts")}</th><th className="px-5 py-2.5 text-right">{t("dash.sec2.last")}</th></tr></thead>
                  <tbody className="divide-y divide-line">{sec.byAddress.map((a) => <tr key={a.ip}><td className="px-5 py-2.5 font-mono text-xs">{a.ip}</td><td className="px-3 py-2.5 text-right tabular-nums">{a.tries}</td><td className="px-3 py-2.5 text-right tabular-nums">{a.accounts}</td><td className="whitespace-nowrap px-5 py-2.5 text-right text-muted">{ago(a.last)}</td></tr>)}</tbody></table></div>
              )}
            </Panel>
            <section className={`flex items-center gap-4 rounded-2xl border p-5 ${sec.yourFailed24 === 0 ? "border-ok/30 bg-ok/10" : "border-warn/30 bg-warn/10"}`}>
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${sec.yourFailed24 === 0 ? "bg-ok/15 text-ok" : "bg-warn/15 text-warn"}`}>{sec.yourFailed24 === 0 ? <CheckCircle2 className="size-5" aria-hidden /> : <AlertTriangle className="size-5" aria-hidden />}</span>
              <div><h3 className="font-semibold text-ink">{t("dash.sec2.yours")}</h3><p className="text-sm text-muted">{sec.yourFailed24 === 0 ? t("dash.sec2.yours.ok") : t("dash.sec2.yours.bad", { n: sec.yourFailed24 })}</p></div>
            </section>
          </div>
        </DashSection>
      )}

      {sys && (
        <>
          <DashSection id="system" eyebrow={t("dash.sec.systemEyebrow")} title={t("dash.sec.system")} subtitle={t("dash.sec.system.sub")}>
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <li><KpiCard icon={Bug} label={t("dash.sys.errors")} value={sys.errors24} caption={t("dash.sys.errors.cap")} pill={sys.errors24 === 0 ? { text: t("dash.pill.normal"), tone: "ok" } : { text: t("dash.pill.watch"), tone: "warn" }} /></li>
              <li><KpiCard icon={Timer} label={t("dash.sys.jobs")} value={`${sys.jobsGood} ${t("dash.sys.of")} ${sys.jobs.length}`} caption={t("dash.sys.jobs.cap")} pill={sys.jobsGood === sys.jobs.length ? { text: t("dash.pill.ok"), tone: "ok" } : { text: t("dash.pill.late"), tone: "bad" }} /></li>
              <li><KpiCard icon={AlertTriangle} label={t("dash.sys.lastError")} value={sys.lastError ? ago(sys.lastError.at) : t("dash.sys.none")} caption={sys.lastError ? `${sys.lastError.name}: ${sys.lastError.message}`.slice(0, 90) : t("dash.sys.lastError.none")} pill={sys.lastError ? { text: t("dash.pill.seen"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
              <li><KpiCard icon={DatabaseBackup} label={t("dash.sys.backup")} value={sys.backup.lastSuccessAt ? ago(sys.backup.lastSuccessAt) : t("dash.sys.none")} caption={t("dash.sys.backup.cap")} href="/settings/backups" openLabel={t("dash.kpi.open")} pill={sys.backup.level === "ok" ? { text: t("dash.pill.ok"), tone: "ok" } : sys.backup.level === "warn" ? { text: t("dash.pill.late"), tone: "warn" } : { text: t("dash.pill.alert"), tone: "bad" }} /></li>
            </ul>
            <div className="mt-4 rounded-2xl border border-line bg-surface p-5 text-sm shadow-[var(--shadow-card)]">
              <p className="font-semibold text-ink">{t("dash.sys.jobList")}</p>
              <ul className="mt-2 divide-y divide-line">{sys.jobs.map((j) => <li key={j.name} className="flex items-center justify-between gap-3 py-2"><span>{j.label}</span><span className="flex items-center gap-3 text-muted">{j.lastAt ? ago(j.lastAt) : t("dash.sys.neverRan")}<Pill tone={j.ok && j.onTime ? "ok" : "bad"}>{j.ok && j.onTime ? t("dash.pill.ok") : t("dash.pill.late")}</Pill></span></li>)}</ul>
            </div>
          </DashSection>

          <DashSection id="speed" title={t("dash.sec.speed")} subtitle={t("dash.sec.speed.sub")}>
            <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
              <Panel title={t("dash.speed.title")} subtitle={t("dash.speed.sub")}>
                <ul className="divide-y divide-line text-sm">{sys.speed.map((q) => <li key={q.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"><span>{t(`dash.speed.${q.label}` as "dash.speed.title")}</span><span className="flex items-center gap-3"><span className="font-semibold tabular-nums">{q.ms} ms</span><Pill tone={q.level}>{q.level === "ok" ? t("dash.speed.fast") : q.level === "warn" ? t("dash.speed.slowish") : t("dash.speed.slow")}</Pill></span></li>)}</ul>
              </Panel>
              <Panel title={t("dash.size.title")} subtitle={t("dash.size.sub")}>
                <p className="text-3xl font-semibold tabular-nums text-ink">{bytes(sys.dbBytes)}</p>
                <p className="mb-4 text-sm text-muted">{t("dash.size.files", { n: sys.files.count, size: bytes(sys.files.bytes) })}</p>
                <HBars items={sys.tables.map((x) => ({ label: `${x.name} · ${x.rows.toLocaleString()}`, value: x.bytes }))} label={t("dash.size.tables")} summary={t("dash.size.tables")} tone="#4f46e5" format={bytes} />
              </Panel>
            </div>
          </DashSection>
        </>
      )}
    </>
  );
}
