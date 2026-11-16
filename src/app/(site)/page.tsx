import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Bell, CalendarDays, Camera, MapPin, MessageCircle, Rss, School, Pencil } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref, waHref } from "@/lib/site";
import { listPublicNews, publicTermProgress, resolveSiteImages } from "@/server/website";
import { schoolCalendar } from "@/server/calendar";
import { displayDate, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { ButtonLink, Eyebrow, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { HeroStage } from "@/components/site/fx/hero-stage";
import { WordReveal } from "@/components/site/fx/word-reveal";
import { LocalTime } from "@/components/site/fx/local-time";
import { CountUp } from "@/components/site/fx/count-up";
import { HRail } from "@/components/site/fx/h-rail";
import { PortalShowcase } from "@/components/site/portal-showcase";
import { Photo } from "@/components/site/photo";
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
  const size = len <= 22 ? "text-[clamp(2.8rem,7.5vw,6.5rem)]" : len <= 44 ? "text-[clamp(2.5rem,5.6vw,5rem)]" : "text-[clamp(2.2rem,4.6vw,4rem)]";
  return { head, tail, size };
}

/** First paragraph of a longer text, cut to a readable length. */
function statement(s: string | null | undefined, max = 90) {
  const first = (s ?? "").split(/\n\s*\n/)[0]?.trim() ?? "";
  const words = first.split(/\s+/).filter(Boolean);
  return words.length > max ? `${words.slice(0, max).join(" ")}…` : first;
}

export default async function HomePage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const { school, text, settings, levels, contact, images } = site;
  const todayIso = todayInTimezone(school.timezone);
  const todayDate = parseDateOnly(todayIso) as Date;
  const [news, upcomingRaw, termNow] = await Promise.all([
    listPublicNews(school.id, { limit: 3 }),
    schoolCalendar(school.id, todayDate, new Date(todayDate.getTime() + 150 * 86_400_000), { includeInternal: false }),
    publicTermProgress(school.id, school.timezone),
  ]);
  // "Coming up": from today on, ranges that are already running included; term start/end dates are listed with the events.
  const events = upcomingRaw.filter((i) => (i.to ?? i.from) >= todayIso).slice(0, 5);
  const igUrl = site.social.instagram;
  const igHandle = igUrl ? `@${igUrl.replace(/\/+$/, "").split("/").pop()}` : null;
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

  const hud = [
    { label: t("site.hud.time"), value: <span className="display text-4xl text-heading"><LocalTime timezone={school.timezone} initial={nowAtSchool} /></span>, sub: city },
    levels.length > 0 && { label: t("site.stats.levels"), value: <span className="display text-4xl text-heading"><CountUp to={levels.length} /></span>, sub: levels.map((l) => l.name).join(" · ") },
    classCount > 0 && { label: t("site.stats.classes"), value: <span className="display text-4xl text-heading"><CountUp to={classCount} /></span> },
    { label: t("site.stats.admissions"), href: open ? "/apply/form" : "/apply", value: <span className="display flex items-center gap-3 text-4xl text-heading">{open && <span className="pulse-dot size-2.5 rounded-full bg-brand-500" aria-hidden />}{open ? t("site.stats.open") : t("site.stats.closed")}</span>, sub: t("site.hero.apply") },
  ].filter(Boolean) as { label: string; value: React.ReactNode; sub?: string; href?: string }[];

  const tiles = [
    { href: "/apply", title: t("site.nav.admissions"), pic: gallery[1] },
    { href: "/school-life", title: t("site.nav.schoolLife"), pic: gallery[5] ?? gallery[0] },
    { href: "/portal", title: t("site.nav.portal"), pic: gallery[3] },
    { href: "/calendar", title: t("site.nav.calendar"), pic: gallery[2] },
  ].filter((x) => x.pic);

  return (
    <>
      {/* ───────── Hero: the school's photographs ───────── */}
      <HeroStage slides={slides} labels={{ pause: t("site.hero.pause"), play: t("site.hero.play"), of: t("site.hero.of") }}>
        <div className={`${WRAP} flex min-h-[min(46rem,86svh)] flex-col justify-end pb-24 pt-32 sm:pb-28`}>
          <div className="max-w-5xl">
            <h1 className={`display text-white [text-shadow:0_2px_24px_rgb(0_0_0/.35)] ${size}`}>
              {head && <span className="block"><WordReveal text={head} /></span>}
              <span className="block text-sun"><WordReveal text={tail} offset={head.split(/\s+/).filter(Boolean).length} /></span>
            </h1>
            {text.heroSubtitle && <p className="lead rise-3 mt-6 max-w-2xl text-white/90">{text.heroSubtitle}</p>}
            <div className="rise-3 mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={open ? "/apply/form" : "/apply"} variant="sun" arrow>{open ? t("site.hero.apply") : t("site.nav.admissions")}</ButtonLink>
              <ButtonLink href="/about" variant="ghost">{t("site.hero.explore")}</ButtonLink>
            </div>
            {!open && <p className="mt-4 max-w-md text-sm text-white/75">{t("site.hero.closed")}</p>}
          </div>
        </div>
      </HeroStage>

      {/* ───────── At a glance (real figures from the school's records) ───────── */}
      <section className="relative z-10 -mt-12 sm:-mt-16">
        <dl className={`${WRAP}`}>
          <div className="card-y grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
            {hud.map((h, i) => {
              const cell = (<><dt className="text-[11px] font-bold uppercase tracking-[.16em] text-muted">{h.label}</dt><dd className="mt-2">{h.value}</dd>{h.sub && <p className="mt-1 truncate text-xs text-muted">{h.sub}</p>}</>);
              const cls = `block p-5 sm:p-7 ${i % 2 === 1 ? "border-l border-line lg:border-l-0" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""}`;
              return h.href ? <Link key={h.label} href={h.href} className={`${cls} transition-colors hover:bg-tint`}>{cell}</Link> : <div key={h.label} className={cls}>{cell}</div>;
            })}
          </div>
        </dl>
      </section>

      {/* ───────── Welcome ───────── */}
      {lead && (
        <section>
          <div className={`${WRAP} grid items-center gap-14 py-20 sm:py-28 lg:grid-cols-2 lg:gap-20`}>
            {aboutPic && (
              <Reveal className="order-last lg:order-first">
                <div className="photo-offset ml-5 sm:ml-6"><div className="frame aspect-[4/3] shadow-[var(--shadow-card)]"><Photo image={aboutPic} sizes="(min-width: 1024px) 45vw, 90vw" /></div></div>
              </Reveal>
            )}
            <Reveal className={aboutPic ? "" : "lg:col-span-2 lg:max-w-3xl"}>
              <Eyebrow>{t("site.about.kicker")}</Eyebrow>
              <h2 className="display mt-4 text-[2rem] text-heading sm:text-5xl">{t("site.about.title")}</h2>
              <p className="lead mt-6 whitespace-pre-line text-ink/85">{lead}</p>
              <div className="mt-8 flex flex-wrap gap-3"><ButtonLink href="/about" variant="outline" arrow>{t("site.about.more")}</ButtonLink></div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ───────── Programmes (real levels, real links) ───────── */}
      {levels.length > 0 && (
        <section className="site-soft border-y border-line">
          <div className={`${WRAP} py-20 sm:py-28`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading eyebrow={t("site.programs.kicker")} title={t("site.programs.title")} />
              <ButtonLink href="/academics" variant="outline" arrow>{t("site.nav.academics")}</ButtonLink>
            </div>
            <ul className={`mt-12 grid gap-6 sm:grid-cols-2 ${levels.length >= 4 ? "xl:grid-cols-4" : levels.length === 3 ? "xl:grid-cols-3" : ""}`}>
              {levels.map((l, i) => {
                const pic = gallery.length ? gallery[(i * 2 + 1) % gallery.length] : undefined;
                return (
                  <Reveal as="li" key={l.id} delay={i * 90}>
                    <Link href={`/academics#${l.slug}`} className="card-y group flex h-full flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-1">
                      {pic && <div className="frame aspect-[16/10]"><Photo image={pic} sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw" /></div>}
                      <div className="flex flex-1 flex-col p-6">
                        <h3 className="display text-2xl text-heading">{l.name}</h3>
                        {l.summary && <p className="mt-2 line-clamp-3 text-muted">{l.summary}</p>}
                        <ul className="mt-4 flex flex-wrap gap-1.5">{l.classes.map((c) => <li key={c} className="rounded bg-tint px-2.5 py-1 text-xs font-bold text-link">{c}</li>)}</ul>
                        <span className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-bold uppercase tracking-[.06em] text-link">{t("site.programs.cta")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1.5" aria-hidden /></span>
                      </div>
                    </Link>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ───────── News and dates ahead (real, published records only) ───────── */}
      {(news.items.length > 0 || events.length > 0 || termNow.current || termNow.next) && (
        <section id="happening">
          <div className={`${WRAP} py-20 sm:py-28`}>
            <SectionHeading align="center" eyebrow={t("site.now.kicker")} title={t("site.now.title")} />
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              {news.items.length > 0 && (
                <Reveal className="card-y p-6 sm:p-8">
                  <h3 className="text-xs font-extrabold uppercase tracking-[.16em] text-heading">{t("site.now.latest")}</h3>
                  <ul className="mt-6 divide-y divide-line">
                    {news.items.map((n) => {
                      const cover = n.coverImage ? covers.get(n.coverImage) : undefined;
                      return (
                        <li key={n.id}>
                          <Link href={`/news/${n.slug ?? n.id}`} className="group flex gap-5 py-5 first:pt-0">
                            {cover && <div className="frame h-28 w-28 shrink-0 rounded"><Photo image={cover} sizes="112px" position="top" /></div>}
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-muted">{displayDate(n.publishedAt, locale)}{n.category ? ` · ${n.category}` : ""}</p>
                              <p className="display mt-1 text-xl text-heading group-hover:text-link">{locale === "SW" && n.titleSw ? n.titleSw : n.title}</p>
                              <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-[.1em] text-link">{t("site.news.read")} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" aria-hidden /></span>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  <Link href="/news" className="mt-2 inline-flex min-h-11 items-center gap-2 border-t border-line pt-4 text-xs font-extrabold uppercase tracking-[.1em] text-link hover:text-link">{t("site.news.all")} <ArrowRight className="size-3.5" aria-hidden /></Link>
                </Reveal>
              )}
              <Reveal delay={90} className={`card-y p-6 sm:p-8 ${news.items.length === 0 ? "lg:col-span-2" : ""}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-extrabold uppercase tracking-[.16em] text-heading">{t("site.now.upcoming")}</h3>
                  <span className="flex items-center gap-2">
                    <a href="/news/rss.xml" aria-label="RSS" title="RSS" className="grid size-7 place-items-center rounded bg-brand-800 text-white hover:bg-brand-600"><Rss className="size-3.5" aria-hidden /></a>
                    <a href="/calendar.ics" aria-label={t("site.cal.subscribe")} title={t("site.cal.subscribe")} className="grid size-7 place-items-center rounded bg-sun text-[#10200f] hover:bg-sun-600"><Bell className="size-3.5" aria-hidden /></a>
                  </span>
                </div>
                {termNow.current && (
                  <div className="mt-5 rounded bg-tint p-4">
                    <p className="flex items-baseline justify-between gap-3 text-sm"><span className="font-bold text-heading">{termNow.current.name} · {termNow.current.year}</span><span className="text-muted">{t("site.now.week", { n: termNow.current.week, total: termNow.current.totalWeeks })}</span></p>
                    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={termNow.current.pct} aria-label={t("site.now.term")} className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="draw h-full rounded-full bg-brand-600" style={{ width: `${termNow.current.pct}%` }} /></div>
                    <p className="mt-1.5 text-xs text-muted">{t("site.now.daysLeft", { n: termNow.current.daysLeft })}</p>
                  </div>
                )}
                {!termNow.current && termNow.next && <p className="mt-5 rounded bg-tint p-4 text-sm font-semibold text-heading">{t("site.now.nextTerm", { name: termNow.next.name, date: displayDate(termNow.next.startsOn, locale) })}</p>}
                {events.length === 0 ? <p className="mt-6 text-muted">{t("site.now.noEvents")}</p> : (
                  <ul className="mt-4 divide-y divide-line">
                    {events.map((e) => {
                      const start = e.from < todayIso ? todayIso : e.from;
                      const d = parseDateOnly(start) as Date;
                      const title = locale === "SW" && e.titleSw ? e.titleSw : e.title;
                      const inner = (
                        <>
                          <div aria-hidden className="grid size-[4.5rem] shrink-0 place-content-center rounded-full border-2 border-link text-center leading-none text-link transition-colors group-hover:bg-brand-700 group-hover:text-white"><span className="block text-[10px] font-extrabold uppercase tracking-[.14em]">{displayDate(d, locale).split(" ")[1]}</span><span className="display mt-0.5 block text-3xl">{d.getUTCDate()}</span></div>
                          <div className="min-w-0 self-center">
                            <p className="flex items-center gap-2 text-base font-bold text-heading"><span aria-hidden className={`size-2 shrink-0 rounded-full ${e.kind === "EVENT" ? "bg-sun" : "bg-brand-600"}`} /><span className="group-hover:text-link">{title}</span></p>
                            <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">{e.to && e.to !== e.from ? <span>→ {displayDate(parseDateOnly(e.to) as Date, locale)}</span> : <span>{t("site.now.allDay")}</span>}{e.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{e.location}</span>}</p>
                          </div>
                        </>
                      );
                      return <li key={e.id + e.from}>{e.kind === "EVENT" ? <Link href={`/events/${e.id}`} className="group flex gap-5 py-4">{inner}</Link> : <div className="group flex gap-5 py-4">{inner}</div>}</li>;
                    })}
                  </ul>
                )}
                <Link href="/calendar" className="mt-2 inline-flex min-h-11 items-center gap-2 border-t border-line pt-4 text-xs font-extrabold uppercase tracking-[.1em] text-link hover:text-link">{t("site.now.fullCalendar")} <ArrowRight className="size-3.5" aria-hidden /></Link>
              </Reveal>
            </div>
          </div>
        </section>
      )}

      {/* ───────── Explore: four doors, each with the school's own picture ───────── */}
      {tiles.length > 0 && (
        <section className="site-soft border-y border-line">
          <div className={`${WRAP} py-16 sm:py-20`}>
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map((x, i) => (
                <Reveal as="li" key={x.href} delay={i * 80}>
                  <Link href={x.href} className="group relative isolate flex aspect-[4/3] items-end overflow-hidden rounded-lg border-b-[5px] border-sun shadow-[var(--shadow-card)]">
                    <div aria-hidden className="absolute inset-0 -z-10"><Photo image={x.pic!} sizes="(min-width: 1024px) 25vw, 50vw" className="transition-transform duration-[1200ms] group-hover:scale-110" /></div>
                    <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgb(6_40_27/.92)_0%,rgb(6_40_27/.25)_65%,transparent_100%)]" />
                    <span className="flex w-full items-center justify-between gap-3 p-5 text-xl font-bold text-white"><span className="display">{x.title}</span><ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1.5" aria-hidden /></span>
                  </Link>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ───────── Three ways in ───────── */}
      <section aria-label={t("site.nav.quick")}>
        <ul className={`${WRAP} grid divide-line py-6 sm:grid-cols-3 sm:divide-x`}>
          {([
            { href: "/contact", icon: MessageCircle, title: t("site.act.enquire"), body: t("site.act.enquire.body") },
            { href: "/apply/visit", icon: School, title: t("site.act.visit"), body: t("site.act.visit.body") },
            { href: open ? "/apply/form" : "/apply", icon: Pencil, title: t("site.act.apply"), body: t("site.act.apply.body") },
          ] as const).map((a, i) => (
            <li key={a.href}>
              <Link href={a.href} className="group flex items-center gap-5 px-2 py-7 transition-colors hover:bg-tint sm:px-8 sm:first:pl-0">
                <span aria-hidden className={`grid size-14 shrink-0 place-items-center rounded-full transition-colors ${i === 2 ? "bg-sun text-[#10200f]" : "bg-brand-800 text-white group-hover:bg-brand-600"}`}><a.icon className="size-6" /></span>
                <span className="min-w-0"><span className="display block text-2xl text-heading">{a.title}</span><span className="block text-sm text-muted">{a.body}</span></span>
                <ArrowRight className="ml-auto size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1.5 group-hover:text-link" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ───────── School life: a rail of photographs that travels as you scroll ───────── */}
      {gallery.length > 0 && (
        <section className="relative border-t border-line">
          <HRail
            items={gallery}
            intro={
              <div>
                <Eyebrow>{t("site.life.kicker")}</Eyebrow>
                <h2 className="display mt-4 text-[2.2rem] text-heading sm:text-5xl">{t("site.life.title")}</h2>
                <div className="mt-8"><ButtonLink href="/school-life" variant="outline" arrow>{t("site.life.cta")}</ButtonLink></div>
              </div>
            }
          />
        </section>
      )}

      {/* ───────── Why families choose the school (the school's own statements) ───────── */}
      {text.strengths.length > 0 && (
        <section className="site-soft border-y border-line">
          <div className={`${WRAP} grid gap-12 py-20 sm:py-28 lg:grid-cols-12`}>
            <div className="lg:col-span-5"><div className="lg:sticky lg:top-32"><Eyebrow>{t("site.why.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.2rem] text-heading sm:text-5xl">{t("site.why.title")}</h2></div></div>
            <ol className="grid gap-4 lg:col-span-7">
              {text.strengths.map((s, i) => (
                <Reveal as="li" key={s.title} delay={(i % 4) * 70}>
                  <div className="card-y flex gap-5 p-6">
                    <span aria-hidden className="display grid size-12 shrink-0 place-items-center rounded-full bg-brand-700 text-lg text-white">{i + 1}</span>
                    <div><h3 className="display text-2xl text-heading">{s.title}</h3>{s.text && <p className="mt-1.5 text-muted">{s.text}</p>}</div>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* ───────── Admissions ───────── */}
      <section className="site-deep relative isolate overflow-hidden">
        <div className={`${WRAP} py-20 sm:py-28`}>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <Reveal className="lg:col-span-7"><p className="eyebrow">{t("site.how.kicker")}</p><h2 className="display mt-4 text-[2.2rem] text-heading sm:text-5xl">{t("site.how.title")}</h2><p className="lead mt-5 max-w-xl text-muted">{text.admissionsIntro ?? t("site.admissions.default")}</p></Reveal>
            <div className="flex flex-wrap gap-3 lg:col-span-5 lg:justify-end">
              {open ? <ButtonLink href="/apply/form" variant="sun" arrow>{t("site.hero.apply")}</ButtonLink> : <ButtonLink href="/contact" variant="sun" arrow>{t("site.nav.contact")}</ButtonLink>}
              <ButtonLink href="/apply" variant="ghost">{t("site.nav.admissions")}</ButtonLink>
            </div>
          </div>
          <ol className="relative mt-14 grid gap-5 md:grid-cols-3">
            <span aria-hidden className="draw absolute left-[8%] right-[8%] top-[3.2rem] hidden h-px bg-white/25 md:block" />
            {([1, 2, 3] as const).map((n, i) => (
              <Reveal as="li" key={n} delay={i * 130}>
                <div className="relative h-full rounded-lg border border-line bg-surface p-8">
                  <span aria-hidden className="display flex size-[4.25rem] items-center justify-center rounded-full bg-sun text-3xl text-[#10200f] ring-[10px] ring-canvas">{n}</span>
                  <h3 className="display mt-6 text-2xl text-heading">{t(`site.how.${n}.title`)}</h3>
                  <p className="mt-3 text-muted">{t(`site.how.${n}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <p className="mt-8 max-w-2xl text-sm text-muted">{t("site.admissions.disclaimer")}</p>
        </div>
      </section>

      {/* ───────── Family portal (scroll-tilt showcase) ───────── */}
      <section className="relative isolate overflow-x-clip bg-brand-950 text-white">
        <PortalShowcase
          eyebrow={t("site.portal.kicker")}
          title={t("site.portal.headline")}
          body={text.parentCommunity ?? t("site.community.default")}
          features={(["reports", "fees", "attendance", "homework", "timetable", "messages", "calendar"] as const).map((k) => t(`site.portal.f.${k}`))}
          primary={{ href: "/portal", label: t("site.nav.portal") }}
          secondary={{ href: "/login", label: t("site.nav.signIn") }}
          labels={{ today: t("site.portal.today"), portal: t("site.portal.kicker"), reports: t("site.portal.f.reports"), fees: t("site.portal.f.fees"), attendance: t("site.portal.f.attendance"), homework: t("site.portal.f.homework"), timetable: t("site.portal.f.timetable"), messages: t("site.portal.f.messages"), behaviour: t("learn.bh.familyTitle") }}
        />
        <p className="relative mx-auto -mt-16 max-w-md px-4 pb-14 text-center text-sm text-white/60 md:-mt-28">{t("site.portal.note")}</p>
      </section>

      {/* ───────── Instagram: the school's own pictures, linking to its profile ───────── */}
      {igUrl && igHandle && gallery.length > 0 && (
        <section>
          <div className={`${WRAP} py-16 sm:py-20`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHeading eyebrow={t("site.ig.kicker")} title={t("site.ig.title")} />
              <ButtonLink href={igUrl} external variant="primary" arrow><Camera className="size-4" aria-hidden />{t("site.ig.follow", { handle: igHandle })}</ButtonLink>
            </div>
            <ul className="mt-10 grid grid-cols-3 gap-2 sm:gap-4 lg:grid-cols-6">
              {gallery.slice(0, 6).map((g) => (
                <li key={g.src}><a href={igUrl} target="_blank" rel="noopener noreferrer" aria-label={`${igHandle}: ${g.alt}`} className="frame print group block aspect-square rounded-lg"><Photo image={g} sizes="(min-width: 1024px) 16vw, 33vw" /></a></li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ───────── Contact ───────── */}
      <section className="site-soft border-t border-line">
        <div className={`${WRAP} grid gap-12 py-20 sm:py-28 lg:grid-cols-[0.9fr_1.1fr]`}>
          <div>
            <SectionHeading eyebrow={t("site.contact.kicker")} title={t("site.contact.title")} />
            {hasContact ? (
              <dl className="card-y mt-8 divide-y divide-line px-6 text-lg">
                {contact.address && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-link">{t("site.contact.address")}</dt><dd>{contact.address}</dd></div>}
                {contact.phone && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-link">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone)} className="font-bold hover:text-link">{contact.phone}</a></dd></div>}
                {contact.phone2 && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-link">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone2)} className="font-bold hover:text-link">{contact.phone2}</a></dd></div>}
                {contact.whatsapp && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-link">WhatsApp</dt><dd><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-bold hover:text-link">{contact.whatsapp}</a></dd></div>}
                {contact.email && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-link">{t("site.contact.email")}</dt><dd><a href={`mailto:${contact.email}`} className="break-all font-bold hover:text-link">{contact.email}</a></dd></div>}
                {contact.hours && <div className="grid gap-1 py-5 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-[11px] font-extrabold uppercase tracking-[.14em] text-link">{t("site.contact.hours")}</dt><dd>{contact.hours}</dd></div>}
              </dl>
            ) : <p className="mt-6 text-muted">{t("site.contact.empty")}</p>}
            {contact.mapUrl && <div className="mt-6"><ButtonLink href={contact.mapUrl} external variant="outline" arrow>{t("site.contact.directions")}</ButtonLink></div>}
          </div>
          <Reveal delay={100} className="card-y p-6 sm:p-9">
            <ContactForm t={t} idPrefix="home" />
          </Reveal>
        </div>
      </section>
    </>
  );
}
