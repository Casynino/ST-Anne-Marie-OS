import type { Metadata } from "next";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { baseUrl, getSite, initialsOf, schoolJsonLd } from "@/lib/site";
import { LanguageSwitch } from "@/components/language-switch";
import { SiteHeader, type SiteLink } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { AnnouncementBar } from "@/components/site/announcement-bar";

export const metadata: Metadata = { metadataBase: new URL(baseUrl()), robots: { index: true, follow: true } };

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [site, t, locale, ctx] = await Promise.all([getSite(), getT(), getLocale(), getContext()]);
  if (!site) return <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center bg-cream p-6 text-center text-muted">{t("app.name")}</main>;

  const links: SiteLink[] = [
    { href: "/", label: t("site.nav.home") },
    { href: "/about", label: t("site.nav.about") },
    { href: "/academics", label: t("site.nav.academics") },
    { href: "/apply", label: t("site.nav.admissions") },
    { href: "/school-life", label: t("site.nav.schoolLife") },
    { href: "/news", label: t("site.nav.newsEvents"), match: ["/events"] },
    { href: "/contact", label: t("site.nav.contact") },
  ];
  return (
    <div className="min-h-dvh bg-cream text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schoolJsonLd(site)).replace(/</g, "\\u003c") }} />
      <AnnouncementBar schoolId={site.school.id} t={t} locale={locale} />
      <SiteHeader
        name={site.school.name}
        initials={initialsOf(site.school.name)}
        logo={site.images.logo}
        links={links}
        applyLabel={t("site.nav.apply")}
        applyShortLabel={t("site.nav.applyShort")}
        applyHref="/apply/form"
        portalLabel={ctx ? t("site.nav.dashboard") : t("site.nav.portal")}
        portalHref={ctx ? "/dashboard" : "/portal"}
        menuLabel={t("nav.menu")}
        closeLabel={t("nav.close")}
        skipLabel={t("site.skip")}
        languageSwitch={<LanguageSwitch current={locale} />}
      />
      <main id="main">{children}</main>
      <SiteFooter t={t} site={site} links={links} />
    </div>
  );
}
