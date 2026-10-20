# Design system

Decisions made with the `ui-ux-pro-max` design skill (searches for style, typography, colour, chart and UX rules) and checked in the browser on desktop, tablet and phone widths. Three looks, one per audience.

## 1. Public website: "night campus" (cinematic)
- **Why:** Nino's other premium sites (Vegas Luxury Hotel, Reckless, Target Express) are dark, cinematic, photo-led and animated; the first public design looked like a generic template and the second ("paper and ink", pale and sparse) was rejected. This one follows his own taste, in the school's colours.
- **Style:** immersive / cinematic: near-black green canvas, full-screen photography, glass panels, one bright accent (the school's yellow `sun`), the school green as a glow. Sections can change tone: default night, `.site-deep` (deep green) and `.site-paper` (warm paper, used for admissions so the page has rhythm). The tokens are semantic (`bg-canvas`, `bg-surface`, `text-ink`, `text-heading`, `text-muted`, `border-line`, `text-link`, `bg-tint`) and re-declared on `.site-root` / `.site-paper` / `.site-deep` in `globals.css`; never hard-code colours on a public page.
- **Type:** Cormorant Garamond (display, `.display`, italic gold second line of the hero) + Inter (text), `src/lib/fonts.ts`.
- **Motion (framer-motion + CSS, all off under `prefers-reduced-motion`):** `HeroStage` (full-screen photo slideshow with slow drift, green tint, parallax, content fades on scroll, pause button), word-by-word headline reveal (`WordReveal`), ticker (`Marquee`), scroll-lit statement (`ScrollWords`), parallax photo pairs (`Parallax`), pinned horizontal photo rail (`HRail`; swipeable strip on phones), pointer spotlight on programme cards (`SpotCard`), counters (`CountUp`), live school time (`LocalTime`), scroll reveals (`Reveal`), line draw on steps, the scroll-tilt portal device (`ContainerScroll`, shows the dark portal). Header is fixed, transparent over the hero and glass once scrolled, with a full-screen numbered menu on phones.
- **Content rules:** photographs are the school's own only (no stock); with none the photo areas are simply absent. Every number and sentence comes from the school's records (`school_settings.website`, levels, classes, news, events). The school's photos are 640 px wide, so full-screen use is softened by the green tint and grain; supply originals for the best result.
- **Inner pages:** `PageHero` (photo header with word-reveal title), `SectionHeading`, `CtaBand`, rounded dark cards, pill buttons (`ButtonLink`: sun / primary / ghost / outline / soft). Width up to 100rem.

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
