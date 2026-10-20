"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";

function Word({ children, progress, range }: { children: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.22, 1]);
  return <span className="mr-[.26em] inline-block"><motion.span style={{ opacity }} className="inline-block">{children}</motion.span></span>;
}

/** A paragraph that lights up word by word as it scrolls through the screen (static for people who prefer reduced motion). */
export function ScrollWords({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.88", "end 0.45"] });
  const words = text.split(/\s+/).filter(Boolean);
  if (reduce) return <p className={className}>{text}</p>;
  return (
    <p ref={ref} className={className} aria-label={text}>
      <span aria-hidden>{words.map((w, i) => <Word key={i} progress={scrollYProgress} range={[i / words.length, Math.min(1, (i + 1.6) / words.length)]}>{w}</Word>)}</span>
    </p>
  );
}
