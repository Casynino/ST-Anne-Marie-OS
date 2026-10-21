import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/site/fx/reveal";
import { WordReveal } from "@/components/site/fx/word-reveal";
import { Photo } from "@/components/site/photo";
import { getSite } from "@/lib/site";
import type { SiteImage } from "@/server/website";

export function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return <p className={`eyebrow ${light ? "eyebrow-light" : ""}`}>{children}</p>;
}

/** Section title: small green label with the yellow bar, a strong heading, optional lead. */
export function SectionHeading({ eyebrow, title, children, align = "left" }: { eyebrow?: string; title: string; children?: ReactNode; light?: boolean; align?: "left" | "center"; rule?: boolean }) {
  return (
    <Reveal className={`max-w-3xl ${align === "center" ? "mx-auto text-center [&_.eyebrow]:justify-center" : ""}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="display mt-4 text-[2rem] text-heading sm:text-5xl">{title}</h2>
      {children && <p className="lead mt-5 max-w-2xl text-muted">{children}</p>}
    </Reveal>
  );
}

const BTN = {
  primary: "bg-brand-700 text-white hover:bg-brand-800",
  sun: "bg-sun text-[#10200f] hover:bg-sun-600",
  outline: "border-2 border-brand-700 text-brand-800 hover:bg-brand-700 hover:text-white",
  ghost: "border-2 border-white/70 text-white hover:bg-white hover:text-brand-900",
  soft: "bg-tint text-brand-800 hover:bg-tint-2",
} as const;

export function ButtonLink({ href, children, variant = "primary", arrow, external, size = "md" }: { href: string; children: ReactNode; variant?: keyof typeof BTN; arrow?: boolean; external?: boolean; size?: "md" | "sm" }) {
  const cls = `group inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-md font-bold tracking-[.01em] transition-[background-color,color,border-color,transform] duration-200 active:scale-[.98] ${size === "md" ? "min-h-12 px-6 text-[15px]" : "min-h-11 px-4 text-sm"} ${BTN[variant]}`;
  const icon = arrow ? external ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /> : null;
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}{icon}</a>
  ) : (
    <Link href={href} className={cls}>{children}{icon}</Link>
  );
}

/** A photograph in a rounded frame with a numbered caption. Space is reserved; never stretched. */
export function Print({ image, n, sizes, className = "", ratio = "aspect-[4/5]", priority, caption = true, position }: { image: SiteImage; n?: number; sizes: string; className?: string; ratio?: string; priority?: boolean; caption?: boolean; position?: string }) {
  return (
    <figure className={className}>
      <div className={`frame print rounded-lg shadow-[var(--shadow-card)] ${ratio}`}><Photo image={image} sizes={sizes} priority={priority} position={position} /></div>
      {caption && <figcaption className="mt-3 flex gap-3 text-[13px] leading-snug text-muted">{n !== undefined && <span className="shrink-0 font-bold tabular-nums text-brand-700">{String(n).padStart(2, "0")}</span>}<span className="line-clamp-2">{image.alt}</span></figcaption>}
    </figure>
  );
}

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Inner-page banner: one of the school's photographs across the top (a different one per page), a deep-green wash so the title is easy to
 * read, the breadcrumb, the page title with a yellow bar, and a lead paragraph. No photograph is shown if the school has none.
 */
export async function PageHero({ eyebrow, title, children, crumbs, photo = true }: { eyebrow?: string; title: string; children?: ReactNode; crumbs?: { href: string; label: string }[]; photo?: boolean }) {
  const gallery = photo ? ((await getSite())?.images.gallery ?? []) : [];
  const pic = gallery.length ? gallery[hashOf(title) % gallery.length] : undefined;
  return (
    <header className="relative isolate overflow-hidden bg-brand-900">
      {pic && <Image src={pic.src} alt="" fill priority sizes="100vw" className="kb -z-20 object-cover opacity-50" />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(6_40_27/.92)_0%,rgb(6_40_27/.7)_55%,rgb(6_40_27/.35)_100%)]" />
      <div className="mx-auto max-w-[100rem] px-4 pb-14 pt-10 sm:px-8 sm:pb-20 sm:pt-16">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="text-sm text-white/75">
            <ol className="flex flex-wrap items-center gap-2">
              {crumbs.map((c, i) => (
                <li key={c.href} className="flex items-center gap-2">
                  <Link href={c.href} className="hover:text-white hover:underline">{c.label}</Link>
                  {i < crumbs.length - 1 && <span aria-hidden>/</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {eyebrow && <p className="rise mt-6 inline-flex items-center gap-3 text-xs font-bold uppercase tracking-[.18em] text-sun"><span aria-hidden className="h-[3px] w-7 rounded bg-sun" />{eyebrow}</p>}
        <h1 className="display rise-2 mt-3 max-w-4xl text-[2.5rem] text-white sm:text-6xl lg:text-7xl">{title}</h1>
        <span aria-hidden className="mt-5 block h-1 w-16 rounded bg-sun" />
        {children && <div className="lead rise-3 mt-6 max-w-2xl text-white/85">{children}</div>}
      </div>
    </header>
  );
}

/** Intentional empty slot for a photograph the school has not supplied yet: a calm panel, never stock imagery. */
export function PhotoSlot({ label, className = "" }: { label: string; className?: string }) {
  return <div role="img" aria-label={label} className={`rounded-lg border border-line bg-tint ${className}`} />;
}

export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`whitespace-pre-line text-lg leading-relaxed text-ink/85 ${className}`}>{children}</div>;
}

/** Closing call to action at the foot of inner pages: a deep-green band with the school's yellow button. */
export function CtaBand({ title, children, actions }: { title: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <section className="site-deep relative isolate overflow-hidden rounded-2xl px-6 py-12 sm:px-14 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-xl"><h2 className="display text-3xl text-heading sm:text-5xl">{title}</h2>{children && <p className="lead mt-4 text-muted">{children}</p>}</div>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </section>
  );
}
