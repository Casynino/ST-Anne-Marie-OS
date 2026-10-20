import Image from "next/image";
import type { ReactNode } from "react";
import siteMedia from "@/lib/site-media.json";

type Media = { gallery: { path: string; width: number; height: number; alt: string }[] };

/**
 * The first thing on a home screen: who you are, what role you are acting as, and one plain sentence about the school today
 * (every number in `children` comes from the school's own records). The photograph is one of the school's own, fading out
 * to the left so the text stays readable; with no photograph the banner is simply the dark surface.
 */
export function DashHero({ eyebrow, title, children, photoIndex = 1 }: { eyebrow: string; title: string; children: ReactNode; photoIndex?: number }) {
  const photo = (siteMedia as unknown as Media).gallery?.[photoIndex] ?? (siteMedia as unknown as Media).gallery?.[0];
  return (
    <section className="relative isolate overflow-hidden rounded-3xl border border-line bg-surface shadow-[var(--shadow-card)]">
      {photo && (
        <>
          <Image src={photo.path} alt="" width={photo.width} height={photo.height} sizes="(min-width: 1024px) 45vw, 100vw" priority className="absolute inset-y-0 right-0 -z-20 h-full w-full object-cover object-center opacity-60 md:w-[58%]" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--color-surface)_0%,var(--color-surface)_38%,transparent_100%)] max-md:bg-[linear-gradient(180deg,transparent,var(--color-surface))]" />
        </>
      )}
      <div className="max-w-2xl px-6 py-7 sm:px-9 sm:py-9">
        <p className="text-[11px] font-bold uppercase tracking-[.22em] text-sun">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-heading sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-ink/85 sm:text-lg">{children}</p>
      </div>
    </section>
  );
}

/** A number highlighted inside the hero sentence. */
export const Hi = ({ tone = "ok", children }: { tone?: "ok" | "warn" | "bad"; children: ReactNode }) => (
  <strong className={`font-semibold ${tone === "ok" ? "text-ok" : tone === "warn" ? "text-sun" : "text-bad"}`}>{children}</strong>
);
