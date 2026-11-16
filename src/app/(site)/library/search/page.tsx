import Link from "next/link";
import type { Metadata } from "next";
import { SearchX } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { getLibraryViewer } from "@/lib/library/next";
import { libraryFacets, searchLibrary } from "@/server/library";
import { PageHero } from "@/components/site/blocks";
import { ResourceTile } from "@/components/library/parts";

export const metadata: Metadata = { title: "Search the library" };

type Sp = { q?: string; categoryId?: string; classId?: string; subjectId?: string; language?: string; type?: string; sort?: string; page?: string };
const uuidOnly = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

const SELECT = "min-h-11 w-full border border-line bg-surface px-3 text-base";

/** Search and filter the library. Results are always limited to what the person may see, and come in pages. */
export default async function LibrarySearchPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const [site, t, locale, lv, sp] = await Promise.all([getSite(), getT(), getLocale(), getLibraryViewer(), searchParams]);
  if (!site) return null;
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const filters = { q: sp.q?.slice(0, 100), categoryId: uuidOnly(sp.categoryId), classId: uuidOnly(sp.classId), subjectId: uuidOnly(sp.subjectId), language: sp.language, type: sp.type, sort: sp.sort, page };
  const [facets, res] = await Promise.all([libraryFacets(site.school.id, locale), searchLibrary(site.school.id, lv.viewer, filters, locale)]);
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const link = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: filters.q, categoryId: filters.categoryId, classId: filters.classId, subjectId: filters.subjectId, language: filters.language, type: filters.type, sort: filters.sort })) if (v) u.set(k, String(v));
    if (p > 1) u.set("page", String(p));
    return `/library/search${u.size ? `?${u}` : ""}`;
  };
  const opt = (items: { id: string; name: string }[]) => items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>);
  const hasFilters = !!(filters.q || filters.categoryId || filters.classId || filters.subjectId || filters.language || filters.type);
  return (
    <>
      <PageHero photo={false} eyebrow={t("lib.kicker")} title={t("lib.search.title")} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/library", label: t("lib.title") }, { href: "/library/search", label: t("lib.search.title") }]} />
      <div className="mx-auto max-w-[100rem] px-4 py-10 sm:px-6">
        <form method="get" action="/library/search" role="search" className="grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-4">
            <label htmlFor="q" className="mb-1 block text-sm font-medium">{t("lib.search")}</label>
            <input id="q" name="q" type="search" defaultValue={filters.q ?? ""} placeholder={t("lib.search.placeholder")} className="h-12 w-full border-2 border-link bg-surface px-4 text-lg" />
          </div>
          <div><label htmlFor="classId" className="mb-1 block text-sm font-medium">{t("lib.f.class")}</label><select id="classId" name="classId" className={SELECT} defaultValue={filters.classId ?? ""}><option value="">{t("lib.f.any")}</option>{opt(facets.classes)}</select></div>
          <div><label htmlFor="subjectId" className="mb-1 block text-sm font-medium">{t("lib.f.subject")}</label><select id="subjectId" name="subjectId" className={SELECT} defaultValue={filters.subjectId ?? ""}><option value="">{t("lib.f.any")}</option>{opt(facets.subjects)}</select></div>
          <div><label htmlFor="categoryId" className="mb-1 block text-sm font-medium">{t("lib.f.category")}</label><select id="categoryId" name="categoryId" className={SELECT} defaultValue={filters.categoryId ?? ""}><option value="">{t("lib.f.any")}</option>{opt(facets.categories)}</select></div>
          <div><label htmlFor="type" className="mb-1 block text-sm font-medium">{t("lib.f.type")}</label>
            <select id="type" name="type" className={SELECT} defaultValue={filters.type ?? ""}><option value="">{t("lib.f.any")}</option>{["PDF", "DOCUMENT", "SLIDES", "SHEET", "IMAGE"].map((k) => <option key={k} value={k}>{t(`lib.type.${k}` as "lib.type.PDF")}</option>)}</select></div>
          <div><label htmlFor="language" className="mb-1 block text-sm font-medium">{t("lib.f.language")}</label>
            <select id="language" name="language" className={SELECT} defaultValue={filters.language ?? ""}><option value="">{t("lib.f.any")}</option><option value="EN">English</option><option value="SW">Kiswahili</option><option value="OTHER">{t("lib.f.other")}</option></select></div>
          <div><label htmlFor="sort" className="mb-1 block text-sm font-medium">{t("lib.f.sort")}</label>
            <select id="sort" name="sort" className={SELECT} defaultValue={filters.sort ?? ""}><option value="">{t("lib.f.newest")}</option><option value="title">{t("lib.f.title")}</option></select></div>
          <div className="flex items-end gap-3 lg:col-span-2">
            <button type="submit" className="inline-flex min-h-11 flex-1 items-center justify-center bg-brand-700 px-6 font-semibold text-white hover:bg-brand-800">{t("lib.search.button")}</button>
            {hasFilters && <Link href="/library/search" className="inline-flex min-h-11 items-center px-3 font-semibold text-link underline underline-offset-4">{t("lib.f.clear")}</Link>}
          </div>
        </form>

        <p className="mb-5 mt-8 text-muted" aria-live="polite">{t("lib.results", { n: String(res.total) })}{lv.source === "visitor" && <> · <Link href="/library/verify" className="font-semibold text-link underline underline-offset-4">{t("lib.member.cta")}</Link></>}</p>
        {res.items.length === 0 ? (
          <div className="border border-dashed border-line bg-tint p-10 text-center">
            <SearchX className="mx-auto size-10 text-link" aria-hidden />
            <p className="display mt-3 text-2xl text-heading">{t("lib.none.title")}</p>
            <p className="mt-1 text-muted">{t("lib.none.body")}</p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{res.items.map((r) => <ResourceTile key={r.id} r={r} t={t} />)}</ul>
        )}
        {pages > 1 && (
          <nav aria-label={t("lib.pages")} className="mt-10 flex items-center justify-between gap-4">
            {page > 1 ? <Link href={link(page - 1)} className="inline-flex min-h-11 items-center border border-line bg-surface px-5 font-semibold hover:border-link">{t("lib.prev")}</Link> : <span />}
            <span className="text-muted">{t("lib.pageOf", { page: String(page), pages: String(pages) })}</span>
            {page < pages ? <Link href={link(page + 1)} className="inline-flex min-h-11 items-center border border-line bg-surface px-5 font-semibold hover:border-link">{t("lib.next")}</Link> : <span />}
          </nav>
        )}
      </div>
    </>
  );
}
