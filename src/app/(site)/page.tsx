import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, CalendarDays, GraduationCap, MapPin, MessageCircle, Phone } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref, waHref } from "@/lib/site";
import { listPublicEvents, listPublicNews, resolveSiteImages } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { ButtonLink, Eyebrow, PhotoSlot, SectionHeading } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { Marquee } from "@/components/site/fx/marquee";
import { Gallery } from "@/components/site/fx/gallery";
import { Photo } from "@/components/site/photo";
import { NewsCard } from "@/components/site/news-card";
import { ContactForm } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await getSite(), { path: "/" });
}

const TONES = ["bg-brand-700 text-white", "bg-indigo text-white", "bg-sun text-brand-950", "bg-brand-900 text-white"] as const;

export default async function HomePage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const { school, text, settings, levels, contact, images } = site;
  const [news, events] = await Promise.all([listPublicNews(school.id, { limit: 3 }), listPublicEvents(school.id, school.timezone, { limit: 3 })]);
  const covers = await resolveSiteImages(news.items.map((n) => n.coverImage));

  // Hero picture set: the school's chosen hero photos, else its gallery photos; if none exist, brand shapes (never stock).
  const heroPhotos = (images.hero.length ? images.hero : images.gallery).slice(0, 3);
  const open = settings.applicationsOpen;
  const hasIntro = Boolean(text.about || text.philosophy || text.learningApproach || text.vision);

  return (
    <>
      {/* ───────── Hero ───────── */}
      <section className="relative isolate overflow-hidden bg-cream">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-14 lg:min-h-[44rem] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative z-10">
            <div className="rise"><Eyebrow>{open ? t("site.hero.status") : school.name}</Eyebrow></div>
            <h1 className="display rise-2 mt-5 text-[2.6rem] text-brand-950 sm:text-6xl lg:text-[4.4rem]">{text.heroTitle}</h1>
            {text.heroSubtitle && <p className="rise-3 mt-6 max-w-xl text-lg leading-relaxed text-ink/80 sm:text-xl">{text.heroSubtitle}</p>}
            <div className="rise-3 mt-9 flex flex-wrap gap-3">
              <ButtonLink href={open ? "/apply/form" : "/apply"} arrow>{open ? t("site.hero.apply") : t("site.nav.admissions")}</ButtonLink>
              <ButtonLink href="/about" variant="outline">{t("site.hero.explore")}</ButtonLink>
            </div>
            {!open && <p className="mt-4 max-w-md text-sm text-muted">{t("site.hero.closed")}</p>}
            {levels.length > 0 && (
              <p className="rise-3 mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-5 text-sm font-semibold uppercase tracking-wider text-brand-800">
                {levels.map((l, i) => <span key={l.id} className="flex items-center gap-3">{i > 0 && <span aria-hidden className="size-1.5 rounded-full bg-sun" />}{l.name}</span>)}
              </p>
            )}
          </div>

          {/* Layered composition: green disc, yellow arch, photo arch + photo tile + (optional) photo circle */}
          <div className="rise-2 relative mx-auto aspect-[5/6] w-full max-w-md lg:max-w-none">
            <div aria-hidden className="absolute right-0 top-2 size-[78%] rounded-full bg-brand-700" />
            <div aria-hidden className="absolute bottom-6 left-0 h-[34%] w-[26%] rounded-t-full bg-sun" />
            {heroPhotos[0] ? (
              <div className="frame frame-arch absolute left-[8%] top-0 h-[78%] w-[52%] shadow-[var(--shadow-lift)]"><Photo image={heroPhotos[0]} sizes="(min-width: 1024px) 28vw, 52vw" priority /></div>
            ) : (
              <PhotoSlot label={t("site.photo.pending")} className="frame-arch absolute left-[8%] top-0 h-[78%] w-[52%]" />
            )}
            {heroPhotos[1] && <div className="frame absolute bottom-0 right-0 h-[44%] w-[50%] rounded-3xl border-4 border-cream shadow-[var(--shadow-lift)]"><Photo image={heroPhotos[1]} sizes="(min-width: 1024px) 24vw, 46vw" priority /></div>}
            {heroPhotos[2] && <div className="frame absolute right-[6%] top-[4%] size-[26%] rounded-full border-4 border-cream shadow-[var(--shadow-card)]"><Photo image={heroPhotos[2]} sizes="14vw" priority /></div>}
            {school.motto && <p className="absolute bottom-[8%] left-[6%] max-w-[44%] -rotate-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold leading-snug text-brand-900 shadow-[var(--shadow-card)]">{school.motto}</p>}
          </div>
        </div>
      </section>

      {levels.length > 0 && <Marquee items={levels.map((l) => l.name)} className="bg-brand-800 py-5 text-white/90" />}

      {/* ───────── Introduction ───────── */}
      {hasIntro && (
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <Reveal className="mx-auto w-full max-w-sm lg:max-w-none">
              {images.about ? (
                <div className="frame frame-arch aspect-[4/5] shadow-[var(--shadow-card)]"><Photo image={images.about} sizes="(min-width: 1024px) 34vw, 80vw" /></div>
              ) : (
                <PhotoSlot label={t("site.photo.pending")} className="frame-arch aspect-[4/5]" />
              )}
            </Reveal>
            <div>
              <SectionHeading eyebrow={t("site.about.kicker")} title={t("site.about.title")} />
              {text.about && <Reveal><p className="mt-6 line-clamp-6 whitespace-pre-line text-lg leading-relaxed text-ink/85">{text.about}</p></Reveal>}
              <dl className="mt-8 grid gap-6 sm:grid-cols-2">
                {([["philosophy", text.philosophy], ["learningApproach", text.learningApproach]] as const).filter(([, v]) => v).map(([k, v], i) => (
                  <Reveal key={k} delay={i * 80}><div className="border-l-4 border-sun pl-4"><dt className="font-semibold text-brand-900">{t(`site.intro.${k}`)}</dt><dd className="mt-1 line-clamp-4 text-muted">{v}</dd></div></Reveal>
                ))}
              </dl>
              <div className="mt-8"><ButtonLink href="/about" variant="soft" arrow>{t("site.about.more")}</ButtonLink></div>
            </div>
          </div>
        </section>
      )}

      {/* ───────── Academic programmes (real levels, real links) ───────── */}
      {levels.length > 0 && (
        <section className="bg-cream-deep">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <SectionHeading eyebrow={t("site.programs.kicker")} title={t("site.programs.title")} />
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {levels.map((l, i) => (
                <Reveal as="li" key={l.id} delay={i * 80}>
                  <Link href={`/academics#${l.slug}`} className="card-lift group flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-white">
                    <div className={`relative flex h-36 items-end overflow-hidden p-6 ${TONES[i % TONES.length]}`}>
                      <span aria-hidden className="absolute -right-6 -top-10 size-40 rounded-full bg-white/10" />
                      <span aria-hidden className="absolute bottom-0 right-8 h-20 w-14 rounded-t-full bg-white/15" />
                      <h3 className="display relative text-3xl">{l.name}</h3>
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      {l.summary && <p className="text-ink/80">{l.summary}</p>}
                      {l.focus && <p className="mt-3 text-sm text-muted"><span className="font-semibold text-brand-800">{t("site.programs.focus")}: </span>{l.focus}</p>}
                      <ul className="mt-4 flex flex-wrap gap-1.5">{l.classes.map((c) => <li key={c} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">{c}</li>)}</ul>
                      <span className="mt-auto inline-flex items-center gap-2 pt-6 font-semibold text-brand-700">{t("site.programs.cta")} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></span>
                    </div>
                  </Link>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ───────── Why families choose the school (the school's own statements) ───────── */}
      {text.strengths.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionHeading eyebrow={t("site.why.kicker")} title={t("site.why.title")} />
          <ol className="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2">
            {text.strengths.map((s, i) => (
              <Reveal as="li" key={s.title} delay={(i % 2) * 90} className="flex gap-5 border-t border-line pt-6">
                <span aria-hidden className="display text-4xl text-brand-300">{String(i + 1).padStart(2, "0")}</span>
                <div><h3 className="text-xl font-bold text-brand-900">{s.title}</h3>{s.text && <p className="mt-2 text-muted">{s.text}</p>}</div>
              </Reveal>
            ))}
          </ol>
        </section>
      )}

      {/* ───────── School life ───────── */}
      {(images.gallery.length > 0 || text.schoolLife.length > 0) && (
        <section className="bg-brand-950 text-white">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <SectionHeading light eyebrow={t("site.life.kicker")} title={t("site.life.title")} />
              <ButtonLink href="/school-life" variant="ghost" arrow>{t("site.life.cta")}</ButtonLink>
            </div>
            {images.gallery.length > 0 && <Reveal className="mt-10"><Gallery items={images.gallery} labels={{ close: t("nav.close"), prev: t("site.gallery.prev"), next: t("site.gallery.next"), open: t("site.gallery.open") }} /></Reveal>}
            {text.schoolLife.length > 0 && (
              <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {text.schoolLife.slice(0, 6).map((a) => (
                  <li key={a.title} className="rounded-2xl border border-white/10 bg-white/5 p-5"><h3 className="font-bold">{a.title}</h3>{a.text && <p className="mt-1 text-sm text-brand-100">{a.text}</p>}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ───────── Admissions ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-brand-700 p-8 text-white sm:p-14">
          <div aria-hidden className="absolute -right-16 -top-16 size-72 rounded-full bg-brand-600" />
          <div aria-hidden className="absolute -bottom-2 right-10 hidden h-44 w-32 rounded-t-full bg-sun sm:block" />
          <div className="relative max-w-2xl">
            <Eyebrow light>{t("site.how.kicker")}</Eyebrow>
            <h2 className="display mt-4 text-4xl sm:text-5xl">{t("site.how.title")}</h2>
            <p className="mt-4 text-lg text-brand-100">{text.admissionsIntro ?? t("site.admissions.default")}</p>
            <ol className="mt-8 space-y-4">
              {([1, 2, 3] as const).map((n) => (
                <li key={n} className="flex gap-4"><span className="display flex size-10 shrink-0 items-center justify-center rounded-full bg-sun text-lg text-brand-950">{n}</span><div><p className="font-bold">{t(`site.how.${n}.title`)}</p><p className="text-sm text-brand-100">{t(`site.how.${n}.body`)}</p></div></li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap gap-3">
              {open ? <ButtonLink href="/apply/form" variant="sun" arrow>{t("site.hero.apply")}</ButtonLink> : <ButtonLink href="/contact" variant="sun" arrow>{t("site.nav.contact")}</ButtonLink>}
              <ButtonLink href="/apply" variant="ghost">{t("site.nav.admissions")}</ButtonLink>
            </div>
            <p className="mt-5 text-sm text-brand-200">{t("site.admissions.disclaimer")}</p>
          </div>
        </div>
      </section>

      {/* ───────── News and events (real, published records only) ───────── */}
      {(news.items.length > 0 || events.length > 0) && (
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading eyebrow={t("site.news.kicker")} title={t("site.nav.newsEvents")} />
            <ButtonLink href="/news" variant="outline" arrow>{t("site.news.all")}</ButtonLink>
          </div>
          <div className={`mt-10 grid gap-5 ${events.length > 0 ? "lg:grid-cols-[1.6fr_1fr]" : ""}`}>
            {news.items.length > 0 && (
              <ul className={`grid gap-5 ${events.length > 0 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                {news.items.slice(0, events.length > 0 ? 2 : 3).map((n, i) => <Reveal as="li" key={n.id} delay={i * 90}><NewsCard post={n} cover={n.coverImage ? covers.get(n.coverImage) : undefined} locale={locale} /></Reveal>)}
              </ul>
            )}
            {events.length > 0 && (
              <Reveal className="rounded-3xl border border-line bg-white p-6">
                <h3 className="display text-2xl text-brand-950">{t("site.events.title")}</h3>
                <ul className="mt-4 divide-y divide-line">
                  {events.map((e) => (
                    <li key={e.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                      <div aria-hidden className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-50 text-brand-800"><span className="display text-xl leading-none">{e.startsOn.getUTCDate()}</span><span className="text-[10px] font-bold uppercase">{displayDate(e.startsOn, locale).split(" ")[1]}</span></div>
                      <div className="min-w-0"><Link href={`/events/${e.id}`} className="font-semibold text-brand-950 hover:text-brand-700">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</Link>{e.location && <p className="text-sm text-muted">{e.location}</p>}</div>
                    </li>
                  ))}
                </ul>
                <Link href="/events" className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-brand-700 hover:underline">{t("site.events.all")} <ArrowRight className="size-4" aria-hidden /></Link>
              </Reveal>
            )}
          </div>
        </section>
      )}

      {/* ───────── Parents and guardians ───────── */}
      <section className="bg-cream-deep">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <Reveal>
            <Eyebrow>{t("site.community.kicker")}</Eyebrow>
            <h2 className="display mt-4 text-3xl text-brand-950 sm:text-4xl">{t("site.community.title")}</h2>
            <p className="mt-4 max-w-2xl text-lg text-ink/80">{text.parentCommunity ?? t("site.community.default")}</p>
          </Reveal>
          <Reveal delay={100} className="flex flex-wrap gap-3"><ButtonLink href="/portal" arrow><GraduationCap className="size-5" aria-hidden />{t("site.nav.portal")}</ButtonLink></Reveal>
        </div>
      </section>

      {/* ───────── Contact ───────── */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <SectionHeading eyebrow={t("site.contact.kicker")} title={t("site.contact.title")} />
            <Reveal>
              {Object.values(contact).some(Boolean) ? (
                <ul className="mt-8 space-y-4 text-lg">
                  {contact.address && <li className="flex gap-3"><MapPin className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />{contact.address}</li>}
                  {contact.phone && <li className="flex gap-3"><Phone className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden /><a href={telHref(contact.phone)} className="font-semibold hover:text-brand-700">{contact.phone}</a></li>}
                  {contact.phone2 && <li className="flex gap-3"><Phone className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden /><a href={telHref(contact.phone2)} className="font-semibold hover:text-brand-700">{contact.phone2}</a></li>}
                  {contact.whatsapp && <li className="flex gap-3"><MessageCircle className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden /><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-brand-700">WhatsApp</a></li>}
                  {contact.hours && <li className="flex gap-3"><CalendarDays className="mt-1 size-5 shrink-0 text-brand-600" aria-hidden />{contact.hours}</li>}
                </ul>
              ) : <p className="mt-6 text-muted">{t("site.contact.empty")}</p>}
              {contact.mapUrl && <div className="mt-6"><ButtonLink href={contact.mapUrl} external variant="soft" arrow>{t("site.contact.directions")}</ButtonLink></div>}
            </Reveal>
          </div>
          <Reveal delay={100} className="rounded-3xl border border-line bg-white p-6 shadow-[var(--shadow-card)] sm:p-8"><ContactForm t={t} idPrefix="home" /></Reveal>
        </div>
      </section>
    </>
  );
}
