import Link from "next/link";
import { BookOpen, CalendarCheck, CalendarClock, ClipboardCheck, ClipboardList, FileText, Users } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import type { DashboardData } from "@/server/dashboard";
import type { teacherHome } from "@/server/teacher-home";
import { LinkButton } from "@/components/ui";
import { AttentionTabs } from "@/components/dash/attention-tabs";
import { DashHero, Hi } from "@/components/dash/hero";
import { Cell, DashSection, DashTable, EmptyLine, KpiCard, Panel, PersonCell, Pill } from "@/components/dash/parts";
import { JumpNav } from "@/components/dash/jump-nav";
import type { Quick } from "@/components/dash/quick-links";
import { ActionBar } from "@/components/dash/action-bar";
import { toneFor } from "@/components/learning/timetable-grid";

type Props = { t: Translate; locale: "EN" | "SW"; first: string; hour: number; schoolName: string; portal: string; today: string; d: DashboardData; th: Awaited<ReturnType<typeof teacherHome>>; quick: Quick[] };

/** The teacher's own home: today's lessons, what is waiting for them, and the classes they teach. */
export function TeacherDashboard({ t, locale, first, hour, schoolName, portal, today, d, th, quick }: Props) {
  const regDone = d.myRegisters.filter((r) => r.status === "FINALISED").length;
  const registers = d.myRegisters.filter((r) => r.status !== "FINALISED");
  const sheets = d.exams?.mine ?? [];
  const messages = d.attention.find((a) => a.key === "messagesWaiting");
  const rows = [
    registers.length > 0 && { key: "registers", area: "attendance", href: "/attendance", text: t("tch.todo.registers", { n: registers.length }) },
    sheets.length > 0 && { key: "sheets", area: "results", href: "/marks", text: t("tch.todo.sheets", { n: sheets.length }) },
    th.homework.toMark > 0 && { key: "mark", area: "homework", href: "/assignments", text: t("tch.todo.homework", { n: th.homework.toMark }) },
    th.plans.needs > 0 && { key: "plans", area: "planning", href: "/planning", text: th.plans.returned > 0 ? t("tch.todo.plansReturned", { n: th.plans.returned }) : t("tch.todo.plans", { n: th.plans.needs }) },
    messages && { key: "messages", area: "messages", href: "/communication/messages", text: t("dash.attention.messagesWaiting", { count: messages.count }) },
  ].filter(Boolean) as { key: string; area: string; href: string; text: string }[];
  const bits = [
    th.today.length > 0 && <><Hi>{th.today.length}</Hi> {th.today.length === 1 ? t("tch.hero.lessons.one") : t("tch.hero.lessons")}</>,
    registers.length > 0 && <><Hi tone="warn">{registers.length}</Hi> {registers.length === 1 ? t("tch.hero.registers.one") : t("tch.hero.registers")}</>,
    th.homework.toMark > 0 && <><Hi tone="warn">{th.homework.toMark}</Hi> {th.homework.toMark === 1 ? t("tch.hero.homework.one") : t("tch.hero.homework")}</>,
    sheets.length > 0 && <><Hi tone="warn">{sheets.length}</Hi> {sheets.length === 1 ? t("tch.hero.sheets.one") : t("tch.hero.sheets")}</>,
  ].filter(Boolean);
  const take = (r: (typeof d.myRegisters)[number]) => `/attendance/take?classId=${r.classId}${r.streamId ? `&streamId=${r.streamId}` : ""}&sessionId=${r.sessionId}&date=${today}`;

  return (
    <>
      <DashHero photoIndex={4} locale={locale} search={{ action: "/students", placeholder: t("search.students"), label: t("search.students"), button: t("common.search") }} eyebrow={`${schoolName} · ${portal}`.toUpperCase()} title={t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: first })}>
        {bits.length > 0 ? bits.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>) : t("tch.hero.calm")}
      </DashHero>
      <ActionBar label={t("dash.quick.title")} items={quick} trailing={<span className="ml-auto text-sm text-muted">{displayDate(new Date(`${today}T00:00:00Z`), locale)}{d.term ? ` · ${d.term.name}` : ""}</span>} />
      <JumpNav label={t("dash.jump")} items={[rows.length > 0 && { id: "todo", label: t("tch.todo.title") }, { id: "quick", label: t("dash.quick.title") }, { id: "today", label: t("tch.today.title") }, { id: "students", label: t("tch.students.title") }, { id: "mine", label: t("tch.classes.title") }, { id: "work", label: t("tch.work.title") }].filter(Boolean) as { id: string; label: string }[]} />

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {d.myRegisters.length > 0 && <li><KpiCard icon={CalendarCheck} ring={Math.round((regDone / d.myRegisters.length) * 100)} tone={regDone === d.myRegisters.length ? "ok" : "warn"} label={t("tch.kpi.registers")} value={`${regDone}/${d.myRegisters.length}`} caption={t("tch.kpi.registers.cap", { done: regDone, total: d.myRegisters.length })} href="/attendance" openLabel={t("dash.kpi.open")} pill={regDone === d.myRegisters.length ? { text: t("dash.pill.onTrack"), tone: "ok" } : { text: t("dash.pill.watch"), tone: "warn" }} /></li>}
        <li><KpiCard icon={Users} label={t("tch.kpi.students")} value={th.studentCount} caption={t("tch.kpi.students.cap")} pill={{ text: t("dash.pill.active"), tone: "brand" }} /></li>
        <li><KpiCard icon={CalendarClock} label={t("tch.kpi.lessons")} value={th.today.length} caption={t("tch.kpi.lessons.cap")} href="/timetable" openLabel={t("dash.kpi.open")} pill={{ text: t("dash.pill.live"), tone: "ok" }} /></li>
        <li><KpiCard icon={ClipboardList} label={t("tch.kpi.homework")} value={th.homework.open} caption={t("tch.kpi.homework.cap", { n: th.homework.toMark })} href="/assignments" openLabel={t("dash.kpi.open")} pill={th.homework.toMark > 0 ? { text: t("dash.pill.new"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
        <li><KpiCard icon={FileText} label={t("tch.kpi.plans")} value={th.plans.needs} caption={t("tch.kpi.plans.cap", { s: th.plans.schemes, l: th.plans.lessons })} href="/planning" openLabel={t("dash.kpi.open")} pill={th.plans.needs > 0 ? { text: t("dash.pill.watch"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
      </ul>

      {rows.length > 0 && (
        <DashSection id="todo" title={t("tch.todo.title")} subtitle={t("tch.todo.sub")}>
          <AttentionTabs allLabel={t("dash.attention.all")} rows={rows} areas={(["attendance", "results", "homework", "planning", "messages"] as const).map((x) => ({ id: x, label: t(`dash.area.${x}`) }))} />
        </DashSection>
      )}

      <DashSection id="today" title={t("tch.today.title")} subtitle={t("tch.today.sub")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title={t("tch.today.lessons")} subtitle={th.today.length === 0 ? t("tch.today.none") : t("tch.today.lessons.sub", { n: th.today.length })} right={<Link href="/timetable" className="text-sm font-semibold text-link hover:underline">{t("learn.tt.title")}</Link>}>
            {th.today.length === 0 ? <EmptyLine>{t("tch.today.none")}</EmptyLine> : (
              <ul className="space-y-2.5">
                {th.today.map((l) => (
                  <li key={l.id} className={`flex items-center gap-4 rounded-xl p-3 ${toneFor(l.subjectName)}`}>
                    <div className="w-16 shrink-0 text-xs font-semibold opacity-80"><span className="block text-base">{l.period?.startTime}</span>{l.period?.endTime}</div>
                    <div className="min-w-0"><p className="truncate text-base font-bold">{l.subjectName}</p><p className="truncate text-sm opacity-80">{l.className}{l.streamName ? ` ${l.streamName}` : ""}{l.room ? ` · ${l.room}` : ""}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t("tch.today.registers")} subtitle={t("tch.today.registers.sub")} right={<Link href="/attendance" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            {d.myRegisters.length === 0 ? <EmptyLine>{t("tch.today.noRegisters")}</EmptyLine> : (
              <ul className="space-y-2.5">
                {d.myRegisters.map((r) => (
                  <li key={`${r.classId}-${r.streamId}`}>
                    <Link href={take(r)} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-line bg-canvas/60 px-4 py-2.5 hover:border-brand-500">
                      <span><span className="block font-semibold text-heading">{r.className}{r.streamName ? ` ${r.streamName}` : ""}</span><span className="text-xs text-muted">{t("dash.classes.students", { n: r.students })}</span></span>
                      <Pill tone={r.status === "FINALISED" ? "ok" : r.status === "DRAFT" ? "warn" : "neutral"}>{r.status === "FINALISED" ? t("dash.registers.FINALISED") : t("tch.today.take")}</Pill>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </DashSection>

      <DashSection id="students" title={t("tch.students.title")} subtitle={t("tch.students.sub", { n: th.rosterTotal })}>
        <Panel title={t("tch.students.title")} subtitle={th.rosterTotal > th.roster.length ? t("tch.students.more", { n: th.roster.length, total: th.rosterTotal }) : undefined} right={<Link href="/students" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
          <DashTable min="34rem" empty={th.roster.length === 0 ? t("tch.students.none") : undefined} head={[{ label: t("learn.student") }, { label: t("learn.class") }, { label: t("tch.students.today") }, { label: t("tch.students.rate"), right: true }]}>
            {th.roster.map((r) => (
              <tr key={r.id}>
                <Cell><Link href={`/students/${r.id}`} className="hover:opacity-90"><PersonCell name={r.name} sub={r.admissionNo} /></Link></Cell>
                <Cell>{r.className ?? "—"}</Cell>
                <Cell>{r.today ? <Pill tone={r.today === "PRESENT" ? "ok" : r.today === "ABSENT" ? "bad" : r.today === "LATE" ? "warn" : "info"}>{t(`att.status.${r.today}`)}</Pill> : <span className="text-muted">{t("tch.students.notMarked")}</span>}</Cell>
                <Cell right className={r.ratePct !== null && r.ratePct < 85 ? "font-semibold text-sun" : ""}>{r.ratePct === null ? "—" : `${r.ratePct}%`}</Cell>
              </tr>
            ))}
          </DashTable>
        </Panel>
      </DashSection>

      <DashSection id="mine" title={t("tch.classes.title")} subtitle={t("tch.classes.sub")}>
        {th.classes.length === 0 ? <EmptyLine>{t("learn.plan.noUnits")}</EmptyLine> : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {th.classes.map((c) => (
              <li key={c.id} className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between gap-3"><h3 className="text-xl font-semibold text-heading">{c.className}</h3>{c.streams.length > 0 && <span className="text-sm text-muted">{c.streams.join(" · ")}</span>}</div>
                <ul className="mt-3 flex flex-wrap gap-1.5">{c.subjects.map((s) => <li key={s} className="inline-flex items-center gap-1.5 rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-link"><BookOpen className="size-3" aria-hidden />{s}</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
      </DashSection>

      <DashSection id="work" title={t("tch.work.title")} subtitle={t("tch.work.sub")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title={t("dash.hw.title")} subtitle={t("dash.hw.sub", { open: th.homework.open, overdue: th.homework.rows.filter((r) => r.overdue).length })} right={<Link href="/assignments" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <DashTable empty={th.homework.rows.length === 0 ? t("learn.asg.none") : undefined} min="30rem" head={[{ label: t("learn.title") }, { label: t("learn.class") }, { label: t("learn.asg.due") }, { label: t("learn.asg.handedIn"), right: true }, { label: t("tch.work.toMark"), right: true }]}>
              {th.homework.rows.map((r) => <tr key={r.id}><Cell><Link href={`/assignments/${r.id}`} className="font-semibold text-link hover:underline">{r.title}</Link><span className="block text-xs text-muted">{r.subjectName}</span></Cell><Cell>{r.className}{r.streamName ? ` ${r.streamName}` : ""}</Cell><Cell className="whitespace-nowrap text-muted">{displayDate(r.dueAt, locale)}</Cell><Cell right>{r.handedIn}/{r.roster}</Cell><Cell right className={r.handedIn - r.marked > 0 ? "font-semibold text-sun" : "text-muted"}>{Math.max(0, r.handedIn - r.marked)}</Cell></tr>)}
            </DashTable>
          </Panel>
          <Panel title={t("dash.exams.mine")} subtitle={t("dash.exams.mine.sub")} right={<Link href="/marks" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <DashTable empty={sheets.length === 0 ? t("tch.work.noSheets") : undefined} min="28rem" head={[{ label: t("learn.subject") }, { label: t("learn.class") }, { label: t("dash.exams.progress"), right: true }, { label: t("common.status") }]}>
              {sheets.map((m) => <tr key={m.id}><Cell><Link href={`/marks/${m.id}`} className="font-semibold text-link hover:underline">{m.subjectName}</Link><span className="block text-xs text-muted">{m.examName}</span></Cell><Cell>{m.className}{m.streamName ? ` ${m.streamName}` : ""}</Cell><Cell right><span className="inline-flex items-center gap-2"><span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-ok" style={{ width: `${m.roster > 0 ? Math.round((m.entered / m.roster) * 100) : 0}%` }} /></span><span className="tabular-nums">{m.entered}/{m.roster}</span></span></Cell><Cell>{m.overdue ? <Pill tone="bad">{t("marks.overdue")}</Pill> : <Pill tone={m.status === "RETURNED" ? "warn" : "neutral"}>{t(`marks.status.${m.status}` as "marks.status.DRAFT")}</Pill>}</Cell></tr>)}
            </DashTable>
          </Panel>
          {th.applicantExams.length > 0 && (
            <Panel title={t("appexam.title")} subtitle={t("exam.dash.sub")} className="lg:col-span-2" right={<Link href="/applicant-exams" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
              <DashTable min="30rem" head={[{ label: t("adm.applicant") }, { label: t("exam.col.subject") }, { label: t("exam.col.interview") }, { label: t("common.status") }]}>
                {th.applicantExams.map((x) => <tr key={x.id}><Cell><Link href={`/applicant-exams/${x.id}`} className="font-semibold text-link hover:underline">{x.applicant}</Link><span className="block text-xs text-muted">{x.applicationNo}</span></Cell><Cell>{x.subject}</Cell><Cell className="whitespace-nowrap text-muted">{displayDate(x.interviewAt, locale)}</Cell><Cell><Pill tone={x.label === "RETURNED" ? "bad" : x.label === "AWAITING_MARKING" ? "warn" : "neutral"}>{t(`exam.st.${x.label}` as "exam.st.SUBMITTED")}</Pill></Cell></tr>)}
              </DashTable>
            </Panel>
          )}
          {th.behaviour.length > 0 && (
            <Panel title={t("tch.beh.title")} subtitle={t("tch.beh.sub")} className="lg:col-span-2" right={<Link href="/behaviour" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
              <DashTable min="30rem" head={[{ label: t("learn.date") }, { label: t("learn.student") }, { label: t("learn.bh.type") }, { label: t("learn.bh.category") }]}>
                {th.behaviour.map((b) => <tr key={b.id}><Cell className="whitespace-nowrap text-muted">{displayDate(b.occurredOn, locale)}</Cell><Cell className="font-semibold text-ink">{b.studentName}</Cell><Cell><Pill tone={b.type === "POSITIVE" ? "ok" : b.type === "CONCERN" ? "warn" : "bad"}>{t(`learn.bh.type.${b.type}`)}</Pill></Cell><Cell>{b.category}</Cell></tr>)}
              </DashTable>
            </Panel>
          )}
        </div>
      </DashSection>
    </>
  );
}
