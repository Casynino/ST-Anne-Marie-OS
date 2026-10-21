import Link from "next/link";
import { redirect } from "next/navigation";
import { Globe, LogOut, KeyRound } from "lucide-react";
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
import { ThemeRoot, getTheme } from "@/components/theme-root";
import { ThemeToggle } from "@/components/theme-toggle";

/** Family portal shell: parents and students only. Staff are sent to the staff area. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const theme = await getTheme();
  if (ctx.userType === "STAFF") redirect("/dashboard");
  const [t, locale, school, logo, unread, unreadThreads, applications] = await Promise.all([getT(), getLocale(), getSchoolBasics(ctx.schoolId), getBrandLogo(ctx.schoolId), countMyUnread(ctx), countMyUnreadThreads(ctx), myApplications(ctx)]);
  const nav = [
    { href: "/family", label: t("fam.nav.home"), badge: 0 },
    ...(applications.length > 0 ? [{ href: "/family/applications", label: t("apf.nav"), badge: applications.filter((a) => a.draftStatus === "AWAITING_PAYMENT").length }] : []),
    { href: "/family/inbox", label: t("fam.inbox"), badge: unread },
    ...(ctx.userType === "GUARDIAN" ? [{ href: "/family/messages", label: t("msg.title"), badge: unreadThreads }] : []),
    { href: "/family/calendar", label: t("cal.title"), badge: 0 },
    { href: "/family/settings", label: t("fam.settings.nav"), badge: 0 },
  ];
  return (
    <ThemeRoot className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">{t("site.skip")}</a>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[96rem] items-center gap-3 px-4">
          <Link href="/family" className="flex min-w-0 items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.src} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
            ) : (
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">{initialsOf(school.name)}</span>
            )}
            <span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold text-link">{school.name}</span><span className="block truncate text-xs text-muted">{t("fam.portal")}</span></span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/" target="_blank" rel="noopener" aria-label={t("nav.website")} title={t("nav.website")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:text-ink"><Globe className="size-4" aria-hidden /><span className="hidden sm:inline">{t("nav.website")}</span></Link>
            <ThemeToggle initial={theme} labels={{ toDark: t("theme.dark"), toLight: t("theme.light") }} />
            <LanguageSwitch current={locale} />
            <Link href="/change-password" className="hidden min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:text-ink sm:inline-flex" title={t("auth.changePassword.button")}><KeyRound className="size-4" aria-hidden />{t("auth.changePassword.button")}</Link>
            <SignOutButton action={signOutAction} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium hover:bg-canvas"><LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">{t("nav.signOut")}</span></SignOutButton>
          </div>
        </div>
        <nav aria-label={t("fam.portal")} className="mx-auto max-w-[96rem] overflow-x-auto px-4 pb-2">
          <ul className="flex gap-1 whitespace-nowrap text-sm">
            {nav.map((n) => (
              <li key={n.href}><Link href={n.href} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 font-medium text-ink hover:bg-canvas">{n.label}{n.badge > 0 && <span className="rounded-full bg-warn px-1.5 text-xs font-semibold text-white">{n.badge}</span>}</Link></li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-[96rem] px-4 py-6 sm:px-6 xl:px-8">{children}</main>
    </ThemeRoot>
  );
}
