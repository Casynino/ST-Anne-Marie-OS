import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { NAV_ICONS } from "@/components/app-shell/icons";
import siteMedia from "@/lib/site-media.json";
import type { Quick } from "./quick-links";

type Media = { gallery: { path: string; width: number; height: number; alt: string }[] };

export type HeroSearch = { action: string; placeholder: string; button: string };

/**
 * The first thing on a home screen (the Target Express / Swift Cargo banner): the date and the role you are acting as as two small tags,
 * a greeting, one plain sentence about the school today (every number in `children` comes from the school's own records), then the
 * search box and the first one or two things to do. A photograph from the school itself fills the right side and fades into the colour,
 * so the words stay easy to read. Colours stay the same in light and dark mode.
 */
export function DashHero({ eyebrow, title, children, photoIndex = 1, date, search, actions = [] }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number; date?: string; search?: HeroSearch; actions?: Quick[] }) {
  const gallery = (siteMedia as unknown as Media).gallery ?? [];
  const photo = gallery[photoIndex] ?? gallery[0];
  // "SCHOOL · ROLE" → the school name is already in the sidebar, so only the role (and class / number on a child's page) is shown as a tag.
  const parts = eyebrow.split(" · ");
  const tags = parts.length > 1 ? parts.slice(1) : parts;
  return (
    <section className="relative isolate overflow-hidden rounded-2xl text-white shadow-[var(--shadow-lift)]">
      <div aria-hidden className="dash-hero-bg absolute inset-0 -z-20" />
      {photo && (
        <div aria-hidden className="dash-hero-photo absolute inset-y-0 right-0 -z-10 hidden w-[52%] md:block">
          <Image src={photo.path} alt="" width={photo.width} height={photo.height} sizes="(min-width: 1024px) 50vw, 100vw" priority className="size-full object-cover" />
        </div>
      )}
      <div className="px-5 py-6 sm:px-8 sm:py-7 md:pr-[46%]">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          {date && <span className="inline-flex items-center gap-2 rounded-md bg-white/15 px-2.5 py-1 text-white"><span className="live-dot" aria-hidden />{date}</span>}
          {tags.map((tag) => <span key={tag} className="rounded-md bg-black/25 px-2.5 py-1 uppercase tracking-[.1em] text-[#f3c95c]">{tag}</span>)}
        </div>
        <h1 className="mt-3 text-[1.9rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.25rem]">{title}</h1>
        <p className="mt-1.5 max-w-xl text-base leading-relaxed text-white/85">{children}</p>
        {search && (
          <form action={search.action} method="get" role="search" className="mt-4 flex max-w-xl gap-2">
            <label className="sr-only" htmlFor="hero-search">{search.placeholder}</label>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/70" aria-hidden />
              <input id="hero-search" name="q" type="search" placeholder={search.placeholder} className="h-11 w-full rounded-lg border-white/25! bg-black/30! pl-9 pr-3 text-sm text-white! placeholder:text-white/60 focus:border-white/70! focus:bg-black/40!" />
            </div>
            <button type="submit" className="h-11 shrink-0 rounded-lg bg-white px-4 text-sm font-semibold text-[#10231a] transition-colors hover:bg-white/90">{search.button}</button>
          </form>
        )}
        {actions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.slice(0, 2).map((q, i) => {
              const Icon = NAV_ICONS[q.icon];
              return (
                <Link key={q.href + q.label} href={q.href} className={`inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${i === 0 ? "bg-white text-[#10231a] hover:bg-white/90" : "border border-white/30 bg-black/20 text-white hover:bg-black/35"}`}>
                  <Icon className="size-4" aria-hidden />
                  {q.label}
                  {q.count ? <span className="rounded bg-[#e8dc2e] px-1.5 text-xs font-bold tabular-nums text-[#10231a]">{q.count}</span> : null}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/** The banner and the row of coloured shortcuts under it, together: every staff home opens with this. The first two shortcuts sit in the banner. */
export function HomeBanner({ eyebrow, title, children, photoIndex, date, quick, searchBox, allLabel }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number; date?: string; quick: Quick[]; searchBox?: HeroSearch; allLabel: string }) {
  return (
    <>
      <DashHero eyebrow={eyebrow} title={title} photoIndex={photoIndex} date={date} search={searchBox} actions={quick.slice(0, 2)}>{children}</DashHero>
      <ChipRow label={allLabel} items={quick.slice(2)} />
    </>
  );
}

const CHIP = ["bg-[#1c58c4]", "bg-[#c93545]", "bg-[#0b7a52]", "bg-[#a15c00]", "bg-[#6b3fc0]", "bg-[#0a7a92]", "bg-[#3f4bb8]", "bg-[#b4501a]"] as const;

/** The row of coloured shortcuts (up to eight; the sidebar has the rest): one colour each, an icon, the name, and a yellow count when something is waiting there. */
export function ChipRow({ items, label }: { items: Quick[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap gap-2">
      {items.slice(0, 8).map((q, i) => {
        const Icon = NAV_ICONS[q.icon];
        return (
          <Link key={q.href + q.label} href={q.href} className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 ${CHIP[i % CHIP.length]}`}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {q.label}
            {q.count ? <span className="rounded bg-[#e8dc2e] px-1.5 text-xs font-bold tabular-nums text-[#10231a]">{q.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** A number highlighted inside the hero sentence (the hero is always dark, so these are light tones). */
export const Hi = ({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad"; children: ReactNode }) => (
  <strong className={`font-semibold ${tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-yellow-300" : "text-red-300"}`}>{children}</strong>
);
