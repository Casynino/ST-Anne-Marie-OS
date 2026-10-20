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

/** Section title: small gold label, large serif heading, optional lead. */
export function SectionHeading({ eyebrow, title, children, align = "left" }: { eyebrow?: string; title: string; children?: ReactNode; light?: boolean; align?: "left" | "center"; rule?: boolean }) {
  return (
    <Reveal className={`max-w-3xl ${align === "center" ? "mx-auto text-center [&_.eyebrow]:justify-center" : ""}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="display mt-5 text-[2.6rem] text-heading sm:text-6xl lg:text-7xl">{title}</h2>
      {children && <p className="lead mt-6 max-w-2xl text-muted">{children}</p>}
    </Reveal>
  );
}

const BTN = {
  primary: "bg-brand-600 text-white hover:bg-brand-500",
  sun: "bg-sun text-[#10200f] hover:bg-sun-600",
  outline: "border border-ink/30 text-heading hover:border-ink hover:bg-ink/10",
  ghost: "glass text-white hover:bg-white/15",
  soft: "bg-tint text-heading hover:bg-tint-2",
} as const;

export function ButtonLink({ href, children, variant = "primary", arrow, external, size = "md" }: { href: string; children: ReactNode; variant?: keyof typeof BTN; arrow?: boolean; external?: boolean; size?: "md" | "sm" }) {
  const cls = `group inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full font-semibold tracking-[.01em] transition-[background-color,color,border-color,transform] duration-300 active:scale-[.98] ${size === "md" ? "min-h-12 px-7 text-[15px]" : "min-h-11 px-5 text-sm"} ${BTN[variant]}`;
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
      <div className={`frame print rounded-[1.5rem] ring-1 ring-white/10 ${ratio}`}><Photo image={image} sizes={sizes} priority={priority} position={position} /></div>
      {caption && <figcaption className="mt-3 flex gap-3 text-[13px] leading-snug text-muted">{n !== undefined && <span className="shrink-0 font-semibold tabular-nums text-sun">{String(n).padStart(2, "0")}</span>}<span className="line-clamp-2">{image.alt}</span></figcaption>}
    </figure>
  );
}

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Inner-page header: one of the school's photographs fills the top, tinted deep green and drifting slowly, with the breadcrumb, the
 * page title rising word by word and a lead paragraph on top. (A different photograph per page; none if the school has none.)
 */
export async function PageHero({ eyebrow, title, children, crumbs, photo = true }: { eyebrow?: string; title: string; children?: ReactNode; crumbs?: { href: string; label: string }[]; photo?: boolean }) {
  const gallery = photo ? ((await getSite())?.images.gallery ?? []) : [];
  const pic = gallery.length ? gallery[hashOf(title) % gallery.length] : undefined;
  return (
    <header className="relative isolate overflow-hidden bg-canvas">
      {pic && <Image src={pic.src} alt="" fill priority sizes="100vw" className="kb -z-20 object-cover opacity-60 saturate-[.8]" />}
      <div aria-hidden className="absolute inset-0 -z-10 bg-[#06150d]/60 mix-blend-multiply" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(7_16_11/.75)_0%,rgb(7_16_11/.3)_45%,rgb(7_16_11/1)_100%)]" />
      <div aria-hidden className="grain absolute inset-0 -z-10" />
      <div className="mx-auto max-w-[100rem] px-4 pb-16 pt-40 sm:px-8 sm:pb-24 sm:pt-52">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="text-sm text-white/65">
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
        {eyebrow && <div className="rise mt-8"><Eyebrow>{eyebrow}</Eyebrow></div>}
        <h1 className="display mt-5 max-w-5xl text-[3.2rem] text-white sm:text-[5.6rem] lg:text-[7.2rem]"><WordReveal text={title} /></h1>
        {children && <div className="lead rise-3 mt-7 max-w-2xl text-white/80">{children}</div>}
      </div>
    </header>
  );
}

/** Intentional empty slot for a photograph the school has not supplied yet: a calm panel, never stock imagery. */
export function PhotoSlot({ label, className = "" }: { label: string; className?: string }) {
  return <div role="img" aria-label={label} className={`rounded-[1.5rem] border border-line bg-surface ${className}`} />;
}

export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`whitespace-pre-line text-lg leading-relaxed text-ink/85 ${className}`}>{children}</div>;
}

/** Closing call to action at the foot of inner pages. */
export function CtaBand({ title, children, actions }: { title: string; children?: ReactNode; actions: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden rounded-[2rem] border border-white/10 bg-surface px-6 py-12 sm:px-14 sm:py-16">
      <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-80 rounded-full bg-sun/10 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 left-10 -z-10 size-80 rounded-full bg-brand-500/15 blur-3xl" />
      <div className="flex flex-wrap items-end justify-between gap-8">
        <div className="max-w-xl"><h2 className="display text-4xl text-heading sm:text-6xl">{title}</h2>{children && <p className="lead mt-4 text-muted">{children}</p>}</div>
        <div className="flex flex-wrap gap-3">{actions}</div>
      </div>
    </section>
  );
}
