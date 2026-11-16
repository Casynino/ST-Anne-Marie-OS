"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Switches between the dark and light theme instantly and remembers the choice (cookie read by the server, so there is no flash). */
export function ThemeToggle({ initial, labels, onDark }: { initial: "dark" | "light"; labels: { toDark: string; toLight: string }; /** On the dark sidebar: light icon, soft white hover. */ onDark?: boolean }) {
  const [theme, setTheme] = useState(initial);
  useEffect(() => setTheme(initial), [initial]);
  const flip = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.querySelector("[data-theme-root]")?.classList.toggle("theme-night", next === "dark");
    document.cookie = `sam_theme=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  const label = theme === "dark" ? labels.toLight : labels.toDark;
  return (
    <button type="button" onClick={flip} aria-label={label} title={label} className={`inline-flex size-10 items-center justify-center rounded-lg ${onDark ? "text-brand-100 hover:bg-white/10 hover:text-white" : "text-muted hover:bg-canvas hover:text-ink"}`}>
      {theme === "dark" ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
