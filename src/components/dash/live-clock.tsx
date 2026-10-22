"use client";

import { useEffect, useState } from "react";

/** The time in one or two places, updated every half minute. Drawn after the page loads so the server and the browser never disagree. */
export function LiveClock({ zones }: { zones: { label: string; tz: string }[] }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) return <span className="h-4" aria-hidden />;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums text-white/80">
      {zones.map((z) => (
        <span key={z.tz}>{z.label} <strong className="font-semibold text-white">{new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: z.tz }).format(now)}</strong></span>
      ))}
    </span>
  );
}
