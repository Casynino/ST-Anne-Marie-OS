import Image from "next/image";
import type { ReactNode } from "react";
import siteMedia from "@/lib/site-media.json";

type Media = { gallery: { path: string; width: number; height: number; alt: string }[] };

/**
 * The first thing on a home screen, kept simple: the school and the role you are acting as, a greeting, and one plain sentence about the
 * school today (every number in `children` comes from the school's own records). A photograph from the school itself fills the right side
 * and fades into the dark green on the left, so the words stay easy to read. No search box and no buttons here: the top bar searches and
 * the row of shortcuts below the banner does the rest. Colours stay the same in light and dark mode.
 */
export function DashHero({ eyebrow, title, children, photoIndex = 1 }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number }) {
  const gallery = (siteMedia as unknown as Media).gallery ?? [];
  const photo = gallery[photoIndex] ?? gallery[0];
  return (
    <section className="relative isolate overflow-hidden rounded-2xl text-white shadow-[var(--shadow-lift)]">
      <div aria-hidden className="dash-hero-bg absolute inset-0 -z-20" />
      {photo && (
        <div aria-hidden className="dash-hero-photo absolute inset-y-0 right-0 -z-10 hidden w-[56%] md:block">
          <Image src={photo.path} alt="" width={photo.width} height={photo.height} sizes="(min-width: 1024px) 50vw, 100vw" priority className="size-full object-cover" />
        </div>
      )}
      <div className="px-6 py-7 sm:px-9 sm:py-9 md:pr-[48%]">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-[#f3c95c]"><span className="live-dot" aria-hidden />{eyebrow}</p>
        <h1 className="mt-3 text-[1.9rem] font-semibold leading-tight tracking-tight text-white sm:text-[2.25rem]">{title}</h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-white/85">{children}</p>
      </div>
    </section>
  );
}

/** A number highlighted inside the hero sentence (the hero is always dark, so these are light tones). */
export const Hi = ({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad"; children: ReactNode }) => (
  <strong className={`font-semibold ${tone === "ok" ? "text-emerald-300" : tone === "warn" ? "text-yellow-300" : "text-red-300"}`}>{children}</strong>
);
