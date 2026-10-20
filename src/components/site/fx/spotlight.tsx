"use client";

import type { CSSProperties, ReactNode } from "react";

/** Card whose highlight follows the cursor (fine pointers only; touch devices just see the plain card). */
export function Spotlight({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "article" | "li" | "a" }) {
  const Component = Tag as "div";
  return (
    <Component
      className={`spot ${className}`}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
      }}
      style={{ "--mx": "50%", "--my": "50%" } as CSSProperties}
    >
      {children}
    </Component>
  );
}
