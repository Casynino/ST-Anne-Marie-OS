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
      <span className="rounded-full bg-sun px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[.16em] text-[#10200f]">{t("site.bar.label")}</span>
      <span className="truncate font-medium">{title}</span>
      <ArrowRight className="size-4 shrink-0" aria-hidden />
    </>
  );
  const cls = "mx-auto flex max-w-[100rem] items-center justify-center gap-3 px-4 py-2 text-[13px] text-white/90 hover:text-white sm:px-8";
  return (
    <div className="border-b border-white/10 bg-black/35">
      {external ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>}
    </div>
  );
}
