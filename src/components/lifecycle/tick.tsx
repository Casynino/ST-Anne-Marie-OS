"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/*
 * Ticking applicants in a list for one bulk form. The ticks live in React state (not in the page's form fields), so they survive a refused
 * request: the form is reset after every submit and a refusal ("the class has 2 places but you ticked 3") must not make the person tick again.
 */

type Ticks = { ticked: ReadonlySet<string>; all: readonly string[]; toggle: (id: string) => void; setAll: (on: boolean) => void };
const Ctx = createContext<Ticks | null>(null);
const useTicks = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Tick components need a TickProvider");
  return c;
};

export function TickProvider({ all, children }: { all: readonly string[]; children: ReactNode }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const value = useMemo<Ticks>(() => ({
    ticked, all,
    toggle: (id) => setTicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    setAll: (on) => setTicked(on ? new Set(all) : new Set()),
  }), [ticked, all]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function TickBox({ id, label }: { id: string; label: string }) {
  const t = useTicks();
  return <input type="checkbox" aria-label={label} checked={t.ticked.has(id)} onChange={() => t.toggle(id)} className="mt-3 size-4 accent-brand-700" />;
}

export function TickAll({ label }: { label: string }) {
  const t = useTicks();
  return <input type="checkbox" aria-label={label} checked={t.all.length > 0 && t.ticked.size === t.all.length} onChange={(e) => t.setAll(e.target.checked)} className="size-4 accent-brand-700" />;
}

/** Put inside the bulk form: one hidden field per ticked applicant. */
export function TickFields({ name }: { name: string }) {
  const t = useTicks();
  return <>{[...t.ticked].map((id) => <input key={id} type="hidden" name={name} value={id} />)}</>;
}

/** `template` is the translated sentence with "{n}" where the number goes (a function cannot be passed from a server component). */
export function TickCount({ template, className = "" }: { template: string; className?: string }) {
  const t = useTicks();
  return <span className={`text-sm text-muted ${className}`} aria-live="polite">{template.replace("{n}", String(t.ticked.size))}</span>;
}
