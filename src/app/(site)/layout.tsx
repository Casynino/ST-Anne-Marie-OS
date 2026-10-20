import type { Metadata } from "next";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { getSite, initialsOf } from "@/lib/site";
import { LanguageSwitch } from "@/components/language-switch";
import { SiteHeader, type SiteLink } from "@/components/site/site-nav";
import { SiteFooter } from "@/components/site/footer";

export const metadata: Metadata = { robots: { index: true, follow: true } };

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [site, t, locale, ctx] = await Promise.all([getSite(), getT(), getLocale(), getContext()]);
  if (!site) {
    return <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center p-6 text-center text-muted">{t("app.name")}</main>;
  }
  const links: SiteLink[] = [
    { href: "/", label: t("site.nav.home") },
    { href: "/about", label: t("site.nav.about") },
    { href: "/apply", label: t("site.nav.admissions") },
    { href: "/news", label: t("site.nav.news") },
    { href: "/calendar", label: t("site.nav.calendar") },
    { href: "/contact", label: t("site.nav.contact") },
  ];
  return (
    <div className="min-h-dvh bg-paper text-ink">
      <SiteHeader
        name={site.school.name}
        initials={initialsOf(site.school.name)}
        logoPath={site.settings.logoPath}
        links={links}
        applyLabel={t("site.nav.apply")}
        applyHref="/apply/form"
        signInLabel={ctx ? t("site.nav.dashboard") : t("site.nav.signIn")}
        signInHref={ctx ? "/dashboard" : "/login"}
        menuLabel={t("nav.menu")}
        closeLabel={t("nav.close")}
        skipLabel={t("site.skip")}
        languageSwitch={<LanguageSwitch current={locale} />}
      />
      <main id="main">{children}</main>
      <SiteFooter t={t} name={site.school.name} motto={site.school.motto} contact={site.contact} links={links} social={{ facebook: site.settings.facebook, instagram: site.settings.instagram }} />
    </div>
  );
}
