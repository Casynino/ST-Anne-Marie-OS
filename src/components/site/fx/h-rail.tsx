"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import type { SiteImage } from "@/server/website";

const OFFSET = ["mt-0", "mt-16", "mt-6", "mt-24", "mt-10", "mt-20"];
const SIZE = ["h-[52vh]", "h-[44vh]", "h-[56vh]", "h-[40vh]", "h-[50vh]", "h-[46vh]"];

function Card({ g, i, mobile }: { g: SiteImage; i: number; mobile?: boolean }) {
  const portrait = g.height >= g.width;
  return (
    <figure className={mobile ? "w-[78vw] shrink-0 snap-center" : `shrink-0 ${OFFSET[i % OFFSET.length]}`}>
      <div className={`frame overflow-hidden rounded-[1.5rem] ring-1 ring-white/10 ${mobile ? "aspect-[4/5]" : `${SIZE[i % SIZE.length]} ${portrait ? "aspect-[4/5]" : "aspect-[4/3]"}`}`}>
        <Image src={g.src} alt={g.alt} width={g.width} height={g.height} sizes={mobile ? "78vw" : "40vw"} loading="lazy" className="size-full object-cover" />
      </div>
      <figcaption className="mt-3 flex max-w-xs gap-3 text-sm text-muted"><span className="font-medium tabular-nums text-sun">{String(i + 1).padStart(2, "0")}</span><span className="line-clamp-2">{g.alt}</span></figcaption>
    </figure>
  );
}

/**
 * The school's photographs on a rail that travels sideways as the page scrolls down (the page pins while it moves). On phones,
 * and for people who prefer reduced motion, it is an ordinary swipeable strip instead.
 */
export function HRail({ items, intro }: { items: SiteImage[]; intro: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [dist, setDist] = useState(0);
  const { scrollYProgress } = useScroll({ target: outer, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0, 1], [0, -dist]);

  useEffect(() => {
    const measure = () => setDist(Math.max(0, (track.current?.scrollWidth ?? 0) - window.innerWidth));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [items.length]);

  const strip = (
    <div className="flex snap-x gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:px-8 [&::-webkit-scrollbar]:hidden">
      {items.map((g, i) => <Card key={g.src} g={g} i={i} mobile />)}
    </div>
  );
  return (
    <>
      <div className="lg:hidden"><div className="mx-auto max-w-[100rem] px-4 pb-10 sm:px-8">{intro}</div>{strip}</div>
      <div className="hidden lg:block">
        {reduce ? (
          <><div className="mx-auto max-w-[100rem] px-8 pb-10">{intro}</div>{strip}</>
        ) : (
          <div ref={outer} style={{ height: `calc(100vh + ${dist}px)` }} className="relative">
            <div className="sticky top-0 flex h-screen items-center overflow-hidden">
              <motion.div ref={track} style={{ x }} className="flex items-start gap-10 pl-[max(2rem,calc((100vw-100rem)/2+2rem))] pr-[20vw]">
                <div className="w-[min(34rem,38vw)] shrink-0 self-center pr-6">{intro}</div>
                {items.map((g, i) => <Card key={g.src} g={g} i={i} />)}
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
