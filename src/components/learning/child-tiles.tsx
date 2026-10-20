import Link from "next/link";
import { CalendarClock, ClipboardList, FolderOpen, HeartHandshake, Wallet, type LucideIcon } from "lucide-react";

type Tile = { key: string; href: string; label: string; hint?: string; badge?: number };
const STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  timetable: { icon: CalendarClock, tone: "tone tone-sky" },
  homework: { icon: ClipboardList, tone: "tone tone-butter" },
  portfolio: { icon: FolderOpen, tone: "tone tone-blush" },
  behaviour: { icon: HeartHandshake, tone: "tone tone-mint" },
  fees: { icon: Wallet, tone: "tone tone-lav" },
};

/** Colour-coded quick links on a child's page: large touch targets, one idea per tile. */
export function ChildTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <ul className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => {
        const s = STYLE[t.key]!;
        return (
          <li key={t.key}>
            <Link href={t.href} className={`group relative flex min-h-28 flex-col justify-between overflow-hidden rounded-3xl p-4 transition-transform duration-200 hover:-translate-y-1 ${s.tone}`}>
              <span className="flex size-11 items-center justify-center rounded-2xl bg-surface/70"><s.icon className="size-6" aria-hidden /></span>
              <span><span className="block text-base font-bold leading-tight">{t.label}</span>{t.hint && <span className="mt-0.5 block text-xs opacity-75">{t.hint}</span>}</span>
              {!!t.badge && <span className="absolute right-3 top-3 grid min-w-6 place-items-center rounded-full bg-surface px-1.5 text-xs font-bold">{t.badge}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
