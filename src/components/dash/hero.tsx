import Image from "next/image";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import siteMedia from "@/lib/site-media.json";
import { LiveClock } from "./live-clock";

type Media = { gallery: { path: string; width: number; height: number; alt: string }[] };

/**
 * The first thing on a home screen: the date and the role you are acting as, a greeting, one plain sentence about the school today (every number
 * in `children` comes from the school's own records), and, for staff, a search box and the main actions. The banner is a deep green-to-teal
 * gradient with a faint grid; one of the school's own photographs shows through on the right. Colours stay the same in light and dark mode.
 */
export function DashHero({ eyebrow, title, children, photoIndex = 1, search, actions, tz = "Africa/Dar_es_Salaam", locale = "EN" }: {
  eyebrow: string; title: string; children: ReactNode; photoIndex?: number;
  search?: { action: string; placeholder: string; label: string; button: string }; actions?: ReactNode; tz?: string; locale?: "EN" | "SW";
}) {
  const photo = (siteMedia as unknown as Media).gallery?.[photoIndex] ?? (siteMedia as unknown as Media).gallery?.[0];
  const date = new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date());
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-white/10 text-white shadow-[var(--shadow-lift)]">
      <div aria-hidden className="dash-hero-bg absolute inset-0 -z-30" />
      {photo && <Image src={photo.path} alt="" width={photo.width} height={photo.height} sizes="(min-width: 1024px) 45vw, 100vw" priority className="absolute inset-y-0 right-0 -z-20 hidden h-full w-[48%] object-cover opacity-35 mix-blend-luminosity md:block" />}
      <div aria-hidden className="dash-hero-grid absolute inset-0 -z-10" />
      <div className="px-6 py-6 sm:px-9 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
          <p className="flex items-center gap-2 font-semibold uppercase tracking-[.16em] text-white/90"><span className="live-dot" aria-hidden />{eyebrow}</p>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-white/80"><span>{date}</span><LiveClock zones={[{ label: "", tz }]} /></span>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-[2.5rem] sm:leading-[1.1]">{title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-white/85 sm:text-lg">{children}</p>
        {search && (
          <form action={search.action} method="get" className="mt-5 flex max-w-2xl gap-2" role="search">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{search.label}</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/60" aria-hidden />
              <input name="q" placeholder={search.placeholder} className="min-h-11 w-full !border-white/20 !bg-black/25 pl-10 pr-3 text-[15px] !text-white placeholder:text-white/55" />
            </label>
            <button className="min-h-11 shrink-0 rounded-[0.625rem] bg-white px-5 text-sm font-medium text-brand-900 shadow-sm transition-colors hover:bg-brand-50">{search.button}</button>
          </form>
        )}
        {actions && <div className="mt-4 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  );
}

/** A number highlighted inside the hero sentence (the hero is always dark, so these are light tones). */
export const Hi = ({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad"; children: ReactNode }) => (
  <strong className={`font-semibold ${tone === "ok" ? "text-emerald-200" : tone === "warn" ? "text-yellow-200" : "text-red-200"}`}>{children}</strong>
);
