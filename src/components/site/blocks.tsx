import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/site/fx/reveal";
import { Photo } from "@/components/site/photo";
import { getSite } from "@/lib/site";
import type { SiteImage } from "@/server/website";

export function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return <p className={`eyebrow ${light ? "eyebrow-light" : ""}`}>{children}</p>;
}

/** Section title with a printed rule above it. */
export function SectionHeading({ eyebrow, title, children, light, align = "left", rule = true }: { eyebrow?: string; title: string; children?: ReactNode; light?: boolean; align?: "left" | "center"; rule?: boolean }) {
  return (
    <Reveal className={rule ? `border-t pt-5 ${light ? "border-cream/60" : "border-ink"}` : ""}>
      <div className={`max-w-3xl ${align === "center" ? "mx-auto text-center [&_.eyebrow]:justify-center" : ""}`}>
        {eyebrow && <Eyebrow light={light}>{eyebrow}</Eyebrow>}
        <h2 className={`display mt-4 text-[2.4rem] sm:text-6xl ${light ? "text-cream" : "text-ink"}`}>{title}</h2>
        {children && <p className={`lead mt-5 max-w-2xl ${light ? "text-cream/80" : "text-ink/75"}`}>{children}</p>}
      </div>
    </Reveal>
  );
}

const BTN = {
  primary: "bg-ink text-cream hover:bg-brand-800",
  sun: "bg-sun text-ink hover:bg-sun-600",
  outline: "border border-ink text-ink hover:bg-ink hover:text-cream",
  ghost: "border border-cream/50 text-cream hover:bg-cream hover:text-ink",
  soft: "bg-cream-deep text-ink hover:bg-line",
} as const;

export function ButtonLink({ href, children, variant = "primary", arrow, external, size = "md" }: { href: string; children: ReactNode; variant?: keyof typeof BTN; arrow?: boolean; external?: boolean; size?: "md" | "sm" }) {
  const cls = `group inline-flex items-center justify-center gap-2.5 whitespace-nowrap font-semibold tracking-[.01em] transition-[background-color,color,border-color] duration-200 active:translate-y-px ${size === "md" ? "min-h-12 px-6 text-base" : "min-h-11 px-4 text-sm"} ${BTN[variant]}`;
  const icon = arrow ? external ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /> : null;
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}{icon}</a>
  ) : (
    <Link href={href} className={cls}>{children}{icon}</Link>
  );
}

/** A photograph as a print on the page: rectangular, with a numbered caption underneath. Never stretched; space is reserved. */
export function Print({ image, n, sizes, className = "", ratio = "aspect-[4/5]", priority, caption = true, position }: { image: SiteImage; n?: number; sizes: string; className?: string; ratio?: string; priority?: boolean; caption?: boolean; position?: string }) {
  return (
    <figure className={className}>
      <div className={`frame print ${ratio}`}><Photo image={image} sizes={sizes} priority={priority} position={position} /></div>
      {caption && <figcaption className="mt-2 flex gap-3 text-[13px] leading-snug text-muted">{n !== undefined && <span className="shrink-0 font-semibold tabular-nums text-ink">{String(n).padStart(2, "0")}</span>}<span className="line-clamp-2 italic">{image.alt}</span></figcaption>}
    </figure>
  );
}

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Inner-page header: a masthead rule, breadcrumb, the page title set large, a lead paragraph, and one of the school's own
 * photographs as a captioned print on wider screens (a different one per page). No photograph is shown if the school has none.
 */
export async function PageHero({ eyebrow, title, children, crumbs, photo = true }: { eyebrow?: string; title: string; children?: ReactNode; crumbs?: { href: string; label: string }[]; photo?: boolean }) {
  const gallery = photo ? ((await getSite())?.images.gallery ?? []) : [];
  const pic = gallery.length ? gallery[hashOf(title) % gallery.length] : undefined;
  return (
    <header className="border-t-[3px] border-ink">
      <div className="mx-auto max-w-[100rem] px-4 pb-14 pt-6 sm:px-6 sm:pb-20">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-2">
              {crumbs.map((c, i) => (
                <li key={c.href} className="flex items-center gap-2">
                  <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link>
                  {i < crumbs.length - 1 && <span aria-hidden>/</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className={`mt-10 grid gap-10 sm:mt-14 ${pic ? "md:grid-cols-[1.5fr_1fr] md:items-end" : ""}`}>
          <div>
            {eyebrow && <div className="rise"><Eyebrow>{eyebrow}</Eyebrow></div>}
            <h1 className="display rise-2 mt-5 text-[3.1rem] sm:text-[5.2rem] lg:text-[6.6rem]">{title}</h1>
            {children && <div className="lead rise-3 mt-7 max-w-2xl text-ink/80">{children}</div>}
          </div>
          {pic && <Print image={pic} sizes="(min-width: 768px) 30vw, 0px" ratio="aspect-[4/3]" className="hidden md:block" />}
        </div>
      </div>
      <div className="h-px bg-ink/30" />
    </header>
  );
}

/** Intentional empty slot for a photograph the school has not supplied yet: a hatched panel, never stock imagery. */
export function PhotoSlot({ label, className = "" }: { label: string; className?: string }) {
  return <div role="img" aria-label={label} className={`hatch border border-line ${className}`} />;
}

export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`whitespace-pre-line text-lg leading-relaxed text-ink/85 ${className}`}>{children}</div>;
}

/** Closing call to action used at the foot of inner pages: an ink band with the school's own words. */
export function CtaBand({ title, children, actions }: { title: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <section className="bg-ink px-6 py-10 text-cream sm:px-12 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-xl"><h2 className="display text-4xl sm:text-5xl">{title}</h2>{children && <p className="mt-3 text-cream/75">{children}</p>}</div>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </section>
  );
}
