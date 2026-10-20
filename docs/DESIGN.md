# Design system

Decisions made with the `ui-ux-pro-max` design skill (searches for style, typography, colour, chart and UX rules) and checked in the browser on desktop, tablet and phone widths. Three looks, one per audience.

## 1. Public website: "paper and ink" (editorial)
- **Style:** editorial grid / magazine + Swiss modernism. Looks like a printed school prospectus, not an app template.
- **Type:** Crimson Pro (display and lead paragraphs, `.display`, `.lead`), Atkinson Hyperlegible (body; chosen for legibility on low-end phones). Loaded in `src/lib/fonts.ts`.
- **Colour:** warm paper `#f6f1e4`, near-black ink `#16211a`, the school green (`brand-*`, anchored on the emblem `#028051`) for accents, one yellow highlighter (`sun`). Tokens are re-declared on `.site-root` in `src/app/globals.css` (including square corners and no shadows), so every utility on the public pages follows them. Brand colours are still swappable in `@theme`.
- **Rules:** square corners, hairline rules instead of cards, numbered rows, no gradients, glows, waves, blobs, tilt cards or icon-in-circle tiles. Photographs are the school's own, shown as captioned "prints" (`Print` in `components/site/blocks.tsx`); with no photographs the page simply has none (hatched placeholder only where a slot is required). No stock images.
- **Page furniture:** masthead rule (`border-t-[3px]`), `PageHero` (title, lead, one print), `SectionHeading` (rule + title), `ButtonLink` (ink / sun / outline / ghost), `CtaBand` (ink closing band), `NewsCard` (article), ruled definition lists for contact data.
- **Motion:** short CSS entrance on the hero, scroll `Reveal` for blocks below the fold, the scroll-tilt portal device (`ContainerScroll`), a pulse on the "applications open" dot. All off under `prefers-reduced-motion`.
- **Width:** content up to 100rem, side padding 1rem / 1.5rem.

## 2. Staff area: data-dense dashboard, dark by default
- **Style:** data-dense dashboard. Fira Sans with tabular numbers (`.app-root`). Dark theme `.theme-night` (cookie `sam_theme`, toggle in the top bar and portal header) is a set of semantic tokens (`bg-surface`, `bg-canvas`, `text-ink`, `text-muted`, `border-line`, `text-link`, `text-heading`, `bg-tint`, `tone-*`), so a screen never hard-codes a colour.
- **Home screens are role-driven:** admin / head / accountant / registrar see the permission-gated school overview (`dashboard.ts`: hero with one plain sentence built from real numbers, jump chips, KPI cards, "needs attention" list with tabs, charts and tables); a teacher (class or subject, no school-wide student access) sees their own day (`teacher-home.ts`, `dashboard/teacher.tsx`): lessons today, registers to take, homework to mark, mark sheets, planning, classes, recent behaviour notes.
- **Charts:** dependency-free SVG, each with a legend, native hover values, and a hidden table with the same numbers. Colour is never the only signal.
- **Monitoring** (sign-ins, errors, jobs, backups) is not on the Overview; it lives at Settings → System health and Backups.
- **Width:** shell content up to 112rem.

## 3. Family portal (parents and students)
Same dark design system. Child page = hero (child's name, one sentence from real figures), four KPI cards (attendance, fees owed, latest report, homework), quick tiles, today's lessons, homework table, attendance donut with recent days, report cards table with PDF. A student sees the same page, greeted by name. Everything a family can read goes through `portal.ts`.

## Pre-delivery checklist (used for every screen)
Contrast ≥ 4.5:1 in light and dark; focus rings kept; touch targets ≥ 44 px; no horizontal scroll at 375 px; no emoji as icons and no sparkle icons; labelled icon buttons; reduced-motion respected; empty, loading and error states present; numbers formatted once (tabular); nothing invented (no made-up statistics, photos or text).
