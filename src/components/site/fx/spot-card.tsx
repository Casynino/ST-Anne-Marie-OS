"use client";

import type { ReactNode } from "react";

/** A card with a soft light that follows the pointer (the glow is set through two CSS variables; nothing re-renders). */
export function SpotCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`spot ${className}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
    >
      {children}
    </div>
  );
}
