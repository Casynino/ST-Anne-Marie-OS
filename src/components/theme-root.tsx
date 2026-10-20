import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { fira } from "@/lib/fonts";

export const THEME_COOKIE = "sam_theme";
export type Theme = "dark" | "light";

/** Dark is the default for the staff area and the family portal; a visitor's choice is remembered in a cookie so it is right on first paint. */
export async function getTheme(): Promise<Theme> {
  return (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
}

/** Wraps a signed-in area: sets the typeface and the colour theme for everything inside. */
export async function ThemeRoot({ children, className = "" }: { children: ReactNode; className?: string }) {
  const theme = await getTheme();
  return (
    <div data-theme-root className={`app-root ${fira.variable} ${theme === "dark" ? "theme-night" : ""} bg-canvas text-ink ${className}`}>
      {children}
    </div>
  );
}
