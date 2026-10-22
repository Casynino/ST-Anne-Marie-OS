import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { humanSize } from "@/lib/library/files";
import { libraryFormOptions, listManageResources } from "@/server/library";
import { Badge, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";

export const metadata: Metadata = { title: "Library" };
const TONE = { DRAFT: "neutral", PENDING_REVIEW: "warn", APPROVED: "brand", PUBLISHED: "ok", ARCHIVED: "neutral" } as const;
const STATUSES = ["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"] as const;
const SELECT = "min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base";

export default async function LibraryAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; categoryId?: string; page?: string }> }) {
  const [ctx, t, sp] = await Promise.all([requireContext(), getT(), searchParams]);
  if (!hasAny(ctx, ["library.read", "library.upload", "library.manage", "library.review", "library.publish"])) return <NoAccess t={t} />;
  const page = Math.max(1, Number(sp.page) || 1);
  const [res, opts] = await Promise.all([
    listManageResources(ctx, { q: sp.q, status: sp.status, categoryId: sp.categoryId && /^[0-9a-f-]{36}$/i.test(sp.categoryId) ? sp.categoryId : undefined, page }),
    hasAny(ctx, ["library.upload", "library.manage", "library.publish"]) ? libraryFormOptions(ctx) : null,
  ]);
  const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
  const q = (p: number) => { const u = new URLSearchParams(); if (sp.q) u.set("q", sp.q); if (sp.status) u.set("status", sp.status); if (sp.categoryId) u.set("categoryId", sp.categoryId); if (p > 1) u.set("page", String(p)); return `/library-admin${u.size ? `?${u}` : ""}`; };
  return (
    <>
      <PageHeader title={t("lib.admin.title")} subtitle={t("lib.admin.sub")} actions={ctx.permissions.has("library.upload") ? <LinkButton href="/library-admin/new">{t("lib.admin.new")}</LinkButton> : undefined} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin" />
      <form method="get" className="mb-4 grid gap-3 sm:grid-cols-4">
        <input name="q" type="search" defaultValue={sp.q ?? ""} placeholder={t("lib.search.placeholder")} aria-label={t("lib.search")} className={`${SELECT} sm:col-span-2`} />
        <select name="status" defaultValue={sp.status ?? ""} aria-label={t("lib.m.status")} className={SELECT}><option value="">{t("lib.f.any")}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`lib.status.${s}` as "lib.status.DRAFT")}</option>)}</select>
        <select name="categoryId" defaultValue={sp.categoryId ?? ""} aria-label={t("lib.f.category")} className={SELECT}><option value="">{t("lib.f.any")}</option>{opts?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-5 font-semibold text-white hover:bg-brand-800 sm:col-span-4 sm:w-40 btn-primary">{t("lib.search.button")}</button>
      </form>
      {res.items.length === 0 ? <EmptyState>{t("lib.admin.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-canvas text-left text-xs text-muted"><tr><th className="px-3 py-2">{t("lib.m.title")}</th><th className="px-3 py-2">{t("lib.f.category")}</th><th className="px-3 py-2">{t("lib.m.audience")}</th><th className="px-3 py-2">{t("lib.m.status")}</th><th className="px-3 py-2">{t("lib.f.type")}</th><th className="px-3 py-2">{t("lib.m.updated")}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {res.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2"><Link href={`/library-admin/${r.id}`} className="font-semibold text-link hover:underline">{r.title}</Link></td>
                  <td className="px-3 py-2">{r.category.name}</td>
                  <td className="px-3 py-2">{t(`lib.aud.${r.audience}` as "lib.aud.PUBLIC")}</td>
                  <td className="px-3 py-2"><Badge tone={TONE[r.status]}>{t(`lib.status.${r.status}` as "lib.status.DRAFT")}</Badge></td>
                  <td className="px-3 py-2">{r.files[0] ? `${r.files[0].fileName.split(".").pop()?.toUpperCase()} · ${humanSize(r.files[0].sizeBytes)}` : "—"}</td>
                  <td className="px-3 py-2">{displayDate(r.updatedAt, ctx.locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <nav className="mt-4 flex items-center justify-between text-sm">{page > 1 ? <Link href={q(page - 1)} className="font-semibold text-link">{t("lib.prev")}</Link> : <span />}<span className="text-muted">{t("lib.pageOf", { page: String(page), pages: String(pages) })}</span>{page < pages ? <Link href={q(page + 1)} className="font-semibold text-link">{t("lib.next")}</Link> : <span />}</nav>}
    </>
  );
}
