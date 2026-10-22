import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, CalendarCheck, CheckCircle2, ClipboardCheck, Circle, FileCheck, Inbox, Receipt, UserPlus, Users, Wallet } from "lucide-react";
import { displayDate } from "@/lib/dates";
import { LinkButton } from "@/components/ui";
import { DashHero, Hi } from "@/components/dash/hero";
import { Cell, DashSection, DashTable, DonutStat, EmptyLine, GradientTile, KpiCard, Panel, PersonCell, Pill } from "@/components/dash/parts";
import { JumpNav } from "@/components/dash/jump-nav";
import { Ring } from "@/components/dash/viz";
import type { HeadHome } from "@/server/head-home";
import type { adminHome } from "@/server/admin-home";
import { AdmissionsSection, AttentionSection, QueueSection, CalendarSection, ClassesSection, FeesSection, KpiSection, LearningSection, MyRegistersSection, PulseSection, ResultsSection, StudentsSection, type DashEnv } from "./sections";
import { ActionBar } from "@/components/dash/action-bar";
import type { Quick } from "@/components/dash/quick-links";
import { AttentionBlock, financeRows, headRows, standardRows } from "./attention";
import { DeskRow } from "./home";
import { quickItems } from "./quick";
import { compactMoney } from "./sections";
import { AccountantBody, HeadBody } from "./homes";
import { RegistrarBody } from "./registrar";
import type { RegistrarHome } from "@/server/registrar-home";

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
  const teachersPanel = (
    <div className="mt-4">
      {head && (
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
      )}
    </div>
  );
  return (
    <>
      <Greeting {...props} photoIndex={0}><Sentence bits={bits} empty={t("head.hero.calm")} /></Greeting>
      <ActionBar label={t("dash.quick.title")} items={quickItems("head", t, can, d.attention)} trailing={<Date_ env={env} today={props.today} />} />
      <AttentionBlock t={t} rows={[...standardRows(env, { queues: true }), ...financeRows(env), ...headRows(t, tot)]} />
      <DeskRow env={env} />

      {tot && (
        <ul className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          <li><GradientTile icon={Users} tone="orange" label={t("head.kpi.teachers")} value={tot.teachers} caption={tot.neverSignedIn > 0 ? t("head.kpi.teachers.never", { n: tot.neverSignedIn }) : t("head.kpi.teachers.cap")} /></li>
          <li><GradientTile icon={CalendarCheck} tone={tot.registersTotal > 0 && tot.registersFinalised < tot.registersTotal ? "rose" : "green"} label={t("head.kpi.registers")} value={tot.registersTotal === 0 ? "—" : `${tot.registersFinalised}/${tot.registersTotal}`} caption={t("head.kpi.registers.cap")} href="/attendance" /></li>
          <li><GradientTile icon={FileCheck} tone="teal" label={t("head.kpi.sheets")} value={tot.sheetsAwaiting} caption={tot.sheetsOverdue > 0 ? t("head.kpi.sheets.overdue", { n: tot.sheetsOverdue }) : t("head.kpi.sheets.cap")} href="/marks" /></li>
          <li><GradientTile icon={BookOpen} tone="indigo" label={t("head.kpi.plans")} value={tot.plansAwaiting} caption={t("head.kpi.plans.cap")} href="/planning" /></li>
          <li><GradientTile icon={Wallet} tone="violet" spark={d.finance && d.finance.trend.some((p) => p.cents > 0) ? running(d.finance.trend.map((p) => p.cents)) : undefined} label={t("dash.kpi.collected")} value={d.finance ? money(d.finance.collected) : "—"} caption={d.finance ? t("dash.kpi.outstanding.hint", { amount: money(d.finance.outstanding) }) : t("dash.unavailable")} href={d.finance ? "/finance" : undefined} /></li>
        </ul>
      )}

      <HeadBody env={env} teachers={teachersPanel} />
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
      <ActionBar label={t("dash.quick.title")} items={quickItems("accountant", t, can, d.attention)} trailing={<Date_ env={env} today={props.today} />} />
      <AttentionBlock t={t} rows={[...standardRows(env, { queues: true }), ...financeRows(env)]} />

      {f && (
        <ul className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]" aria-label={t("dash.money.title")}>
          <li><GradientTile icon={Wallet} tone="green" spark={f.trend.some((p) => p.cents > 0) ? running(f.trend.map((p) => p.cents)) : undefined} label={t("dash.kpi.collected")} value={`${env.school.currency} ${compactMoney(f.collected)}`} caption={f.ratePct !== null ? t("dash.kpi.collected.hint", { pct: String(f.ratePct) }) : undefined} href="/finance/payments" /></li>
          <li><GradientTile icon={Receipt} tone="violet" label={t("dash.money.billed")} value={`${env.school.currency} ${compactMoney(f.billed)}`} caption={f.term.name} href="/finance/invoices" /></li>
          <li><GradientTile icon={Receipt} tone="orange" label={t("dash.kpi.outstanding")} value={`${env.school.currency} ${compactMoney(f.outstanding)}`} caption={t("dash.money.notYet")} href="/finance/reports" /></li>
          <li><GradientTile icon={Receipt} tone="rose" label={t("dash.money.overdue")} value={`${env.school.currency} ${compactMoney(f.overdue)}`} caption={t("acc.kpi.overdue.cap")} href="/finance/reports" /></li>
          <li><GradientTile icon={Wallet} tone="indigo" label={t("dash.money.expenses")} value={`${env.school.currency} ${compactMoney(f.expenses)}`} caption={t("acc.kpi.expenses.cap")} href="/finance/expenses" /></li>
        </ul>
      )}
      {!f && <div className="mt-6"><EmptyLine>{t("acc.empty")}</EmptyLine></div>}

      <AccountantBody env={env} />
    </>
  );
}

/* ───────────────────────── Registrar ───────────────────────── */

export function RegistrarDashboard({ props, reg }: { props: HomeProps; reg: RegistrarHome | null }) {
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
      <ActionBar label={t("dash.quick.title")} items={quickItems("registrar", t, can, d.attention)} trailing={<Date_ env={env} today={props.today} />} />
      <AttentionBlock t={t} rows={standardRows(env, { queues: true, skip: ["registersOpen", "conflicts"] })} />
      <RegistrarBody env={env} reg={reg} />
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
