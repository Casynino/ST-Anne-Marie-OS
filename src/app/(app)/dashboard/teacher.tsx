import Link from "next/link";
import { ArrowRight, BookOpen, CalendarCheck, CalendarClock, ClipboardList, FileText, Users } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import type { DashboardData } from "@/server/dashboard";
import type { teacherHome } from "@/server/teacher-home";
import { DashHero, Hi } from "@/components/dash/hero";
import { Cell, ColorBars, DashTable, DonutStat, EmptyLine, GradientTile, Panel, PersonCell, Pill } from "@/components/dash/parts";
import { MonthCard } from "@/components/dash/month-card";
import type { AttentionRow } from "@/components/dash/attention-tabs";
import { AttentionBlock } from "./attention";
import { Row, N, T, W } from "@/components/dash/rows";
import type { Quick } from "@/components/dash/quick-links";
import { ActionBar } from "@/components/dash/action-bar";
import { toneFor } from "@/components/learning/timetable-grid";

const STATUS_COLOR = { PRESENT: "#2fd08f", LATE: "#f3b94c", EXCUSED: "#8b80ff", ABSENT: "#ff8574", NOT_MARKED: "#4b5a52" } as const;
const More = ({ href, label }: { href: string; label: string }) => <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{label}<ArrowRight className="size-4" aria-hidden /></Link>;

type Props = { t: Translate; locale: "EN" | "SW"; first: string; hour: number; schoolName: string; portal: string; today: string; d: DashboardData; th: Awaited<ReturnType<typeof teacherHome>>; quick: Quick[]; events: string[] };

/**
 * The teacher's own home. One strip of coloured numbers, then what needs them, today's lessons and registers, how their students are doing
 * today, who needs a word, and the work in hand. A figure is shown once.
 */
export function TeacherDashboard({ t, locale, first, hour, schoolName, portal, today, d, th, quick, events }: Props) {
  const regDone = d.myRegisters.filter((r) => r.status === "FINALISED").length;
  const registers = d.myRegisters.filter((r) => r.status !== "FINALISED");
  const sheets = d.exams?.mine ?? [];
  const messages = d.attention.find((a) => a.key === "messagesWaiting");
  const rows: AttentionRow[] = [
    registers.length > 0 && { key: "registers", area: "attendance", href: "/attendance", tone: "warn" as const, text: t("tch.todo.registers", { n: registers.length }), detail: t("att.d.tchRegisters") },
    sheets.length > 0 && { key: "sheets", area: "results", href: "/marks", tone: "warn" as const, text: t("tch.todo.sheets", { n: sheets.length }), detail: t("att.d.tchSheets") },
    th.homework.toMark > 0 && { key: "mark", area: "homework", href: "/assignments", tone: "info" as const, text: t("tch.todo.homework", { n: th.homework.toMark }), detail: t("att.d.tchMark") },
    th.plans.needs > 0 && { key: "plans", area: "planning", href: "/planning", tone: th.plans.returned > 0 ? "bad" as const : "info" as const, text: th.plans.returned > 0 ? t("tch.todo.plansReturned", { n: th.plans.returned }) : t("tch.todo.plans", { n: th.plans.needs }), detail: th.plans.returned > 0 ? t("att.d.tchPlansReturned") : t("att.d.tchPlans") },
    messages && { key: "messages", area: "messages", href: "/communication/messages", tone: "info" as const, text: t("dash.attention.messagesWaiting", { count: messages.count }), detail: t("att.d.messagesWaiting") },
  ].filter(Boolean) as AttentionRow[];
  const bits = [
    th.today.length > 0 && <><Hi>{th.today.length}</Hi> {th.today.length === 1 ? t("tch.hero.lessons.one") : t("tch.hero.lessons")}</>,
    registers.length > 0 && <><Hi tone="warn">{registers.length}</Hi> {registers.length === 1 ? t("tch.hero.registers.one") : t("tch.hero.registers")}</>,
    th.homework.toMark > 0 && <><Hi tone="warn">{th.homework.toMark}</Hi> {th.homework.toMark === 1 ? t("tch.hero.homework.one") : t("tch.hero.homework")}</>,
    sheets.length > 0 && <><Hi tone="warn">{sheets.length}</Hi> {sheets.length === 1 ? t("tch.hero.sheets.one") : t("tch.hero.sheets")}</>,
  ].filter(Boolean);
  const take = (r: (typeof d.myRegisters)[number]) => `/attendance/take?classId=${r.classId}${r.streamId ? `&streamId=${r.streamId}` : ""}&sessionId=${r.sessionId}&date=${today}`;

  // How the teacher's students are today, from the registers that are finalised (the rest are "not marked yet").
  const tally = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0, NOT_MARKED: 0 };
  for (const r of th.roster) tally[r.today ?? "NOT_MARKED"]++;
  const marked = th.roster.length - tally.NOT_MARKED;
  const watch = th.roster.filter((r) => r.ratePct !== null && r.ratePct < 85).sort((a, b) => (a.ratePct ?? 0) - (b.ratePct ?? 0)).slice(0, 6);
  const due = th.homework.rows.map((r) => r.dueAt.toISOString().slice(0, 10));

  return (
    <>
      <DashHero photoIndex={4} eyebrow={`${schoolName} · ${portal}`.toUpperCase()} title={t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: first })}>
        {bits.length > 0 ? bits.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>) : t("tch.hero.calm")}
      </DashHero>
      <ActionBar label={t("dash.quick.title")} items={quick} trailing={<span className="ml-auto text-sm text-muted">{displayDate(new Date(`${today}T00:00:00Z`), locale)}{d.term ? ` · ${d.term.name}` : ""}</span>} />

      <AttentionBlock t={t} rows={rows} />

      <ul className="mt-5 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]" aria-label={t("dash.kpis")}>
        {d.myRegisters.length > 0 && <li><GradientTile icon={CalendarCheck} tone={regDone === d.myRegisters.length ? "green" : "rose"} label={t("tch.kpi.registers")} value={`${regDone}/${d.myRegisters.length}`} caption={t("tch.kpi.registers.cap", { done: regDone, total: d.myRegisters.length })} href="/attendance" /></li>}
        <li><GradientTile icon={Users} tone="orange" label={t("tch.kpi.students")} value={th.studentCount} caption={t("tch.kpi.students.cap")} href="/students" /></li>
        <li><GradientTile icon={CalendarClock} tone="teal" label={t("tch.kpi.lessons")} value={th.today.length} caption={t("tch.kpi.lessons.cap")} href="/timetable" /></li>
        <li><GradientTile icon={ClipboardList} tone="violet" label={t("tch.kpi.homework")} value={th.homework.open} caption={t("tch.kpi.homework.cap", { n: th.homework.toMark })} href="/assignments" /></li>
        <li><GradientTile icon={FileText} tone="indigo" label={t("tch.kpi.plans")} value={th.plans.needs} caption={t("tch.kpi.plans.cap", { s: th.plans.schemes, l: th.plans.lessons })} href="/planning" /></li>
      </ul>

      <Row>
        <div className={`flex flex-col gap-4 ${W}`}>
        <Panel title={t("tch.today.lessons")} subtitle={th.today.length === 0 ? t("tch.today.none") : t("tch.today.lessons.sub", { n: th.today.length })} right={<More href="/timetable" label={t("learn.tt.title")} />}>
          {th.today.length === 0 ? <EmptyLine>{t("tch.today.none")}</EmptyLine> : (
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {th.today.map((l) => (
                <li key={l.id} className={`flex items-center gap-4 rounded-xl p-3 ${toneFor(l.subjectName)}`}>
                  <div className="w-14 shrink-0 text-xs font-semibold opacity-80"><span className="block text-base">{l.period?.startTime}</span>{l.period?.endTime}</div>
                  <div className="min-w-0"><p className="truncate text-base font-bold">{l.subjectName}</p><p className="truncate text-sm opacity-80">{l.className}{l.streamName ? ` ${l.streamName}` : ""}{l.room ? ` · ${l.room}` : ""}</p></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t("tch.today.registers")} subtitle={t("tch.today.registers.sub")} right={<More href="/attendance" label={t("dash.table.viewAll")} />}>
          {d.myRegisters.length === 0 ? <EmptyLine>{t("tch.today.noRegisters")}</EmptyLine> : (
            <ul className="space-y-2">
              {d.myRegisters.map((r) => (
                <li key={`${r.classId}-${r.streamId}`}>
                  <Link href={take(r)} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line bg-canvas/60 px-3.5 py-2 hover:border-link/50">
                    <span><span className="block font-semibold text-heading">{r.className}{r.streamName ? ` ${r.streamName}` : ""}</span><span className="text-xs text-muted">{t("dash.classes.students", { n: r.students })}</span></span>
                    <Pill tone={r.status === "FINALISED" ? "ok" : r.status === "DRAFT" ? "warn" : "neutral"}>{r.status === "FINALISED" ? t("dash.registers.FINALISED") : t("tch.today.take")}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        </div>
        <MonthCard className="flex-[1_1_19rem]" label={t("dash.events.title")} today={today} locale={locale} events={events} marked={due} eventsLabel={t("dash.events.title")} markedLabel={t("tch.cal.hw")} />
      </Row>

      <Row>
        {th.roster.length > 0 && (
          <Panel className={N} title={t("tch.donut.title")} subtitle={t("tch.donut.sub")}>
            <DonutStat label={t("tch.donut.title")} center={marked === 0 ? "—" : `${Math.round((tally.PRESENT / marked) * 100)}%`} caption={marked === 0 ? t("tch.donut.center") : t("att.status.PRESENT")} segments={[
              { label: t("att.status.PRESENT"), value: tally.PRESENT, color: STATUS_COLOR.PRESENT }, { label: t("att.status.LATE"), value: tally.LATE, color: STATUS_COLOR.LATE },
              { label: t("att.status.EXCUSED"), value: tally.EXCUSED, color: STATUS_COLOR.EXCUSED }, { label: t("att.status.ABSENT"), value: tally.ABSENT, color: STATUS_COLOR.ABSENT },
              { label: t("tch.students.notMarked"), value: tally.NOT_MARKED, color: STATUS_COLOR.NOT_MARKED },
            ]} />
          </Panel>
        )}
        {th.roster.length > 0 && (
          <Panel className={N} title={t("tch.watch.title")} subtitle={t("tch.watch.sub")}>
            {watch.length === 0 ? <p className="text-sm text-ok">{t("tch.watch.none")}</p> : (
              <ul className="divide-y divide-line">
                {watch.map((r) => <li key={r.id}><Link href={`/students/${r.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={r.name} sub={r.className ?? r.admissionNo} /><span className={`shrink-0 text-sm font-semibold tabular-nums ${(r.ratePct ?? 0) < 70 ? "text-bad" : "text-warn"}`}>{r.ratePct}%</span></Link></li>)}
              </ul>
            )}
          </Panel>
        )}
        {th.week.some((x) => x.count > 0) && (
          <Panel className={N} title={t("tch.week")} subtitle={t("tch.week.sub")}>
            <ColorBars label={t("tch.week")} labelWidth="6.5rem" max={Math.max(...th.week.map((x) => x.count), 1)} items={th.week.map((x) => ({ label: t(`learn.day.${x.day}` as "learn.day.1"), value: x.count }))} />
          </Panel>
        )}
        <Panel className={N} title={t("tch.classes.title")} subtitle={t("tch.classes.sub")}>
          {th.classes.length === 0 ? <EmptyLine>{t("learn.plan.noUnits")}</EmptyLine> : (
            <ul className="space-y-3">
              {th.classes.map((c) => (
                <li key={c.id} className="rounded-xl border border-line bg-canvas/50 p-3.5">
                  <div className="flex items-baseline justify-between gap-3"><h4 className="font-semibold text-heading">{c.className}</h4>{c.streams.length > 0 && <span className="text-xs text-muted">{c.streams.join(" · ")}</span>}</div>
                  <ul className="mt-2 flex flex-wrap gap-1.5">{c.subjects.map((s) => <li key={s} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${toneFor(s)}`}><BookOpen className="size-3" aria-hidden />{s}</li>)}</ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Row>

      <Row>
        <Panel className={W} title={t("dash.hw.title")} subtitle={t("dash.hw.sub", { open: th.homework.open, overdue: th.homework.rows.filter((r) => r.overdue).length })} right={<More href="/assignments" label={t("dash.table.viewAll")} />}>
          <DashTable empty={th.homework.rows.length === 0 ? t("learn.asg.none") : undefined} min="30rem" head={[{ label: t("learn.title") }, { label: t("learn.class") }, { label: t("learn.asg.due") }, { label: t("learn.asg.handedIn"), right: true }, { label: t("tch.work.toMark"), right: true }]}>
            {th.homework.rows.map((r) => <tr key={r.id}><Cell><Link href={`/assignments/${r.id}`} className="font-semibold text-link hover:underline">{r.title}</Link><span className="block text-xs text-muted">{r.subjectName}</span></Cell><Cell>{r.className}{r.streamName ? ` ${r.streamName}` : ""}</Cell><Cell className="whitespace-nowrap text-muted">{displayDate(r.dueAt, locale)}</Cell><Cell right>{r.handedIn}/{r.roster}</Cell><Cell right className={r.handedIn - r.marked > 0 ? "font-semibold text-warn" : "text-muted"}>{Math.max(0, r.handedIn - r.marked)}</Cell></tr>)}
          </DashTable>
        </Panel>
      </Row>

      <Row>
        <Panel className={W} title={t("dash.exams.mine")} subtitle={t("dash.exams.mine.sub")} right={<More href="/marks" label={t("dash.table.viewAll")} />}>
          <DashTable empty={sheets.length === 0 ? t("tch.work.noSheets") : undefined} min="28rem" head={[{ label: t("learn.subject") }, { label: t("learn.class") }, { label: t("dash.exams.progress"), right: true }, { label: t("common.status") }]}>
            {sheets.map((m) => <tr key={m.id}><Cell><Link href={`/marks/${m.id}`} className="font-semibold text-link hover:underline">{m.subjectName}</Link><span className="block text-xs text-muted">{m.examName}</span></Cell><Cell>{m.className}{m.streamName ? ` ${m.streamName}` : ""}</Cell><Cell right><span className="inline-flex items-center gap-2"><span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-sm bg-line"><span className="block h-full rounded-sm bg-ok" style={{ width: `${m.roster > 0 ? Math.round((m.entered / m.roster) * 100) : 0}%` }} /></span><span className="tabular-nums">{m.entered}/{m.roster}</span></span></Cell><Cell>{m.overdue ? <Pill tone="bad">{t("marks.overdue")}</Pill> : <Pill tone={m.status === "RETURNED" ? "warn" : "neutral"}>{t(`marks.status.${m.status}` as "marks.status.DRAFT")}</Pill>}</Cell></tr>)}
          </DashTable>
        </Panel>
        {th.applicantExams.length > 0 && (
          <Panel className={N} title={t("appexam.title")} subtitle={t("exam.dash.sub")} right={<More href="/applicant-exams" label={t("dash.table.viewAll")} />}>
            <ul className="divide-y divide-line">
              {th.applicantExams.map((x) => <li key={x.id}><Link href={`/applicant-exams/${x.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={x.applicant} sub={`${x.subject} · ${displayDate(x.interviewAt, locale)}`} /><Pill tone={x.label === "RETURNED" ? "bad" : x.label === "AWAITING_MARKING" ? "warn" : "neutral"}>{t(`exam.st.${x.label}` as "exam.st.SUBMITTED")}</Pill></Link></li>)}
            </ul>
          </Panel>
        )}
      </Row>

      <Row>
        {th.roster.length > 0 && (
          <Panel className={W} title={t("tch.students.title")} subtitle={th.rosterTotal > th.roster.length ? t("tch.students.more", { n: th.roster.length, total: th.rosterTotal }) : t("tch.students.sub", { n: th.rosterTotal })} right={<More href="/students" label={t("dash.table.viewAll")} />}>
            <DashTable min="34rem" head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("tch.students.today") }, { label: t("tch.students.rate"), right: true }]}>
              {th.roster.slice(0, 12).map((r) => (
                <tr key={r.id}>
                  <Cell><Link href={`/students/${r.id}`} className="hover:opacity-90"><PersonCell name={r.name} sub={r.admissionNo} /></Link></Cell>
                  <Cell>{r.className ?? "—"}</Cell>
                  <Cell>{r.today ? <Pill tone={r.today === "PRESENT" ? "ok" : r.today === "ABSENT" ? "bad" : r.today === "LATE" ? "warn" : "info"}>{t(`att.status.${r.today}`)}</Pill> : <span className="text-muted">{t("tch.students.notMarked")}</span>}</Cell>
                  <Cell right className={r.ratePct !== null && r.ratePct < 85 ? "font-semibold text-warn" : ""}>{r.ratePct === null ? "—" : `${r.ratePct}%`}</Cell>
                </tr>
              ))}
            </DashTable>
          </Panel>
        )}
        {th.behaviour.length > 0 && (
          <Panel className={N} title={t("tch.beh.title")} subtitle={t("tch.beh.sub")} right={<More href="/behaviour" label={t("dash.table.viewAll")} />}>
            <ul className="divide-y divide-line">
              {th.behaviour.map((b) => <li key={b.id} className="flex items-center justify-between gap-3 py-2.5"><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{b.studentName}</span><span className="block truncate text-xs text-muted">{b.category} · {displayDate(b.occurredOn, locale)}</span></span><Pill tone={b.type === "POSITIVE" ? "ok" : b.type === "CONCERN" ? "warn" : "bad"}>{t(`learn.bh.type.${b.type}`)}</Pill></li>)}
            </ul>
          </Panel>
        )}
      </Row>
    </>
  );
}
