import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Reveal } from "@/components/site/fx/reveal";

export function Kicker({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return <p className={`site-mono text-xs font-semibold uppercase ${dark ? "text-glow" : "text-accent"}`}>{children}</p>;
}

export function SectionHeading({ kicker, title, children, dark }: { kicker?: string; title: string; children?: ReactNode; dark?: boolean }) {
  return (
    <Reveal className="max-w-2xl">
      {kicker && <Kicker dark={dark}>{kicker}</Kicker>}
      <h2 className={`site-serif mt-3 text-3xl leading-[1.1] sm:text-5xl ${dark ? "text-white" : "text-night"}`}>{title}</h2>
      {children && <p className={`mt-4 text-base leading-relaxed sm:text-lg ${dark ? "text-brand-100" : "text-muted"}`}>{children}</p>}
    </Reveal>
  );
}

const CTA = {
  solid: "bg-night text-white hover:bg-night-2",
  accent: "bg-accent text-white hover:bg-accent-700",
  signal: "bg-signal text-night hover:bg-signal-700 shadow-[0_8px_30px_-8px_rgb(255_178_62/.6)]",
  ghost: "border border-white/25 text-white hover:bg-white/10",
  outline: "border border-night/20 bg-white text-night hover:bg-paper-deep",
} as const;

export function CtaLink({ href, children, variant = "solid", arrow }: { href: string; children: ReactNode; variant?: keyof typeof CTA; arrow?: boolean }) {
  return (
    <Link href={href} className={`group inline-flex min-h-12 items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 text-base font-semibold transition-colors ${CTA[variant]}`}>
      {children}
      {arrow && <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />}
    </Link>
  );
}

/** Decorative orbit illustration drawn in SVG: no image to download, colours come from the tokens. */
export function Orbit({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden fill="none">
      <circle cx="200" cy="200" r="170" stroke="rgb(76 201 240 / .18)" />
      <circle cx="200" cy="200" r="120" stroke="rgb(255 255 255 / .14)" />
      <circle cx="200" cy="200" r="70" stroke="rgb(76 201 240 / .3)" />
      <circle cx="200" cy="200" r="26" className="fill-glow/20" stroke="rgb(76 201 240 / .8)" />
      <g className="orbit-ring">
        <circle cx="200" cy="30" r="7" className="fill-signal" />
        <circle cx="370" cy="200" r="4" className="fill-glow" />
      </g>
      <g className="orbit-ring-2">
        <circle cx="80" cy="200" r="5" className="fill-white" />
        <circle cx="200" cy="320" r="8" className="fill-glow/70" />
      </g>
    </svg>
  );
}

/** Dark, compact header band for inner pages. */
export function PageHero({ kicker, title, children }: { kicker?: string; title: string; children?: ReactNode }) {
  return (
    <header className="hero-glow hero-grid relative isolate overflow-hidden bg-night text-white">
      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-20">
        {kicker && <div className="site-rise"><Kicker dark>{kicker}</Kicker></div>}
        <h1 className="site-serif site-rise-2 mt-3 max-w-3xl text-4xl leading-[1.05] sm:text-6xl">{title}</h1>
        {children && <div className="site-rise-3 mt-5 max-w-2xl text-lg leading-relaxed text-brand-100">{children}</div>}
      </div>
    </header>
  );
}
