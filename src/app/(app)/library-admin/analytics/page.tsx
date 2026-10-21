import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { libraryAnalytics } from "@/server/library";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";

export const metadata: Metadata = { title: "Library statistics" };

function List({ rows, empty }: { rows: { name: string; count: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.name}><div className="flex justify-between gap-3"><span>{r.name}</span><span className="tabular-nums text-muted">{r.count}</span></div><div aria-hidden className="mt-1 h-1.5 bg-canvas"><div className="h-full bg-brand-600" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} /></div></li>
      ))}
    </ul>
  );
}

export default async function LibraryAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const [ctx, t, sp] = await Promise.all([requireContext(), getT(), searchParams]);
  if (!hasAny(ctx, ["library.analytics", "library.manage"])) return <NoAccess t={t} />;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const a = await libraryAnalytics(ctx, days);
  const stat = (label: string, value: number, href?: string) => <div className="rounded-xl border border-line bg-surface p-4"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{href ? <Link href={href} className="hover:underline">{value}</Link> : value}</p></div>;
  return (
    <>
      <PageHeader title={t("lib.nav.analytics")} subtitle={t("lib.an.sub")} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin/analytics" />
      <div className="mb-4 flex gap-2">{[7, 30, 90].map((d) => <Link key={d} href={`/library-admin/analytics?days=${d}`} aria-current={d === days ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${d === days ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface"}`}>{t("lib.an.days", { n: String(d) })}</Link>)}</div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stat(t("lib.an.published"), a.totalPublished)}
        {stat(t("lib.an.awaiting"), a.awaiting.length, "/library-admin?status=PENDING_REVIEW")}
        {stat(t("lib.an.downloads", { n: String(days) }), a.downloads)}
        {stat(t("lib.an.views", { n: String(days) }), a.views)}
        {stat(t("lib.an.noFile"), a.noFile)}
      </div>
      <p className="mt-2 text-xs text-muted">{t("lib.an.note")}</p>
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card title={t("lib.an.byCategory")}><List rows={a.byCategory} empty={t("lib.an.none")} /></Card>
        <Card title={t("lib.an.byClass")}><List rows={a.byClass} empty={t("lib.an.none")} /></Card>
        <Card title={t("lib.an.bySubject")}><List rows={a.bySubject} empty={t("lib.an.none")} /></Card>
        <Card title={t("lib.an.top", { n: String(days) })}>
          {a.top.length === 0 ? <p className="text-sm text-muted">{t("lib.an.noUse")}</p> : <ol className="space-y-2 text-sm">{a.top.map((x) => <li key={x.id} className="flex justify-between gap-3"><Link href={`/library-admin/${x.id}`} className="text-link hover:underline">{x.title}</Link><span className="tabular-nums text-muted">{x.count}</span></li>)}</ol>}
        </Card>
        <Card title={t("lib.an.recent")}>
          <ul className="space-y-2 text-sm">{a.recent.map((x) => <li key={x.id} className="flex justify-between gap-3"><Link href={`/library-admin/${x.id}`} className="text-link hover:underline">{x.title}</Link><span className="text-muted">{displayDate(x.createdAt, ctx.locale)}</span></li>)}{a.recent.length === 0 && <li className="text-muted">{t("lib.an.none")}</li>}</ul>
        </Card>
        <Card title={t("lib.an.pending")}>
          <ul className="space-y-2 text-sm">{a.awaiting.map((x) => <li key={x.id}><Link href={`/library-admin/${x.id}`} className="text-link hover:underline">{x.title}</Link></li>)}{a.awaiting.length === 0 && <li className="text-muted">{t("lib.an.none")}</li>}</ul>
        </Card>
      </div>
    </>
  );
}
