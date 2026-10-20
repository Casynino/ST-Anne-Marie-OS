"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, CalendarCheck, CalendarClock, FileText, GraduationCap, HeartHandshake, MessageCircle, Wallet, type LucideIcon } from "lucide-react";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";

type Labels = Record<"reports" | "fees" | "attendance" | "homework" | "timetable" | "messages" | "today" | "portal" | "behaviour", string>;

const TILES: { key: keyof Labels; icon: LucideIcon; tone: string }[] = [
  { key: "homework", icon: BookOpen, tone: "bg-[#fbf3c4] text-[#6b5c00]" },
  { key: "timetable", icon: CalendarClock, tone: "bg-[#dff3fb] text-[#0b4f66]" },
  { key: "reports", icon: FileText, tone: "bg-[#e6e4fb] text-[#27258f]" },
  { key: "fees", icon: Wallet, tone: "bg-[#fde7e4] text-[#8a2c1f]" },
  { key: "attendance", icon: CalendarCheck, tone: "bg-[#dcf4e4] text-[#145232]" },
  { key: "messages", icon: MessageCircle, tone: "bg-[#fdebd6] text-[#8a4b0f]" },
];

/**
 * The family portal as a screen: labels and shapes only (no names, marks or amounts), so it can never be mistaken for real records.
 * It lives inside the scroll-tilt device frame.
 */
function PortalScreen({ labels }: { labels: Labels }) {
  return (
    <div aria-hidden className="flex h-full w-full overflow-hidden rounded-xl bg-[#f3f6f4] text-[#10231a] md:rounded-2xl">
      <div className="hidden w-14 shrink-0 flex-col items-center gap-4 bg-brand-950 py-5 text-brand-200 sm:flex">
        <GraduationCap className="size-5 text-sun" />
        {[BookOpen, CalendarClock, FileText, Wallet, HeartHandshake].map((I, i) => <I key={i} className={`size-5 ${i === 0 ? "text-white" : "opacity-60"}`} />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="tex-arches relative bg-brand-700 px-5 py-5 text-left text-white md:px-8 md:py-7">
          <p className="text-[11px] font-bold uppercase tracking-[.16em] text-brand-200">{labels.portal}</p>
          <p className="display mt-1 text-2xl md:text-3xl">{labels.today}</p>
        </div>
        <ul className="grid grid-cols-2 gap-2.5 p-3 md:grid-cols-3 md:gap-4 md:p-6">
          {TILES.map((t) => (
            <li key={t.key} className={`flex min-h-24 flex-col justify-between rounded-2xl p-3 text-left md:min-h-32 md:p-5 ${t.tone}`}>
              <span className="grid size-9 place-items-center rounded-xl bg-white/70 md:size-11"><t.icon className="size-5 md:size-6" /></span>
              <span>
                <span className="block text-sm font-bold leading-tight md:text-base">{labels[t.key]}</span>
                <span className="mt-2 block h-1.5 w-2/3 rounded-full bg-current opacity-20" />
              </span>
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
        <div className="px-2 text-white">
          <p className="eyebrow eyebrow-light justify-center">{eyebrow}</p>
          <h2 className="display mx-auto mt-4 max-w-3xl text-4xl sm:text-6xl">{title}</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-brand-100">{body}</p>
          <ul className="mt-6 flex flex-wrap justify-center gap-2">
            {features.map((f) => <li key={f} className="rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-sm font-semibold text-brand-50">{f}</li>)}
          </ul>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href={primary.href} className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-sun px-6 text-base font-semibold text-brand-950 hover:bg-sun-600"><GraduationCap className="size-5" aria-hidden />{primary.label}<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden /></Link>
            <Link href={secondary.href} className="inline-flex min-h-12 items-center justify-center rounded-full border-2 border-white/40 px-6 text-base font-semibold text-white hover:bg-white hover:text-brand-900">{secondary.label}</Link>
          </div>
        </div>
      }
    >
      <PortalScreen labels={labels} />
    </ContainerScroll>
  );
}
