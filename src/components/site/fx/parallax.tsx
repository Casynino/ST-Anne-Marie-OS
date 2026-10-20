"use client";

import { LazyMotion, domAnimation, m, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

/** Moves its content a little slower/faster than the page while it crosses the viewport. */
export function Parallax({ children, distance = 40, className }: { children: ReactNode; distance?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <LazyMotion features={domAnimation} strict>
      <div ref={ref} className={className}>
        <m.div style={{ y }}>{children}</m.div>
      </div>
    </LazyMotion>
  );
}
