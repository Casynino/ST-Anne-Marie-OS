"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const KEY = "sam_site_theme";
const apply = (dark: boolean) => { document.documentElement.dataset.siteTheme = dark ? "dark" : "light"; };

/** Light is the public website's default; a visitor can switch to the calm dark version, and the choice is remembered in the browser. */
export function SiteThemeToggle({ labels }: { labels: { toDark: string; toLight: string } }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try { const d = localStorage.getItem(KEY) === "dark"; setDark(d); apply(d); } catch { /* storage unavailable: stay light */ }
  }, []);
  const flip = () => {
    const d = !dark;
    setDark(d);
    apply(d);
    try { localStorage.setItem(KEY, d ? "dark" : "light"); } catch { /* not remembered */ }
  };
  const label = dark ? labels.toLight : labels.toDark;
  return (
    <button type="button" onClick={flip} aria-label={label} title={label} className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:text-ink">
      {dark ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
