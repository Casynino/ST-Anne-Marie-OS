import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Locale, Translate } from "@/lib/i18n";
import { getBarAnnouncement } from "@/server/website";

/** One short, real notice from the school's published announcements. Renders nothing when there is none. */
export async function AnnouncementBar({ schoolId, t, locale }: { schoolId: string; t: Translate; locale: Locale }) {
  const a = await getBarAnnouncement(schoolId);
  if (!a) return null;
  const title = locale === "SW" && a.titleSw ? a.titleSw : a.title;
  const href = a.barLink ?? `/news/${a.slug ?? a.id}`;
  const external = /^https:\/\//.test(href);
  const inner = (
    <>
      <span className="rounded-full bg-sun px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-brand-950">{t("site.bar.label")}</span>
      <span className="truncate font-medium">{title}</span>
      <ArrowRight className="size-4 shrink-0" aria-hidden />
    </>
  );
  const cls = "mx-auto flex max-w-6xl items-center justify-center gap-3 px-4 py-2 text-sm text-white hover:bg-brand-800 sm:px-6";
  return (
    <div className="bg-brand-700">
      {external ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>}
    </div>
  );
}
