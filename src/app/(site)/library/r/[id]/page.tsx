import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download, Lock, Eye } from "lucide-react";
import { getLocale, getT } from "@/lib/auth/next";
import { getSite } from "@/lib/site";
import { getLibraryViewer } from "@/lib/library/next";
import { AppError } from "@/lib/errors";
import { humanSize } from "@/lib/library/files";
import { getLibraryResource } from "@/server/library";
import { PageHero } from "@/components/site/blocks";
import { KindBadge, VerifyForm } from "@/components/library/parts";
import { ActionForm } from "@/components/form";
import { leaveLibraryAction } from "../../actions";

export const metadata: Metadata = { title: "Library resource" };

/** One resource: what it is, and the one thing the visitor can do next (open it, verify to open it, or learn why they cannot). */
export default async function ResourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const [{ id }, sp, site, t, locale, lv] = await Promise.all([params, searchParams, getSite(), getT(), getLocale(), getLibraryViewer()]);
  if (!site || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await getLibraryResource(site!.school.id, lv.viewer, id, locale).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!r) notFound();
  const notice = ["VERIFY", "PIN_NEEDED", "NOT_FOR_YOU", "UNAVAILABLE", "FAILED"].includes(sp.notice ?? "") ? sp.notice! : null;
  const reason = r.access.ok ? null : r.access.reason;
  const readable = r.kind === "PDF" || r.kind === "IMAGE";
  const meta: [string, string | null][] = [
    [t("lib.f.category"), r.category.name], [t("lib.f.class"), r.classes.join(", ") || null], [t("lib.f.subject"), r.subjects.join(", ") || null],
    [t("lib.f.language"), r.language === "SW" ? "Kiswahili" : r.language === "EN" ? "English" : t("lib.f.other")], [t("lib.author"), r.author],
    [t("lib.f.type"), `${t(`lib.type.${r.kind}` as "lib.type.PDF")}${r.hasFile ? `, ${humanSize(r.sizeBytes)}` : ""}`],
    [t("lib.published"), r.publishedAt ? new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(r.publishedAt) : null],
  ];
  return (
    <>
      <PageHero photo={false} eyebrow={r.category.name} title={r.title} crumbs={[{ href: "/", label: t("site.nav.home") }, { href: "/library", label: t("lib.title") }, { href: `/library/r/${id}`, label: r.title }]} />
      <div className="mx-auto grid max-w-[100rem] gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-8">
          {notice && (
            <p role="alert" className="border-l-4 border-sun bg-tint px-4 py-3 text-base">
              {t(`lib.notice.${notice}` as "lib.notice.VERIFY")}
            </p>
          )}
          {r.description && <p className="whitespace-pre-line text-lg leading-relaxed text-ink/85">{r.description}</p>}
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {meta.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="eyebrow">{k}</dt><dd className="mt-1 text-lg font-medium text-heading">{v}</dd></div>)}
          </dl>
          {r.copyright && <p className="border-t border-line pt-4 text-sm text-muted">{r.copyright}</p>}
        </div>

        <aside className="self-start border border-line bg-surface p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3"><KindBadge kind={r.kind} />{r.hasFile && <span className="text-sm text-muted">{humanSize(r.sizeBytes)}</span>}</div>
          {r.access.ok ? (
            <div className="mt-5 space-y-3">
              <h2 className="display text-2xl text-heading">{t("lib.access.ok")}</h2>
              {readable && <a href={`/api/library/files/${id}`} target="_blank" rel="noopener" className="flex min-h-12 items-center justify-center gap-2 bg-brand-700 px-6 text-lg font-semibold text-white hover:bg-brand-800"><Eye className="size-5" aria-hidden />{t("lib.read")}</a>}
              <a href={`/api/library/files/${id}?download=1`} className={`flex min-h-12 items-center justify-center gap-2 px-6 text-lg font-semibold ${readable ? "border-2 border-link text-link hover:bg-tint" : "bg-brand-700 text-white hover:bg-brand-800"}`}><Download className="size-5" aria-hidden />{t("lib.download")}</a>
              <p className="text-sm text-muted">{t("lib.access.note")}</p>
            </div>
          ) : reason === "VERIFY" || reason === "PIN_NEEDED" ? (
            <div className="mt-5">
              <h2 className="display flex items-center gap-2 text-2xl text-heading"><Lock className="size-5" aria-hidden />{t("lib.access.verify")}</h2>
              <p className="mb-4 mt-1 text-muted">{reason === "PIN_NEEDED" ? t("lib.access.pin") : t("lib.access.verify.body")}</p>
              {reason === "PIN_NEEDED" && lv.source === "session" && <div className="mb-4"><ActionForm action={leaveLibraryAction} submitLabel={t("lib.leave")} inline /></div>}
              <VerifyForm t={t} next={`/library/r/${id}`} />
            </div>
          ) : reason === "NOT_FOR_YOU" ? (
            <div className="mt-5 space-y-3">
              <h2 className="display text-2xl text-heading">{t("lib.access.notyou")}</h2>
              <p className="text-muted">{t("lib.access.notyou.body")}</p>
              {lv.source === "session" && <ActionForm action={leaveLibraryAction} submitLabel={t("lib.leave")} inline />}
              <Link href="/library/search" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4">{t("lib.access.back")}</Link>
            </div>
          ) : (
            <div className="mt-5 space-y-3"><h2 className="display text-2xl text-heading">{t("lib.access.unavailable")}</h2><Link href="/library/search" className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-4">{t("lib.access.back")}</Link></div>
          )}
        </aside>
      </div>
    </>
  );
}
