import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BadgeCheck, BookOpen, CalendarDays, FileText, GraduationCap, HeartHandshake, Lightbulb, MapPin, MessageCircle, Phone, School, Trophy, Users, type LucideIcon } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, initialsOf, pageMetadata, telHref, waHref } from "@/lib/site";
import { listPublicEvents, listPublicNews, resolveSiteImages } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { ButtonLink, Eyebrow, HeroBackdrop, PhotoSlot, RiseWords, SectionHeading, Wave } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { CountUp } from "@/components/site/fx/count-up";
import { PhotoStrip } from "@/components/site/fx/photo-strip";
import { PortalShowcase } from "@/components/site/portal-showcase";
import { Gallery } from "@/components/site/fx/gallery";
import { Photo } from "@/components/site/photo";
import { NewsCard } from "@/components/site/news-card";
import { ContactForm } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await getSite(), { path: "/" });
}

const WHY_ICONS: LucideIcon[] = [BookOpen, GraduationCap, HeartHandshake, Trophy, Users, Lightbulb];
const WHY_TONES = [
  "bg-brand-700 text-white [--muted:var(--color-brand-100)]",
  "bg-white text-brand-950 [--muted:var(--color-muted)]",
  "bg-sun text-brand-950 [--muted:rgb(16_35_26/.75)]",
  "bg-indigo text-white [--muted:rgb(255_255_255/.8)]",
  "bg-brand-900 text-white [--muted:var(--color-brand-100)]",
  "bg-cream-deep text-brand-950 [--muted:var(--color-muted)]",
] as const;
const LEVEL_TONES = ["from-brand-900/90 via-brand-800/55", "from-indigo/90 via-indigo/50", "from-brand-950/90 via-brand-700/55"] as const;

export default async function HomePage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const { school, text, settings, levels, contact, images } = site;
  const [news, events] = await Promise.all([listPublicNews(school.id, { limit: 3 }), listPublicEvents(school.id, school.timezone, { limit: 3 })]);
  const covers = await resolveSiteImages(news.items.map((n) => n.coverImage));

  // Picture sets come only from the school's own photographs; with none, brand shapes are shown (never stock imagery).
  const heroPhotos = (images.hero.length ? images.hero : images.gallery).slice(0, 3);
  const open = settings.applicationsOpen;
  const hasIntro = Boolean(text.about || text.philosophy || text.learningApproach || text.vision);
  const classCount = levels.reduce((n, l) => n + l.classes.length, 0);
  const gallery = images.gallery;

  return (
    <>
      {/* ───────── Hero ───────── */}
      <section className="relative isolate overflow-x-clip text-white">
        <HeroBackdrop />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-36 pt-12 sm:px-6 sm:pb-44 sm:pt-20 lg:min-h-[46rem] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="parallax-slow relative z-10">
            <div className="rise inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[.16em] text-brand-50">
              {open && <span className="pulse-dot size-2 rounded-full bg-sun" aria-hidden />}
              {open ? t("site.hero.status") : school.name}
            </div>
            <h1 className="display mt-6 text-[2.7rem] text-white sm:text-6xl lg:text-[4.6rem]"><RiseWords text={text.heroTitle} /></h1>
            {text.heroSubtitle && <p className="rise-3 mt-6 max-w-xl text-lg leading-relaxed text-brand-100 sm:text-xl">{text.heroSubtitle}</p>}
            <div className="rise-3 mt-9 flex flex-wrap gap-3">
              <ButtonLink href={open ? "/apply/form" : "/apply"} variant="sun" arrow>{open ? t("site.hero.apply") : t("site.nav.admissions")}</ButtonLink>
              <ButtonLink href="/about" variant="ghost">{t("site.hero.explore")}</ButtonLink>
            </div>
            {!open && <p className="mt-4 max-w-md text-sm text-brand-200">{t("site.hero.closed")}</p>}
            {levels.length > 0 && (
              <ul className="rise-3 mt-10 flex flex-wrap gap-2">
                {levels.map((l) => <li key={l.id} className="rounded-full border border-white/20 px-3.5 py-1.5 text-sm font-semibold text-brand-50">{l.name}</li>)}
              </ul>
            )}
          </div>

          {/* Layered composition: moving ring, yellow arch, photo arch, photo tile and circle */}
          <div className="parallax-fast"><div className="rise-2 relative mx-auto aspect-[5/6] w-full max-w-md lg:max-w-none">
            <svg aria-hidden viewBox="0 0 100 100" className="spin-slow absolute -right-4 top-0 size-[88%] text-sun/60"><circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth=".6" strokeDasharray="1.5 3.5" /></svg>
            <div aria-hidden className="absolute right-0 top-4 size-[74%] rounded-full bg-brand-600/70" />
            <div aria-hidden className="float-b absolute bottom-6 left-0 h-[34%] w-[26%] rounded-t-full bg-sun" />
            {heroPhotos[0] ? (
              <div className="frame frame-arch kenburns float-a absolute left-[8%] top-0 h-[78%] w-[52%] shadow-[0_30px_60px_-24px_rgb(0_0_0/.65)]"><Photo image={heroPhotos[0]} sizes="(min-width: 1024px) 28vw, 52vw" priority /></div>
            ) : (
              <PhotoSlot label={t("site.photo.pending")} className="frame-arch absolute left-[8%] top-0 h-[78%] w-[52%]" />
            )}
            {heroPhotos[1] && <div className="frame float-b absolute bottom-0 right-0 h-[44%] w-[50%] rounded-3xl border-4 border-white/90 shadow-[0_24px_48px_-20px_rgb(0_0_0/.6)]"><Photo image={heroPhotos[1]} sizes="(min-width: 1024px) 24vw, 46vw" priority /></div>}
            {heroPhotos[2] && <div className="frame float-a absolute right-[6%] top-[4%] size-[26%] rounded-full border-4 border-white/90 shadow-[var(--shadow-card)]"><Photo image={heroPhotos[2]} sizes="14vw" priority /></div>}
            {school.motto && <p style={{ "--r": "-3deg" } as React.CSSProperties} className="float-a absolute bottom-[8%] left-[2%] max-w-[46%] rounded-2xl bg-white px-4 py-3 text-sm font-semibold leading-snug text-brand-900 shadow-[var(--shadow-card)]">{school.motto}</p>}
          </div></div>
        </div>
        <Wave className="absolute inset-x-0 -bottom-px text-cream" />
      </section>

      {/* ───────── Facts (all read from the school's own records) ───────── */}
      <section className="relative z-10 -mt-24 sm:-mt-28">
        <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-3 px-4 sm:px-6 lg:grid-cols-4 lg:gap-5">
          {levels.length > 0 && (
            <Reveal as="li">
              <div className="tilt h-full rounded-3xl bg-white p-5 shadow-[var(--shadow-card)] sm:p-7">
                <School className="size-6 text-brand-600" aria-hidden />
                <p className="display mt-4 text-5xl text-brand-900 sm:text-6xl"><CountUp to={levels.length} /></p>
                <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-muted">{t("site.stats.levels")}</p>
              </div>
            </Reveal>
          )}
          {classCount > 0 && (
            <Reveal as="li" delay={80}>
              <div className="tilt h-full rounded-3xl bg-white p-5 shadow-[var(--shadow-card)] sm:p-7">
                <Users className="size-6 text-brand-600" aria-hidden />
                <p className="display mt-4 text-5xl text-brand-900 sm:text-6xl"><CountUp to={classCount} /></p>
                <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-muted">{t("site.stats.classes")}</p>
              </div>
            </Reveal>
          )}
          <Reveal as="li" delay={160}>
            <Link href={open ? "/apply/form" : "/apply"} className="tilt group flex h-full flex-col rounded-3xl bg-sun p-5 text-brand-950 shadow-[var(--shadow-card)] sm:p-7">
              <BadgeCheck className="size-6" aria-hidden />
              <p className="display mt-4 flex items-center gap-3 text-4xl sm:text-5xl">{open && <span className="pulse-dot size-3 rounded-full bg-brand-700" aria-hidden />}{open ? t("site.stats.open") : t("site.stats.closed")}</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">{t("site.stats.admissions")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></p>
            </Link>
          </Reveal>
          <Reveal as="li" delay={240}>
            <Link href="/portal" className="tilt group flex h-full flex-col rounded-3xl bg-brand-800 p-5 text-white shadow-[var(--shadow-card)] sm:p-7">
              <GraduationCap className="size-6 text-sun" aria-hidden />
              <p className="display mt-4 text-3xl leading-tight sm:text-4xl">{t("site.nav.portal")}</p>
              <p className="mt-auto flex items-center gap-2 pt-3 text-sm font-semibold uppercase tracking-wider text-brand-100">{t("site.nav.signIn")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></p>
            </Link>
          </Reveal>
        </ul>
      </section>

      {/* ───────── Introduction ───────── */}
      {hasIntro && (
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="tex-dots-dark absolute inset-0 -z-10 opacity-60 [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]" />
          <p aria-hidden className="outline-text display pointer-events-none absolute -right-6 top-6 -z-10 select-none text-[11rem] leading-none sm:text-[22rem]">{initialsOf(school.name) || "SAM"}</p>
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
            <div className="grid gap-16 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <Reveal className="relative mx-auto w-full max-w-sm lg:max-w-none">
                <svg aria-hidden viewBox="0 0 100 100" className="spin-slow absolute -left-10 -top-10 size-40 text-brand-400"><circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 5" /></svg>
                <div aria-hidden className="float-b absolute -bottom-5 -right-4 z-10 h-32 w-24 rounded-t-full bg-sun" />
                {images.about ? (
                  <div className="frame frame-arch relative aspect-[4/5] shadow-[var(--shadow-lift)]"><Photo image={images.about} sizes="(min-width: 1024px) 34vw, 80vw" /></div>
                ) : (
                  <PhotoSlot label={t("site.photo.pending")} className="frame-arch aspect-[4/5]" />
                )}
              </Reveal>
              <div>
                <SectionHeading eyebrow={t("site.about.kicker")} title={t("site.about.title")} />
                {text.about && <Reveal><p className="mt-6 line-clamp-6 whitespace-pre-line text-lg leading-relaxed text-ink/85">{text.about}</p></Reveal>}
                <dl className="mt-8 grid gap-4 sm:grid-cols-2">
                  {([["philosophy", text.philosophy], ["learningApproach", text.learningApproach]] as const).filter(([, v]) => v).map(([k, v], i) => (
                    <Reveal key={k} delay={i * 80}><div className="tilt h-full rounded-2xl border border-line bg-white/80 p-5 shadow-[var(--shadow-card)]"><dt className="flex items-center gap-2 font-semibold text-brand-900"><span aria-hidden className="h-5 w-1.5 rounded-full bg-sun" />{t(`site.intro.${k}`)}</dt><dd className="mt-2 line-clamp-4 text-muted">{v}</dd></div></Reveal>
                  ))}
                </dl>
                <div className="mt-8"><ButtonLink href="/about" variant="primary" arrow>{t("site.about.more")}</ButtonLink></div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ───────── Moving photographs ───────── */}
      <PhotoStrip images={gallery} className="pb-4" />

      {/* ───────── Academic programmes (real levels, real links) ───────── */}
      {levels.length > 0 && (
        <section className="mesh-soft relative isolate mt-20 overflow-hidden">
          <div aria-hidden className="tex-arches-dark absolute inset-0 -z-10 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-28">
            <SectionHeading eyebrow={t("site.programs.kicker")} title={t("site.programs.title")} />
            <ul className={`mt-14 grid gap-6 sm:grid-cols-2 ${levels.length === 2 ? "" : "lg:grid-cols-3"}`}>
              {levels.map((l, i) => {
                const pic = gallery.length ? gallery[(i * 2 + 3) % gallery.length] : undefined;
                return (
                  <Reveal as="li" key={l.id} delay={i * 90}>
                    <Link href={`/academics#${l.slug}`} className="card-lift group flex h-full flex-col overflow-hidden rounded-[2rem] border border-line bg-white">
                      <div className={`frame relative bg-brand-800 ${levels.length === 2 ? "h-56 sm:h-64" : "h-52"}`}>
                        {pic && <Photo image={pic} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="opacity-90 saturate-[.85]" />}
                        <div aria-hidden className={`absolute inset-0 bg-gradient-to-t to-transparent ${LEVEL_TONES[i % LEVEL_TONES.length]}`} />
                        <span aria-hidden className="absolute -right-6 -top-10 size-36 rounded-full bg-white/10" />
                        <h3 className="display absolute inset-x-6 bottom-5 text-4xl text-white">{l.name}</h3>
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        {l.summary && <p className="text-ink/80">{l.summary}</p>}
                        {l.focus && <p className="mt-3 text-sm text-muted"><span className="font-semibold text-brand-800">{t("site.programs.focus")}: </span>{l.focus}</p>}
                        <ul className="mt-4 flex flex-wrap gap-1.5">{l.classes.map((c) => <li key={c} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">{c}</li>)}</ul>
                        <span className="mt-auto inline-flex items-center gap-2 pt-6 font-semibold text-brand-700">{t("site.programs.cta")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></span>
                      </div>
                    </Link>
                  </Reveal>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* ───────── Why families choose the school (the school's own statements) ───────── */}
      {text.strengths.length > 0 && (
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="absolute -left-40 top-20 -z-10 size-[30rem] rounded-full bg-brand-100/60" />
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
            <SectionHeading eyebrow={t("site.why.kicker")} title={t("site.why.title")} />
            <ol className={`mt-14 grid gap-5 sm:grid-cols-2 ${text.strengths.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
              {text.strengths.map((s, i) => {
                const Icon = WHY_ICONS[i % WHY_ICONS.length]!;
                return (
                  <Reveal as="li" key={s.title} delay={(i % 4) * 80}>
                    <div className={`tilt relative flex h-full min-h-[17rem] flex-col overflow-hidden rounded-[2rem] border border-line p-7 ${WHY_TONES[i % WHY_TONES.length]}`}>
                      <span aria-hidden className="display absolute -right-1 -top-3 select-none text-[7rem] leading-none opacity-[.10]">{String(i + 1).padStart(2, "0")}</span>
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-current/10"><Icon className="size-6" aria-hidden /></span>
                      <h3 className="display relative mt-auto pt-10 text-2xl">{s.title}</h3>
                      {s.text && <p className="relative mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{s.text}</p>}
                    </div>
                  </Reveal>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      {/* ───────── School life ───────── */}
      {(gallery.length > 0 || text.schoolLife.length > 0) && (
        <section className="relative isolate overflow-x-clip text-white">
          <HeroBackdrop />
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHeading light eyebrow={t("site.life.kicker")} title={t("site.life.title")} />
              <ButtonLink href="/school-life" variant="ghost" arrow>{t("site.life.cta")}</ButtonLink>
            </div>
            {gallery.length > 0 && <Reveal className="mt-12"><Gallery items={gallery} labels={{ close: t("nav.close"), prev: t("site.gallery.prev"), next: t("site.gallery.next"), open: t("site.gallery.open") }} /></Reveal>}
            {text.schoolLife.length > 0 && (
              <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {text.schoolLife.slice(0, 6).map((a, i) => (
                  <Reveal as="li" key={a.title} delay={(i % 3) * 80}><div className="tilt h-full rounded-2xl border border-white/15 bg-white/[.07] p-5"><h3 className="font-bold">{a.title}</h3>{a.text && <p className="mt-1 text-sm text-brand-100">{a.text}</p>}</div></Reveal>
                ))}
              </ul>
            )}
          </div>
          <Wave className="absolute inset-x-0 -bottom-px text-cream" />
          <div className="h-8 sm:h-14" />
        </section>
      )}

      {/* ───────── Admissions journey ───────── */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="tex-dots-dark absolute inset-0 -z-10 opacity-50" />
        <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-[26rem] rounded-full bg-brand-100/70" />
        <div aria-hidden className="float-b absolute -bottom-6 left-[6%] -z-10 hidden h-44 w-32 rounded-t-full bg-sun/80 lg:block" />
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <SectionHeading eyebrow={t("site.how.kicker")} title={t("site.how.title")}>{text.admissionsIntro ?? t("site.admissions.default")}</SectionHeading>
            <Reveal className="flex flex-wrap gap-3 lg:justify-end">
              {open ? <ButtonLink href="/apply/form" arrow>{t("site.hero.apply")}</ButtonLink> : <ButtonLink href="/contact" arrow>{t("site.nav.contact")}</ButtonLink>}
              <ButtonLink href="/apply" variant="outline">{t("site.nav.admissions")}</ButtonLink>
            </Reveal>
          </div>
          <ol className="relative mt-14 grid gap-5 md:grid-cols-3">
            <span aria-hidden className="absolute left-[16%] right-[16%] top-[3.1rem] hidden border-t-2 border-dashed border-brand-300 md:block" />
            {([[1, FileText], [2, Phone], [3, BadgeCheck]] as const).map(([n, Icon], i) => (
              <Reveal as="li" key={n} delay={i * 120}>
                <div className="tilt relative h-full rounded-[2rem] border border-line bg-white p-7 shadow-[var(--shadow-card)]">
                  <div className="relative flex items-center gap-4">
                    <span className="display relative flex size-14 items-center justify-center rounded-full bg-brand-700 text-2xl text-white ring-8 ring-cream">{n}</span>
                    <Icon className="size-7 text-brand-600" aria-hidden />
                  </div>
                  <h3 className="display mt-6 text-2xl text-brand-950">{t(`site.how.${n}.title`)}</h3>
                  <p className="mt-2 text-muted">{t(`site.how.${n}.body`)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <p className="mt-8 text-sm text-muted">{t("site.admissions.disclaimer")}</p>
        </div>
      </section>

      {/* ───────── News and events (real, published records only) ───────── */}
      {(news.items.length > 0 || events.length > 0) && (
        <section className="mesh-soft relative isolate overflow-hidden">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHeading eyebrow={t("site.news.kicker")} title={t("site.nav.newsEvents")} />
              <ButtonLink href="/news" variant="outline" arrow>{t("site.news.all")}</ButtonLink>
            </div>
            <div className={`mt-12 grid gap-6 ${events.length > 0 ? "lg:grid-cols-[1.6fr_1fr]" : ""}`}>
              {news.items.length > 0 && (
                <ul className={`grid gap-6 ${events.length > 0 ? "sm:grid-cols-2" : news.items.length === 1 ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                  {news.items.slice(0, events.length > 0 ? 2 : 3).map((n, i) => <Reveal as="li" key={n.id} delay={i * 90}><NewsCard post={n} cover={n.coverImage ? covers.get(n.coverImage) : undefined} locale={locale} featured={news.items.length === 1 && events.length === 0} /></Reveal>)}
                </ul>
              )}
              {events.length > 0 && (
                <Reveal className="rounded-[2rem] border border-line bg-white p-7 shadow-[var(--shadow-card)]">
                  <h3 className="display flex items-center gap-3 text-2xl text-brand-950"><CalendarDays className="size-6 text-brand-600" aria-hidden />{t("site.events.title")}</h3>
                  <ul className="mt-5 divide-y divide-line">
                    {events.map((e) => (
                      <li key={e.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                        <div aria-hidden className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-700 text-white"><span className="display text-xl leading-none">{e.startsOn.getUTCDate()}</span><span className="text-[10px] font-bold uppercase">{displayDate(e.startsOn, locale).split(" ")[1]}</span></div>
                        <div className="min-w-0"><Link href={`/events/${e.id}`} className="font-semibold text-brand-950 hover:text-brand-700">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</Link>{e.location && <p className="text-sm text-muted">{e.location}</p>}</div>
                      </li>
                    ))}
                  </ul>
                  <Link href="/events" className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-brand-700 hover:underline">{t("site.events.all")} <ArrowRight className="size-4" aria-hidden /></Link>
                </Reveal>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───────── Family portal (scroll-tilt showcase) ───────── */}
      <section className="relative isolate overflow-x-clip text-white">
        <HeroBackdrop />
        <PortalShowcase
          eyebrow={t("site.portal.kicker")}
          title={t("site.portal.headline")}
          body={text.parentCommunity ?? t("site.community.default")}
          features={(["reports", "fees", "attendance", "homework", "timetable", "messages", "calendar"] as const).map((k) => t(`site.portal.f.${k}`))}
          primary={{ href: "/portal", label: t("site.nav.portal") }}
          secondary={{ href: "/login", label: t("site.nav.signIn") }}
          labels={{ today: t("site.portal.today"), portal: t("site.portal.kicker"), reports: t("site.portal.f.reports"), fees: t("site.portal.f.fees"), attendance: t("site.portal.f.attendance"), homework: t("site.portal.f.homework"), timetable: t("site.portal.f.timetable"), messages: t("site.portal.f.messages"), behaviour: t("learn.bh.familyTitle") }}
        />
        <p className="relative mx-auto -mt-16 max-w-md px-4 pb-6 text-center text-sm text-brand-200 md:-mt-28">{t("site.portal.note")}</p>
        <Wave className="absolute inset-x-0 -bottom-px text-cream" />
        <div className="h-8 sm:h-14" />
      </section>

      {/* ───────── Contact ───────── */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="tex-dots-dark absolute inset-0 -z-10 opacity-50" />
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <SectionHeading eyebrow={t("site.contact.kicker")} title={t("site.contact.title")} />
              <Reveal>
                {Object.values(contact).some(Boolean) ? (
                  <ul className="mt-8 space-y-3 text-lg">
                    {contact.address && <li className="flex items-start gap-4 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50"><MapPin className="size-5 text-brand-700" aria-hidden /></span><span className="pt-2">{contact.address}</span></li>}
                    {contact.phone && <li className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50"><Phone className="size-5 text-brand-700" aria-hidden /></span><a href={telHref(contact.phone)} className="font-semibold hover:text-brand-700">{contact.phone}</a></li>}
                    {contact.phone2 && <li className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50"><Phone className="size-5 text-brand-700" aria-hidden /></span><a href={telHref(contact.phone2)} className="font-semibold hover:text-brand-700">{contact.phone2}</a></li>}
                    {contact.whatsapp && <li className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50"><MessageCircle className="size-5 text-brand-700" aria-hidden /></span><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-brand-700">WhatsApp</a></li>}
                    {contact.hours && <li className="flex items-start gap-4 rounded-2xl bg-white p-4 shadow-[var(--shadow-card)]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50"><CalendarDays className="size-5 text-brand-700" aria-hidden /></span><span className="pt-2">{contact.hours}</span></li>}
                  </ul>
                ) : <p className="mt-6 text-muted">{t("site.contact.empty")}</p>}
                {contact.mapUrl && <div className="mt-6"><ButtonLink href={contact.mapUrl} external variant="primary" arrow>{t("site.contact.directions")}</ButtonLink></div>}
              </Reveal>
            </div>
            <Reveal delay={100} className="relative rounded-[2rem] border border-line bg-white p-6 shadow-[var(--shadow-lift)] sm:p-8">
              <span aria-hidden className="absolute -right-3 -top-3 h-16 w-12 rounded-t-full bg-sun" />
              <ContactForm t={t} idPrefix="home" />
            </Reveal>
          </div>
        </div>
      </section>
    </>
  );
}
