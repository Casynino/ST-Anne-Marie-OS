import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, ClipboardCheck, GraduationCap, Inbox, UserCog, UserPlus, ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getDashboard } from "@/server/dashboard";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { BarList, ChartCard, Donut, EmptyChart, TrendChart } from "@/components/charts";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

const KPI_ICON = { enrolled: GraduationCap, pipeline: UserPlus, attendanceToday: ClipboardCheck, staff: UserCog, enquiries: Inbox } as const;
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
  const [d, school, roles] = await Promise.all([
    getDashboard(ctx),
    getSchoolBasics(ctx.schoolId),
    db.role.findMany({ where: { schoolId: ctx.schoolId, key: { in: [...ctx.roleKeys] } }, select: { name: true } }),
  ]);
  const can = (p: string) => ctx.permissions.has(p as never);
  const first = ctx.fullName.split(" ")[0] ?? ctx.fullName;
  const nothingToShow = d.kpis.length === 0 && !d.enrollmentByClass && !d.pipeline && !d.attendanceTrend && !d.recentApplications && !d.activity && d.myRegisters.length === 0;
  const pipelineTotal = d.pipeline?.reduce((n, p) => n + p.value, 0) ?? 0;
  const enrolTotal = d.enrollmentByClass?.reduce((n, p) => n + p.value, 0) ?? 0;
  const fmtDay = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), locale).slice(0, 6);

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
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label={t("dash.kpis")}>
          {d.kpis.map((k) => {
            const Icon = KPI_ICON[k.key as keyof typeof KPI_ICON];
            const hint = k.key === "pipeline" ? t("dash.kpi.pipeline.hint", { count: Number(k.hint ?? 0) }) : k.key === "attendanceToday" ? (k.value === null ? t("dash.kpi.attendanceToday.none") : t("dash.kpi.attendanceToday.hint", { done: k.hint?.split("/")[0] ?? "0", total: k.hint?.split("/")[1] ?? "0" })) : undefined;
            return (
              <li key={k.key}>
                <Link href={k.href} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                  <span className="flex items-center justify-between text-sm text-muted"><span>{t(`dash.kpi.${k.key}` as "dash.kpi.enrolled")}</span><span className="rounded-lg bg-brand-50 p-1.5 text-brand-700"><Icon className="size-4" aria-hidden /></span></span>
                  <span className="mt-2 text-3xl font-semibold tabular-nums text-ink">{k.value === null ? <span aria-label={t("dash.unavailable")}>—</span> : typeof k.value === "number" ? k.value.toLocaleString() : k.value}</span>
                  {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
                  <span className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-medium text-brand-700 group-hover:underline">{t("dash.kpi.open")} <ArrowRight className="size-3.5" aria-hidden /></span>
                </Link>
              </li>
            );
          })}
        </ul>
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
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {d.enrollmentByClass && (
            <ChartCard title={t("dash.chart.enrollment")} subtitle={t("dash.chart.enrollment.sub", { total: enrolTotal })} href="/students" hrefLabel={t("dash.chart.enrollment.link")}>
              {d.enrollmentByClass.length === 0 ? <EmptyChart>{t("dash.chart.enrollment.empty")}</EmptyChart> : (
                <div className="space-y-5">
                  <BarList items={d.enrollmentByClass} label={t("dash.chart.enrollment")} summary={t("dash.chart.enrollment.summary")} />
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

      {(d.recentApplications || d.activity) && (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
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
      )}
    </>
  );
}
