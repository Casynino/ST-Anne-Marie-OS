import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { NAV_ICONS } from "@/components/app-shell/icons";
import siteMedia from "@/lib/site-media.json";
import type { Quick } from "./quick-links";

type Media = { gallery: { path: string; width: number; height: number; alt: string }[] };

/**
 * The first thing on a home screen (the Swift Cargo director's banner): the greeting centred in spaced capitals between two thin yellow
 * lines, the role under it in small yellow capitals, the date, and one plain sentence about the school today (every number in `children`
 * comes from the school's own records). A photograph from the school itself runs behind it and fades into navy on the left, so the words
 * stay easy to read. Colours stay the same in light and dark mode.
 */
export function DashHero({ eyebrow, title, children, photoIndex = 1, date }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number; date?: string }) {
  const gallery = (siteMedia as unknown as Media).gallery ?? [];
  const photo = gallery[photoIndex] ?? gallery[0];
  // "SCHOOL · ROLE" → the school name is already in the sidebar, so only the role (and class / number on a child's page) is shown.
  const parts = eyebrow.split(" · ");
  const tags = parts.length > 1 ? parts.slice(1) : parts;
  return (
    <section className="relative isolate overflow-hidden rounded-2xl text-white shadow-[var(--shadow-lift)] ring-1 ring-white/10">
      <div aria-hidden className="dash-hero-bg absolute inset-0 -z-20" />
      {photo && <Image src={photo.path} alt="" width={photo.width} height={photo.height} sizes="(min-width: 1024px) 80vw, 100vw" priority className="absolute inset-0 -z-10 size-full object-cover opacity-80" />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-[#08122b] via-[#08122b]/80 to-[#08122b]/15" />
      <div className="px-5 py-8 text-center sm:py-10">
        <h1 className="inline-flex items-center justify-center gap-3 text-[1.4rem] font-semibold uppercase tracking-[.16em] text-white sm:gap-5 sm:text-[1.9rem] sm:tracking-[.2em]">
          <span aria-hidden className="hidden h-px w-8 bg-[#e8dc2e] sm:block sm:w-12" />
          <span>{title}</span>
          <span aria-hidden className="hidden h-px w-8 bg-[#e8dc2e] sm:block sm:w-12" />
        </h1>
        <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[.3em] text-[#f3c95c]">{tags.join(" · ")}</p>
        {date && <p className="mt-2 text-sm text-white/85">{date}</p>}
        <p className="mx-auto mt-1.5 max-w-2xl text-sm leading-relaxed text-white/80">{children}</p>
      </div>
    </section>
  );
}

/** The banner and the row of shortcuts under it, together: every staff home opens with this. */
export function HomeBanner({ eyebrow, title, children, photoIndex, date, quick, allLabel }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number; date?: string; quick: Quick[]; allLabel: string }) {
  return (
    <>
      <DashHero eyebrow={eyebrow} title={title} photoIndex={photoIndex} date={date}>{children}</DashHero>
      <ChipRow label={allLabel} items={quick} />
    </>
  );
}

const CHIP_TONES = ["indigo", "rose", "green", "orange", "violet", "teal"] as const;

/** The row of shortcuts (up to eight; the sidebar has the rest): an outlined chip each, with a coloured icon, the name, and a yellow count when something is waiting there. */
export function ChipRow({ items, label }: { items: Quick[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap gap-2">
      {items.slice(0, 8).map((q, i) => {
        const Icon = NAV_ICONS[q.icon];
        return (
          <Link key={q.href + q.label} href={q.href} className={`tint-${CHIP_TONES[i % CHIP_TONES.length]} inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface/70 px-3.5 text-sm font-medium text-ink transition hover:border-link/50 hover:bg-surface`}>
            <Icon className="size-4 shrink-0 text-[color:var(--tf)]" aria-hidden />
            {q.label}
            {q.count ? <span className="rounded bg-sun px-1.5 text-xs font-bold tabular-nums text-brand-950">{q.count}</span> : null}
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
