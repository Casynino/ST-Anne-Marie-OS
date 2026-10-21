import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { libraryActivity } from "@/server/library";
import { getSchoolBasics } from "@/server/settings";
import { Badge, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";

export const metadata: Metadata = { title: "Library activity" };

/** Who opened what. Detailed and personal, so only for people the school has trusted with the library audit permission. */
export default async function LibraryActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const [ctx, t, sp] = await Promise.all([requireContext(), getT(), searchParams]);
  if (!ctx.permissions.has("library.audit")) return <NoAccess t={t} />;
  const [log, school] = await Promise.all([libraryActivity(ctx, Math.max(1, Number(sp.page) || 1)), getSchoolBasics(ctx.schoolId)]);
  const pages = Math.max(1, Math.ceil(log.total / log.pageSize));
  return (
    <>
      <PageHeader title={t("lib.nav.activity")} subtitle={t("lib.act.sub")} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin/activity" />
      {log.items.length === 0 ? <EmptyState>{t("lib.act.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-canvas text-left text-xs text-muted"><tr><th className="px-3 py-2">{t("lib.act.when")}</th><th className="px-3 py-2">{t("lib.act.who")}</th><th className="px-3 py-2">{t("lib.m.title")}</th><th className="px-3 py-2">{t("lib.act.what")}</th></tr></thead>
            <tbody className="divide-y divide-line">
              {log.items.map((e) => (
                <tr key={e.id}><td className="px-3 py-2">{displayDateTime(e.at, school.timezone, ctx.locale)}</td><td className="px-3 py-2">{e.who ?? t("lib.act.visitor")}</td><td className="px-3 py-2">{e.title}</td><td className="px-3 py-2"><Badge tone={e.outcome === "GRANTED" ? "ok" : "bad"}>{t(`lib.act.${e.outcome}` as "lib.act.GRANTED")}</Badge> {e.kind === "DOWNLOAD" ? t("lib.download") : t("lib.read")}{e.reason ? ` · ${e.reason}` : ""}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && <nav className="mt-4 flex items-center justify-between text-sm">{log.page > 1 ? <Link href={`/library-admin/activity?page=${log.page - 1}`} className="font-semibold text-link">{t("lib.prev")}</Link> : <span />}<span className="text-muted">{t("lib.pageOf", { page: String(log.page), pages: String(pages) })}</span>{log.page < pages ? <Link href={`/library-admin/activity?page=${log.page + 1}`} className="font-semibold text-link">{t("lib.next")}</Link> : <span />}</nav>}
    </>
  );
}
