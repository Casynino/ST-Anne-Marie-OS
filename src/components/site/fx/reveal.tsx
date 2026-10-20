"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Tag = "div" | "li" | "ul" | "ol" | "section" | "article" | "figure" | "blockquote" | "span";

let observer: IntersectionObserver | undefined;
function getObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer?.unobserve(e.target);
        (e.target as HTMLElement).dataset.rv = "in";
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
  );
  return observer;
}

/**
 * Fades and lifts a block into view once. Only blocks that start BELOW the fold are hidden, and only after
 * hydration, so without JS, with reduced motion, or for anything already on screen the content is simply there.
 */
export function Reveal({ as: Tag = "div", delay = 0, className, children }: { as?: Tag; delay?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return; // already visible: never hide
    el.dataset.rv = "wait";
    const io = getObserver();
    io.observe(el);
    return () => io.unobserve(el);
  }, []);
  const Component = Tag as "div";
  return (
    <Component ref={ref as React.RefObject<HTMLDivElement>} className={className} style={{ "--d": delay } as CSSProperties}>
      {children}
    </Component>
  );
}
