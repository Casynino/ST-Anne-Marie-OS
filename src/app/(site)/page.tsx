import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref, waHref } from "@/lib/site";
import { listPublicEvents, listPublicNews, resolveSiteImages } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { ButtonLink, Eyebrow, Print } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { HeroStage } from "@/components/site/fx/hero-stage";
import { WordReveal } from "@/components/site/fx/word-reveal";
import { LocalTime } from "@/components/site/fx/local-time";
import { CountUp } from "@/components/site/fx/count-up";
import { Marquee } from "@/components/site/fx/marquee";
import { ScrollWords } from "@/components/site/fx/scroll-words";
import { Parallax } from "@/components/site/fx/parallax";
import { HRail } from "@/components/site/fx/h-rail";
import { SpotCard } from "@/components/site/fx/spot-card";
import { PortalShowcase } from "@/components/site/portal-showcase";
import { Photo } from "@/components/site/photo";
import { NewsCard } from "@/components/site/news-card";
import { ContactForm } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await getSite(), { path: "/" });
}

const WRAP = "mx-auto max-w-[100rem] px-4 sm:px-8";

/** Sets the headline as two parts (before / after the first comma, else the last word) and sizes it to its length. */
function headline(title: string) {
  const t = title.trim();
  const comma = t.indexOf(",");
  const words = t.split(/\s+/);
  const head = comma > 0 ? t.slice(0, comma + 1) : words.length > 1 ? words.slice(0, -1).join(" ") : "";
  const tail = comma > 0 ? t.slice(comma + 1).trim() : words.length > 1 ? words[words.length - 1]! : t;
  const len = t.length;
  const size = len <= 22 ? "text-[clamp(3.4rem,9.5vw,9rem)]" : len <= 44 ? "text-[clamp(3rem,7.6vw,7rem)]" : "text-[clamp(2.7rem,6.2vw,5.6rem)]";
  return { head, tail, size };
}

/** First paragraph of a longer text, cut to a readable length for the scroll-lit statement. */
function statement(s: string | null | undefined, max = 62) {
  const first = (s ?? "").split(/\n\s*\n/)[0]?.trim() ?? "";
  const words = first.split(/\s+/).filter(Boolean);
  return words.length > max ? `${words.slice(0, max).join(" ")}…` : first;
}

export default async function HomePage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const { school, text, settings, levels, contact, images } = site;
  const [news, events] = await Promise.all([listPublicNews(school.id, { limit: 3 }), listPublicEvents(school.id, school.timezone, { limit: 4 })]);
  const covers = await resolveSiteImages(news.items.map((n) => n.coverImage));

  // Pictures come only from the school's own photographs; with none, the page simply has none (never stock imagery).
  const gallery = images.gallery;
  const pool = images.hero.length ? images.hero : gallery;
  const landscape = pool.filter((p) => p.width / p.height >= 1.25);
  const slides = (landscape.length >= 2 ? [...landscape, ...pool.filter((p) => !landscape.includes(p))] : pool).slice(0, 5);
  const open = settings.applicationsOpen;
  const classCount = levels.reduce((n, l) => n + l.classes.length, 0);
  const { head, tail, size } = headline(text.heroTitle);
  const lead = statement(text.about ?? text.vision ?? text.philosophy ?? text.learningApproach);
  const aboutPic = images.about ?? gallery[3] ?? gallery[0];
  const hasContact = Object.values(contact).some(Boolean);
  const city = school.timezone.split("/").pop()?.replace(/_/g, " ") ?? "";
  const nowAtSchool = new Intl.DateTimeFormat("en-GB", { timeZone: school.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const ticker = text.strengths.length > 0 ? text.strengths.map((s) => s.title) : levels.map((l) => l.name);

  const hud = [
    { label: t("site.hud.time"), value: <span className="display text-4xl sm:text-5xl"><LocalTime timezone={school.timezone} initial={nowAtSchool} /></span>, sub: city },
    levels.length > 0 && { label: t("site.stats.levels"), value: <span className="display text-4xl sm:text-5xl"><CountUp to={levels.length} /></span>, sub: levels.map((l) => l.name).join(" · ") },
    classCount > 0 && { label: t("site.stats.classes"), value: <span className="display text-4xl sm:text-5xl"><CountUp to={classCount} /></span> },
    { label: t("site.stats.admissions"), href: open ? "/apply/form" : "/apply", value: <span className="display flex items-center gap-3 text-4xl sm:text-5xl">{open && <span className="pulse-dot size-2.5 rounded-full bg-sun" aria-hidden />}{open ? t("site.stats.open") : t("site.stats.closed")}</span>, sub: t("site.hero.apply") },
  ].filter(Boolean) as { label: string; value: React.ReactNode; sub?: string; href?: string }[];

  return (
    <>
      {/* ───────── Hero: the school's photographs, full screen ───────── */}
      <HeroStage slides={slides} labels={{ pause: t("site.hero.pause"), play: t("site.hero.play"), of: t("site.hero.of") }}>
        <div className={`${WRAP} flex min-h-[100svh] flex-col justify-end pb-28 pt-44 sm:pb-24`}>
          <div className="max-w-6xl">
            <p className="rise glass inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[.2em] text-white/90">
              {open && <span className="pulse-dot size-2 rounded-full bg-sun" aria-hidden />}
              <span>{open ? t("site.hero.status") : school.name}</span>
              {levels.length > 0 && <span className="text-white/45">{levels.map((l) => l.name).join(" · ")}</span>}
            </p>
            <h1 className={`display mt-7 text-white ${size}`}>
              {head && <span className="block"><WordReveal text={head} /></span>}
              <span className="block italic text-sun"><WordReveal text={tail} offset={head.split(/\s+/).filter(Boolean).length} /></span>
            </h1>
            {text.heroSubtitle && <p className="lead rise-3 mt-8 max-w-2xl text-white/80">{text.heroSubtitle}</p>}
            <div className="rise-3 mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink href={open ? "/apply/form" : "/apply"} variant="sun" arrow>{open ? t("site.hero.apply") : t("site.nav.admissions")}</ButtonLink>
              <ButtonLink href="/about" variant="ghost">{t("site.hero.explore")}</ButtonLink>
            </div>
            {!open && <p className="mt-4 max-w-md text-sm text-white/60">{t("site.hero.closed")}</p>}
          </div>

          <dl className="rise-3 glass mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-[1.5rem] bg-white/10 lg:grid-cols-4">
            {hud.map((h) => {
              const cell = (<><dt className="text-[11px] font-semibold uppercase tracking-[.2em] text-white/55">{h.label}</dt><dd className="mt-2 text-white">{h.value}</dd>{h.sub && <p className="mt-1 truncate text-xs text-white/55">{h.sub}</p>}</>);
              return h.href ? <Link key={h.label} href={h.href} className="block bg-[#07100b]/70 p-5 transition-colors hover:bg-[#07100b]/45 sm:p-6">{cell}</Link> : <div key={h.label} className="bg-[#07100b]/70 p-5 sm:p-6">{cell}</div>;
            })}
          </dl>
        </div>
      </HeroStage>

      {/* ───────── Ticker: the school's own words ───────── */}
      {ticker.length > 0 && <div className="border-y border-white/10 bg-[#050c08] py-6 sm:py-8"><Marquee items={ticker} /></div>}

      {/* ───────── The school, lit word by word ───────── */}
      {lead && (
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="absolute -left-40 top-1/3 -z-10 size-[34rem] rounded-full bg-brand-500/10 blur-3xl" />
          <div className={`${WRAP} grid gap-14 py-24 sm:py-36 lg:grid-cols-12`}>
            <div className="lg:col-span-7">
              <Eyebrow>{t("site.about.kicker")}</Eyebrow>
              <ScrollWords text={lead} className="display mt-8 text-[2rem] leading-[1.18] text-heading sm:text-5xl lg:text-[3.4rem]" />
              <div className="mt-10"><ButtonLink href="/about" variant="outline" arrow>{t("site.about.more")}</ButtonLink></div>
            </div>
            {aboutPic && (
              <div className="grid grid-cols-2 gap-5 lg:col-span-5">
                <Parallax from={70} to={-30} className="col-span-1 pt-16"><Print image={aboutPic} n={1} sizes="(min-width: 1024px) 18vw, 45vw" ratio="aspect-[3/4]" /></Parallax>
                {gallery[4] && <Parallax from={20} to={-90} className="col-span-1"><Print image={gallery[4]} n={2} sizes="(min-width: 1024px) 18vw, 45vw" ratio="aspect-[3/4]" /></Parallax>}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ───────── Programmes (real levels, real links) ───────── */}
      {levels.length > 0 && (
        <section className="site-deep relative isolate overflow-hidden border-y border-white/10">
          <div className={`${WRAP} py-24 sm:py-32`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <Reveal className="max-w-3xl"><Eyebrow>{t("site.programs.kicker")}</Eyebrow><h2 className="display mt-5 text-[2.6rem] text-heading sm:text-6xl lg:text-7xl">{t("site.programs.title")}</h2></Reveal>
              <ButtonLink href="/academics" variant="ghost" arrow>{t("site.nav.academics")}</ButtonLink>
            </div>
            <ul className={`mt-14 grid gap-5 sm:grid-cols-2 ${levels.length >= 4 ? "xl:grid-cols-4" : levels.length === 3 ? "xl:grid-cols-3" : ""}`}>
              {levels.map((l, i) => {
                const pic = gallery.length ? gallery[(i * 2 + 1) % gallery.length] : undefined;
                return (
                  <Reveal as="li" key={l.id} delay={i * 90}>
                    <SpotCard className="h-full rounded-[1.75rem]">
                      <Link href={`/academics#${l.slug}`} className="group relative isolate flex h-full min-h-[26rem] flex-col justify-end overflow-hidden rounded-[1.75rem] border border-white/10 bg-surface p-7 transition-[border-color,transform] duration-500 hover:-translate-y-1 hover:border-sun/50">
                        {pic && <div aria-hidden className="absolute inset-0 -z-10"><Photo image={pic} sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw" className="saturate-[.7] transition-transform duration-[1400ms] group-hover:scale-110" /></div>}
                        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(8_26_17/.35)_0%,rgb(7_16_11/.92)_70%)]" />
                        <span aria-hidden className="display absolute right-6 top-4 text-[6.5rem] leading-none text-white/10 transition-colors duration-500 group-hover:text-sun/40">{String(i + 1).padStart(2, "0")}</span>
                        <h3 className="display text-5xl text-white">{l.name}</h3>
                        {l.summary && <p className="mt-3 line-clamp-3 text-white/70">{l.summary}</p>}
                        <ul className="mt-5 flex flex-wrap gap-1.5">{l.classes.map((c) => <li key={c} className="glass rounded-full px-3 py-1 text-xs font-semibold text-white">{c}</li>)}</ul>
                        <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-sun">{t("site.programs.cta")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1.5" aria-hidden /></span>
                      </Link>
                    </SpotCard>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ───────── School life: a rail of photographs that travels as you scroll ───────── */}
      {gallery.length > 0 && (
        <section className="relative">
          <HRail
            items={gallery}
            intro={
              <div>
                <Eyebrow>{t("site.life.kicker")}</Eyebrow>
                <h2 className="display mt-5 text-[2.8rem] text-heading sm:text-6xl xl:text-7xl">{t("site.life.title")}</h2>
                <div className="mt-8"><ButtonLink href="/school-life" variant="outline" arrow>{t("site.life.cta")}</ButtonLink></div>
              </div>
            }
          />
        </section>
      )}

      {/* ───────── Why families choose the school (the school's own statements) ───────── */}
      {text.strengths.length > 0 && (
        <section className="border-t border-white/10">
          <div className={`${WRAP} grid gap-14 py-24 sm:py-32 lg:grid-cols-12`}>
            <div className="lg:col-span-5"><div className="lg:sticky lg:top-32"><Eyebrow>{t("site.why.kicker")}</Eyebrow><h2 className="display mt-5 text-[2.6rem] text-heading sm:text-6xl lg:text-7xl">{t("site.why.title")}</h2></div></div>
            <ol className="lg:col-span-7">
              {text.strengths.map((s, i) => (
                <Reveal as="li" key={s.title} className="group relative border-t border-white/12 py-8 first:border-t-0 first:pt-0">
                  <span aria-hidden className="draw absolute -top-px left-0 h-px w-full bg-sun group-first:hidden" />
                  <div className="grid gap-x-8 sm:grid-cols-[4.5rem_1fr]">
                    <span aria-hidden className="display text-5xl text-sun/90 transition-transform duration-500 group-hover:translate-x-1">{String(i + 1).padStart(2, "0")}</span>
                    <div><h3 className="display text-4xl text-heading sm:text-5xl">{s.title}</h3>{s.text && <p className="lead mt-3 max-w-xl text-muted">{s.text}</p>}</div>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* ───────── Admissions ───────── */}
      <section className="site-paper relative isolate overflow-hidden">
        <div className={`${WRAP} py-24 sm:py-32`}>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <Reveal className="lg:col-span-7"><p className="eyebrow">{t("site.how.kicker")}</p><h2 className="display mt-5 text-[2.8rem] text-heading sm:text-6xl lg:text-7xl">{t("site.how.title")}</h2><p className="lead mt-6 max-w-xl text-muted">{text.admissionsIntro ?? t("site.admissions.default")}</p></Reveal>
            <div className="flex flex-wrap gap-3 lg:col-span-5 lg:justify-end">
              {open ? <ButtonLink href="/apply/form" variant="primary" arrow>{t("site.hero.apply")}</ButtonLink> : <ButtonLink href="/contact" variant="primary" arrow>{t("site.nav.contact")}</ButtonLink>}
              <ButtonLink href="/apply" variant="outline">{t("site.nav.admissions")}</ButtonLink>
            </div>
          </div>
          <ol className="relative mt-16 grid gap-5 md:grid-cols-3">
            <span aria-hidden className="draw absolute left-[8%] right-[8%] top-[3.4rem] hidden h-px bg-brand-600/40 md:block" />
            {([1, 2, 3] as const).map((n, i) => (
              <Reveal as="li" key={n} delay={i * 130}>
                <div className="relative h-full rounded-[1.75rem] border border-line bg-surface p-8 shadow-[var(--shadow-card)]">
                  <span aria-hidden className="display flex size-[4.5rem] items-center justify-center rounded-full bg-brand-700 text-4xl text-white ring-[10px] ring-canvas">{n}</span>
                  <h3 className="display mt-7 text-4xl text-heading">{t(`site.how.${n}.title`)}</h3>
                  <p className="mt-3 text-muted">{t(`site.how.${n}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <p className="mt-8 max-w-2xl text-sm text-muted">{t("site.admissions.disclaimer")}</p>
        </div>
      </section>

      {/* ───────── News and dates (real, published records only) ───────── */}
      {(news.items.length > 0 || events.length > 0) && (
        <section>
          <div className={`${WRAP} py-24 sm:py-32`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <Reveal><Eyebrow>{t("site.news.kicker")}</Eyebrow><h2 className="display mt-5 text-[2.6rem] text-heading sm:text-6xl lg:text-7xl">{t("site.nav.newsEvents")}</h2></Reveal>
              <ButtonLink href="/news" variant="ghost" arrow>{t("site.news.all")}</ButtonLink>
            </div>
            <div className={`mt-14 grid gap-6 ${events.length > 0 && news.items.length > 0 ? "lg:grid-cols-[1.7fr_1fr]" : ""}`}>
              {news.items.length > 0 && (
                <ul className={`grid gap-6 ${events.length > 0 ? "sm:grid-cols-2" : news.items.length === 1 ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                  {news.items.slice(0, events.length > 0 ? 2 : 3).map((n, i) => <Reveal as="li" key={n.id} delay={i * 90}><NewsCard post={n} cover={n.coverImage ? covers.get(n.coverImage) : undefined} locale={locale} featured={news.items.length === 1 && events.length === 0} /></Reveal>)}
                </ul>
              )}
              {events.length > 0 && (
                <Reveal className="rounded-[1.75rem] border border-line bg-surface p-7">
                  <h3 className="display flex items-center gap-3 text-3xl text-heading"><CalendarDays className="size-6 text-sun" aria-hidden />{t("site.events.title")}</h3>
                  <ul className="mt-4 divide-y divide-white/10">
                    {events.map((e) => (
                      <li key={e.id}>
                        <Link href={`/events/${e.id}`} className="group grid grid-cols-[4rem_1fr] gap-4 py-5">
                          <div aria-hidden className="rounded-2xl border border-white/10 bg-white/5 py-2 text-center transition-colors group-hover:border-sun/60"><span className="display block text-4xl leading-none text-heading">{e.startsOn.getUTCDate()}</span><span className="mt-1 block text-[10px] font-semibold uppercase tracking-[.16em] text-sun">{displayDate(e.startsOn, locale).split(" ")[1]}</span></div>
                          <div className="min-w-0"><span className="display text-2xl text-heading group-hover:text-sun">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</span>{e.location && <p className="mt-1 flex items-center gap-1.5 text-sm text-muted"><MapPin className="size-3.5" aria-hidden />{e.location}</p>}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link href="/events" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sun hover:underline">{t("site.events.all")} <ArrowRight className="size-4" aria-hidden /></Link>
                </Reveal>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───────── Family portal (scroll-tilt showcase) ───────── */}
      <section className="site-deep relative isolate overflow-x-clip border-y border-white/10">
        <div aria-hidden className="absolute left-1/2 top-24 -z-10 size-[44rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl" />
        <PortalShowcase
          eyebrow={t("site.portal.kicker")}
          title={t("site.portal.headline")}
          body={text.parentCommunity ?? t("site.community.default")}
          features={(["reports", "fees", "attendance", "homework", "timetable", "messages", "calendar"] as const).map((k) => t(`site.portal.f.${k}`))}
          primary={{ href: "/portal", label: t("site.nav.portal") }}
          secondary={{ href: "/login", label: t("site.nav.signIn") }}
          labels={{ today: t("site.portal.today"), portal: t("site.portal.kicker"), reports: t("site.portal.f.reports"), fees: t("site.portal.f.fees"), attendance: t("site.portal.f.attendance"), homework: t("site.portal.f.homework"), timetable: t("site.portal.f.timetable"), messages: t("site.portal.f.messages"), behaviour: t("learn.bh.familyTitle") }}
        />
        <p className="relative mx-auto -mt-16 max-w-md px-4 pb-14 text-center text-sm text-white/55 md:-mt-28">{t("site.portal.note")}</p>
      </section>

      {/* ───────── Contact ───────── */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="absolute -right-40 top-10 -z-10 size-[36rem] rounded-full bg-sun/[.06] blur-3xl" />
        <div className={`${WRAP} grid gap-14 py-24 sm:py-32 lg:grid-cols-[0.9fr_1.1fr]`}>
          <div>
            <Reveal><Eyebrow>{t("site.contact.kicker")}</Eyebrow><h2 className="display mt-5 text-[2.8rem] text-heading sm:text-6xl lg:text-7xl">{t("site.contact.title")}</h2></Reveal>
            {hasContact ? (
              <dl className="mt-10 divide-y divide-white/10 rounded-[1.75rem] border border-line bg-surface px-6 text-lg">
                {contact.address && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-sun">{t("site.contact.address")}</dt><dd>{contact.address}</dd></div>}
                {contact.phone && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-sun">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone)} className="font-semibold hover:text-sun">{contact.phone}</a></dd></div>}
                {contact.phone2 && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-sun">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone2)} className="font-semibold hover:text-sun">{contact.phone2}</a></dd></div>}
                {contact.whatsapp && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-sun">WhatsApp</dt><dd><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-sun">{contact.whatsapp}</a></dd></div>}
                {contact.email && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-sun">{t("site.contact.email")}</dt><dd><a href={`mailto:${contact.email}`} className="break-all font-semibold hover:text-sun">{contact.email}</a></dd></div>}
                {contact.hours && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-semibold uppercase tracking-[.2em] text-sun">{t("site.contact.hours")}</dt><dd>{contact.hours}</dd></div>}
              </dl>
            ) : <p className="mt-6 text-muted">{t("site.contact.empty")}</p>}
            {contact.mapUrl && <div className="mt-6"><ButtonLink href={contact.mapUrl} external variant="outline" arrow>{t("site.contact.directions")}</ButtonLink></div>}
          </div>
          <Reveal delay={100} className="rounded-[1.75rem] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-9">
            <ContactForm t={t} idPrefix="home" />
          </Reveal>
        </div>
      </section>
    </>
  );
}
