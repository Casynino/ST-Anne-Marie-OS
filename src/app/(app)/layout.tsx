import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { db } from "@/lib/db";
import { requireContext, getT, hasAny, getLocale } from "@/lib/auth/next";
import { getSchoolBasics } from "@/server/settings";
import { getCurrentAcademicContext } from "@/server/academics";
import { getBrandLogo } from "@/server/website";
import { signOutAction } from "@/app/actions-shared";
import { countMyUnread } from "@/server/notifications";
import { countNewEnquiries } from "@/server/enquiries";
import { countUnmatchedEvents } from "@/server/payment-events";
import { countStaffAttention } from "@/server/messaging";
import { SignOutButton } from "@/components/sign-out-button";
import { LanguageSwitch } from "@/components/language-switch";
import { initialsOf } from "@/lib/site";
import type { NavGroup } from "@/components/app-shell/icons";
import { AppSidebar, MobileDrawer } from "@/components/app-shell/sidebar";
import { countExamWork } from "@/server/admission-exams";
import { countAdmissionPaymentsDue } from "@/server/admission-offers";
import { Breadcrumbs, GlobalSearch, NotificationBell, UserMenu, WebsiteLink } from "@/components/app-shell/topbar";
import { ThemeRoot, getTheme } from "@/components/theme-root";
import { stepOutAction } from "./step-in/actions";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const theme = await getTheme();
  if (ctx.userType !== "STAFF") redirect("/family"); // parents and students use the family portal, never the staff area
  const [t, locale, school, academic, logo, unread, newEnquiries, unmatchedPayments, staffAttention, roles, jar, examWork, admissionDue] = await Promise.all([
    getT(), getLocale(), getSchoolBasics(ctx.schoolId), getCurrentAcademicContext(ctx.schoolId), getBrandLogo(ctx.schoolId),
    countMyUnread(ctx), countNewEnquiries(ctx), ctx.permissions.has("finance.reconcile") ? countUnmatchedEvents(ctx) : Promise.resolve(0), countStaffAttention(ctx),
    db.role.findMany({ where: { schoolId: ctx.schoolId, key: { in: [...ctx.roleKeys] } }, select: { name: true }, orderBy: { name: "asc" } }),
    cookies(),
    hasAny(ctx, ["admission.exam.mark", "admission.exam.review"]) ? countExamWork(ctx) : Promise.resolve(0),
    countAdmissionPaymentsDue(ctx),
  ]);

  // Navigation is grouped by purpose and only lists modules this user may open. Finance and examinations appear
  // here when those modules exist; nothing is shown for modules that do not.
  const groups: NavGroup[] = [{ label: t("navgroup.overview"), flat: true, items: [{ href: "/dashboard", label: t("nav.dashboard"), icon: "dashboard" }] }];
  // The student's journey, from the lowest step to the highest: apply, come back each year, study in a class, attend, family contacts.
  const journey = [
    hasAny(ctx, ["admission.read"]) && { href: "/admissions", label: t("nav.admissions"), icon: "admissions" as const },
    hasAny(ctx, ["registration.read"]) && { href: "/students/returning", label: t("nav.returning"), icon: "returning" as const },
    hasAny(ctx, ["student.read", "student.read_assigned"]) && { href: "/students", label: t("nav.students"), icon: "students" as const },
    hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"]) && { href: "/attendance", label: t("nav.attendance"), icon: "attendance" as const },
    hasAny(ctx, ["guardian.read"]) && { href: "/guardians", label: t("nav.guardians"), icon: "guardians" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (journey.length) groups.push({ label: t("navgroup.journey"), icon: "students" as const, items: journey });
  const academic_ = [
    hasAny(ctx, ["academic.office"]) && { href: "/academic-office", label: t("nav.academicOffice"), icon: "academicOffice" as const },
    hasAny(ctx, ["progression.read"]) && { href: "/academic-office/progression", label: t("nav.progression"), icon: "returning" as const },
    hasAny(ctx, ["academic.read"]) && { href: "/academic-setup", label: t("nav.academics"), icon: "academics" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (academic_.length) groups.push({ label: t("navgroup.academic"), icon: "academics" as const, items: academic_ });
  const examNav = [
    hasAny(ctx, ["exam.read"]) && { href: "/exams", label: t("nav.exams"), icon: "exams" as const },
    hasAny(ctx, ["marks.enter", "marks.enter_any", "results.approve", "results.lock"]) && { href: "/marks", label: t("nav.marks"), icon: "marks" as const },
    hasAny(ctx, ["results.read", "results.read_assigned"]) && { href: "/results", label: t("nav.results"), icon: "results" as const },
    hasAny(ctx, ["reportcard.read", "remarks.class", "remarks.head"]) && { href: "/report-cards", label: t("nav.reportCards"), icon: "reportcards" as const },
    hasAny(ctx, ["admission.exam.mark", "admission.exam.review", "admission.exam.assign"]) && { href: "/applicant-exams", label: t("nav.applicantExams"), icon: "exams" as const, badge: examWork },
    hasAny(ctx, ["grading.manage"]) && { href: "/grading", label: t("nav.grading"), icon: "grading" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (examNav.length) groups.push({ label: t("navgroup.exams"), icon: "exams" as const, items: examNav });
  const learnNav = [
    hasAny(ctx, ["timetable.read"]) && { href: "/timetable", label: t("nav.timetable"), icon: "timetable" as const },
    hasAny(ctx, ["plans.write", "plans.review"]) && { href: "/planning", label: t("nav.planning"), icon: "planning" as const },
    hasAny(ctx, ["assignments.manage", "assignments.oversee"]) && { href: "/assignments", label: t("nav.assignments"), icon: "assignments" as const },
    hasAny(ctx, ["portfolio.manage"]) && { href: "/portfolio", label: t("nav.portfolio"), icon: "portfolio" as const },
    hasAny(ctx, ["library.read", "library.upload", "library.manage", "library.review", "library.publish", "library.pin"]) && { href: "/library-admin", label: t("nav.library"), icon: "library" as const },
    hasAny(ctx, ["behaviour.record", "behaviour.read_all"]) && { href: "/behaviour", label: t("nav.behaviour"), icon: "behaviour" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (learnNav.length) groups.push({ label: t("navgroup.learning"), icon: "timetable" as const, items: learnNav });
  const financeNav = [
    hasAny(ctx, ["fees.read", "finance.reports", "expense.read", "finance.reconcile"]) && { href: "/finance", label: t("nav.finance"), icon: "finance" as const, badge: (unmatchedPayments ?? 0) + admissionDue },
  ].filter(Boolean) as NavGroup["items"];
  if (financeNav.length) groups.push({ label: t("navgroup.finance"), icon: "finance" as const, items: financeNav });
  const comms = [
    hasAny(ctx, ["comms.read", "messages.read", "messages.moderate"]) && { href: hasAny(ctx, ["comms.read"]) ? "/communication" : "/communication/messages", label: t("nav.communication"), icon: "communication" as const, badge: staffAttention },
    { href: "/school-calendar", label: t("nav.calendar"), icon: "calendar" as const },
    hasAny(ctx, ["enquiry.read"]) && { href: "/enquiries", label: t("nav.enquiries"), icon: "enquiries" as const, badge: newEnquiries ?? 0 },
    { href: "/notifications", label: t("nav.notifications"), icon: "notifications" as const, badge: unread },
    hasAny(ctx, ["website.manage"]) && { href: "/website", label: t("nav.website"), icon: "website" as const },
  ].filter(Boolean) as NavGroup["items"];
  groups.push({ label: t("navgroup.communication"), icon: "communication" as const, items: comms });
  const admin = [
    hasAny(ctx, ["staff.recruit"]) && { href: "/staff-recruitment", label: t("nav.recruitment"), icon: "recruitment" as const },
    hasAny(ctx, ["user.read"]) && { href: "/users", label: t("nav.users"), icon: "users" as const },
    hasAny(ctx, ["role.read"]) && { href: "/roles", label: t("nav.roles"), icon: "roles" as const },
    hasAny(ctx, ["school.settings.read"]) && { href: "/settings", label: t("nav.settings"), icon: "settings" as const },
    hasAny(ctx, ["audit.read"]) && { href: "/audit", label: t("nav.audit"), icon: "audit" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (admin.length) groups.push({ label: t("navgroup.administration"), icon: "settings" as const, items: admin });

  const initials = initialsOf(school.name);
  const logoRef = logo ? { src: logo.src } : undefined;
  const crumbLabels: Record<string, string> = {
    students: t("nav.students"), admissions: t("nav.admissions"), attendance: t("nav.attendance"), guardians: t("nav.guardians"), "academic-setup": t("nav.academics"),
    users: t("nav.users"), roles: t("nav.roles"), settings: t("nav.settings"), audit: t("nav.audit"), website: t("nav.website"), enquiries: t("nav.enquiries"), notifications: t("nav.notifications"),
    "report-cards": t("nav.reportCards"), finance: t("nav.finance"), communication: t("nav.communication"), "school-calendar": t("nav.calendar"), messages: t("msg.title"), templates: t("comm.nav.templates"), invoices: t("fin.nav.invoices"), payments: t("fin.nav.payments"), refunds: t("fin.nav.refunds"), reconciliation: t("fin.nav.reconciliation"), fees: t("fin.nav.fees"), expenses: t("fin.nav.expenses"), remarks: t("rc.remarks.title"), exams: t("nav.exams"), "applicant-exams": t("nav.applicantExams"), marks: t("nav.marks"), results: t("nav.results"), grading: t("nav.grading"),
    "library-admin": t("nav.library"), categories: t("lib.nav.categories"), analytics: t("lib.nav.analytics"), activity: t("lib.nav.activity"), timetable: t("nav.timetable"), planning: t("nav.planning"), assignments: t("nav.assignments"), portfolio: t("nav.portfolio"), behaviour: t("nav.behaviour"), periods: t("learn.periods.title"), schemes: t("learn.schemes"), lessons: t("learn.lessons"),
    "academic-office": t("nav.academicOffice"), concerns: t("concern.title"), transfers: t("tr.title"), "staff-recruitment": t("nav.recruitment"), tasks: t("nav.tasks"), interviews: t("adm.nav.interviews"), placement: t("adm.nav.placement"), policy: t("adm.nav.policy"), progression: t("lc.prog.title"), returning: t("lc.nav.returning"), annual: t("lc.nav.annualFees"), readiness: t("lc.ready.title"),
    new: t("bc.new"), edit: t("common.edit"), import: t("bc.import"), take: t("bc.take"), reports: t("bc.reports"), conflicts: t("bc.conflicts"), alerts: t("bc.alerts"), staff: t("bc.staff"), register: t("bc.register"),
  };
  const canSearch = hasAny(ctx, ["student.read", "student.read_assigned"]);
  const signOut = (
    <SignOutButton action={signOutAction} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-bad hover:bg-red-50"><LogOut className="size-4" aria-hidden /> {t("nav.signOut")}</SignOutButton>
  );
  const signOutClass = "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-[#ff9b8e] hover:bg-white/5";
  const who = initialsOf(ctx.fullName).slice(0, 2);
  const sidebarSignOut = {
    full: (
      <div className="space-y-1">
        <Link href="/change-password" title={t("auth.changePassword.button")} className="block rounded-lg px-2.5 py-1.5 hover:bg-white/5">
          <span className="block truncate text-sm font-medium text-white">{ctx.fullName}</span>
          {roles[0]?.name && <span className="block truncate text-xs text-brand-200">{roles[0].name}</span>}
        </Link>
        {ctx.oversight && <Link href="/step-in" className="block rounded-lg px-2.5 py-1.5 text-xs text-brand-300 hover:bg-white/5 hover:text-white">{t("step.link")}</Link>}
        <div className="flex items-center justify-between px-1"><LanguageSwitch current={locale} dark pill /><ThemeToggle onDark initial={theme} labels={{ toDark: t("theme.dark"), toLight: t("theme.light") }} /></div>
        <SignOutButton action={signOutAction} className={signOutClass}><LogOut className="size-4" aria-hidden /> {t("nav.signOut")}</SignOutButton>
      </div>
    ),
    icon: (
      <div className="space-y-1">
        <Link href="/change-password" title={ctx.fullName} className="mx-auto grid size-9 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white"><span aria-hidden>{who}</span><span className="sr-only">{t("auth.changePassword.button")}</span></Link>
        <SignOutButton action={signOutAction} className={`${signOutClass} justify-center px-0`}><LogOut className="size-4" aria-hidden /><span className="sr-only">{t("nav.signOut")}</span></SignOutButton>
      </div>
    ),
  };
  const drawerFooter = (
    <div className="space-y-2">
      <Link href="/change-password" className="block rounded-lg px-3 py-1.5 hover:bg-white/5">
        <span className="block truncate text-base font-medium text-white">{ctx.fullName}</span>
        {roles[0]?.name && <span className="block truncate text-sm text-brand-200">{roles[0].name}</span>}
      </Link>
      {ctx.oversight && <Link href="/step-in" className="block rounded-lg px-3 py-1 text-sm text-brand-300 hover:bg-white/5 hover:text-white">{t("step.link")}</Link>}
      <div className="flex items-center justify-between gap-2 px-1">
        <LanguageSwitch current={locale} dark />
        <SignOutButton action={signOutAction} className="flex min-h-12 items-center gap-2 rounded-lg px-3 text-base font-medium text-[#ff9b8e] hover:bg-white/5"><LogOut className="size-5" aria-hidden /> {t("nav.signOut")}</SignOutButton>
      </div>
    </div>
  );

  return (
    <ThemeRoot className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">{t("site.skip")}</a>
      <AppSidebar groups={groups} name={school.name} subtitle={t("nav.subtitle")} initials={initials} logo={logoRef} collapsedInitially={jar.get("sam_nav")?.value === "collapsed"} labels={{ collapse: t("nav.collapse"), expand: t("nav.expand") }} footer={sidebarSignOut} />
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 bg-canvas/85 px-3 backdrop-blur-md lg:px-6">
          <MobileDrawer groups={groups} name={school.name} subtitle={t("nav.subtitle")} initials={initials} logo={logoRef} labels={{ menu: t("nav.menu"), close: t("nav.close") }} footer={drawerFooter} />
          <Breadcrumbs labels={crumbLabels} detailsLabel={t("bc.details")} homeLabel={t("nav.dashboard")} />
          {canSearch ? <GlobalSearch action="/students" placeholder={t("search.students")} label={t("search.students")} /> : <span className="flex-1" />}
          <div className="ml-auto flex items-center gap-1">
            {academic.year && <span className="mr-1 hidden items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted xl:inline-flex" title={`${t("dash.year")} / ${t("dash.term")}`}>{academic.year.name}{academic.term ? ` · ${academic.term.name}` : ""}</span>}
            <div className="lg:hidden"><ThemeToggle initial={theme} labels={{ toDark: t("theme.dark"), toLight: t("theme.light") }} /></div>
            <WebsiteLink label={t("nav.website")} />
            <NotificationBell count={unread} label={t("nav.notifications")} />
            <div className="lg:hidden">
              <UserMenu name={ctx.fullName} initials={who} role={roles[0]?.name} passwordLabel={t("auth.changePassword.button")}>
                <div className="px-1"><LanguageSwitch current={locale} /></div>
                {signOut}
              </UserMenu>
            </div>
          </div>
        </header>
        {ctx.stepInUntil && ctx.stepInUntil > Date.now() && (
          <div role="status" className="no-print flex flex-wrap items-center justify-between gap-2 bg-warn/20 px-4 py-2 text-sm text-ink lg:px-6">
            <span>{t("step.banner", { n: Math.max(1, Math.ceil((ctx.stepInUntil - Date.now()) / 60000)) })}</span>
            <form action={stepOutAction}><button type="submit" className="font-semibold text-link hover:underline">{t("step.stop")}</button></form>
          </div>
        )}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[112rem] px-3 py-5 outline-none sm:px-6 sm:py-7 xl:px-10">{children}</main>
      </div>
    </ThemeRoot>
  );
}
