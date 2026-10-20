"use client";

import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";

/** Moves its content vertically a little as it crosses the screen, so layers drift at different speeds. */
export function Parallax({ children, from = 50, to = -50, className = "" }: { children: ReactNode; from?: number; to?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [from, to]);
  return <div ref={ref} className={className}><motion.div style={{ y }}>{children}</motion.div></div>;
}
