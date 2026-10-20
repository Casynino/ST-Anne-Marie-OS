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
import { SignOutButton } from "@/components/sign-out-button";
import { LanguageSwitch } from "@/components/language-switch";
import { initialsOf } from "@/lib/site";
import type { NavGroup } from "@/components/app-shell/icons";
import { AppSidebar, MobileDrawer } from "@/components/app-shell/sidebar";
import { Breadcrumbs, GlobalSearch, NotificationBell, UserMenu } from "@/components/app-shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  if (ctx.userType !== "STAFF") redirect("/family"); // parents and students use the family portal, never the staff area
  const [t, locale, school, academic, logo, unread, newEnquiries, unmatchedPayments, roles, jar] = await Promise.all([
    getT(), getLocale(), getSchoolBasics(ctx.schoolId), getCurrentAcademicContext(ctx.schoolId), getBrandLogo(ctx.schoolId),
    countMyUnread(ctx), countNewEnquiries(ctx), ctx.permissions.has("finance.reconcile") ? countUnmatchedEvents(ctx) : Promise.resolve(0),
    db.role.findMany({ where: { schoolId: ctx.schoolId, key: { in: [...ctx.roleKeys] } }, select: { name: true }, orderBy: { name: "asc" } }),
    cookies(),
  ]);

  // Navigation is grouped by purpose and only lists modules this user may open. Finance and examinations appear
  // here when those modules exist; nothing is shown for modules that do not.
  const groups: NavGroup[] = [{ label: t("navgroup.overview"), items: [{ href: "/dashboard", label: t("nav.dashboard"), icon: "dashboard" }] }];
  const academic_ = [
    hasAny(ctx, ["student.read", "student.read_assigned"]) && { href: "/students", label: t("nav.students"), icon: "students" as const },
    hasAny(ctx, ["admission.read"]) && { href: "/admissions", label: t("nav.admissions"), icon: "admissions" as const },
    hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"]) && { href: "/attendance", label: t("nav.attendance"), icon: "attendance" as const },
    hasAny(ctx, ["guardian.read"]) && { href: "/guardians", label: t("nav.guardians"), icon: "guardians" as const },
    hasAny(ctx, ["academic.read"]) && { href: "/academic-setup", label: t("nav.academics"), icon: "academics" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (academic_.length) groups.push({ label: t("navgroup.academic"), items: academic_ });
  const examNav = [
    hasAny(ctx, ["exam.read"]) && { href: "/exams", label: t("nav.exams"), icon: "exams" as const },
    hasAny(ctx, ["marks.enter", "marks.enter_any", "results.approve", "results.lock"]) && { href: "/marks", label: t("nav.marks"), icon: "marks" as const },
    hasAny(ctx, ["results.read", "results.read_assigned"]) && { href: "/results", label: t("nav.results"), icon: "results" as const },
    hasAny(ctx, ["reportcard.read", "remarks.class", "remarks.head"]) && { href: "/report-cards", label: t("nav.reportCards"), icon: "reportcards" as const },
    hasAny(ctx, ["grading.manage"]) && { href: "/grading", label: t("nav.grading"), icon: "grading" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (examNav.length) groups.push({ label: t("navgroup.exams"), items: examNav });
  const financeNav = [
    hasAny(ctx, ["fees.read", "finance.reports", "expense.read", "finance.reconcile"]) && { href: "/finance", label: t("nav.finance"), icon: "finance" as const, badge: unmatchedPayments },
  ].filter(Boolean) as NavGroup["items"];
  if (financeNav.length) groups.push({ label: t("navgroup.finance"), items: financeNav });
  const comms = [
    hasAny(ctx, ["enquiry.read"]) && { href: "/enquiries", label: t("nav.enquiries"), icon: "enquiries" as const, badge: newEnquiries ?? 0 },
    { href: "/notifications", label: t("nav.notifications"), icon: "notifications" as const, badge: unread },
    hasAny(ctx, ["website.manage"]) && { href: "/website", label: t("nav.website"), icon: "website" as const },
  ].filter(Boolean) as NavGroup["items"];
  groups.push({ label: t("navgroup.communication"), items: comms });
  const admin = [
    hasAny(ctx, ["user.read"]) && { href: "/users", label: t("nav.users"), icon: "users" as const },
    hasAny(ctx, ["role.read"]) && { href: "/roles", label: t("nav.roles"), icon: "roles" as const },
    hasAny(ctx, ["school.settings.read"]) && { href: "/settings", label: t("nav.settings"), icon: "settings" as const },
    hasAny(ctx, ["audit.read"]) && { href: "/audit", label: t("nav.audit"), icon: "audit" as const },
  ].filter(Boolean) as NavGroup["items"];
  if (admin.length) groups.push({ label: t("navgroup.administration"), items: admin });

  const initials = initialsOf(school.name);
  const logoRef = logo ? { src: logo.src } : undefined;
  const crumbLabels: Record<string, string> = {
    students: t("nav.students"), admissions: t("nav.admissions"), attendance: t("nav.attendance"), guardians: t("nav.guardians"), "academic-setup": t("nav.academics"),
    users: t("nav.users"), roles: t("nav.roles"), settings: t("nav.settings"), audit: t("nav.audit"), website: t("nav.website"), enquiries: t("nav.enquiries"), notifications: t("nav.notifications"),
    "report-cards": t("nav.reportCards"), finance: t("nav.finance"), invoices: t("fin.nav.invoices"), payments: t("fin.nav.payments"), refunds: t("fin.nav.refunds"), reconciliation: t("fin.nav.reconciliation"), fees: t("fin.nav.fees"), expenses: t("fin.nav.expenses"), remarks: t("rc.remarks.title"), exams: t("nav.exams"), marks: t("nav.marks"), results: t("nav.results"), grading: t("nav.grading"),
    new: t("bc.new"), edit: t("common.edit"), import: t("bc.import"), take: t("bc.take"), reports: t("bc.reports"), conflicts: t("bc.conflicts"), alerts: t("bc.alerts"), staff: t("bc.staff"), register: t("bc.register"),
  };
  const canSearch = hasAny(ctx, ["student.read", "student.read_assigned"]);
  const signOut = (
    <SignOutButton action={signOutAction} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-bad hover:bg-red-50"><LogOut className="size-4" aria-hidden /> {t("nav.signOut")}</SignOutButton>
  );
  const drawerFooter = <div className="space-y-3"><LanguageSwitch current={locale} dark /><SignOutButton action={signOutAction} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-brand-100 hover:bg-white/10"><LogOut className="size-5" aria-hidden /> {t("nav.signOut")}</SignOutButton></div>;

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">{t("site.skip")}</a>
      <AppSidebar groups={groups} name={school.name} initials={initials} logo={logoRef} collapsedInitially={jar.get("sam_nav")?.value === "collapsed"} labels={{ collapse: t("nav.collapse"), expand: t("nav.expand") }} />
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-white/95 px-3 backdrop-blur lg:px-6">
          <MobileDrawer groups={groups} name={school.name} initials={initials} logo={logoRef} labels={{ menu: t("nav.menu"), close: t("nav.close") }} footer={drawerFooter} />
          <Breadcrumbs labels={crumbLabels} detailsLabel={t("bc.details")} homeLabel={t("nav.dashboard")} />
          {canSearch ? <GlobalSearch action="/students" placeholder={t("search.students")} label={t("search.students")} /> : <span className="flex-1" />}
          <div className="ml-auto flex items-center gap-1">
            {academic.year && <span className="mr-1 hidden items-center rounded-full border border-line px-3 py-1.5 text-xs font-medium text-muted xl:inline-flex" title={`${t("dash.year")} / ${t("dash.term")}`}>{academic.year.name}{academic.term ? ` · ${academic.term.name}` : ""}</span>}
            <NotificationBell count={unread} label={t("nav.notifications")} />
            <UserMenu name={ctx.fullName} initials={initialsOf(ctx.fullName).slice(0, 2)} role={roles[0]?.name} passwordLabel={t("auth.changePassword.button")}>
              <div className="px-1"><LanguageSwitch current={locale} /></div>
              {signOut}
            </UserMenu>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-3 py-5 outline-none sm:px-6 sm:py-7">{children}</main>
      </div>
    </div>
  );
}
