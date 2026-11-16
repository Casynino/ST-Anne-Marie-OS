import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getSchoolBasics } from "@/server/settings";
import { getBrandLogo } from "@/server/website";
import { signOutAction } from "@/app/actions-shared";
import { SignOutButton } from "@/components/sign-out-button";
import { LanguageSwitch } from "@/components/language-switch";
import { initialsOf } from "@/lib/site";
import { countMyUnread } from "@/server/notifications";
import { countMyUnreadThreads } from "@/server/messaging";
import { myApplications } from "@/server/application-fee";
import { myChildren } from "@/server/portal";
import { ThemeRoot, getTheme } from "@/components/theme-root";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppSidebar, MobileDrawer } from "@/components/app-shell/sidebar";
import { NotificationBell, UserMenu, WebsiteLink } from "@/components/app-shell/topbar";
import type { NavGroup } from "@/components/app-shell/icons";

/**
 * Family portal shell: parents and students only (staff are sent to the staff area). It is the same shell as the staff area, so everybody
 * finds things in the same place: the quiet side menu with the person's children, their messages and calendar, and a slim top bar.
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const theme = await getTheme();
  if (ctx.userType === "STAFF") redirect("/dashboard");
  const [t, locale, school, logo, unread, unreadThreads, applications, kids, jar] = await Promise.all([getT(), getLocale(), getSchoolBasics(ctx.schoolId), getBrandLogo(ctx.schoolId), countMyUnread(ctx), countMyUnreadThreads(ctx), myApplications(ctx), myChildren(ctx), cookies()]);
  const groups: NavGroup[] = [
    { label: t("fam.nav.home"), flat: true, items: [{ href: "/family", label: t("fam.nav.home"), icon: "dashboard" }] },
    ...(kids.length > 0 ? [{ label: t("fam.children.title"), items: kids.map((c) => ({ href: `/family/${c.id}`, label: c.name.split(" ")[0] ?? c.name, icon: "students" as const })) }] : []),
    {
      label: t("navgroup.communication"),
      items: [
        { href: "/family/inbox", label: t("fam.inbox"), icon: "notifications", badge: unread },
        ...(ctx.userType === "GUARDIAN" ? [{ href: "/family/messages", label: t("msg.title"), icon: "communication" as const, badge: unreadThreads }] : []),
        { href: "/family/calendar", label: t("cal.title"), icon: "calendar" },
      ],
    },
    {
      label: t("fam.settings.nav"),
      items: [
        ...(applications.length > 0 ? [{ href: "/family/applications", label: t("apf.nav"), icon: "admissions" as const, badge: applications.filter((a) => a.draftStatus === "AWAITING_PAYMENT").length }] : []),
        { href: "/family/settings", label: t("fam.settings.nav"), icon: "settings" },
      ],
    },
  ];
  const initials = initialsOf(school.name);
  const logoRef = logo ? { src: logo.src } : undefined;
  const who = initialsOf(ctx.fullName).slice(0, 2);
  const signOutClass = "flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] font-medium text-[#ff9b8e] hover:bg-white/5";
  const sidebarFoot = {
    full: (
      <div className="space-y-1">
        <Link href="/change-password" title={t("auth.changePassword.button")} className="block rounded-lg px-2.5 py-1.5 hover:bg-white/5">
          <span className="block truncate text-sm font-medium text-white">{ctx.fullName}</span>
          <span className="block truncate text-xs text-brand-200">{t("fam.portal")}</span>
        </Link>
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
  const signOutRow = <SignOutButton action={signOutAction} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-bad hover:bg-red-50"><LogOut className="size-4" aria-hidden /> {t("nav.signOut")}</SignOutButton>;
  const drawerFooter = <div className="space-y-3"><LanguageSwitch current={locale} dark /><SignOutButton action={signOutAction} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-brand-100 hover:bg-surface/10"><LogOut className="size-5" aria-hidden /> {t("nav.signOut")}</SignOutButton></div>;
  return (
    <ThemeRoot className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">{t("site.skip")}</a>
      <AppSidebar groups={groups} name={school.name} initials={initials} logo={logoRef} collapsedInitially={jar.get("sam_nav")?.value === "collapsed"} labels={{ collapse: t("nav.collapse"), expand: t("nav.expand") }} footer={sidebarFoot} />
      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 bg-canvas/85 px-3 backdrop-blur-md lg:px-6">
          <MobileDrawer groups={groups} name={school.name} initials={initials} logo={logoRef} labels={{ menu: t("nav.menu"), close: t("nav.close") }} footer={drawerFooter} />
          <div className="ml-auto flex items-center gap-1">
            <div className="lg:hidden"><ThemeToggle initial={theme} labels={{ toDark: t("theme.dark"), toLight: t("theme.light") }} /></div>
            <WebsiteLink label={t("nav.website")} />
            <NotificationBell href="/family/inbox" count={unread} label={t("fam.inbox")} />
            <div className="lg:hidden">
              <UserMenu name={ctx.fullName} initials={who} role={t("fam.portal")} passwordLabel={t("auth.changePassword.button")}>
                <div className="px-1"><LanguageSwitch current={locale} /></div>
                {signOutRow}
              </UserMenu>
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[112rem] px-3 py-5 outline-none sm:px-6 sm:py-7 xl:px-10">{children}</main>
      </div>
    </ThemeRoot>
  );
}
