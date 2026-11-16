import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2, ClipboardCheck, Hourglass, Percent, UserX } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, todayInTimezone, parseDateOnly } from "@/lib/dates";
import { countPendingConflicts } from "@/server/attendance";
import { attendanceDesk } from "@/server/attendance-desk";
import { getSchoolBasics } from "@/server/settings";
import { EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { AttendanceNav } from "@/components/attendance/subnav";
import { OfflinePanel } from "@/components/attendance/offline-panel";
import { AreaChart } from "@/components/dash/charts-client";
import { Cell, ColorBars, DonutStat, EmptyLine, GradientTile, Panel, PersonCell, Pill, StackedBars } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";

export const metadata: Metadata = { title: "Attendance" };
type Search = { date?: string };
const TONE = { NOT_STARTED: "neutral", DRAFT: "warn", FINALISED: "ok" } as const;
const COLOR = { PRESENT: "#2fd08f", LATE: "#f3b94c", EXCUSED: "#8b80ff", ABSENT: "#ff8574", NOT_MARKED: "#4b5a52" } as const;

/**
 * The attendance desk. Registers come first (one line per class: who is done, who is not, how the marks fall), then the pictures that explain
 * them: the day in numbers, class by class, the last two weeks, the teachers' registers, and the students who are away most often.
 */
export default async function AttendancePage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"])) return <NoAccess t={t} />;
  const school = await getSchoolBasics(ctx.schoolId);
  const sp = await searchParams;
  const today = todayInTimezone(school.timezone);
  const date = sp.date && parseDateOnly(sp.date) ? sp.date : today;
  const canTake = hasAny(ctx, ["attendance.take", "attendance.take_any"]);

  let desk: Awaited<ReturnType<typeof attendanceDesk>> | null = null;
  let problem: string | null = null;
  try {
    desk = await attendanceDesk(ctx, date);
  } catch (e) {
    if (e instanceof AppError) problem = e.fieldErrors?.date ? t("att.noYear") : e.message;
    else throw e;
  }
  const conflicts = await countPendingConflicts(ctx);
  const header = (
    <>
      <PageHeader title={t("att.title")} />
      <AttendanceNav ctx={ctx} t={t} current="/attendance" conflicts={conflicts} />
      {canTake && <OfflinePanel userId={ctx.userId} locale={ctx.locale} timezone={school.timezone} fullName={ctx.fullName} canTake />}
    </>
  );
  if (problem) return <>{header}<EmptyState>{problem}</EmptyState></>;
  if (!desk || desk.overview.rows.length === 0) return <>{header}<EmptyState>{t("att.noClasses")}</EmptyState></>;

  const { overview, daily, classRates, topAbsent, teachers, schoolDays, teacherOf } = desk;
  const showSession = overview.sessions.length > 1 || overview.settings.mode === "PER_SESSION";
  const sessionName = (id: string) => {
    const s = overview.sessions.find((x) => x.id === id);
    return ctx.locale === "SW" && s?.nameSw ? s.nameSw : (s?.name ?? "");
  };
  // A class with nobody in it has no register to take, so it is left out of the list and the counts.
  const lines = overview.rows.filter((r) => r.studentCount > 0).flatMap((r) => r.cells.map((c) => ({ r, c })));
  const done = lines.filter((l) => l.c.status === "FINALISED");
  const sum = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0 };
  for (const l of done) for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += l.c.counts[k];
  const marked = sum.PRESENT + sum.LATE + sum.EXCUSED + sum.ABSENT;
  const everyone = overview.rows.reduce((n, r) => n + r.studentCount * r.cells.length, 0);
  const present = sum.PRESENT + (overview.settings.lateCountsAsPresent ? sum.LATE : 0) + (overview.settings.excusedCountsAsPresent ? sum.EXCUSED : 0);
  const rate = marked ? Math.round((present / marked) * 1000) / 10 : null;
  const notStarted = lines.filter((l) => l.c.status === "NOT_STARTED").length;
  const trend = daily.filter((d) => d.rate !== null);
  const fmtDay = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), ctx.locale).slice(0, 6);
  const floor = trend.length ? Math.max(0, Math.floor((Math.min(...trend.map((d) => d.rate as number)) - 5) / 10) * 10) : 0;

  return (
    <>
      {header}

      <ul className="mt-1 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]" aria-label={t("att.title")}>
        <li><GradientTile icon={ClipboardCheck} tone={done.length === lines.length ? "green" : "orange"} label={t("attd.tile.done")} value={`${done.length}/${lines.length}`} caption={t("attd.tile.done.cap", { total: lines.length })} /></li>
        <li><GradientTile icon={Percent} tone={rate !== null && rate < overview.settings.lowThresholdPct ? "rose" : "teal"} label={t("attd.tile.rate")} value={rate === null ? "—" : `${rate}%`} caption={t("attd.tile.rate.cap")} /></li>
        <li><GradientTile icon={UserX} tone={sum.ABSENT > 0 ? "rose" : "green"} label={t("attd.tile.absent")} value={sum.ABSENT} caption={t("attd.tile.absent.cap")} /></li>
        <li><GradientTile icon={Hourglass} tone="indigo" label={t("attd.tile.todo")} value={notStarted} caption={t("attd.tile.todo.cap")} /></li>
      </ul>

      <Row>
        <Panel className="flex-[3_1_42rem]" title={t("attd.regs")} subtitle={t("attd.regs.sub", { date: displayDate(parseDateOnly(overview.date) as Date, ctx.locale) })}
          right={<form method="get" className="flex items-center gap-2"><label className="sr-only" htmlFor="att-date">{t("attd.date")}</label><input id="att-date" type="date" name="date" defaultValue={date} className="min-h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink" /><button className="btn-secondary min-h-9 px-3 text-sm">{t("common.filter")}</button>{sp.date && <Link href="/attendance" className="text-sm text-muted hover:text-ink hover:underline">{t("common.clear")}</Link>}</form>}>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted">
                <th className="px-5 py-2.5">{t("learn.class")}</th><th className="px-3 py-2.5 text-right">{t("attd.col.students")}</th><th className="px-3 py-2.5">{t("attd.col.register")}</th><th className="px-3 py-2.5">{t("attd.col.marks")}</th><th className="px-5 py-2.5" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {lines.map(({ r, c }) => {
                  const href = `/attendance/take?classId=${r.classId}${r.streamId ? `&streamId=${r.streamId}` : ""}&sessionId=${c.sessionId}&date=${overview.date}`;
                  const fin = c.status === "FINALISED";
                  const label = fin ? t("att.view") : r.canTake ? (c.status === "DRAFT" ? t("att.continue") : t("att.take")) : t("att.view");
                  const primary = r.canTake && !fin;
                  const total = r.studentCount || 1;
                  const mine = teacherOf(r.classId, r.streamId);
                  return (
                    <tr key={`${r.classId}-${r.streamId}-${c.sessionId}`} className="hover:bg-canvas/50">
                      <Cell className="py-2.5"><span className="font-medium text-ink">{r.className}{r.streamName ? ` · ${r.streamName}` : ""}</span>{showSession && <span className="ml-2 text-xs text-muted">{sessionName(c.sessionId)}</span>}<span className="block text-xs text-muted">{mine.length ? mine.join(", ") : t("student.class.noTeacher")}</span></Cell>
                      <Cell right className="py-2.5">{r.studentCount}</Cell>
                      <Cell className="py-2.5"><Pill tone={TONE[c.status]}>{c.status === "NOT_STARTED" ? t("att.notStarted") : c.status === "DRAFT" ? t("att.draft") : t("att.finalised")}</Pill></Cell>
                      <Cell className="py-2.5">
                        {c.status === "NOT_STARTED" ? <span className="text-muted">—</span> : (
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-2 w-24 shrink-0 overflow-hidden rounded-sm bg-line" role="img" aria-label={`${t("att.status.PRESENT")} ${c.counts.PRESENT}, ${t("att.status.LATE")} ${c.counts.LATE}, ${t("att.status.EXCUSED")} ${c.counts.EXCUSED}, ${t("att.status.ABSENT")} ${c.counts.ABSENT}`}>
                              {(["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const).map((k) => <span key={k} className="h-full" style={{ width: `${(c.counts[k] / total) * 100}%`, background: COLOR[k] }} title={`${t(`att.status.${k}`)}: ${c.counts[k]}`} />)}
                            </span>
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted"><span className="text-ink">{c.counts.PRESENT}</span> · <span className={c.counts.ABSENT > 0 ? "text-bad" : ""}>{c.counts.ABSENT}</span></span>
                          </span>
                        )}
                      </Cell>
                      <Cell right className="py-2.5"><Link href={href} className={`btn-sm inline-flex items-center font-medium ${primary ? "btn-primary" : "btn-secondary"}`}>{label}</Link></Cell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            {(["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const).map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: COLOR[k] }} />{t(`att.status.${k}`)}</span>)}
            <span>{t("att.status.PRESENT")} · {t("att.status.ABSENT")}</span>
          </p>
        </Panel>

        <div className="flex flex-[1_1_19rem] flex-col gap-4">
          <Panel title={t("attd.today")}>
            <DonutStat label={t("attd.today")} center={everyone} caption={t("attd.today.center")} segments={[
              { label: t("att.status.PRESENT"), value: sum.PRESENT, color: COLOR.PRESENT }, { label: t("att.status.LATE"), value: sum.LATE, color: COLOR.LATE },
              { label: t("att.status.EXCUSED"), value: sum.EXCUSED, color: COLOR.EXCUSED }, { label: t("att.status.ABSENT"), value: sum.ABSENT, color: COLOR.ABSENT },
              { label: t("attd.today.notMarked"), value: Math.max(0, everyone - marked), color: COLOR.NOT_MARKED },
            ]} />
          </Panel>
          {classRates.length > 0 && (
            <Panel title={t("attd.byClass")} subtitle={t("attd.byClass.sub")}>
              <ColorBars label={t("attd.byClass")} max={100} unit="%" labelWidth="5.5rem" items={classRates.filter((c) => c.ratePct !== null).map((c) => ({ label: c.name, value: c.ratePct as number, mark: overview.settings.lowThresholdPct }))} />
            </Panel>
          )}
        </div>
      </Row>

      {trend.length > 0 ? (
        <Row>
          <Panel className="flex-[1_1_26rem]" title={t("home.attendance14")} subtitle={t("dash.pulse.attendance.sub")} right={<Link href="/attendance/reports" className="text-sm font-medium text-link hover:underline">{t("dash.chart.attendance.link")}</Link>}>
            {trend.length < 2 ? <EmptyLine>{t("attd.nodata")}</EmptyLine> : <AreaChart height={230} label={t("home.attendance14")} summary={t("dash.pulse.attendance.sub")} kind="percent" yMin={floor} yMax={100} goal={{ value: overview.settings.lowThresholdPct, label: `${overview.settings.lowThresholdPct}%` }} points={trend.map((d) => ({ key: d.date, label: fmtDay(d.date), value: d.rate as number }))} />}
          </Panel>
          <Panel className="flex-[1_1_26rem]" title={t("dash.chart.attendance")} subtitle={t("dash.chart.attendance.sub")}>
            <StackedBars points={daily.map((d) => ({ key: d.date, label: fmtDay(d.date), parts: { PRESENT: d.counts.PRESENT, LATE: d.counts.LATE, EXCUSED: d.counts.EXCUSED, ABSENT: d.counts.ABSENT } }))} series={[{ key: "PRESENT", label: t("att.status.PRESENT") }, { key: "LATE", label: t("att.status.LATE"), color: "#e0a100" }, { key: "EXCUSED", label: t("att.status.EXCUSED"), color: "#4f46e5" }, { key: "ABSENT", label: t("att.status.ABSENT"), color: "#e5604d" }]} label={t("dash.chart.attendance")} summary={t("dash.chart.attendance.sub")} />
          </Panel>
        </Row>
      ) : (
        <Row><Panel className="flex-[1_1_100%]" title={t("home.attendance14")}><EmptyLine>{t("attd.nodata")}</EmptyLine></Panel></Row>
      )}

      <Row>
        {desk.allScope && (
          <Panel className="flex-[2_1_34rem]" title={t("attd.teachers")} subtitle={t("attd.teachers.sub", { n: schoolDays })}>
            {teachers.length === 0 ? <EmptyLine>{t("attd.teachers.none")}</EmptyLine> : (
              <div className="-mx-5 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-sm">
                  <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted"><th className="px-5 py-2.5">{t("attd.teacher")}</th><th className="px-3 py-2.5">{t("learn.class")}</th><th className="px-3 py-2.5">{t("attd.teacher.days")}</th><th className="px-5 py-2.5 text-right">{t("attd.teacher.rate")}</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {teachers.map((x) => {
                      const pct = schoolDays > 0 ? Math.round((x.finalisedDays / schoolDays) * 100) : 0;
                      return (
                        <tr key={x.staffId} className="hover:bg-canvas/50">
                          <Cell className="py-2.5"><PersonCell name={x.name} /></Cell>
                          <Cell className="py-2.5 text-muted">{x.classes.join(", ")}</Cell>
                          <Cell className="py-2.5">
                            <span className="flex items-center gap-2.5">
                              <span className="h-2 w-28 overflow-hidden rounded-sm bg-line" role="img" aria-label={t("attd.teacher.days.of", { n: x.finalisedDays, total: schoolDays })}><span className={`block h-full rounded-sm ${pct >= 90 ? "bg-ok" : pct >= 60 ? "bg-warn" : "bg-bad"}`} style={{ width: `${pct}%` }} /></span>
                              <span className="whitespace-nowrap text-xs tabular-nums text-muted">{t("attd.teacher.days.of", { n: x.finalisedDays, total: schoolDays })}</span>
                            </span>
                          </Cell>
                          <Cell right className={`py-2.5 ${x.ratePct !== null && x.ratePct < overview.settings.lowThresholdPct ? "font-semibold text-warn" : ""}`}>{x.ratePct === null ? "—" : `${x.ratePct}%`}</Cell>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}
        <Panel className="flex-[1_1_20rem]" title={t("attd.watch")} subtitle={t("attd.watch.sub")}>
          {topAbsent.length === 0 ? <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="size-4 shrink-0" aria-hidden />{t("attd.watch.none")}</p> : (
            <ul className="divide-y divide-line">
              {topAbsent.map((s) => (
                <li key={s.studentId}><Link href={`/students/${s.studentId}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={s.name} sub={`${s.className ?? "—"} · ${s.admissionNo}`} /><span className={`shrink-0 text-sm font-semibold tabular-nums ${s.absences >= 5 ? "text-bad" : "text-warn"}`}>{t("attd.watch.times", { n: s.absences })}</span></Link></li>
              ))}
            </ul>
          )}
        </Panel>
      </Row>
    </>
  );
}
