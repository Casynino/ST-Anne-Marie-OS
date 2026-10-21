import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, CalendarCheck, CheckCircle2, ClipboardCheck, Circle, FileCheck, Inbox, Receipt, UserPlus, Users, Wallet } from "lucide-react";
import { displayDate } from "@/lib/dates";
import { LinkButton } from "@/components/ui";
import { DashHero, Hi } from "@/components/dash/hero";
import { Cell, DashSection, DashTable, DonutStat, EmptyLine, KpiCard, Panel, PersonCell, Pill } from "@/components/dash/parts";
import { JumpNav } from "@/components/dash/jump-nav";
import { Ring } from "@/components/dash/viz";
import type { HeadHome } from "@/server/head-home";
import type { adminHome } from "@/server/admin-home";
import { AdmissionsSection, AttentionSection, QueueSection, CalendarSection, ClassesSection, FeesSection, KpiSection, LearningSection, MyRegistersSection, PulseSection, ResultsSection, StudentsSection, type DashEnv } from "./sections";
import { QuickSection, jumpItems, quickItems } from "./quick";

/*
 * The home pages of the different staff roles. Each is a choice and an order of the shared sections (see sections.tsx) plus the few
 * panels that belong to the role alone: the teachers' overview for the head teacher, the money desk for the accountant, the admissions desk
 * for the registrar and the set-up checklist for the administrator.
 */

export type HomeProps = { env: DashEnv; first: string; hour: number; portal: string; today: string; can: (p: string) => boolean };

function Greeting({ env, first, hour, portal, children, photoIndex = 1 }: { env: DashEnv; first: string; hour: number; portal: string; children: ReactNode; photoIndex?: number }) {
  const { t, school } = env;
  return (
    <DashHero photoIndex={photoIndex} eyebrow={`${school.name} · ${portal}`.toUpperCase()} title={t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: first })}>
      {children}
    </DashHero>
  );
}

const Sentence = ({ bits, empty }: { bits: ReactNode[]; empty: string }) => <>{bits.length > 0 ? bits.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>) : empty}</>;

const running = (xs: number[]) => { let a = 0; return xs.map((x) => (a += x)); };

function Date_({ env, today }: { env: DashEnv; today: string }) {
  return <span className="ml-auto text-sm text-muted">{displayDate(new Date(`${today}T00:00:00Z`), env.locale)}{env.d.term ? ` · ${env.d.term.name}` : ""}</span>;
}

/* ───────────────────────── Head teacher ───────────────────────── */

export function HeadDashboard({ props, head }: { props: HomeProps; head: HeadHome | null }) {
  const { env, can } = props;
  const { t, locale, money, d } = env;
  const tot = head?.totals;
  const bits: ReactNode[] = [];
  if (tot && tot.teachers > 0) bits.push(<><Hi>{tot.teachers}</Hi> {t("head.hero.teachers")}</>);
  if (tot && tot.registersTotal > 0) bits.push(<><Hi tone={tot.registersFinalised === tot.registersTotal ? "ok" : "warn"}>{tot.registersFinalised}/{tot.registersTotal}</Hi> {t("head.hero.registers")}</>);
  if (tot && tot.sheetsAwaiting > 0) bits.push(<><Hi tone="warn">{tot.sheetsAwaiting}</Hi> {t("head.hero.sheets")}</>);
  if (tot && tot.plansAwaiting > 0) bits.push(<><Hi tone="warn">{tot.plansAwaiting}</Hi> {t("head.hero.plans")}</>);
  return (
    <>
      <Greeting {...props} photoIndex={0}><Sentence bits={bits} empty={t("head.hero.calm")} /></Greeting>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {can("results.approve") && <LinkButton href="/marks"><FileCheck className="size-4" aria-hidden /> {t("acts.approveMarks")}</LinkButton>}
        {can("plans.review") && <LinkButton href="/planning" variant="secondary">{t("acts.reviewPlans")}</LinkButton>}
        {can("attendance.take_any") && <LinkButton href="/attendance" variant="secondary"><ClipboardCheck className="size-4" aria-hidden /> {t("dash.takeAttendance")}</LinkButton>}
        {can("reportcard.generate") && <LinkButton href="/report-cards" variant="secondary">{t("nav.reportCards")}</LinkButton>}
        {can("academic.office") && <LinkButton href="/academic-office" variant="secondary">{t("nav.academicOffice")}</LinkButton>}
        <Date_ env={env} today={props.today} />
      </div>
      <JumpNav label={t("dash.jump")} items={jumpItems(env, ["quick", "queues", "attention", "pulse", "teachers", "classes", "results", "students", "learning", "calendar"], { teachers: !!head && t("head.teachers.title") })} />

      {tot && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <li><KpiCard icon={Users} label={t("head.kpi.teachers")} value={tot.teachers} caption={tot.neverSignedIn > 0 ? t("head.kpi.teachers.never", { n: tot.neverSignedIn }) : t("head.kpi.teachers.cap")} pill={tot.neverSignedIn > 0 ? { text: t("dash.pill.watch"), tone: "warn" } : { text: t("dash.pill.team"), tone: "info" }} /></li>
          <li><KpiCard icon={CalendarCheck} ring={tot.registersTotal > 0 ? Math.round((tot.registersFinalised / tot.registersTotal) * 100) : null} tone={tot.registersFinalised === tot.registersTotal ? "ok" : "warn"} label={t("head.kpi.registers")} value={tot.registersTotal === 0 ? "—" : `${tot.registersFinalised}/${tot.registersTotal}`} caption={t("head.kpi.registers.cap")} href="/attendance" openLabel={t("dash.kpi.open")} pill={tot.registersTotal === 0 ? { text: t("dash.pill.notStarted"), tone: "neutral" } : tot.registersFinalised === tot.registersTotal ? { text: t("dash.pill.onTrack"), tone: "ok" } : { text: t("dash.pill.watch"), tone: "warn" }} /></li>
          <li><KpiCard icon={FileCheck} label={t("head.kpi.sheets")} value={tot.sheetsAwaiting} caption={tot.sheetsOverdue > 0 ? t("head.kpi.sheets.overdue", { n: tot.sheetsOverdue }) : t("head.kpi.sheets.cap")} href="/marks" openLabel={t("dash.kpi.open")} pill={tot.sheetsAwaiting > 0 ? { text: t("dash.pill.new"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
          <li><KpiCard icon={BookOpen} label={t("head.kpi.plans")} value={tot.plansAwaiting} caption={t("head.kpi.plans.cap")} href="/planning" openLabel={t("dash.kpi.open")} pill={tot.plansAwaiting > 0 ? { text: t("dash.pill.new"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
          <li><KpiCard icon={Wallet} spark={d.finance && d.finance.trend.some((p) => p.cents > 0) ? running(d.finance.trend.map((p) => p.cents)) : undefined} label={t("dash.kpi.collected")} value={d.finance ? money(d.finance.collected) : "—"} caption={d.finance ? t("dash.kpi.outstanding.hint", { amount: money(d.finance.outstanding) }) : t("dash.unavailable")} href={d.finance ? "/finance" : undefined} openLabel={t("dash.kpi.open")} pill={d.finance ? { text: t("dash.pill.collected"), tone: "ok" } : undefined} /></li>
        </ul>
      )}

      <QuickSection t={t} items={quickItems("head", t, can, d.attention)} />
      <QueueSection env={env} />
      <AttentionSection env={env} />
      <PulseSection env={env} />

      {head && (
        <DashSection id="teachers" title={t("head.teachers.title")} subtitle={head.term ? t("head.teachers.sub", { term: head.term.name }) : t("head.teachers.sub.noterm")}>
          <Panel title={t("head.teachers.title")} subtitle={tot && tot.sheetsUnassigned > 0 ? t("head.unassigned", { n: tot.sheetsUnassigned }) : undefined} right={<Link href="/users" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <DashTable min="52rem" empty={head.teachers.length === 0 ? t("head.teachers.empty") : undefined} head={[{ label: t("head.col.teacher") }, { label: t("head.col.register") }, { label: t("head.col.sheets") }, { label: t("head.col.homework") }, { label: t("head.col.plans") }, { label: t("head.col.seen") }]}>
              {head.teachers.map((r) => (
                <tr key={r.staffId}>
                  <Cell><PersonCell name={r.name} sub={[...r.classes.map((c) => t("head.classTeacher", { c })), ...r.subjects].slice(0, 3).join(" · ") || r.jobTitle || "—"} /></Cell>
                  <Cell>{r.register === null ? <span className="text-muted">—</span> : r.register.finalised === r.register.total ? <Pill tone="ok">{t("head.reg.done", { done: r.register.finalised, total: r.register.total })}</Pill> : r.register.draft > 0 ? <Pill tone="warn">{t("head.reg.draft")}</Pill> : <Pill tone="neutral">{t("head.reg.none")}</Pill>}</Cell>
                  <Cell>{r.sheets.open + r.sheets.submitted + r.sheets.done === 0 ? <span className="text-muted">—</span> : <><span>{t("head.sheet.cell", { open: r.sheets.open, submitted: r.sheets.submitted })}</span>{r.sheets.overdue > 0 && <span className="block text-xs font-semibold text-bad">{t("head.sheet.overdue", { n: r.sheets.overdue })}</span>}</>}</Cell>
                  <Cell>{r.homework.open === 0 ? <span className="text-muted">—</span> : <span className={r.homework.toMark > 0 ? "text-sun" : ""}>{t("head.hw.cell", { open: r.homework.open, toMark: r.homework.toMark })}</span>}</Cell>
                  <Cell>{r.plans.drafts + r.plans.awaiting + r.plans.returned === 0 ? <span className="text-muted">—</span> : <span className={r.plans.awaiting > 0 ? "font-semibold text-sun" : ""}>{t("head.plan.cell", { drafts: r.plans.drafts, awaiting: r.plans.awaiting })}</span>}</Cell>
                  <Cell className="whitespace-nowrap text-muted">{r.lastLoginAt ? displayDate(r.lastLoginAt, locale) : <span className="text-warn">{t("head.seen.never")}</span>}</Cell>
                </tr>
              ))}
            </DashTable>
          </Panel>
        </DashSection>
      )}

      <ClassesSection env={env} />
      <ResultsSection env={env} />
      <StudentsSection env={env} />
      <LearningSection env={env} />
      <CalendarSection env={env} />
    </>
  );
}

/* ───────────────────────── Accountant ───────────────────────── */

export function AccountantDashboard({ props }: { props: HomeProps }) {
  const { env, can } = props;
  const { t, money, d } = env;
  const f = d.finance;
  const bits: ReactNode[] = [];
  if (f) {
    bits.push(<><Hi>{money(f.collected)}</Hi> {t("dash.hero.received")}</>);
    if (f.outstanding > 0) bits.push(<><Hi tone="warn">{money(f.outstanding)}</Hi> {t("dash.hero.owed")}</>);
    if (f.overdue > 0) bits.push(<><Hi tone="bad">{money(f.overdue)}</Hi> {t("acc.hero.overdue")}</>);
  }
  return (
    <>
      <Greeting {...props} photoIndex={2}><Sentence bits={bits} empty={t("acc.hero.empty")} /></Greeting>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {can("payment.record") && <LinkButton href="/finance/payments/new"><Wallet className="size-4" aria-hidden /> {t("acts.recordPayment")}</LinkButton>}
        <LinkButton href="/finance/invoices" variant="secondary"><Receipt className="size-4" aria-hidden /> {t("acts.invoices")}</LinkButton>
        <LinkButton href="/finance/fees" variant="secondary">{t("acts.fees")}</LinkButton>
        {can("expense.read") && <LinkButton href="/finance/expenses" variant="secondary">{t("acts.expenses")}</LinkButton>}
        {can("finance.reconcile") && <LinkButton href="/finance/reconciliation" variant="secondary">{t("acts.reconcile")}</LinkButton>}
        <Date_ env={env} today={props.today} />
      </div>
      <JumpNav label={t("dash.jump")} items={jumpItems(env, ["quick", "queues", "attention", "fees", "calendar"])} />

      {f && (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label={t("dash.money.title")}>
          <li><KpiCard icon={Wallet} ring={f.ratePct} spark={f.trend.some((p) => p.cents > 0) ? running(f.trend.map((p) => p.cents)) : undefined} label={t("dash.kpi.collected")} value={money(f.collected)} caption={f.ratePct !== null ? t("dash.kpi.collected.hint", { pct: String(f.ratePct) }) : undefined} href="/finance/payments" openLabel={t("dash.kpi.open")} pill={{ text: t("dash.pill.collected"), tone: "ok" }} /></li>
          <li><KpiCard icon={Receipt} label={t("dash.money.billed")} value={money(f.billed)} caption={f.term.name} href="/finance/invoices" openLabel={t("dash.kpi.open")} pill={{ text: t("dash.pill.active"), tone: "brand" }} /></li>
          <li><KpiCard icon={Receipt} label={t("dash.kpi.outstanding")} value={money(f.outstanding)} caption={t("dash.money.notYet")} href="/finance/reports" openLabel={t("dash.kpi.open")} pill={f.outstanding > 0 ? { text: t("dash.pill.watch"), tone: "warn" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
          <li><KpiCard icon={Receipt} label={t("dash.money.overdue")} value={money(f.overdue)} caption={t("acc.kpi.overdue.cap")} href="/finance/reports" openLabel={t("dash.kpi.open")} pill={f.overdue > 0 ? { text: t("dash.pill.overdue"), tone: "bad" } : { text: t("dash.pill.clear"), tone: "ok" }} /></li>
          <li><KpiCard icon={Wallet} label={t("dash.money.expenses")} value={money(f.expenses)} caption={t("acc.kpi.expenses.cap")} href="/finance/expenses" openLabel={t("dash.kpi.open")} pill={{ text: t("dash.pill.active"), tone: "neutral" }} /></li>
        </ul>
      )}
      {!f && <div className="mt-6"><EmptyLine>{t("acc.empty")}</EmptyLine></div>}

      <QuickSection t={t} items={quickItems("accountant", t, can, d.attention)} />
      <QueueSection env={env} />
      <AttentionSection env={env} />
      <FeesSection env={env} />
      <CalendarSection env={env} />
    </>
  );
}

/* ───────────────────────── Registrar ───────────────────────── */

export function RegistrarDashboard({ props }: { props: HomeProps }) {
  const { env, can } = props;
  const { t, d } = env;
  const enrolled = d.kpis.find((k) => k.key === "enrolled");
  const applied = d.pipeline?.find((p) => p.label === "APPLIED")?.value ?? 0;
  const enquiries = d.kpis.find((k) => k.key === "enquiries");
  const bits: ReactNode[] = [];
  if (enrolled) bits.push(<><Hi>{Number(enrolled.value).toLocaleString()}</Hi> {t("dash.hero.students")}</>);
  if (applied > 0) bits.push(<><Hi tone="warn">{applied}</Hi> {t("dash.hero.applications")}</>);
  if (enquiries && Number(enquiries.value) > 0) bits.push(<><Hi tone="warn">{String(enquiries.value)}</Hi> {t("reg.hero.enquiries")}</>);
  return (
    <>
      <Greeting {...props} photoIndex={4}><Sentence bits={bits} empty={t("dash.hero.empty")} /></Greeting>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {can("student.create") && <LinkButton href="/students/new"><UserPlus className="size-4" aria-hidden /> {t("dash.registerStudent")}</LinkButton>}
        {can("admission.create") && <LinkButton href="/admissions/new" variant="secondary">{t("dash.newApplication")}</LinkButton>}
        {can("student.import") && <LinkButton href="/students/import" variant="secondary">{t("acts.importStudents")}</LinkButton>}
        {can("enquiry.read") && <LinkButton href="/enquiries" variant="secondary"><Inbox className="size-4" aria-hidden /> {t("acts.enquiries")}</LinkButton>}
        <Date_ env={env} today={props.today} />
      </div>
      <JumpNav label={t("dash.jump")} items={jumpItems(env, ["quick", "queues", "school", "attention", "admissions", "students", "pulse", "classes", "calendar"])} />
      <QuickSection t={t} items={quickItems("registrar", t, can, d.attention)} />
      <QueueSection env={env} />
      <KpiSection env={env} />
      <AttentionSection env={env} />
      <AdmissionsSection env={env} />
      <StudentsSection env={env} />
      <PulseSection env={env} />
      <ClassesSection env={env} />
      <MyRegistersSection env={env} />
      <CalendarSection env={env} />
    </>
  );
}

/* ───────────────────────── Administrator ───────────────────────── */

export function SetupSection({ env, setup }: { env: DashEnv; setup: Awaited<ReturnType<typeof adminHome>> }) {
  const { t } = env;
  const total = setup.items.length;
  return (
    <DashSection id="setup" title={t("setup.title")} subtitle={t("setup.sub", { done: setup.doneCount, total })}>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel title={t("setup.checklist")} subtitle={setup.doneCount === total ? t("setup.allDone") : t("setup.todo")}>
          <div className="mb-5 flex items-center gap-5">
            <Ring value={Math.round((setup.doneCount / total) * 100)} size={88} stroke={11} label={t("setup.ring")}><span className="text-base font-semibold tabular-nums text-heading">{setup.doneCount}/{total}</span></Ring>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink">{t("setup.ring")}</p><div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-ok" style={{ width: `${Math.round((setup.doneCount / total) * 100)}%` }} /></div></div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {setup.items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className={`flex min-h-14 items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors hover:border-brand-500 ${i.done ? "border-ok/30 bg-canvas/60" : "border-warn/40 bg-canvas/60"}`}>
                  {i.done ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden /> : <Circle className="size-5 shrink-0 text-warn" aria-hidden />}
                  <span className="min-w-0 flex-1"><span className="block font-medium text-ink">{t(`setup.${i.key}`)}</span><span className="block text-xs text-muted">{i.done ? (i.count !== null ? t("setup.count", { n: i.count }) : t("setup.done")) : t("setup.todo.item")}</span></span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={t("setup.people.title")} subtitle={t("setup.people.sub")} right={<Link href="/users" className="text-sm font-semibold text-link hover:underline">{t("acts.users")}</Link>}>
          <DonutStat label={t("setup.people.title")} center={(setup.people.staff + setup.people.parents + setup.people.students).toLocaleString()} caption={t("setup.people.title")} segments={[{ label: t("setup.people.staff"), value: setup.people.staff, color: "#a066d9" }, { label: t("setup.people.parents"), value: setup.people.parents, color: "#14a3b8" }, { label: t("setup.people.students"), value: setup.people.students, color: "#e0a100" }]} />
          {setup.people.neverSignedIn > 0 && <p className="mt-4 rounded-xl bg-canvas/60 px-4 py-3 text-sm text-warn">{t("setup.people.never", { n: setup.people.neverSignedIn })}</p>}
          <div className="mt-4 flex flex-wrap gap-2"><LinkButton href="/roles" variant="secondary">{t("acts.roles")}</LinkButton><LinkButton href="/settings/system" variant="secondary">{t("acts.system")}</LinkButton><LinkButton href="/website" variant="secondary">{t("acts.website")}</LinkButton></div>
        </Panel>
      </div>
    </DashSection>
  );
}
