import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, KeyRound } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getSchoolBasics } from "@/server/settings";
import { getBrandLogo } from "@/server/website";
import { signOutAction } from "@/app/actions-shared";
import { SignOutButton } from "@/components/sign-out-button";
import { LanguageSwitch } from "@/components/language-switch";
import { initialsOf } from "@/lib/site";

/** Family portal shell: parents and students only. Staff are sent to the staff area. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  if (ctx.userType === "STAFF") redirect("/dashboard");
  const [t, locale, school, logo] = await Promise.all([getT(), getLocale(), getSchoolBasics(ctx.schoolId), getBrandLogo(ctx.schoolId)]);
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg">{t("site.skip")}</a>
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Link href="/family" className="flex min-w-0 items-center gap-3">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.src} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
            ) : (
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white">{initialsOf(school.name)}</span>
            )}
            <span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold text-brand-800">{school.name}</span><span className="block truncate text-xs text-muted">{t("fam.portal")}</span></span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch current={locale} />
            <Link href="/change-password" className="hidden min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-muted hover:text-ink sm:inline-flex" title={t("auth.changePassword.button")}><KeyRound className="size-4" aria-hidden />{t("auth.changePassword.button")}</Link>
            <SignOutButton action={signOutAction} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium hover:bg-canvas"><LogOut className="size-4" aria-hidden /><span className="hidden sm:inline">{t("nav.signOut")}</span></SignOutButton>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
