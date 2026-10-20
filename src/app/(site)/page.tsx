import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata, telHref, waHref } from "@/lib/site";
import { listPublicEvents, listPublicNews, resolveSiteImages } from "@/server/website";
import { displayDate } from "@/lib/dates";
import { ButtonLink, Eyebrow, Print } from "@/components/site/blocks";
import { Reveal } from "@/components/site/fx/reveal";
import { PortalShowcase } from "@/components/site/portal-showcase";
import { Photo } from "@/components/site/photo";
import { NewsCard } from "@/components/site/news-card";
import { ContactForm } from "@/components/site/contact-form";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await getSite(), { path: "/" });
}

/** Sets a headline as short lines and picks a size that fits its length, so a short motto is huge and a full sentence still reads well. */
function headline(title: string) {
  const len = title.trim().length;
  const tier = len <= 18 ? { max: 12, size: "text-[clamp(3.6rem,11.5vw,9.5rem)] leading-[.88]" } : len <= 40 ? { max: 16, size: "text-[clamp(3rem,7.4vw,6.4rem)] leading-[.92]" } : { max: 19, size: "text-[clamp(2.6rem,5.4vw,4.9rem)] leading-[.95]" };
  const lines: string[] = [];
  for (const w of title.trim().split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + w).length <= tier.max) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  return { lines, size: tier.size };
}

const CONTAINER = "mx-auto max-w-[100rem] px-4 sm:px-6";

export default async function HomePage() {
  const [site, t, locale] = await Promise.all([getSite(), getT(), getLocale()]);
  if (!site) return null;
  const { school, text, settings, levels, contact, images } = site;
  const [news, events] = await Promise.all([listPublicNews(school.id, { limit: 3 }), listPublicEvents(school.id, school.timezone, { limit: 4 })]);
  const covers = await resolveSiteImages(news.items.map((n) => n.coverImage));

  // Pictures come only from the school's own photographs; with none, the page simply has no pictures (never stock imagery).
  const gallery = images.gallery;
  const heroPics = images.hero.length ? images.hero : gallery;
  const open = settings.applicationsOpen;
  const hasIntro = Boolean(text.about || text.philosophy || text.learningApproach || text.vision);
  const classCount = levels.reduce((n, l) => n + l.classes.length, 0);
  const { lines, size: headSize } = headline(text.heroTitle);
  const aboutPic = images.about ?? gallery[3];
  const hasContact = Object.values(contact).some(Boolean);

  const facts = [
    levels.length > 0 && { label: t("site.stats.levels"), value: <span className="display text-5xl sm:text-6xl">{levels.length}</span> },
    classCount > 0 && { label: t("site.stats.classes"), value: <span className="display text-5xl sm:text-6xl">{classCount}</span> },
    { label: t("site.stats.admissions"), href: open ? "/apply/form" : "/apply", value: <span className="display flex items-center gap-3 text-4xl sm:text-5xl">{open && <span className="pulse-dot size-2.5 rounded-full bg-brand-600" aria-hidden />}{open ? t("site.stats.open") : t("site.stats.closed")}</span> },
    { label: t("site.nav.portal"), href: "/portal", value: <span className="display flex items-center gap-2 text-4xl sm:text-5xl">{t("site.nav.signIn")}<ArrowUpRight className="size-7" aria-hidden /></span> },
  ].filter(Boolean) as { label: string; value: React.ReactNode; href?: string }[];

  return (
    <>
      {/* ───────── Masthead ───────── */}
      <section className="border-t-[3px] border-ink">
        <div className={`${CONTAINER} grid gap-12 pb-16 pt-8 sm:pb-24 sm:pt-12 lg:grid-cols-12 lg:gap-10`}>
          <div className={`${heroPics.length > 0 ? "lg:col-span-7" : "lg:col-span-10"} flex flex-col`}>
            <p className="rise flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold uppercase tracking-[.2em] text-ink/70">
              {open && <span className="inline-flex items-center gap-2 text-brand-700"><span className="pulse-dot size-2 rounded-full bg-brand-600" aria-hidden />{t("site.hero.status")}</span>}
              {levels.length > 0 && <span>{levels.map((l) => l.name).join(" · ")}</span>}
            </p>
            <h1 className={`display rise-2 mt-8 tracking-[-0.04em] text-ink ${headSize}`}>
              {lines.map((l, i) => <span key={i} className={`block ${i === lines.length - 1 && lines.length > 1 ? "italic text-brand-700" : ""}`}>{l}</span>)}
            </h1>
            {text.heroSubtitle && <p className="lead rise-3 mt-8 max-w-xl text-ink/80">{text.heroSubtitle}</p>}
            <div className="rise-3 mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <ButtonLink href={open ? "/apply/form" : "/apply"} variant="primary" arrow>{open ? t("site.hero.apply") : t("site.nav.admissions")}</ButtonLink>
              <Link href="/about" className="text-base font-semibold text-ink underline decoration-1 underline-offset-[6px] hover:decoration-2">{t("site.hero.explore")}</Link>
            </div>
            {!open && <p className="mt-4 max-w-md text-sm text-muted">{t("site.hero.closed")}</p>}
            {school.motto && <p className="mt-10 max-w-md border-l-[3px] border-sun pl-4 font-[family-name:var(--font-display)] text-xl italic leading-snug text-ink/85 lg:mt-auto lg:pt-10">{school.motto}</p>}
          </div>

          {heroPics.length > 0 && (
            <div className="relative lg:col-span-5">
              <Print image={heroPics[0]!} n={1} sizes="(min-width: 1024px) 38vw, 90vw" ratio="aspect-[1/1]" priority className="ml-auto w-[88%] sm:w-[78%] lg:w-[82%]" />
              {(heroPics[2] ?? heroPics[1]) && (
                <Print image={(heroPics[2] ?? heroPics[1])!} n={2} sizes="(min-width: 1024px) 24vw, 55vw" ratio="aspect-[4/3]" priority className="mt-6 w-[58%] lg:w-[56%]" />
              )}
            </div>
          )}
        </div>

        {/* Facts, all read from the school's own records */}
        <dl className="border-t border-ink">
          <div className={`${CONTAINER} grid grid-cols-2 lg:grid-cols-4`}>
            {facts.map((f, i) => {
              const cell = (
                <>
                  <dt className="text-xs font-bold uppercase tracking-[.18em] text-muted">{f.label}</dt>
                  <dd className="mt-3 text-ink">{f.value}</dd>
                </>
              );
              const cls = `block border-ink/25 px-4 py-6 sm:px-6 sm:py-8 ${i > 0 ? "lg:border-l" : ""} ${i % 2 === 1 ? "border-l lg:border-l" : ""} ${i >= 2 ? "border-t lg:border-t-0" : ""}`;
              return f.href ? <Link key={f.label} href={f.href} className={`${cls} transition-colors hover:bg-cream-deep`}>{cell}</Link> : <div key={f.label} className={cls}>{cell}</div>;
            })}
          </div>
        </dl>
      </section>

      {/* ───────── The school (the school's own words) ───────── */}
      {hasIntro && (
        <section className="border-t-[3px] border-ink bg-white">
          <div className={`${CONTAINER} grid gap-12 py-20 sm:py-28 lg:grid-cols-12`}>
            <div className="lg:col-span-4">
              <Eyebrow>{t("site.about.kicker")}</Eyebrow>
              {aboutPic && <Print image={aboutPic} n={3} sizes="(min-width: 1024px) 28vw, 80vw" ratio="aspect-[4/5]" className="mt-8 max-w-sm" />}
            </div>
            <div className="lg:col-span-8">
              <Reveal>
                <h2 className="display text-[2.6rem] sm:text-6xl lg:text-7xl">{t("site.about.title")}</h2>
                {text.about && <p className="lead mt-8 line-clamp-[8] whitespace-pre-line text-[1.45rem] leading-[1.35] text-ink/90 sm:text-[1.75rem]">{text.about}</p>}
              </Reveal>
              {(text.philosophy || text.learningApproach) && (
                <dl className="mt-12 grid gap-x-10 gap-y-8 border-t border-ink pt-6 md:grid-cols-2">
                  {([["philosophy", text.philosophy], ["learningApproach", text.learningApproach]] as const).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}><dt className="eyebrow">{t(`site.intro.${k}`)}</dt><dd className="mt-3 line-clamp-5 text-lg leading-relaxed text-ink/80">{v}</dd></div>
                  ))}
                </dl>
              )}
              <div className="mt-10"><ButtonLink href="/about" variant="outline" arrow>{t("site.about.more")}</ButtonLink></div>
            </div>
          </div>
        </section>
      )}

      {/* ───────── Programmes, as an index (real levels, real links) ───────── */}
      {levels.length > 0 && (
        <section className="border-t-[3px] border-ink">
          <div className={`${CONTAINER} py-20 sm:py-28`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <Reveal><Eyebrow>{t("site.programs.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.6rem] sm:text-6xl lg:text-7xl">{t("site.programs.title")}</h2></Reveal>
              <ButtonLink href="/academics" variant="outline" arrow>{t("site.nav.academics")}</ButtonLink>
            </div>
            <ol className="mt-14 border-b border-ink">
              {levels.map((l, i) => {
                const pic = gallery.length ? gallery[(i * 2 + 1) % gallery.length] : undefined;
                return (
                  <li key={l.id} className="border-t border-ink">
                    <Link href={`/academics#${l.slug}`} className="index-row group relative grid min-h-[7.5rem] items-center gap-x-8 gap-y-2 px-1 py-6 hover:bg-ink hover:text-cream sm:px-4 md:grid-cols-[4rem_minmax(0,1.1fr)_minmax(0,1fr)_2rem]">
                      <span aria-hidden className="text-sm font-semibold tabular-nums text-muted group-hover:text-cream/70">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="display text-[2.4rem] sm:text-6xl">{l.name}</h3>
                      <div className="md:pl-4">
                        {l.summary && <p className="line-clamp-2 text-ink/75 group-hover:text-cream/80">{l.summary}</p>}
                        <p className="mt-1 text-sm text-muted group-hover:text-cream/70">{l.classes.join(" · ")}</p>
                      </div>
                      <ArrowRight className="hidden size-6 transition-transform group-hover:translate-x-1 md:block" aria-hidden />
                      {pic && <span aria-hidden className="pointer-events-none absolute right-24 top-1/2 hidden h-32 w-44 -translate-y-1/2 overflow-hidden border-2 border-cream opacity-0 transition-opacity duration-300 group-hover:opacity-100 xl:block"><Photo image={pic} sizes="176px" /></span>}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      )}

      {/* ───────── School life: a contact sheet of the school's own photographs ───────── */}
      {(gallery.length > 0 || text.schoolLife.length > 0) && (
        <section className="border-t-[3px] border-ink bg-white">
          <div className={`${CONTAINER} py-20 sm:py-28`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <Reveal><Eyebrow>{t("site.life.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.6rem] sm:text-6xl lg:text-7xl">{t("site.life.title")}</h2></Reveal>
              <ButtonLink href="/school-life" variant="outline" arrow>{t("site.life.cta")}</ButtonLink>
            </div>
            {gallery.length > 0 && (
              <ul className="mt-14 grid grid-cols-2 gap-x-5 gap-y-8 md:grid-cols-12">
                {gallery.slice(0, 6).map((g, i) => {
                  const span = ["md:col-span-7", "md:col-span-5", "md:col-span-4", "md:col-span-4", "md:col-span-4", "md:col-span-12"][i] ?? "md:col-span-4";
                  const ratio = ["aspect-[3/2]", "aspect-[1/1]", "aspect-[4/5]", "aspect-[4/5]", "aspect-[4/5]", "aspect-[16/6]"][i] ?? "aspect-[4/5]";
                  return <li key={g.src} className={`${i === 0 ? "col-span-2" : ""} ${span}`}><Reveal><Print image={g} n={i + 1} ratio={ratio} sizes="(min-width: 768px) 40vw, 90vw" /></Reveal></li>;
                })}
              </ul>
            )}
            {text.schoolLife.length > 0 && (
              <ul className="mt-14 grid gap-x-10 border-t border-ink md:grid-cols-2 lg:grid-cols-3">
                {text.schoolLife.slice(0, 6).map((a) => (
                  <li key={a.title} className="border-b border-ink/25 py-5"><h3 className="display text-2xl">{a.title}</h3>{a.text && <p className="mt-1 text-ink/75">{a.text}</p>}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ───────── Why families choose the school (the school's own statements) ───────── */}
      {text.strengths.length > 0 && (
        <section className="border-t-[3px] border-ink">
          <div className={`${CONTAINER} grid gap-12 py-20 sm:py-28 lg:grid-cols-12`}>
            <div className="lg:col-span-4"><div className="lg:sticky lg:top-28"><Eyebrow>{t("site.why.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.6rem] sm:text-6xl">{t("site.why.title")}</h2></div></div>
            <ol className="lg:col-span-8">
              {text.strengths.map((s, i) => (
                <Reveal as="li" key={s.title} className="grid gap-x-8 gap-y-2 border-t border-ink py-7 first:border-t-0 first:pt-0 sm:grid-cols-[4rem_1fr]">
                  <span aria-hidden className="display text-4xl text-brand-600">{String(i + 1).padStart(2, "0")}</span>
                  <div><h3 className="display text-3xl sm:text-4xl">{s.title}</h3>{s.text && <p className="mt-3 max-w-xl text-lg leading-relaxed text-ink/80">{s.text}</p>}</div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* ───────── Admissions ───────── */}
      <section className="bg-ink text-cream">
        <div className={`${CONTAINER} py-20 sm:py-28`}>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <Reveal className="lg:col-span-7"><Eyebrow light>{t("site.how.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.6rem] text-cream sm:text-6xl lg:text-7xl">{t("site.how.title")}</h2><p className="lead mt-6 max-w-xl text-cream/75">{text.admissionsIntro ?? t("site.admissions.default")}</p></Reveal>
            <div className="flex flex-wrap gap-3 lg:col-span-5 lg:justify-end">
              {open ? <ButtonLink href="/apply/form" variant="sun" arrow>{t("site.hero.apply")}</ButtonLink> : <ButtonLink href="/contact" variant="sun" arrow>{t("site.nav.contact")}</ButtonLink>}
              <ButtonLink href="/apply" variant="ghost">{t("site.nav.admissions")}</ButtonLink>
            </div>
          </div>
          <ol className="mt-16 grid border-t border-cream/40 md:grid-cols-3 md:divide-x md:divide-cream/25">
            {([1, 2, 3] as const).map((n, i) => (
              <Reveal as="li" key={n} delay={i * 90} className="py-8 md:px-8 md:first:pl-0 md:last:pr-0">
                <span aria-hidden className="display text-7xl text-sun sm:text-8xl">{n}</span>
                <h3 className="display mt-4 text-3xl text-cream">{t(`site.how.${n}.title`)}</h3>
                <p className="mt-3 max-w-xs text-cream/75">{t(`site.how.${n}.body`)}</p>
              </Reveal>
            ))}
          </ol>
          <p className="mt-4 max-w-2xl text-sm text-cream/60">{t("site.admissions.disclaimer")}</p>
        </div>
      </section>

      {/* ───────── News and dates (real, published records only) ───────── */}
      {(news.items.length > 0 || events.length > 0) && (
        <section className="border-t-[3px] border-ink">
          <div className={`${CONTAINER} py-20 sm:py-28`}>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <Reveal><Eyebrow>{t("site.news.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.6rem] sm:text-6xl lg:text-7xl">{t("site.nav.newsEvents")}</h2></Reveal>
              <ButtonLink href="/news" variant="outline" arrow>{t("site.news.all")}</ButtonLink>
            </div>
            <div className={`mt-14 grid gap-12 ${events.length > 0 && news.items.length > 0 ? "lg:grid-cols-[1.7fr_1fr]" : ""}`}>
              {news.items.length > 0 && (
                <ul className={`grid gap-x-8 gap-y-10 ${events.length > 0 ? "sm:grid-cols-2" : news.items.length === 1 ? "" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                  {news.items.slice(0, events.length > 0 ? 2 : 3).map((n, i) => <Reveal as="li" key={n.id} delay={i * 90}><NewsCard post={n} cover={n.coverImage ? covers.get(n.coverImage) : undefined} locale={locale} featured={news.items.length === 1 && events.length === 0} /></Reveal>)}
                </ul>
              )}
              {events.length > 0 && (
                <Reveal className="border-t border-ink pt-4">
                  <h3 className="eyebrow">{t("site.events.title")}</h3>
                  <ul className="mt-2 divide-y divide-ink/20">
                    {events.map((e) => (
                      <li key={e.id} className="grid grid-cols-[4.2rem_1fr] gap-4 py-5">
                        <div aria-hidden className="text-center"><span className="display block text-5xl leading-none">{e.startsOn.getUTCDate()}</span><span className="mt-1 block text-[11px] font-bold uppercase tracking-[.16em] text-muted">{displayDate(e.startsOn, locale).split(" ")[1]}</span></div>
                        <div className="min-w-0"><Link href={`/events/${e.id}`} className="display text-2xl hover:underline">{locale === "SW" && e.titleSw ? e.titleSw : e.title}</Link>{e.location && <p className="mt-1 text-sm text-muted">{e.location}</p>}</div>
                      </li>
                    ))}
                  </ul>
                  <Link href="/events" className="mt-3 inline-flex min-h-11 items-center gap-2 font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">{t("site.events.all")} <ArrowRight className="size-4" aria-hidden /></Link>
                </Reveal>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ───────── Family portal (scroll-tilt showcase) ───────── */}
      <section className="overflow-x-clip bg-ink text-cream">
        <PortalShowcase
          eyebrow={t("site.portal.kicker")}
          title={t("site.portal.headline")}
          body={text.parentCommunity ?? t("site.community.default")}
          features={(["reports", "fees", "attendance", "homework", "timetable", "messages", "calendar"] as const).map((k) => t(`site.portal.f.${k}`))}
          primary={{ href: "/portal", label: t("site.nav.portal") }}
          secondary={{ href: "/login", label: t("site.nav.signIn") }}
          labels={{ today: t("site.portal.today"), portal: t("site.portal.kicker"), reports: t("site.portal.f.reports"), fees: t("site.portal.f.fees"), attendance: t("site.portal.f.attendance"), homework: t("site.portal.f.homework"), timetable: t("site.portal.f.timetable"), messages: t("site.portal.f.messages"), behaviour: t("learn.bh.familyTitle") }}
        />
        <p className="relative mx-auto -mt-16 max-w-md px-4 pb-14 text-center text-sm text-cream/60 md:-mt-28">{t("site.portal.note")}</p>
      </section>

      {/* ───────── Contact ───────── */}
      <section className="border-t-[3px] border-ink">
        <div className={`${CONTAINER} grid gap-14 py-20 sm:py-28 lg:grid-cols-[0.9fr_1.1fr]`}>
          <div>
            <Reveal><Eyebrow>{t("site.contact.kicker")}</Eyebrow><h2 className="display mt-4 text-[2.6rem] sm:text-6xl">{t("site.contact.title")}</h2></Reveal>
            {hasContact ? (
              <dl className="mt-10 divide-y divide-ink/25 border-y border-ink text-lg">
                {contact.address && <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">{t("site.contact.address")}</dt><dd>{contact.address}</dd></div>}
                {contact.phone && <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone)} className="font-semibold hover:underline">{contact.phone}</a></dd></div>}
                {contact.phone2 && <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">{t("site.contact.phone")}</dt><dd><a href={telHref(contact.phone2)} className="font-semibold hover:underline">{contact.phone2}</a></dd></div>}
                {contact.whatsapp && <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">WhatsApp</dt><dd><a href={waHref(contact.whatsapp)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">{contact.whatsapp}</a></dd></div>}
                {contact.email && <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">{t("site.contact.email")}</dt><dd><a href={`mailto:${contact.email}`} className="break-all font-semibold hover:underline">{contact.email}</a></dd></div>}
                {contact.hours && <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]"><dt className="pt-1 text-xs font-bold uppercase tracking-[.16em] text-muted">{t("site.contact.hours")}</dt><dd>{contact.hours}</dd></div>}
              </dl>
            ) : <p className="mt-6 text-muted">{t("site.contact.empty")}</p>}
            {contact.mapUrl && <div className="mt-6"><ButtonLink href={contact.mapUrl} external variant="outline" arrow>{t("site.contact.directions")}</ButtonLink></div>}
          </div>
          <Reveal delay={100} className="border border-ink bg-white p-6 sm:p-9">
            <ContactForm t={t} idPrefix="home" />
          </Reveal>
        </div>
      </section>
    </>
  );
}
