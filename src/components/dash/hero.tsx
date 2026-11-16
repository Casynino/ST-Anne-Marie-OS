import Image from "next/image";
import type { ReactNode } from "react";
import siteMedia from "@/lib/site-media.json";

type Media = { gallery: { path: string; width: number; height: number; alt: string }[] };

/**
 * The first thing on a home screen (the ZELab layout): a slim banner with the greeting on the left (the name in bold), one quiet line under
 * it (role, date, term), and a photograph from the school itself on the right that fades into the colour. No figures, no buttons and no
 * search box in it: the sidebar is the way around, and what needs doing is the list right below. The one-sentence summary stays for screen
 * readers. Colours stay the same in light and dark mode.
 */
export function DashHero({ eyebrow, title, children, photoIndex = 1, date }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number; date?: string }) {
  const gallery = (siteMedia as unknown as Media).gallery ?? [];
  const photo = gallery[photoIndex] ?? gallery[0];
  // "SCHOOL · ROLE" → the school name is already in the sidebar, so only the role (and class / number on a child's page) is shown.
  const parts = eyebrow.split(" · ");
  const tags = (parts.length > 1 ? parts.slice(1) : parts).map((x) => x.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()));
  const cut = title.lastIndexOf(", ");
  return (
    <section className="relative isolate overflow-hidden rounded-xl text-white ring-1 ring-white/10">
      <div aria-hidden className="dash-hero-bg absolute inset-0 -z-20" />
      {photo && (
        <div aria-hidden className="dash-hero-photo absolute inset-y-0 right-0 -z-10 hidden w-[46%] sm:block">
          <Image src={photo.path} alt="" width={photo.width} height={photo.height} sizes="(min-width: 1024px) 45vw, 100vw" priority className="size-full object-cover" />
        </div>
      )}
      <div className="px-4 py-4 sm:px-6 sm:py-5 sm:pr-[42%]">
        <h1 className="text-[1.35rem] font-normal leading-tight tracking-tight text-white sm:text-[1.7rem]">
          {cut > 0 ? <>{title.slice(0, cut + 2)}<strong className="font-semibold">{title.slice(cut + 2)}</strong></> : <strong className="font-semibold">{title}</strong>}
        </h1>
        <p className="mt-1 text-sm text-white/70">{[...tags, date].filter(Boolean).join(" · ")}</p>
        <p className="sr-only">{children}</p>
      </div>
    </section>
  );
}

/** The banner every staff home opens with. */
export function HomeBanner({ eyebrow, title, children, photoIndex, date }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number; date?: string }) {
  return <DashHero eyebrow={eyebrow} title={title} photoIndex={photoIndex} date={date}>{children}</DashHero>;
}

/** A number highlighted inside the hero sentence (the hero is always dark, so these are light tones). */
export const Hi = ({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad"; children: ReactNode }) => (
  <strong className={`font-semibold ${tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-yellow-300" : "text-red-300"}`}>{children}</strong>
);
