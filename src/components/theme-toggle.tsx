"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Switches between the dark and light theme instantly and remembers the choice (cookie read by the server, so there is no flash). */
export function ThemeToggle({ initial, labels }: { initial: "dark" | "light"; labels: { toDark: string; toLight: string } }) {
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
    <button type="button" onClick={flip} aria-label={label} title={label} className="inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink">
      {theme === "dark" ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
