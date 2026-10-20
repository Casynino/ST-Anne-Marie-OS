import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpen, CalendarDays, GraduationCap, MapPin, Phone, ShieldCheck, Users } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, telHref } from "@/lib/site";
import { listPublicEvents, listPublicNews } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { CtaLink, Kicker, Orbit, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { WordReveal } from "@/components/site/fx/word-reveal";
import { HeroField } from "@/components/site/fx/hero-field";
import { Marquee } from "@/components/site/fx/marquee";
import { Spotlight } from "@/components/site/fx/spotlight";
import { Parallax } from "@/components/site/fx/parallax";
import { GalleryRail } from "@/components/site/fx/gallery-rail";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite();
  return { title: { absolute: site?.school.name ?? "School" }, description: site?.text.heroSubtitle ?? undefined };
}

export default async function HomePage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const { school, text, settings, levels, contact, gallery } = site;
  const [news, events] = await Promise.all([listPublicNews(school.id, { limit: 3 }), listPublicEvents(school.id, school.timezone, { limit: 3 })]);
  const classCount = levels.reduce((n, l) => n + l.classes.length, 0);

  return (
    <>
      {/* ───────── Hero ───────── */}
      <section className="hero-glow hero-grid relative isolate overflow-hidden bg-night text-white">
        <HeroField />
        <div className="relative z-10 mx-auto grid min-h-[calc(100svh-4.5rem)] max-w-6xl gap-10 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="site-rise site-mono inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase text-glow">
              {settings.applicationsOpen && <span aria-hidden className="size-2 animate-pulse rounded-full bg-signal shadow-[0_0_10px_2px_rgb(255_178_62/.8)]" />}
              {settings.applicationsOpen ? t("site.hero.status") : school.name}
            </p>
            <h1 className="site-serif mt-6 text-[2.7rem] leading-[1.02] sm:text-7xl lg:text-[5.2rem]"><WordReveal text={text.heroTitle} /></h1>
            {text.heroSubtitle && <p className="site-rise-3 mt-6 max-w-xl text-lg leading-relaxed text-brand-100 sm:text-xl">{text.heroSubtitle}</p>}
            <div className="site-rise-3 mt-9 flex flex-wrap gap-3">
              {settings.applicationsOpen && <CtaLink href="/apply/form" variant="signal" arrow>{t("site.hero.apply")}</CtaLink>}
              <CtaLink href="/login" variant="ghost">{t("site.hero.signIn")}</CtaLink>
            </div>
            {!settings.applicationsOpen && <p className="mt-5 max-w-md text-sm text-brand-200">{t("site.hero.closed")}</p>}
            {levels.length > 0 && (
              <dl className="site-rise-3 glass mt-12 inline-grid grid-cols-2 gap-10 rounded-2xl px-6 py-4">
                <div><dt className="site-mono text-[11px] uppercase text-brand-200">{t("site.stats.levels")}</dt><dd className="mt-1 text-3xl font-bold tabular-nums">{levels.length}</dd></div>
                <div><dt className="site-mono text-[11px] uppercase text-brand-200">{t("site.stats.classes")}</dt><dd className="mt-1 text-3xl font-bold tabular-nums">{classCount}</dd></div>
              </dl>
            )}
          </div>

          <div className="site-rise-2 relative mx-auto w-full max-w-md lg:max-w-none">
            {settings.heroImagePath ? (
              <div className="relative">
                <div aria-hidden className="absolute -inset-5 rounded-[2.2rem] bg-gradient-to-br from-glow/40 to-signal/30 opacity-60 blur-2xl" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={settings.heroImagePath} alt="" width={720} height={900} loading="eager" fetchPriority="high" decoding="async" className="relative aspect-[4/5] w-full rounded-[2rem] border border-white/15 object-cover" />
              </div>
            ) : (
              <Orbit className="w-full opacity-90" />
            )}
          </div>
        </div>
        <div aria-hidden className="site-mono pointer-events-none absolute inset-x-0 bottom-5 z-10 hidden justify-center text-[11px] uppercase text-brand-200 sm:flex">
          <span className="flex flex-col items-center gap-2">{t("site.hero.scroll")}<span className="h-8 w-px bg-gradient-to-b from-glow to-transparent" /></span>
        </div>
      </section>

      {/* ───────── Ticker of real levels ───────── */}
      {levels.length > 0 && <Marquee items={levels.map((l) => l.name)} className="border-y border-white/10 bg-night-2 py-6 text-white/80" />}

      {/* ───────── Levels ───────── */}
      {levels.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionHeading kicker={t("site.levels.kicker")} title={t("site.levels.title")} />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {levels.map((l, i) => (
              <Reveal as="li" key={l.id} delay={i * 90}>
                <Spotlight className="lift h-full rounded-3xl border border-night/10 bg-white p-7">
                  <p className="site-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</p>
                  <h3 className="site-serif mt-3 text-3xl text-night">{l.name}</h3>
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {l.classes.map((c) => <li key={c} className="rounded-full bg-accent-50 px-3 py-1 text-sm font-medium text-accent-700">{c}</li>)}
                  </ul>
                </Spotlight>
              </Reveal>
            ))}
          </ul>
        </section>
      )}

      {/* ───────── About ───────── */}
      {text.about && (
        <section className="overflow-hidden bg-night text-white">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2 lg:items-center">
            <Reveal>
              <Kicker dark>{t("site.about.kicker")}</Kicker>
              <h2 className="site-serif mt-3 text-3xl leading-[1.1] sm:text-5xl">{t("site.about.title")}</h2>
              <p className="mt-5 line-clamp-6 whitespace-pre-line text-lg leading-relaxed text-brand-100">{text.about}</p>
              <Link href="/about" className="mt-6 inline-flex min-h-11 items-center gap-2 font-semibold text-signal hover:underline">{t("site.about.more")} <ArrowRight className="size-4" aria-hidden /></Link>
            </Reveal>
            {settings.aboutImagePath ? (
              <Parallax distance={36}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={settings.aboutImagePath} alt="" width={720} height={540} loading="lazy" decoding="async" className="aspect-[4/3] w-full rounded-3xl border border-white/10 object-cover" />
              </Parallax>
            ) : school.motto ? (
              <Reveal as="blockquote" className="glass rounded-3xl p-8 text-2xl font-semibold leading-snug sm:text-4xl">“{school.motto}”</Reveal>
            ) : (
              <Reveal className="mx-auto w-full max-w-sm"><Orbit className="w-full opacity-80" /></Reveal>
            )}
          </div>
        </section>
      )}

      {/* ───────── How applying works ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <SectionHeading kicker={t("site.how.kicker")} title={t("site.how.title")} />
        <Reveal className="relative mt-12">
          <div aria-hidden className="draw absolute left-[8%] right-[8%] top-8 hidden h-px bg-gradient-to-r from-accent via-glow to-signal md:block" />
          <ol className="relative grid gap-4 md:grid-cols-3">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="lift relative overflow-hidden rounded-3xl border border-night/10 bg-white p-7 pt-16">
                <span className="site-serif absolute left-7 top-4 flex size-12 items-center justify-center rounded-full bg-night text-xl text-white">{n}</span>
                <h3 className="text-xl font-bold text-night">{t(`site.how.${n}.title`)}</h3>
                <p className="mt-3 leading-relaxed text-muted">{t(`site.how.${n}.body`)}</p>
              </li>
            ))}
          </ol>
        </Reveal>
        <div className="mt-8 flex flex-wrap gap-3">
          {settings.applicationsOpen && <CtaLink href="/apply/form" variant="accent" arrow>{t("site.hero.apply")}</CtaLink>}
          <CtaLink href="/apply" variant="outline">{t("site.nav.admissions")}</CtaLink>
        </div>
      </section>

      {/* ───────── Gallery (only the school's approved photos) ───────── */}
      {gallery.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <SectionHeading kicker={t("site.gallery.kicker")} title={t("site.gallery.title")} />
          <div className="mt-10"><GalleryRail items={gallery} labels={{ close: t("nav.close"), prev: t("site.gallery.prev"), next: t("site.gallery.next") }} /></div>
        </section>
      )}

      {/* ───────── News + events (real, published content only) ───────── */}
      {(news.items.length > 0 || events.length > 0) && (
        <section className="mx-auto grid max-w-6xl gap-14 px-4 pb-24 sm:px-6 lg:grid-cols-[1.3fr_1fr]">
          {news.items.length > 0 && (
            <div>
              <SectionHeading kicker={t("site.news.kicker")} title={t("site.news.title")} />
              <ul className="mt-8 divide-y divide-night/10 border-y border-night/10">
                {news.items.map((n, i) => (
                  <Reveal as="li" key={n.id} delay={i * 80}>
                    <Link href={`/news/${n.id}`} className="group flex items-start justify-between gap-4 py-6">
                      <div>
                        <p className="site-mono text-xs text-muted">{displayDate(n.publishedAt, locale)}</p>
                        <h3 className="site-serif mt-2 text-2xl text-night transition-colors group-hover:text-accent">{locale === "SW" && n.titleSw ? n.titleSw : n.title}</h3>
                      </div>
                      <ArrowRight className="mt-2 size-5 shrink-0 text-accent transition-transform group-hover:translate-x-1" aria-hidden />
                    </Link>
                  </Reveal>
                ))}
              </ul>
              <Link href="/news" className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-accent hover:underline">{t("site.news.all")} <ArrowRight className="size-4" aria-hidden /></Link>
            </div>
          )}
          {events.length > 0 && (
            <div>
              <SectionHeading kicker={t("site.events.kicker")} title={t("site.events.title")} />
              <ul className="mt-8 space-y-3">
                {events.map((e, i) => (
                  <Reveal as="li" key={e.id} delay={i * 80} className="lift flex gap-4 rounded-2xl border border-night/10 bg-white p-4">
                    <CalendarDays className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
                    <div>
                      <p className="site-mono text-xs text-muted">{displayDate(e.startsOn, locale)}</p>
                      <p className="font-semibold text-night">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</p>
                      {e.location && <p className="text-sm text-muted">{e.location}</p>}
                    </div>
                  </Reveal>
                ))}
              </ul>
              <Link href="/calendar" className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-accent hover:underline">{t("site.events.all")} <ArrowRight className="size-4" aria-hidden /></Link>
            </div>
          )}
        </section>
      )}

      {/* ───────── Portals ───────── */}
      <section className="bg-night-2 text-white">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionHeading dark kicker={t("site.portal.title")} title={t("site.portal.title")}>{t("site.portal.body")}</SectionHeading>
          <ul className="mt-12 grid gap-4 md:grid-cols-3">
            {([["parents", Users], ["students", GraduationCap], ["staff", ShieldCheck]] as const).map(([k, Icon], i) => (
              <Reveal as="li" key={k} delay={i * 100}>
                <Spotlight as="div" className="glass lift group h-full rounded-3xl p-7 hover:bg-white/10">
                  <Link href="/login" className="block">
                    <Icon className="size-8 text-glow" aria-hidden />
                    <h3 className="mt-5 text-xl font-bold">{t(`site.portal.${k}`)}</h3>
                    <p className="mt-8 inline-flex items-center gap-2 font-semibold text-signal">{t("site.portal.cta")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></p>
                  </Link>
                </Spotlight>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* ───────── Final call to action ───────── */}
      <section className="hero-glow hero-grid relative isolate overflow-hidden bg-night text-white">
        <div className="relative z-10 mx-auto grid max-w-6xl gap-8 px-4 py-24 sm:px-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <Reveal>
            <BookOpen className="size-8 text-glow" aria-hidden />
            <h2 className="site-serif mt-4 text-4xl leading-[1.05] sm:text-6xl">{t("site.cta.title")}</h2>
            <p className="mt-4 max-w-xl text-lg text-brand-100">{t("site.cta.body")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {settings.applicationsOpen ? <CtaLink href="/apply/form" variant="signal" arrow>{t("site.hero.apply")}</CtaLink> : <CtaLink href="/contact" variant="signal" arrow>{t("site.nav.contact")}</CtaLink>}
              <CtaLink href="/apply" variant="ghost">{t("site.nav.admissions")}</CtaLink>
            </div>
          </Reveal>
          {(contact.address || contact.phone) && (
            <Reveal delay={120} as="ul" className="glass space-y-3 rounded-3xl p-6 text-brand-100">
              {contact.address && <li className="flex gap-3"><MapPin className="mt-0.5 size-5 shrink-0 text-glow" aria-hidden />{contact.address}</li>}
              {contact.phone && <li className="flex gap-3"><Phone className="mt-0.5 size-5 shrink-0 text-glow" aria-hidden /><a href={telHref(contact.phone)} className="hover:text-white">{contact.phone}</a></li>}
            </Reveal>
          )}
        </div>
      </section>
    </>
  );
}
