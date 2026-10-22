import type { ReactNode } from "react";
import type { Metadata } from "next";
import { CalendarDays, ClipboardCheck, UserPlus } from "lucide-react";
import { redirect } from "next/navigation";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { portalOf, portalLabelKey } from "@/lib/auth/portal";
import { getDashboard } from "@/server/dashboard";
import { displayDate } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { formatMoney } from "@/lib/finance/money";
import { Card, EmptyState, LinkButton } from "@/components/ui";
import { DashHero, Hi } from "@/components/dash/hero";
import { JumpNav } from "@/components/dash/jump-nav";
import { ActivityBlock } from "@/components/dash/activity";
import { teacherHome } from "@/server/teacher-home";
import { headHome } from "@/server/head-home";
import { accountsByRole, adminHome } from "@/server/admin-home";
import { activityPanel } from "@/server/ops";
import * as ov from "@/server/school-overview";
import { classCollectionReport } from "@/server/finance-reports";
import { admissionOverview, admissionQueues } from "@/server/admission-queues";
import { TeacherDashboard } from "./teacher";
import { AccountantDashboard, HeadDashboard, RegistrarDashboard, SetupSection, type HomeProps } from "./roles";
import { AdmissionsSection, AttentionSection, QueueSection, CalendarSection, ClassesSection, FeesSection, KpiSection, LatestSection, LearningSection, MyRegistersSection, PeopleSection, PulseSection, ResultsSection, StudentsSection, type DashEnv, type Overview } from "./sections";
import { ActionBar } from "@/components/dash/action-bar";
import { jumpItems, quickItems } from "./quick";

export const metadata: Metadata = { title: "Dashboard" };

/** The data panels are extras: if one cannot be built (for example a migration has not run yet) the rest of the page still loads. */
async function optional<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) { console.error(JSON.stringify({ level: "error", msg: "dashboard_panel_failed", panel: name, error: e instanceof Error ? e.message.slice(0, 300) : String(e) })); return null; }
}

/**
 * One address for everybody on the staff side: what a person sees first depends on who they are (see `portalOf`): the administrator's
 * set-up and school overview, the head teacher's view of the teachers, the accountant's money desk, the registrar's admissions desk, or
 * a teacher's own day. Every panel inside is still permission-checked by the service that supplies it.
 */
export default async function DashboardPage() {
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  const kind = portalOf(ctx);
  // The Academic Office's home is its own desk.
  if (kind === "academic") redirect("/academic-office");
  const [d, school] = await Promise.all([getDashboard(ctx), getSchoolBasics(ctx.schoolId)]);
  const can = (p: string) => ctx.permissions.has(p as never);
  const first = ctx.fullName.split(" ")[0] ?? ctx.fullName;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: school.timezone }).format(new Date()));
  const portal = t(portalLabelKey(kind));

  if (kind === "teacher") {
    const th = await teacherHome(ctx);
    return <TeacherDashboard t={t} locale={locale} first={first} hour={hour} schoolName={school.name} portal={portal} today={d.today} d={d} th={th} quick={quickItems("teacher", t, can, d.attention)} />;
  }

  // School data panels: each is gated by the permission of its detail screen and fails alone, never the whole page.
  const [byGender, attDaily, absent, payments, byMethod, byClass, homework, behaviour, events, staffRoles, admOverview, admQueues, applications, fill] = await Promise.all([
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
    can("admission.read") ? optional("admissionOverview", () => admissionOverview(ctx)) : null,
    optional("admissionQueues", () => admissionQueues(ctx)),
    optional("applications", () => ov.applicationsDaily(ctx)),
    optional("fill", () => ov.classFill(ctx)),
  ]);
  const o: Overview = { byGender, attDaily, absent, payments, byMethod, byClass, homework, behaviour, events, staffRoles, applications, fill };
  const fmtDay = (iso: string) => displayDate(new Date(`${iso}T00:00:00Z`), locale).slice(0, 6);
  const money = (c: number) => formatMoney(c, school.currency);
  const env: DashEnv = { t, locale, money, fmtDay, school: { timezone: school.timezone, currency: school.currency, name: school.name }, d, o, adm: { overview: admOverview, queues: admQueues ?? [] } };
  const props: HomeProps = { env, first, hour, portal, today: d.today, can };

  if (kind === "head") return <HeadDashboard props={props} head={await optional("head", () => headHome(ctx))} />;
  if (kind === "accountant") return <AccountantDashboard props={props} />;
  if (kind === "registrar") return <RegistrarDashboard props={props} />;

  // Administrator (and staff with a custom role): the school overview, with the set-up checklist for people who run the school.
  const [setup, act, accounts] = kind === "admin"
    ? await Promise.all([optional("setup", () => adminHome(ctx)), can("audit.read") ? optional("activity", () => activityPanel(ctx)) : null, can("user.read") ? optional("accounts", () => accountsByRole(ctx)) : null])
    : [null, null, null];
  const ago = (when: Date) => { const m = Math.round((Date.now() - when.getTime()) / 60000); return m < 1 ? t("dash.ago.now") : m < 60 ? t("dash.ago.min", { n: m }) : m < 48 * 60 ? t("dash.ago.hours", { n: Math.round(m / 60) }) : t("dash.ago.days", { n: Math.round(m / 1440) }); };
  const nothingToShow = d.kpis.length === 0 && !d.finance && !d.exams && !d.enrollmentByClass && !d.pipeline && !d.attendanceTrend && !d.recentApplications && !d.activity && d.myRegisters.length === 0;
  const enrolled = d.kpis.find((k) => k.key === "enrolled");
  const attKpi = d.kpis.find((k) => k.key === "attendanceToday")?.value;
  const summary: ReactNode[] = [
    ...(enrolled ? [<><Hi>{Number(enrolled.value).toLocaleString()}</Hi> {t("dash.hero.students")}</>] : []),
    ...(d.attendanceByClass && d.attendanceByClass.length > 0 ? [attKpi ? <>{t("dash.hero.attendance")} <Hi tone={parseInt(String(attKpi), 10) >= 90 ? "ok" : "warn"}>{String(attKpi)}</Hi></> : <>{t("dash.hero.noRegister")}</>] : []),
    ...(d.finance ? [<><Hi>{money(d.finance.collected)}</Hi> {t("dash.hero.received")}</>, ...(d.finance.outstanding > 0 ? [<><Hi tone="warn">{money(d.finance.outstanding)}</Hi> {t("dash.hero.owed")}</>] : [])] : []),
    ...(d.pipeline && (d.pipeline.find((p) => p.label === "APPLIED")?.value ?? 0) > 0 ? [<><Hi tone="warn">{d.pipeline.find((p) => p.label === "APPLIED")!.value}</Hi> {t("dash.hero.applications")}</>] : []),
  ];
  const chips = jumpItems(env, ["setup", "quick", "attention", "school", "pulse", "classes", "students", "fees", "results", "admissions", "learning", "activity", "people", "calendar", "latest"], {
    setup: !!setup && t("setup.title"), activity: !!act && t("dash.sec.activity"), people: !!accounts && accounts.length > 0 && t("dash.sec.people"), latest: !!d.activity && t("dash.sec.latest"),
  });
  const quick = quickItems(kind === "admin" ? "admin" : "staff", t, can, d.attention);

  return (
    <>
      <DashHero locale={locale} tz={school.timezone} search={{ action: "/students", placeholder: t("search.students"), label: t("search.students"), button: t("common.search") }} eyebrow={`${school.name} · ${portal}`.toUpperCase()} title={t(hour < 12 ? "dash.greet.morning" : hour < 17 ? "dash.greet.afternoon" : "dash.greet.evening", { name: first })}>
        {summary.length > 0 ? summary.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>) : t("dash.hero.empty")}
      </DashHero>
      <ActionBar label={t("dash.quick.title")} items={quick} trailing={<span className="ml-auto inline-flex items-center gap-2 text-sm text-muted"><CalendarDays className="size-4" aria-hidden />{displayDate(new Date(`${d.today}T00:00:00Z`), locale)}{d.year ? ` · ${d.year.name}` : ""}{d.term ? ` · ${d.term.name}` : ""}</span>} />
      <JumpNav items={chips} label={t("dash.jump")} />

      {d.needsSetup && !setup && (
        <Card className="mb-5 mt-5 border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-warn">{t("dash.setup.title")}</h2>
          <p className="mb-3 mt-1 text-sm">{t("dash.setup.body")}</p>
          <LinkButton href="/academic-setup">{t("dash.setup.cta")}</LinkButton>
        </Card>
      )}
      {nothingToShow && <EmptyState><p className="font-semibold text-ink">{t("dash.empty.title")}</p><p className="mt-1">{t("dash.empty.body")}</p></EmptyState>}

      {setup && <SetupSection env={env} setup={setup} />}
      <QueueSection env={env} />
      <KpiSection env={env} />
      <AttentionSection env={env} />
      <PulseSection env={env} />
      <ClassesSection env={env} />
      <MyRegistersSection env={env} />
      <StudentsSection env={env} />
      <FeesSection env={env} />
      <ResultsSection env={env} />
      <AdmissionsSection env={env} />
      <LearningSection env={env} />
      {act && <ActivityBlock t={t} act={act} failed24={act.failed24} fmtDay={fmtDay} ago={ago} />}
      <PeopleSection env={env} accounts={accounts} />
      <CalendarSection env={env} />
      <LatestSection env={env} />
    </>
  );
}
