import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CalendarCheck, ClipboardList, FileDown, GraduationCap, Wallet } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, todayInTimezone } from "@/lib/dates";
import { childAcademicNotices, childFees, childOverview, childProgress, myChildren } from "@/server/portal";
import { childAssignments } from "@/server/assignments";
import { childTimetable } from "@/server/timetable";
import { isoWeekday, schoolTimezone } from "@/server/learning-access";
import { getSchoolBasics } from "@/server/settings";
import { ChildTiles } from "@/components/learning/child-tiles";
import { toneFor } from "@/components/learning/timetable-grid";
import { DashHero, Hi } from "@/components/dash/hero";
import { Cell, ColorBars, DashTable, DonutStat, EmptyLine, GradientTile, Panel, Pill } from "@/components/dash/parts";
import { MonthCard } from "@/components/dash/month-card";
import type { AttentionRow } from "@/components/dash/attention-tabs";
import { AttentionBlock } from "@/app/(app)/dashboard/attention";
import { N, Row, T, W } from "@/components/dash/rows";
import { formatMoney } from "@/lib/finance/money";

export const metadata: Metadata = { title: "My child" };
const TONE = { PRESENT: "ok", LATE: "warn", EXCUSED: "brand", ABSENT: "bad" } as const;
const COLOR = { PRESENT: "#0f9462", LATE: "#e0a100", EXCUSED: "#4f46e5", ABSENT: "#e5604d" } as const;

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
  const [many, fees, homework, tt, school, tz, progress, notices] = await Promise.all([
    myChildren(ctx).then((c) => c.length > 1),
    childFees(ctx, studentId),
    childAssignments(ctx, studentId),
    childTimetable(ctx, studentId).catch(() => null),
    getSchoolBasics(ctx.schoolId),
    schoolTimezone(ctx.schoolId),
    childProgress(ctx, studentId),
    childAcademicNotices(ctx, studentId),
  ]);
  const own = ctx.userType === "STUDENT";
  const todoItems = homework.items.filter((i) => !i.closed && !i.submission);
  const todo = todoItems.length;
  const latest = ov.reportCards[0];
  const { child, attendance: a } = ov;
  const klass = child.className ? `${child.className}${child.streamName ? ` ${child.streamName}` : ""}` : t("fam.notPlaced");
  const weekday = isoWeekday(tz);
  const periods = tt?.periods ?? [];
  const lessons = (tt?.lessons ?? []).filter((l) => l.dayOfWeek === weekday).map((l) => ({ ...l, period: periods.find((p) => p.id === l.periodId) })).sort((x, y) => (x.period?.sequence ?? 0) - (y.period?.sequence ?? 0));
  const owed = fees.summary.outstanding;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()));
  const first = ctx.fullName.split(" ")[0] ?? ctx.fullName;
  const bits = [
    a.ratePct !== null && <><Hi>{a.ratePct}%</Hi> {t("fam.hero.attendance")}</>,
    owed > 0 ? <><Hi tone="warn">{formatMoney(owed, fees.currency)}</Hi> {t("fam.hero.owed")}</> : t("fam.hero.nothingOwed"),
    todo > 0 && <><Hi tone="warn">{todo}</Hi> {todo === 1 ? t("fam.hero.homework.one") : t("fam.hero.homework")}</>,
    latest && latest.average !== null && <>{t("fam.hero.average")} <Hi>{latest.average.toFixed(1)}</Hi></>,
  ].filter(Boolean);
  const attSegments = (["PRESENT", "LATE", "EXCUSED", "ABSENT"] as const).map((k) => ({ label: t(`att.status.${k}`), value: a.counts[k], color: COLOR[k] }));

  const today = todayInTimezone(tz);
  const dateKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  const overdue = homework.items.filter((h) => !h.closed && !h.submission && h.overdue).length;
  const nextExam = [...notices.exams].sort((x, y) => +new Date(x.on) - +new Date(y.on)).find((e) => dateKey(e.on) >= today) ?? null;
  const rows: AttentionRow[] = [
    overdue > 0 && { key: "overdue", area: "homework", href: `/family/${child.id}/assignments`, text: t("fam.attention.overdue", { n: overdue }), detail: t("att.d.famOverdue"), tone: "bad" as const },
    todo - overdue > 0 && { key: "todo", area: "homework", href: `/family/${child.id}/assignments`, text: t("fam.attention.todo", { n: todo - overdue }), detail: t("att.d.famTodo"), tone: "warn" as const },
    owed > 0 && { key: "fees", area: "finance", href: `/family/${child.id}/fees`, text: t("fam.attention.fees", { amount: formatMoney(owed, fees.currency) }), detail: t("att.d.famFees"), tone: fees.summary.overdue > 0 ? "bad" as const : "warn" as const },
    nextExam && { key: "exam", area: "results", href: `/family/${child.id}`, text: t("fam.attention.exam", { subject: nextExam.subject, date: displayDate(nextExam.on, ctx.locale) }), detail: t("att.d.famExam"), tone: "info" as const },
    a.ratePct !== null && a.ratePct < 85 && { key: "att", area: "attendance", href: `/family/${child.id}#attendance`, text: t("fam.attention.attendance", { pct: a.ratePct }), detail: t("att.d.famAtt"), tone: "warn" as const },
  ].filter(Boolean) as AttentionRow[];
  const calExams = notices.exams.map((e) => dateKey(e.on));
  const calHomework = homework.items.filter((h) => !h.closed).map((h) => dateKey(h.dueAt));
  const more = (href: string, label: string) => <Link href={href} className="text-sm font-medium text-link hover:underline">{label}</Link>;

  return (
    <>
      {many && <Link href="/family" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("fam.allChildren")}</Link>}
      <DashHero photoIndex={2} eyebrow={`${school.name} · ${klass} · ${child.admissionNo}`.toUpperCase()} title={own ? t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: first }) : child.name}>
        {bits.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
      </DashHero>

      <AttentionBlock t={t} rows={rows} />

      <ul className="mt-6 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]" aria-label={t("dash.kpis")}>
        <li><GradientTile icon={CalendarCheck} tone={a.ratePct !== null && a.ratePct < 85 ? "rose" : "green"} label={t("fam.summary.attendance")} value={a.ratePct === null ? "—" : `${a.ratePct}%`} caption={ov.period?.label} /></li>
        <li><GradientTile icon={GraduationCap} tone="violet" label={t("fam.summary.report")} value={latest && latest.average !== null ? latest.average.toFixed(1) : "—"} caption={latest ? `${latest.term}${latest.position !== null ? ` · ${t("rc.position")} ${latest.position}/${latest.classSize}` : ""}` : t("fam.summary.noReport")} /></li>
        <li><GradientTile icon={ClipboardList} tone="teal" label={t("learn.fam.homework")} value={todo} caption={todo > 0 ? t("learn.fam.todoCount", { count: todo }) : homework.items.length > 0 ? t("fam.hw.allDone") : t("learn.fam.noHomework")} href={`/family/${child.id}/assignments`} /></li>
        <li><GradientTile icon={Wallet} tone={fees.summary.overdue > 0 ? "rose" : "orange"} label={t("fam.summary.fees")} value={owed > 0 ? formatMoney(owed, fees.currency) : t("fam.summary.nothingOwed")} caption={fees.summary.overdue > 0 ? t("fam.summary.overdue", { amount: formatMoney(fees.summary.overdue, fees.currency) }) : undefined} href={`/family/${child.id}/fees`} /></li>
      </ul>

      <Row>
        <Panel className={W} title={t("fam.sub.title")} subtitle={progress.latest ? `${progress.latest.term} · ${t("fam.sub.sub")}` : t("fam.sub.sub")}>
          {!progress.latest ? <EmptyLine>{t("fam.progress.none")}</EmptyLine> : <ColorBars label={t("fam.sub.title")} max={100} unit="%" labelWidth="8rem" items={progress.latest.subjects.map((x) => ({ label: x.name, value: x.percent, mark: x.classMean }))} />}
        </Panel>
        {a.recorded > 0 && (
          <Panel className={N} title={t("rc.attRate")} subtitle={ov.period?.label}>
            <DonutStat label={t("att.title")} segments={attSegments} center={<span className="text-3xl font-semibold tabular-nums text-ink">{a.ratePct === null ? "—" : `${a.ratePct}%`}</span>} caption={t("fam.recorded", { n: a.recorded })} />
          </Panel>
        )}
        <MonthCard className="flex-[1_1_19rem]" label={t("fam.cal.exams")} today={today} locale={ctx.locale} events={calExams} marked={calHomework} eventsLabel={t("fam.cal.exams")} markedLabel={t("fam.cal.homework")} />
      </Row>

      <Row>
        {progress.trend.filter((x) => x.average !== null).length > 0 && (
          <Panel className={T} title={t("fam.trend.title")} subtitle={progress.averageChange === null ? undefined : t(progress.averageChange >= 0 ? "fam.progress.up" : "fam.progress.down", { n: Math.abs(progress.averageChange).toFixed(1) })}>
            <ColorBars label={t("fam.trend.title")} max={100} labelWidth="6rem" items={progress.trend.filter((x) => x.average !== null).map((x) => ({ label: x.term, value: x.average as number }))} />
          </Panel>
        )}
        <Panel className={N} title={t("tch.today.lessons")} subtitle={lessons.length === 0 ? t("fam.day.noLessons") : t("fam.day.lessons", { n: lessons.length })} right={more(`/family/${child.id}/timetable`, t("learn.tt.title"))}>
          {lessons.length === 0 ? <EmptyLine>{t("fam.day.noLessons")}</EmptyLine> : (
            <ul className="space-y-2">
              {lessons.map((l) => (
                <li key={l.id} className={`flex items-center gap-4 rounded-xl p-3 ${toneFor(l.subjectName)}`}>
                  <div className="w-14 shrink-0 text-xs font-semibold opacity-80"><span className="block text-base">{l.period?.startTime}</span>{l.period?.endTime}</div>
                  <div className="min-w-0"><p className="truncate text-base font-bold">{l.subjectName}</p><p className="truncate text-sm opacity-80">{[l.teacherName, l.room].filter(Boolean).join(" · ")}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Row>

      <div className="mt-4">
        <ChildTiles tiles={[
          { key: "homework", href: `/family/${child.id}/assignments`, label: t("learn.fam.homework"), hint: todo > 0 ? t("learn.fam.todoCount", { count: todo }) : undefined, badge: todo },
          { key: "timetable", href: `/family/${child.id}/timetable`, label: t("learn.tt.title") },
          { key: "portfolio", href: `/family/${child.id}/portfolio`, label: t("learn.pf.title") },
          { key: "behaviour", href: `/family/${child.id}/behaviour`, label: t("learn.bh.familyTitle") },
          { key: "fees", href: `/family/${child.id}/fees`, label: t("fam.fees"), hint: t("fam.fees.hint") },
        ]} />
      </div>

      <Row>
        <Panel className={W} title={t("fam.hw.title")} subtitle={t("fam.hw.sub")} right={more(`/family/${child.id}/assignments`, t("dash.table.viewAll"))}>
          <DashTable min="22rem" empty={homework.items.length === 0 ? t("learn.fam.noHomework") : undefined} head={[{ label: t("learn.title") }, { label: t("learn.asg.due") }, { label: t("common.status") }]}>
            {homework.items.slice(0, 6).map((h) => (
              <tr key={h.id}>
                <Cell><Link href={`/family/${child.id}/assignments/${h.id}`} className="font-semibold text-link hover:underline">{h.title}</Link><span className="block text-xs text-muted">{h.subjectName}</span></Cell>
                <Cell className="whitespace-nowrap text-muted">{displayDate(h.dueAt, ctx.locale)}</Cell>
                <Cell>{h.submission ? <Pill tone={h.submission.released ? "ok" : "brand"}>{h.submission.released && h.submission.score !== null ? `${h.submission.score}${h.maxScore ? `/${h.maxScore}` : ""}` : t("learn.sub.handedIn")}</Pill> : h.overdue ? <Pill tone="bad">{t("learn.fam.overdue")}</Pill> : h.closed ? <Pill>{t("learn.asg.state.CLOSED")}</Pill> : <Pill tone="warn">{t("learn.fam.todo")}</Pill>}</Cell>
              </tr>
            ))}
          </DashTable>
        </Panel>
        {ov.recentAttendance.length > 0 && (
          <Panel className={N} title={t("fam.recentDays")}>
            <DashTable min="16rem" head={[{ label: t("learn.date") }, { label: t("common.status") }]}>
              {ov.recentAttendance.map((r) => (
                <tr key={r.id}><Cell>{displayDate(new Date(`${r.date}T00:00:00Z`), ctx.locale)}</Cell><Cell><Pill tone={TONE[r.status]}>{t(`att.status.${r.status}`)}</Pill></Cell></tr>
              ))}
            </DashTable>
          </Panel>
        )}
      </Row>

      {(notices.exams.length > 0 || notices.concerns.length > 0) && (
        <Row>
          {notices.exams.length > 0 && (
            <Panel className={W} title={t("fam.exams.title")} subtitle={t("fam.notices.sub")}>
              <ul className="divide-y divide-line text-sm">{notices.exams.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{e.examName} · {e.subject}</span><span className="text-muted">{displayDate(e.on, ctx.locale)}{e.startsAt ? ` ${e.startsAt}` : ""}{e.venue ? ` · ${e.venue}` : ""}</span></li>)}</ul>
            </Panel>
          )}
          {notices.concerns.length > 0 && (
            <Panel className={N} title={t("fam.concerns.title")}>
              <ul className="space-y-3 text-sm">{notices.concerns.map((c) => <li key={c.id}><p>{c.message}</p><p className="text-xs text-muted">{displayDate(c.at, ctx.locale)}</p></li>)}</ul>
            </Panel>
          )}
        </Row>
      )}

      <Row>
        <Panel className="flex-[1_1_100%]" title={t("fam.reportCards")} subtitle={t("fam.reports.sub")}>
          {ov.reportCards.length === 0 ? <EmptyLine>{t("fam.noReportCards")}</EmptyLine> : (
            <DashTable min="34rem" head={[{ label: t("rc.term") }, { label: t("res.average"), right: true }, { label: t("rc.grade") }, { label: t("rc.position"), right: true }, { label: "" }]}>
              {ov.reportCards.map((c) => (
                <tr key={c.id}>
                  <Cell><span className="font-semibold text-ink">{c.term}</span><span className="block text-xs text-muted">{c.className} · {t("fam.published", { date: displayDate(c.publishedAt, ctx.locale) })}</span></Cell>
                  <Cell right>{c.average === null ? "—" : c.average.toFixed(1)}</Cell>
                  <Cell>{c.grade ?? "—"}{c.division ? ` · ${c.division}` : ""}</Cell>
                  <Cell right>{c.position !== null ? `${c.position}/${c.classSize}` : "—"}</Cell>
                  <Cell right>
                    <span className="inline-flex gap-2">
                      <Link href={`/family/report-cards/${c.id}`} className="btn-secondary inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold">{t("common.view")}</Link>
                      <a href={`/api/report-cards/${c.id}`} target="_blank" rel="noopener" className="btn-primary inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold"><FileDown className="size-4" aria-hidden />{t("rc.pdf")}</a>
                    </span>
                  </Cell>
                </tr>
              ))}
            </DashTable>
          )}
        </Panel>
      </Row>
    </>
  );
}
