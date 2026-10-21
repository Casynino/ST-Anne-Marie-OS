import Link from "next/link";
import type { Metadata } from "next";
import { BookOpen, Search } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite, pageMetadata } from "@/lib/site";
import { getLibraryViewer } from "@/lib/library/next";
import { libraryHome } from "@/server/library";
import { PageHero, SectionHeading } from "@/components/site/blocks";
import { ResourceTile } from "@/components/library/parts";
import { ActionForm } from "@/components/form";
import { leaveLibraryAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return pageMetadata(await getSite(), { title: t("lib.title"), description: t("lib.lead"), path: "/library" });
}

/** The Digital Library's front page: search first, then the ways to browse, then what is new, featured and (from real use) popular. */
export default async function LibraryPage() {
  const [site, t, locale, lv] = await Promise.all([getSite(), getT(), getLocale(), getLibraryViewer()]);
  if (!site) return null;
  const home = await libraryHome(site.school.id, lv.viewer, locale);
  const verified = lv.source === "session";
  const role = lv.viewer.kind === "STUDENT" ? t("lib.role.student") : lv.viewer.kind === "STAFF" ? t("lib.role.staff") : null;
  return (
    <>
      <PageHero photo={false} eyebrow={t("lib.kicker")} title={t("lib.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/library", label: t("lib.title") }]}>{t("lib.lead")}</PageHero>

      <div className="mx-auto max-w-[100rem] space-y-16 px-4 py-12 sm:px-6">
        <section aria-label={t("lib.search")}>
          <form action="/library/search" method="get" role="search" className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="lib-q" className="sr-only">{t("lib.search")}</label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
              <input id="lib-q" name="q" type="search" placeholder={t("lib.search.placeholder")} className="h-14 w-full border-2 border-brand-700 bg-surface pl-12 pr-4 text-lg placeholder:text-muted/70 focus:border-brand-500" />
            </div>
            <button type="submit" className="inline-flex h-14 items-center justify-center bg-brand-700 px-8 text-lg font-semibold text-white hover:bg-brand-800">{t("lib.search.button")}</button>
          </form>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            {verified && role ? (
              <div className="flex flex-wrap items-center gap-3"><span className="font-semibold text-brand-800">{t("lib.verified", { role })}</span>
                <ActionForm action={leaveLibraryAction} submitLabel={t("lib.leave")} inline />
              </div>
            ) : lv.source === "visitor" ? (
              <p className="text-muted">{t("lib.member.prompt")} <Link href="/library/verify" className="font-semibold text-link underline underline-offset-4">{t("lib.member.cta")}</Link></p>
            ) : <span />}
            <Link href="/library/search" className="font-semibold text-link underline underline-offset-4">{t("lib.browseAll", { n: String(home.total) })}</Link>
          </div>
        </section>

        {home.total === 0 ? (
          <section className="border border-dashed border-line bg-tint p-10 text-center">
            <BookOpen className="mx-auto size-10 text-brand-700" aria-hidden />
            <p className="display mt-3 text-2xl text-heading">{t("lib.empty.title")}</p>
            <p className="mt-1 text-muted">{t("lib.empty.body")}</p>
          </section>
        ) : (
          <>
            <section aria-labelledby="by-category">
              <SectionHeading eyebrow={t("lib.browse")} title={t("lib.byCategory")} />
              <ul id="by-category" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {home.categories.filter((c) => c.count > 0).map((c) => (
                  <li key={c.id}><Link href={`/library/search?categoryId=${c.id}`} className="flex min-h-16 items-center justify-between gap-3 border border-line bg-surface px-5 py-4 hover:border-brand-600"><span className="font-semibold text-heading">{c.name}</span><span className="text-sm text-muted">{c.count}</span></Link></li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="by-class" className="grid gap-12 lg:grid-cols-2">
              <div>
                <SectionHeading eyebrow={t("lib.browse")} title={t("lib.byClass")} />
                <ul id="by-class" className="mt-8 grid gap-3 sm:grid-cols-2">
                  {home.classes.filter((c) => c.count > 0).map((c) => (
                    <li key={c.id}><Link href={`/library/search?classId=${c.id}`} className="flex min-h-14 items-center justify-between gap-3 border border-line bg-surface px-4 py-3 hover:border-brand-600"><span className="font-semibold text-heading">{c.name}</span><span className="text-sm text-muted">{c.count}</span></Link></li>
                  ))}
                  {home.classes.every((c) => c.count === 0) && <li className="text-muted">{t("lib.byClass.none")}</li>}
                </ul>
              </div>
              <div>
                <SectionHeading eyebrow={t("lib.browse")} title={t("lib.bySubject")} />
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {home.subjects.map((s) => (
                    <li key={s.id}><Link href={`/library/search?subjectId=${s.id}`} className="flex min-h-14 items-center justify-between gap-3 border border-line bg-surface px-4 py-3 hover:border-brand-600"><span className="font-semibold text-heading">{s.name}</span><span className="text-sm text-muted">{s.count}</span></Link></li>
                  ))}
                  {home.subjects.length === 0 && <li className="text-muted">{t("lib.bySubject.none")}</li>}
                </ul>
              </div>
            </section>

            {home.featured.length > 0 && (
              <section>
                <SectionHeading eyebrow={t("lib.featured.kicker")} title={t("lib.featured")} />
                <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{home.featured.map((r) => <ResourceTile key={r.id} r={r} t={t} />)}</ul>
              </section>
            )}
            {home.popular.length > 0 && (
              <section>
                <SectionHeading eyebrow={t("lib.popular.kicker")} title={t("lib.popular")} />
                <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{home.popular.map((r) => <ResourceTile key={r.id} r={r} t={t} />)}</ul>
              </section>
            )}
            <section>
              <SectionHeading eyebrow={t("lib.recent.kicker")} title={t("lib.recent")} />
              <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{home.recent.map((r) => <ResourceTile key={r.id} r={r} t={t} />)}</ul>
            </section>
          </>
        )}

        <section className="grid gap-5 bg-brand-800 p-8 text-white sm:p-12 lg:grid-cols-3" aria-labelledby="how">
          <h2 id="how" className="display text-3xl lg:col-span-3">{t("lib.how.title")}</h2>
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex gap-4"><span aria-hidden className="display grid size-11 shrink-0 place-items-center bg-sun text-xl text-[#10200f]">{n}</span><p className="text-lg leading-snug text-white/90"><strong className="block text-white">{t(`lib.how.${n}.title` as "lib.how.1.title")}</strong>{t(`lib.how.${n}.body` as "lib.how.1.body")}</p></div>
          ))}
        </section>
      </div>
    </>
  );
}
