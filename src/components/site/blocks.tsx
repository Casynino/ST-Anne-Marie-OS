import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/site/fx/reveal";

export function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return <p className={`eyebrow ${light ? "eyebrow-light" : ""}`}>{children}</p>;
}

export function SectionHeading({ eyebrow, title, children, light, align = "left" }: { eyebrow?: string; title: string; children?: ReactNode; light?: boolean; align?: "left" | "center" }) {
  return (
    <Reveal className={`max-w-2xl ${align === "center" ? "mx-auto text-center [&_.eyebrow]:justify-center" : ""}`}>
      {eyebrow && <Eyebrow light={light}>{eyebrow}</Eyebrow>}
      <h2 className={`display mt-4 text-[2rem] sm:text-5xl ${light ? "text-white" : "text-brand-900"}`}>{title}</h2>
      {children && <p className={`mt-4 text-base leading-relaxed sm:text-lg ${light ? "text-brand-100" : "text-muted"}`}>{children}</p>}
    </Reveal>
  );
}

const BTN = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-[0_6px_18px_-8px_rgb(2_106_67/.7)]",
  sun: "bg-sun text-brand-950 hover:bg-sun-600",
  outline: "border-2 border-brand-700 text-brand-800 hover:bg-brand-700 hover:text-white",
  ghost: "border-2 border-white/40 text-white hover:bg-white hover:text-brand-900",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
} as const;

export function ButtonLink({ href, children, variant = "primary", arrow, external, size = "md" }: { href: string; children: ReactNode; variant?: keyof typeof BTN; arrow?: boolean; external?: boolean; size?: "md" | "sm" }) {
  const cls = `group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow,transform] duration-200 active:scale-[.98] ${size === "md" ? "min-h-12 px-6 text-base" : "min-h-11 px-4 text-sm"} ${BTN[variant]}`;
  const icon = arrow ? external ? <ArrowUpRight className="size-4" aria-hidden /> : <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /> : null;
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{children}{icon}</a>
  ) : (
    <Link href={href} className={cls}>{children}{icon}</Link>
  );
}

/** Inner-page header: breadcrumb, large display title, short lead. Light, editorial, with a brand-green corner arch. */
export function PageHero({ eyebrow, title, children, crumbs }: { eyebrow?: string; title: string; children?: ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <header className="relative isolate overflow-hidden bg-cream">
      <div aria-hidden className="absolute -right-24 -top-24 -z-10 size-[26rem] rounded-full bg-brand-700 sm:size-[34rem]" />
      <div aria-hidden className="absolute -right-6 top-10 -z-10 hidden h-40 w-28 rounded-t-full bg-sun sm:block" />
      <div className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
            <ol className="flex flex-wrap items-center gap-2">
              {crumbs.map((c, i) => (
                <li key={c.href} className="flex items-center gap-2">
                  <Link href={c.href} className="hover:text-brand-800 hover:underline">{c.label}</Link>
                  {i < crumbs.length - 1 && <span aria-hidden>/</span>}
                </li>
              ))}
            </ol>
          </nav>
        )}
        {eyebrow && <div className="rise"><Eyebrow>{eyebrow}</Eyebrow></div>}
        <h1 className="display rise-2 mt-4 max-w-3xl text-4xl text-brand-950 sm:text-6xl">{title}</h1>
        {children && <div className="rise-3 mt-5 max-w-2xl text-lg leading-relaxed text-ink/80">{children}</div>}
      </div>
    </header>
  );
}

/** Intentional empty slot for a photograph the school has not supplied yet. Visible only to signed-in editors' preview via the page copy; here it is a calm brand panel, never stock imagery. */
export function PhotoSlot({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div role="img" aria-label={label} className={`relative flex items-end overflow-hidden bg-brand-700 ${className}`}>
      <div aria-hidden className="absolute -right-8 -top-8 size-40 rounded-full bg-brand-600" />
      <div aria-hidden className="absolute bottom-0 left-6 h-24 w-16 rounded-t-full bg-sun/90" />
      <div aria-hidden className="absolute bottom-0 left-28 h-14 w-10 rounded-t-full bg-brand-300/70" />
    </div>
  );
}

export function Prose({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`whitespace-pre-line text-lg leading-relaxed text-ink/85 ${className}`}>{children}</div>;
}
