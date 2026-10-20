"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Pause, Play } from "lucide-react";

export type Slide = { src: string; alt: string; width: number; height: number };

/**
 * The first screen: the school's own photographs fill it edge to edge, cross-fading with a slow drift, tinted deep green so
 * the type stays readable, and moving a little slower than the page (parallax). The content passed in sits on top and fades as
 * the visitor scrolls. A pause button is always there (people who dislike motion can stop it); with the system's
 * reduced-motion setting nothing moves at all.
 */
export function HeroStage({ slides, children, labels }: { slides: Slide[]; children: ReactNode; labels: { pause: string; play: string; of: string } }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "24%"]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, reduce ? 1 : 0]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || reduce || slides.length < 2) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % slides.length), 7500);
    return () => window.clearInterval(id);
  }, [playing, reduce, slides.length]);

  return (
    <section ref={ref} className="relative isolate min-h-[100svh] overflow-hidden bg-canvas">
      <motion.div style={{ y }} className="absolute inset-x-0 -top-[6%] -z-20 h-[112%]">
        {slides.map((s, n) => (
          <div key={s.src} aria-hidden={n !== i} className={`absolute inset-0 transition-opacity duration-[1800ms] ease-out ${n === i ? "opacity-100" : "opacity-0"}`}>
            <Image src={s.src} alt={n === i ? s.alt : ""} fill priority={n === 0} sizes="100vw" className={`object-cover saturate-[.85] ${n === i && !reduce ? "kb" : ""}`} />
          </div>
        ))}
      </motion.div>
      <div aria-hidden className="absolute inset-0 -z-10 bg-[#06150d]/55 mix-blend-multiply" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(7_16_11/.7)_0%,rgb(7_16_11/.15)_38%,rgb(7_16_11/.55)_70%,rgb(7_16_11/1)_100%)]" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgb(7_16_11/.8)_0%,rgb(7_16_11/.25)_55%,transparent_100%)]" />
      <div aria-hidden className="grain absolute inset-0 -z-10" />

      <motion.div style={{ opacity: fade }} className="relative z-10">{children}</motion.div>

      {slides.length > 1 && (
        <div className="absolute bottom-5 right-4 z-20 flex items-center gap-3 text-xs font-medium tabular-nums text-white/80 sm:bottom-8 sm:right-8">
          <span aria-live="off">{String(i + 1).padStart(2, "0")} <span className="text-white/40">{labels.of}</span> {String(slides.length).padStart(2, "0")}</span>
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? labels.pause : labels.play} className="glass inline-flex size-10 items-center justify-center rounded-full hover:bg-white/15">
            {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </button>
        </div>
      )}
    </section>
  );
}
