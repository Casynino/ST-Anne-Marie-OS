import { BookOpen, CalendarCheck, CalendarDays, FileText, MessageCircle, Wallet, type LucideIcon } from "lucide-react";

const CARDS: { key: string; icon: LucideIcon; tone: string }[] = [
  { key: "reports", icon: FileText, tone: "bg-[#dff3fb] text-[#0b5f7a]" },
  { key: "fees", icon: Wallet, tone: "bg-[#fde7e4] text-[#9c3324]" },
  { key: "attendance", icon: CalendarCheck, tone: "bg-[#dcf4e4] text-[#16603a]" },
  { key: "homework", icon: BookOpen, tone: "bg-[#fbf3c4] text-[#7a6a00]" },
  { key: "messages", icon: MessageCircle, tone: "bg-[#e6e4fb] text-[#2c2aac]" },
];

/**
 * An illustration of the family portal on a phone. It shows what the portal contains (labels only): no names, marks or
 * amounts, so nothing here can be mistaken for real records.
 */
export function PhoneMock({ title, labels, className = "" }: { title: string; labels: Record<string, string>; className?: string }) {
  return (
    <div aria-hidden className={`relative mx-auto w-[16.5rem] rounded-[2.6rem] border-[9px] border-brand-950 bg-white shadow-[0_40px_80px_-30px_rgb(0_0_0/.7)] ${className}`}>
      <div className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-brand-950" />
      <div className="overflow-hidden rounded-[2rem]">
        <div className="relative bg-brand-700 px-5 pb-6 pt-9 text-white">
          <div className="tex-arches absolute inset-0" />
          <p className="relative text-xs font-semibold uppercase tracking-widest text-brand-200">{title}</p>
          <p className="display relative mt-1 text-xl">{labels.today}</p>
        </div>
        <ul className="-mt-3 space-y-2.5 rounded-t-3xl bg-white px-3.5 pb-5 pt-4">
          {CARDS.map((c, i) => (
            <li key={c.key} className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${c.tone}`} style={{ opacity: 1 - i * 0.04 }}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/70"><c.icon className="size-[1.1rem]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold leading-tight">{labels[c.key]}</span>
                <span className="mt-1.5 block h-1.5 w-2/3 rounded-full bg-current opacity-20" />
              </span>
              <CalendarDays className="size-4 opacity-0" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
