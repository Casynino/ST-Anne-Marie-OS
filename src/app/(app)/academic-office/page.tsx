import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CalendarDays, ClipboardCheck, FileCheck, GraduationCap, HeartHandshake, ListChecks, MoveRight, Users } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { portalLabelKey } from "@/lib/auth/portal";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { academicDesk } from "@/server/academic-office";
import { yearReport } from "@/server/year-report";
import { YearReportPanel } from "@/components/dash/year-report";
import { formatMoney } from "@/lib/finance/money";
import { ActionForm, Field } from "@/components/form";
import { Cell, DashSection, DashTable, DonutStat, EmptyLine, GradientTile, HBars, Panel, Pill, StackedBars } from "@/components/dash/parts";
import type { AttentionRow } from "@/components/dash/attention-tabs";
import { AttentionBlock } from "../dashboard/attention";
import { Badge, LinkButton, NoAccess } from "@/components/ui";
import { HomeBanner, Hi } from "@/components/dash/hero";
import { JumpNav } from "@/components/dash/jump-nav";
import { quickItems } from "../dashboard/quick";
import { AreaChart } from "@/components/dash/charts-client";
import { Ring, StageBar } from "@/components/dash/viz";
import { updateAcademicSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Academic Office" };

export default async function AcademicOfficePage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("academic.office")) return <NoAccess t={t} />;
  const [d, school, year] = await Promise.all([academicDesk(ctx), getSchoolBasics(ctx.schoolId), yearReport(ctx).catch(() => null)]);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const att = d.attendance;
  const perf = d.performance;
  const fmt = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), ctx.locale);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: school.timezone }).format(new Date()));

  const quick = quickItems("academic", t, (p) => can(p as never), d.alerts.map((a) => ({ key: a.key, count: a.count })));
  const SEV: Record<string, "bad" | "warn" | "info"> = { marksOverdue: "bad", attendanceMissing: "warn", resultsToApprove: "warn", awaitingPlacement: "warn", repeatedAbsences: "warn", pendingTransfers: "warn", headProgression: "warn", configGaps: "info", cardsToPrepare: "info", cardsToPublish: "info", capacityWarnings: "info", openConcerns: "info", progressionTodo: "info" };
  const AREA: Record<string, string> = { marksOverdue: "results", resultsToApprove: "results", cardsToPrepare: "results", cardsToPublish: "results", attendanceMissing: "attendance", repeatedAbsences: "attendance" };
  const alertRows: AttentionRow[] = d.alerts.map((a) => ({ key: a.key, area: AREA[a.key] ?? "academic", href: a.href, tone: SEV[a.key] ?? "warn", text: t(`ac.alert.${a.key}` as "ac.alert.configGaps"), detail: t(`att.d.ac.${a.key}` as "att.d.ac.configGaps"), count: a.count }));
  return (
    <>
      <HomeBanner
        photoIndex={3}
        eyebrow={`${school.name} · ${t(portalLabelKey("academic"))}`.toUpperCase()}
        title={t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: ctx.fullName.split(" ")[0] ?? ctx.fullName })}
        date={`${d.year ? d.year.name : t("ac.noYear")}${d.term ? ` · ${d.term.name}` : ""}`}
        quick={quick}
        searchBox={can("student.read") || can("student.read_assigned") ? { action: "/students", placeholder: t("search.students"), button: t("common.search") } : undefined}
        allLabel={t("dash.quick.title")}
      >
        {[
          <><Hi>{d.students.enrolled.toLocaleString()}</Hi> {t("dash.hero.students")}</>,
          ...(att && att.rate !== null ? [<>{t("dash.hero.attendance")} <Hi tone={att.rate >= 90 ? "ok" : "warn"}>{att.rate}%</Hi></>] : []),
          ...(d.students.awaitingPlacement > 0 ? [<><Hi tone="warn">{d.students.awaitingPlacement}</Hi> {t("ac.kpi.placement").toLowerCase()}</>] : []),
          ...(d.students.openConcerns > 0 ? [<><Hi tone="warn">{d.students.openConcerns}</Hi> {t("ac.kpi.concerns").toLowerCase()}</>] : []),
        ].map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
      </HomeBanner>
      <JumpNav label={t("dash.jump")} items={[{ id: "students", label: t("ac.students") }, { id: "attendance", label: t("ac.attendance") }, { id: "performance", label: t("ac.performance") }, ...(d.teachers ? [{ id: "teachers", label: t("ac.teachers") }] : []), { id: "calendar", label: t("ac.calendar") }]} />

      <AttentionBlock t={t} rows={alertRows} />

      <YearReportPanel report={year} t={t} money={(c) => formatMoney(c, school.currency)} groups={["academic", "admissions"]} className="mb-5" />

      <ul className="mt-5 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]" aria-label={t("ac.title")}>
        <li><GradientTile icon={GraduationCap} tone="orange" label={t("ac.kpi.enrolled")} value={d.students.enrolled.toLocaleString()} caption={t("ac.kpi.enrolled.cap")} href="/students" /></li>
        <li><GradientTile icon={Users} tone={d.students.awaitingPlacement > 0 ? "rose" : "green"} label={t("ac.kpi.placement")} value={d.students.awaitingPlacement} caption={t("ac.kpi.placement.cap")} href="/admissions/placement" /></li>
        <li><GradientTile icon={HeartHandshake} tone="violet" label={t("ac.kpi.concerns")} value={d.students.openConcerns} caption={t("ac.kpi.concerns.cap")} href="/academic-office/concerns" /></li>
        <li><GradientTile icon={MoveRight} tone="teal" label={t("ac.kpi.transfers")} value={d.students.pendingTransfers} caption={t("ac.kpi.transfers.cap", { n: d.students.transfersThisTerm })} href="/academic-office/transfers" /></li>
        <li><GradientTile icon={ListChecks} tone={d.tasks && d.tasks.overdue > 0 ? "rose" : "indigo"} label={t("ac.kpi.tasks")} value={d.tasks?.open ?? 0} caption={d.tasks && d.tasks.overdue > 0 ? t("ac.kpi.tasks.overdue", { n: d.tasks.overdue }) : t("ac.kpi.tasks.cap")} href="/tasks?department=ACADEMIC" /></li>
      </ul>

      <DashSection id="students" title={t("ac.students")} subtitle={t("ac.students.sub")}>
        <Panel title={t("ac.byClass")} subtitle={t("ac.byClass.sub")} right={<Link href="/academic-setup" className="text-sm font-semibold text-link hover:underline">{t("ac.manageClasses")}</Link>}>
          <DashTable empty={d.students.byClass.length === 0 ? t("ac.noClasses") : undefined} min="30rem" head={[{ label: t("learn.class") }, { label: t("dash.attToday.students"), right: true }, { label: t("class.capacity"), right: true }, { label: t("common.status") }]}>
            {d.students.byClass.map((c) => {
              const full = c.capacity !== null && c.count >= c.capacity;
              const near = c.capacity !== null && !full && c.count * 100 >= c.capacity * d.settings.capacityWarnPct;
              return <tr key={c.classId}><Cell className="font-semibold text-ink">{c.name}</Cell><Cell right>{c.count}</Cell><Cell right>{c.capacity ?? "—"}</Cell><Cell>{full ? <Pill tone="bad">{t("adm.place.full")}</Pill> : near ? <Pill tone="warn">{t("ac.nearlyFull")}</Pill> : c.capacity !== null ? <Pill tone="ok">{t("ac.hasRoom")}</Pill> : <span className="text-muted">{t("adm.place.noCapacity")}</span>}</Cell></tr>;
            })}
          </DashTable>
        </Panel>
      </DashSection>

      <DashSection id="attendance" title={t("ac.attendance")} subtitle={t("ac.attendance.sub", { date: fmt(d.today) })}>
        {!att ? <EmptyLine>{t("ac.attendance.none")}</EmptyLine> : (
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title={t("ac.attendance.today")} subtitle={t("ac.attendance.registers", { done: att.finalised, total: att.total })} right={<Link href="/attendance" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
              {att.finalised === 0 ? <EmptyLine>{t("ac.attendance.notYet")}</EmptyLine> : (
                <div className="flex flex-col items-center gap-5">
                  <Ring value={att.rate} size={156} stroke={9} tone={att.rate !== null && att.rate >= 90 ? "ok" : "warn"} label={t("ac.attendance.today")}><span><span className="block text-4xl font-semibold tabular-nums text-heading">{att.rate === null ? "—" : `${att.rate}%`}</span><span className="block text-[10px] font-bold uppercase tracking-[.16em] text-muted">{t("att.status.PRESENT")}</span></span></Ring>
                  <ul className="w-full space-y-2.5 text-sm">{([[t("att.status.PRESENT"), att.counts.PRESENT, "#2fd08f"], [t("att.status.LATE"), att.counts.LATE, "#f3b94c"], [t("att.status.ABSENT"), att.counts.ABSENT, "#ff8574"], [t("att.status.EXCUSED"), att.counts.EXCUSED, "#8b80ff"]] as const).map(([label, value, color]) => <li key={label} className="flex items-center justify-between gap-4"><span className="inline-flex items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />{label}</span><span className="font-semibold tabular-nums text-ink">{value}</span></li>)}</ul>
                </div>
              )}
            </Panel>
            <Panel title={t("ac.attendance.trend")} subtitle={t("ac.attendance.trend.sub")} className="lg:col-span-2">
              {att.trend.length < 2 ? <EmptyLine>{t("dash.chart.attendance.empty")}</EmptyLine> : <AreaChart label={t("ac.attendance.trend")} summary={t("ac.attendance.trend.sub")} kind="percent" yMin={Math.max(0, Math.floor((Math.min(...att.trend.map((p) => p.rate)) - 5) / 10) * 10)} yMax={100} goal={{ value: 90, label: t("dash.pulse.goal", { n: 90 }) }} periodLabel={t("dash.period.label")} periods={att.trend.length > 7 ? [{ label: t("dash.period.7"), count: 7 }, { label: t("dash.period.14"), count: 14 }] : undefined} points={att.trend.map((p) => ({ key: p.date, label: fmt(p.date).slice(0, 6), value: p.rate }))} />}
            </Panel>
            <Panel title={t("ac.attendance.missing")} subtitle={t("ac.attendance.missing.sub")} className="lg:col-span-2">
              <DashTable empty={att.missing.length === 0 ? t("ac.attendance.allDone") : undefined} min="28rem" head={[{ label: t("learn.class") }, { label: t("dash.attToday.students"), right: true }, { label: t("ac.teachers") }]}>
                {att.missing.map((m) => <tr key={`${m.classId}-${m.streamName}`}><Cell className="font-semibold text-ink">{m.className}{m.streamName ? ` ${m.streamName}` : ""}</Cell><Cell right>{m.students}</Cell><Cell className="text-muted">{m.teachers.join(", ") || t("ac.noTeacher")}</Cell></tr>)}
              </DashTable>
            </Panel>
            <Panel title={t("ac.attendance.repeated")} subtitle={t("ac.attendance.repeated.sub", { n: d.settings.repeatedAbsences, days: d.settings.repeatedAbsenceDays })}>
              <div id="absences" />
              <DashTable empty={att.repeated.length === 0 ? t("ac.attendance.noRepeated") : undefined} min="20rem" head={[{ label: t("learn.student") }, { label: t("ac.absences"), right: true }]}>
                {att.repeated.map((r) => <tr key={r.studentId}><Cell><Link href={`/students/${r.studentId}`} className="font-semibold text-link hover:underline">{r.name}</Link><span className="block text-xs text-muted">{r.className ?? "—"} · {r.admissionNo}</span></Cell><Cell right className="text-bad">{r.absences}</Cell></tr>)}
              </DashTable>
            </Panel>
          </div>
        )}
      </DashSection>

      <DashSection id="performance" title={t("ac.performance")} subtitle={t("ac.performance.sub")}>
        {!perf ? <EmptyLine>{t("ac.performance.none")}</EmptyLine> : (
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title={t("ac.units")} subtitle={t("ac.units.sub", { total: perf.units.total })} right={<Link href="/marks" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
              {perf.units.total === 0 ? <EmptyLine>{t("ac.units.none")}</EmptyLine> : (
                <>
                  <div className="flex flex-wrap items-center gap-6">
                    <Ring value={Math.round(((perf.units.byStatus.LOCKED ?? 0) / perf.units.total) * 100)} size={116} stroke={9} tone="indigo" label={t("marks.status.LOCKED")}><span><span className="block text-3xl font-semibold tabular-nums text-heading">{Math.round(((perf.units.byStatus.LOCKED ?? 0) / perf.units.total) * 100)}%</span><span className="block text-[10px] font-bold uppercase tracking-[.14em] text-muted">{t("marks.status.LOCKED")}</span></span></Ring>
                    <div className="min-w-[14rem] flex-1"><StageBar label={t("ac.units")} summary={t("ac.units.sub", { total: perf.units.total })} items={(["DRAFT", "RETURNED", "SUBMITTED", "APPROVED", "LOCKED"] as const).map((k) => ({ label: t(`marks.status.${k}` as "marks.status.DRAFT"), value: perf.units.byStatus[k] ?? 0, color: { DRAFT: "#4b5a52", RETURNED: "#f3b94c", SUBMITTED: "#14a3b8", APPROVED: "#8b80ff", LOCKED: "#2fd08f" }[k] }))} /></div>
                  </div>
                  <p className="mt-4 text-sm text-muted">{t("ac.units.missing", { n: perf.units.missingMarks })} · {t("ac.units.overdue", { n: perf.units.overdue })}</p>
                </>
              )}
            </Panel>
            <Panel title={t("ac.cards")} subtitle={t("ac.cards.sub")} right={<Link href="/report-cards" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div><dt className="text-muted">{t("ac.cards.ready")}</dt><dd className="text-2xl font-semibold tabular-nums">{perf.cards.readyToPrepare}</dd></div>
                <div><dt className="text-muted">{t("ac.cards.generated")}</dt><dd className="text-2xl font-semibold tabular-nums">{perf.cards.generated}</dd></div>
                <div><dt className="text-muted">{t("ac.cards.published")}</dt><dd className="text-2xl font-semibold tabular-nums text-ok">{perf.cards.published}</dd></div>
              </dl>
            </Panel>
            <Panel title={t("ac.classAverages")} subtitle={t("ac.classAverages.sub")}>
              {perf.classAverages.length === 0 ? <EmptyLine>{t("ac.classAverages.none")}</EmptyLine> : <HBars items={perf.classAverages.map((c) => ({ label: `${c.className} (${c.students})`, value: c.average }))} format={(n) => `${n}%`} label={t("ac.classAverages")} summary={t("ac.classAverages.sub")} />}
            </Panel>
            <Panel title={t("ac.subjectAverages")} subtitle={t("ac.subjectAverages.sub")}>
              {perf.subjectAverages.length === 0 ? <EmptyLine>{t("ac.classAverages.none")}</EmptyLine> : <HBars items={perf.subjectAverages.map((s) => ({ label: s.name, value: s.average }))} format={(n) => `${n}%`} tone="#4f46e5" label={t("ac.subjectAverages")} summary={t("ac.subjectAverages.sub")} />}
            </Panel>
            <Panel title={t("ac.below")} subtitle={perf.threshold === null ? t("ac.below.noThreshold") : t("ac.below.sub", { n: perf.threshold })} className="lg:col-span-2" right={can("concern.manage") ? <Link href="/academic-office/concerns" className="text-sm font-semibold text-link hover:underline">{t("ac.concerns")}</Link> : undefined}>
              <DashTable empty={perf.below.length === 0 ? t("ac.below.none") : undefined} min="26rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("rc.average"), right: true }]}>
                {perf.below.map((b) => <tr key={b.studentId}><Cell><Link href={`/students/${b.studentId}`} className="font-semibold text-link hover:underline">{b.name}</Link></Cell><Cell>{b.className}</Cell><Cell right className="text-bad">{b.average}%</Cell></tr>)}
              </DashTable>
            </Panel>
          </div>
        )}
      </DashSection>

      {d.teachers && (
        <DashSection id="teachers" title={t("ac.teachers")} subtitle={t("ac.teachers.sub", { n: d.teachers.total })}>
          <Panel title={t("ac.teachers.outstanding")} right={<Link href="/dashboard" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
            <DashTable empty={d.teachers.withOutstanding.length === 0 ? t("ac.teachers.allDone") : undefined} min="30rem" head={[{ label: t("ac.teacher") }, { label: t("ac.registers"), right: true }, { label: t("ac.sheets"), right: true }, { label: t("ac.plans"), right: true }]}>
              {d.teachers.withOutstanding.map((x) => <tr key={x.staffId}><Cell className="font-semibold text-ink">{x.name}</Cell><Cell right className={x.registerDraft > 0 ? "text-sun" : ""}>{x.registerDraft}</Cell><Cell right className={x.sheetsOverdue > 0 ? "text-bad" : x.sheetsOpen > 0 ? "text-sun" : ""}>{x.sheetsOpen}{x.sheetsOverdue > 0 ? ` (${x.sheetsOverdue} ${t("task.overdue").toLowerCase()})` : ""}</Cell><Cell right>{x.planAwaiting}</Cell></tr>)}
            </DashTable>
          </Panel>
        </DashSection>
      )}

      <DashSection id="calendar" title={t("ac.calendar")} subtitle={t("ac.calendar.sub")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title={t("ac.calendar.exams")} right={<Link href="/exams" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
            {d.calendar.exams.length === 0 && d.calendar.sittings.length === 0 ? <EmptyLine>{t("ac.calendar.none")}</EmptyLine> : (
              <ul className="divide-y divide-line text-sm">
                {d.calendar.exams.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><Link href={`/exams/${e.id}`} className="font-medium text-link hover:underline">{e.name}</Link><span className="text-muted">{e.on ? fmt(e.on) : ""}{e.deadline ? ` · ${t("ac.deadline")} ${fmt(e.deadline)}` : ""}</span></li>)}
                {d.calendar.sittings.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{s.examName} · {s.className} · {s.subject}</span><span className="text-muted">{fmt(s.on)}{s.startsAt ? ` ${s.startsAt}` : ""}{s.venue ? ` · ${s.venue}` : ""}</span></li>)}
              </ul>
            )}
          </Panel>
          <Panel title={t("ac.calendar.other")} right={<Link href="/school-calendar" className="text-sm font-semibold text-link hover:underline">{t("dash.kpi.open")}</Link>}>
            {d.calendar.interviews.length === 0 && d.calendar.events.length === 0 ? <EmptyLine>{t("ac.calendar.none")}</EmptyLine> : (
              <ul className="divide-y divide-line text-sm">
                {d.calendar.interviews.map((i) => <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2"><Link href={`/admissions/${i.applicationId}`} className="font-medium text-link hover:underline">{t("ac.calendar.interview", { name: i.name })}</Link><span className="text-muted">{displayDateTime(i.at, school.timezone, ctx.locale)}</span></li>)}
                {d.calendar.events.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{e.title}</span><span className="text-muted">{fmt(e.on)}</span></li>)}
                {d.term && <li className="flex flex-wrap justify-between gap-2 py-2"><span>{t("ac.calendar.termEnds", { term: d.term.name })}</span><span className="text-muted">{fmt(d.term.endsOn)}</span></li>}
              </ul>
            )}
          </Panel>
        </div>
      </DashSection>

      {can("academic.manage") && (
        <DashSection id="settings" title={t("ac.settings")} subtitle={t("ac.settings.sub")}>
          <Panel title={t("ac.settings")}>
            <ActionForm action={updateAcademicSettingsAction} submitLabel={t("common.save")} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
              <Field name="lowAverage" type="number" label={t("ac.settings.low")} defaultValue={d.settings.lowAverage ?? ""} min={0} max={100} hint={t("ac.settings.low.hint")} />
              <Field name="repeatedAbsences" type="number" label={t("ac.settings.abs")} defaultValue={d.settings.repeatedAbsences} min={1} max={60} />
              <Field name="repeatedAbsenceDays" type="number" label={t("ac.settings.days")} defaultValue={d.settings.repeatedAbsenceDays} min={1} max={120} />
              <Field name="capacityWarnPct" type="number" label={t("ac.settings.cap")} defaultValue={d.settings.capacityWarnPct} min={1} max={100} />
            </ActionForm>
          </Panel>
        </DashSection>
      )}
      <p className="mt-8 flex items-center gap-2 text-xs text-muted"><CalendarDays className="size-3.5" aria-hidden /><ClipboardCheck className="size-3.5" aria-hidden /><FileCheck className="size-3.5" aria-hidden /> {t("ac.footnote")}</p>
      <Badge>{school.name}</Badge>
    </>
  );
}
