"use client";

import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Tag = "div" | "li" | "ul" | "ol" | "section" | "article" | "figure" | "blockquote" | "span" | "p";

let observer: IntersectionObserver | undefined;
function getObserver() {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        observer?.unobserve(e.target);
        const el = e.target as HTMLElement;
        el.dataset.rv = "in";
        // Once the entrance has played, drop the state so the element's own hover transitions are not delayed or overridden.
        window.setTimeout(() => { if (el.dataset.rv === "in") el.dataset.rv = "done"; }, 1000 + Number(el.style.getPropertyValue("--d") || 0));
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
