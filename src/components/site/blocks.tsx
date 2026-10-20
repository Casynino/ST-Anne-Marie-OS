import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Reveal } from "@/components/site/fx/reveal";
import { Photo } from "@/components/site/photo";
import { getSite } from "@/lib/site";

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

/** Curved edge between two sections: the fill colour is the colour of the section BELOW (set with a text-* class). */
export function Wave({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1440 90" preserveAspectRatio="none" className={`block h-8 w-full sm:h-14 lg:h-[4.5rem] ${className}`}>
      <path fill="currentColor" d="M0 90V46C180 8 360 0 560 22s420 56 640 34c90-9 170-26 240-46v80z" />
    </svg>
  );
}

/** Layered dark-green backdrop used by every hero: soft moving light, an arch pattern and film grain. Pure CSS. */
export function HeroBackdrop({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`mesh-hero absolute inset-0 -z-10 overflow-hidden ${className}`}>
      <span className="glow glow-a -left-[12%] -top-[28%] size-[34rem] sm:size-[46rem]" />
      <span className="glow glow-b -right-[10%] top-[6%] size-[26rem] sm:size-[34rem]" />
      <span className="glow glow-c -bottom-[34%] right-[22%] size-[30rem] sm:size-[40rem]" />
      <div className="tex-arches absolute inset-0" />
      <div className="tex-grain absolute inset-0" />
    </div>
  );
}

/** Headline whose words rise into place one after another (CSS only; plain text for assistive technology and without motion). */
export function RiseWords({ text, className = "", offset = 0 }: { text: string; className?: string; offset?: number }) {
  return (
    <span className={className}>
      {text.split(/\s+/).map((w, i, all) => (
        <span key={i}>
          <span className="hw"><span style={{ "--i": i + offset } as React.CSSProperties}>{w}</span></span>
          {i < all.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

const hashOf = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Inner-page header: deep green, moving light, breadcrumb, large display title and lead, with one of the school's own
 * photographs in an arch on larger screens (a different one per page). No photograph is shown if the school has none.
 */
export async function PageHero({ eyebrow, title, children, crumbs, photo = true }: { eyebrow?: string; title: string; children?: ReactNode; crumbs?: { href: string; label: string }[]; photo?: boolean }) {
  const gallery = photo ? ((await getSite())?.images.gallery ?? []) : [];
  const pic = gallery.length ? gallery[hashOf(title) % gallery.length] : undefined;
  return (
    <header className="relative isolate overflow-hidden text-white">
      <HeroBackdrop />
      <div className={`mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pb-32 sm:pt-16 ${pic ? "grid items-center gap-10 md:grid-cols-[1.25fr_0.75fr]" : ""}`}>
        <div>
          {crumbs && (
            <nav aria-label="Breadcrumb" className="mb-6 text-sm text-brand-200">
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
          {eyebrow && <div className="rise"><Eyebrow light>{eyebrow}</Eyebrow></div>}
          <h1 className="display mt-4 max-w-3xl text-4xl text-white sm:text-6xl"><RiseWords text={title} /></h1>
          {children && <div className="rise-3 mt-5 max-w-2xl text-lg leading-relaxed text-brand-100">{children}</div>}
        </div>
        {pic && (
          <div className="relative hidden aspect-[4/5] w-full max-w-xs justify-self-end md:block">
            <svg aria-hidden viewBox="0 0 100 100" className="spin-slow absolute -left-8 -top-8 size-44 text-sun/70"><circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 5" /></svg>
            <div aria-hidden className="float-b absolute -bottom-4 -left-6 h-28 w-20 rounded-t-full bg-sun" />
            <div className="frame frame-arch float-a relative size-full shadow-[0_30px_60px_-24px_rgb(0_0_0/.6)]"><Photo image={pic} sizes="(min-width: 768px) 24vw, 0px" /></div>
          </div>
        )}
      </div>
      <Wave className="absolute inset-x-0 bottom-0 text-cream" />
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
