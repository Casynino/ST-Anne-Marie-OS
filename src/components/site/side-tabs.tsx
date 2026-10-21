import Link from "next/link";
import { MapPin, MessageCircle, Pencil } from "lucide-react";
import type { Translate } from "@/lib/i18n";

/** Three always-there doors on the right edge of wide screens: ask, visit, apply. (Phones get the bottom bar instead.) */
export function SideTabs({ t, applyHref }: { t: Translate; applyHref: string }) {
  const tabs = [
    { href: "/contact", icon: MessageCircle, label: t("site.act.enquire") },
    { href: "/apply/visit", icon: MapPin, label: t("site.act.visit") },
    { href: applyHref, icon: Pencil, label: t("site.nav.applyShort") },
  ];
  return (
    <nav aria-label={t("site.nav.quick")} className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-px overflow-hidden rounded-l-xl shadow-[var(--shadow-lift)] 2xl:flex">
      {tabs.map((x, i) => (
        <Link key={x.href} href={x.href} className={`group flex w-[5.25rem] flex-col items-center gap-1.5 px-2 py-4 text-center text-[11px] font-bold uppercase tracking-[.08em] transition-colors ${i === 2 ? "bg-sun text-[#10200f] hover:bg-sun-600" : "bg-brand-900 text-white hover:bg-brand-700"}`}>
          <x.icon className="size-6" aria-hidden />{x.label}
        </Link>
      ))}
    </nav>
  );
}
