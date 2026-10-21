import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Locale, Translate } from "@/lib/i18n";
import { getBarAnnouncement } from "@/server/website";

/** One short, real notice from the school's published announcements, in the school's yellow. Renders nothing when there is none. */
export async function AnnouncementBar({ schoolId, t, locale }: { schoolId: string; t: Translate; locale: Locale }) {
  const a = await getBarAnnouncement(schoolId);
  if (!a) return null;
  const title = locale === "SW" && a.titleSw ? a.titleSw : a.title;
  const href = a.barLink ?? `/news/${a.slug ?? a.id}`;
  const external = /^https:\/\//.test(href);
  const inner = (
    <>
      <span className="text-xs font-bold uppercase tracking-[.14em]">{t("site.bar.label")}<span aria-hidden className="ml-3 font-normal opacity-50">|</span></span>
      <span className="truncate font-semibold">{title}</span>
      <ArrowRight className="size-4 shrink-0" aria-hidden />
    </>
  );
  const cls = "mx-auto flex max-w-[100rem] items-center justify-center gap-3 px-4 py-2.5 text-sm text-[#10200f] hover:underline sm:px-8";
  return <div className="bg-sun">{external ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>}</div>;
}
