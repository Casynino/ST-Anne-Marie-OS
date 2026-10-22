import { monthGrid } from "@/lib/calendar-grid";

/**
 * A small month on a deep-blue card: today is filled, days with something on them carry a dot (yellow = the first list, white = the second),
 * so the date of the next interview is visible at a glance. Draws from dates it is given; nothing is invented.
 */
export function MonthCard({ today, locale, events = [], marked = [], className = "", label, eventsLabel, markedLabel }: { today: string; locale: "EN" | "SW"; events?: string[]; marked?: string[]; className?: string; label: string; eventsLabel?: string; markedLabel?: string }) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const tag = locale === "SW" ? "sw-TZ" : "en-GB";
  const title = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const dow = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(tag, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 1 + i))).slice(0, 2));
  const ev = new Set(events), iv = new Set(marked);
  return (
    <section aria-label={label} className={`min-w-0 rounded-2xl bg-gradient-to-br from-[#2a3590] to-[#4455c4] p-5 text-white shadow-[var(--shadow-card)] ${className}`}>
      <h3 className="text-center text-[15px] font-semibold capitalize">{title}</h3>
      <div role="grid" aria-label={title} className="mt-3">
        <div role="row" className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-[#ffb35c]">{dow.map((d, i) => <span key={i} role="columnheader">{d}</span>)}</div>
        {monthGrid(y, m).map((week, wi) => (
          <div key={wi} role="row" className="mt-1 grid grid-cols-7 text-center text-[13px] tabular-nums">
            {week.map((c) => (
              <span key={c.date} role="gridcell" aria-current={c.date === today ? "date" : undefined} className={`relative mx-auto grid size-8 place-items-center rounded-lg ${c.inMonth ? "" : "text-white/35"} ${c.date === today ? "bg-white font-semibold text-[#2a3590]" : ""}`}>
                {c.day}
                {(ev.has(c.date) || iv.has(c.date)) && (
                  <span aria-hidden className="absolute bottom-0.5 flex gap-0.5">
                    {ev.has(c.date) && <span className="size-1 rounded-full bg-[#ffb35c]" />}
                    {iv.has(c.date) && <span className={`size-1 rounded-full ${c.date === today ? "bg-[#2a3590]" : "bg-white"}`} />}
                  </span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
      {(eventsLabel || markedLabel) && (
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-white/85">
          {eventsLabel && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-[#ffb35c]" />{eventsLabel}</span>}
          {markedLabel && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-1.5 rounded-full bg-white" />{markedLabel}</span>}
        </p>
      )}
    </section>
  );
}
