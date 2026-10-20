"use client";

import { useEffect, useState } from "react";

const fmt = (tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());

/** The time at the school right now (real, from the visitor's clock converted to the school's time zone). */
export function LocalTime({ timezone, initial }: { timezone: string; initial: string }) {
  const [t, setT] = useState(initial);
  useEffect(() => {
    const tick = () => setT(fmt(timezone));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [timezone]);
  return <span suppressHydrationWarning className="tabular-nums">{t}</span>;
}
