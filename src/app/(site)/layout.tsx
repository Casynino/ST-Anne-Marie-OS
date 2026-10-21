import type { Metadata } from "next";
import { getContext, getLocale, getT } from "@/lib/auth/next";
import { homeFor } from "@/lib/auth/home";
import { baseUrl, getSite, initialsOf, schoolJsonLd, telHref } from "@/lib/site";
import { LanguageSwitch } from "@/components/language-switch";
import { SiteHeader, type SiteLink, type SiteSubLink } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { inter, montserrat } from "@/lib/fonts";
import { MobileActions } from "@/components/site/mobile-actions";
import { SideTabs } from "@/components/site/side-tabs";
import { AnnouncementBar } from "@/components/site/announcement-bar";

export const metadata: Metadata = { metadataBase: new URL(baseUrl()), robots: { index: true, follow: true } };

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [site, t, locale, ctx] = await Promise.all([getSite(), getT(), getLocale(), getContext()]);
  if (!site) return <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center bg-canvas p-6 text-center text-muted">{t("app.name")}</main>;

  // The menu lists a page only when the school has content for it, so no link leads to an empty page.
  const { text, levels } = site;
  const sub = (items: (SiteSubLink | false | null | undefined | "")[]) => items.filter((i): i is SiteSubLink => !!i);
  const hasStudentLife = Boolean(text.uniform || text.transport || text.meals || text.health || text.clubs.length > 0);
  const links: SiteLink[] = [
    { href: "/about", label: t("site.nav.about"), items: sub([
      { href: "/about", label: t("site.nav.about") },
      (text.vision || text.mission) && { href: "/about#vision", label: t("site.nav.vision") },
      text.leadership.length > 0 && { href: "/about#leadership", label: t("site.about.leadership") },
      text.history && { href: "/about#history", label: t("site.about.history") },
      text.facilities && { href: "/about#facilities", label: t("site.about.facilities") },
      text.safeguarding && { href: "/about#safeguarding", label: t("site.about.safeguarding") },
    ]) },
    { href: "/academics", label: t("site.nav.academics"), items: sub(levels.map((l) => ({ href: `/academics#${l.slug}`, label: l.name }))) },
    { href: "/apply", label: t("site.nav.admissions"), items: sub([
      { href: "/apply", label: t("site.admissions.title") },
      text.requirements.length > 0 && { href: "/apply#requirements", label: t("site.nav.requirements") },
      text.feesNote && { href: "/apply#fees", label: t("site.nav.fees") },
      text.faqs.length > 0 && { href: "/apply#faq", label: t("site.nav.faq") },
      { href: "/apply/visit", label: t("site.nav.visit") },
      { href: "/apply/track", label: t("site.admissions.track") },
    ]) },
    { href: "/school-life", label: t("site.nav.schoolLife"), items: sub([
      { href: "/school-life", label: t("site.nav.schoolLife") },
      hasStudentLife && { href: "/student-life", label: t("site.nav.studentLife") },
    ]) },
    { href: "/news", label: t("site.nav.newsEvents"), match: ["/events", "/calendar"], items: sub([
      { href: "/news", label: t("site.nav.news") },
      { href: "/events", label: t("site.nav.events") },
      { href: "/calendar", label: t("site.nav.calendar") },
    ]) },
    { href: "/contact", label: t("site.nav.contact") },
  ];
  return (
    <div className={`site-root ${montserrat.variable} ${inter.variable} min-h-dvh bg-canvas text-ink`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schoolJsonLd(site)).replace(/</g, "\\u003c") }} />
      <SiteHeader
        name={site.school.name}
        initials={initialsOf(site.school.name)}
        logo={site.images.logo}
        links={links}
        motto={site.school.motto}
        quickLabel={t("site.nav.quick")}
        quickLinks={[ctx ? { href: homeFor(ctx.userType), label: t("site.nav.myPortal") } : { href: "/login", label: t("site.nav.logIn") }, ...(ctx ? [] : [{ href: "/portal", label: t("site.nav.portal") }]), { href: "/apply/form", label: t("site.nav.apply") }, { href: "/apply/track", label: t("site.admissions.track") }, { href: "/apply/visit", label: t("site.nav.visit") }]}
        searchLabel={t("site.nav.search")}
        calendarLabel={t("site.nav.calendar")}
        applyLabel={t("site.nav.apply")}
        applyShortLabel={t("site.nav.applyShort")}
        applyHref="/apply/form"
        portalLabel={ctx ? ctx.fullName : t("site.nav.logIn")}
        signedIn={Boolean(ctx)}
        portalHref={ctx ? homeFor(ctx.userType) : "/login"}
        menuLabel={t("nav.menu")}
        closeLabel={t("nav.close")}
        skipLabel={t("site.skip")}
        languageSwitch={<LanguageSwitch current={locale} />}
        topSlot={<AnnouncementBar schoolId={site.school.id} t={t} locale={locale} />}
      />
      <SideTabs t={t} applyHref="/apply/form" />
      <main id="main">{children}</main>
      <SiteFooter t={t} site={site} links={links} />
      <MobileActions applyHref="/apply/form" applyLabel={t("site.nav.apply")} phoneHref={site.contact.phone ? telHref(site.contact.phone) : undefined} callLabel={t("site.mobile.call")} />
      <div aria-hidden className="h-20 bg-canvas md:hidden" />
    </div>
  );
}
