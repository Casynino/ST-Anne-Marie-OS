"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CalendarCheck, CalendarClock, FileText, MessageCircle, Wallet, type LucideIcon } from "lucide-react";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";

type Labels = Record<"reports" | "fees" | "attendance" | "homework" | "timetable" | "messages" | "today" | "portal" | "behaviour", string>;

const KPIS: { key: keyof Labels; icon: LucideIcon }[] = [
  { key: "attendance", icon: CalendarCheck },
  { key: "fees", icon: Wallet },
  { key: "reports", icon: FileText },
  { key: "homework", icon: BookOpen },
];
const TILES: { key: keyof Labels; icon: LucideIcon; bg: string; fg: string }[] = [
  { key: "homework", icon: BookOpen, bg: "#2a2814", fg: "#f1d676" },
  { key: "timetable", icon: CalendarClock, bg: "#122730", fg: "#8fd8f5" },
  { key: "messages", icon: MessageCircle, bg: "#2a1a1c", fg: "#ffa89b" },
];

/**
 * The family portal as a screen: labels and shapes only (no names, marks or amounts), so it can never be mistaken for real records.
 * It mirrors the real portal's dark layout and lives inside the scroll-tilt device frame.
 */
function PortalScreen({ labels }: { labels: Labels }) {
  return (
    <div aria-hidden className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-[#09100c] text-left text-[#e8f0ea] md:rounded-2xl">
      <div className="flex items-center gap-3 border-b border-[#22302a] bg-[#121b16] px-4 py-3 md:px-6">
        <span className="grid size-7 place-items-center rounded-md bg-[#0f9462] text-[10px] font-bold text-white">SAM</span>
        <span className="text-xs font-semibold md:text-sm">{labels.portal}</span>
        <span className="ml-auto flex gap-1.5"><span className="h-2 w-10 rounded-full bg-[#22302a]" /><span className="h-2 w-6 rounded-full bg-[#22302a]" /></span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-3 md:space-y-4 md:p-6">
        <div className="relative overflow-hidden rounded-xl border border-[#22302a] bg-[#121b16] px-4 py-4 md:px-7 md:py-6">
          <span className="absolute inset-y-0 right-0 w-1/2 bg-[linear-gradient(90deg,#121b16,#1d3a2d)] opacity-80" />
          <p className="relative text-[10px] font-bold uppercase tracking-[.2em] text-[#e8dc2e]">{labels.today}</p>
          <span className="relative mt-3 block h-3 w-2/5 rounded-full bg-[#e8f0ea]/80 md:h-4" />
          <span className="relative mt-2 block h-2 w-3/5 rounded-full bg-[#93a79b]/60" />
        </div>
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
          {KPIS.map((k) => (
            <li key={k.key} className="rounded-xl border border-[#22302a] bg-[#121b16] p-3 md:p-4">
              <span className="flex items-center justify-between gap-2"><span className="text-[9px] font-bold uppercase tracking-[.14em] text-[#93a79b] md:text-[10px]">{labels[k.key]}</span><k.icon className="size-4 text-[#6fd9a8]" /></span>
              <span className="mt-3 block h-4 w-1/2 rounded bg-[#e8f0ea]/85 md:h-6" />
              <span className="mt-2 block h-1.5 w-2/3 rounded-full bg-[#22302a]" />
            </li>
          ))}
        </ul>
        <ul className="hidden grid-cols-3 gap-3 sm:grid">
          {TILES.map((t) => (
            <li key={t.key} className="flex min-h-20 flex-col justify-between rounded-xl p-4 md:min-h-24" style={{ background: t.bg, color: t.fg }}>
              <t.icon className="size-5" />
              <span className="text-sm font-bold">{labels[t.key]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function PortalShowcase({ eyebrow, title, body, features, primary, secondary, labels }: { eyebrow: string; title: string; body: string; features: string[]; primary: { href: string; label: string }; secondary: { href: string; label: string }; labels: Labels }) {
  return (
    <ContainerScroll
      titleComponent={
        <div className="px-2 text-cream">
          <p className="eyebrow eyebrow-light justify-center">{eyebrow}</p>
          <h2 className="display mx-auto mt-5 max-w-3xl text-[2.6rem] text-cream sm:text-7xl">{title}</h2>
          <p className="lead mx-auto mt-6 max-w-2xl text-cream/75">{body}</p>
          <ul className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-1 text-sm font-semibold uppercase tracking-[.12em] text-cream/80">
            {features.map((f) => <li key={f} className="after:ml-5 after:text-cream/30 after:content-['/'] last:after:hidden">{f}</li>)}
          </ul>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={primary.href} className="group inline-flex min-h-12 items-center justify-center gap-2.5 bg-sun px-6 text-base font-semibold text-ink hover:bg-sun-600">{primary.label}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></Link>
            <Link href={secondary.href} className="inline-flex min-h-12 items-center justify-center border border-cream/50 px-6 text-base font-semibold text-cream hover:bg-cream hover:text-ink">{secondary.label}</Link>
          </div>
        </div>
      }
    >
      <PortalScreen labels={labels} />
    </ContainerScroll>
  );
}
