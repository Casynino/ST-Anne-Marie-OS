import { useId, type ReactNode } from "react";
import { smoothPath } from "./path";

/*
 * Small, dependency-free pictures for the dashboards. Each one draws from numbers it is given (never invented), carries a text
 * alternative, and never relies on colour alone.
 */

const TONE = { ok: "text-ok", warn: "text-warn", bad: "text-bad", sun: "text-sun", link: "text-link", indigo: "text-[#8b80ff]", sky: "text-[#14a3b8]", white: "text-white/90", tint: "text-[color:var(--tf)]" } as const;
export type VizTone = keyof typeof TONE;

/** A tiny trend line with a soft fill, for the bottom of a headline number. */
export function Spark({ values, tone = "ok", summary }: { values: number[]; tone?: VizTone; summary?: string }) {
  const id = useId();
  if (values.length < 2) return null;
  const W = 160, H = 44, pad = 5;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo;
  const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * W, y: span === 0 ? H / 2 : pad + (1 - (v - lo) / span) * (H - pad * 2) }));
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`h-11 w-full ${TONE[tone]}`} role={summary ? "img" : undefined} aria-label={summary} aria-hidden={summary ? undefined : true}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".3" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A progress ring. `value` is a percentage; null draws an empty ring with a dash (nothing to measure yet). */
export function Ring({ value, size = 112, stroke = 10, tone = "ok", label, children }: { value: number | null; size?: number; stroke?: number; tone?: VizTone; label: string; children?: ReactNode }) {
  const r = 50 - stroke / 2, C = 2 * Math.PI * r;
  const dash = value === null ? 0 : (Math.max(0, Math.min(100, value)) / 100) * C;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className={`size-full -rotate-90 ${TONE[tone]}`} role="img" aria-label={value === null ? label : `${label}: ${Math.round(value)}%`}>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
        {value !== null && dash > 0 && <circle cx="50" cy="50" r={r} fill="none" strokeWidth={stroke} stroke="currentColor" strokeLinecap="round" strokeDasharray={`${dash} ${C - dash}`} />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children ?? <span className="text-xl font-semibold tabular-nums text-heading">{value === null ? "—" : `${Math.round(value)}%`}</span>}</div>
    </div>
  );
}

/** One bar cut into stages, with a legend that prints every count and share (the "where everything stands" picture). */
export function StageBar({ items, label, summary }: { items: { label: string; value: number; color: string }[]; label: string; summary: string }) {
  const total = items.reduce((n, i) => n + i.value, 0);
  return (
    <figure aria-label={label}>
      <div aria-hidden className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-line">
        {items.filter((i) => i.value > 0).map((i) => <div key={i.label} title={`${i.label}: ${i.value}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(i.value / (total || 1)) * 100}%`, background: i.color, minWidth: 6 }} />)}
      </div>
      <ul className="mt-4 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: i.color }} /><span className="truncate">{i.label}</span></span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">{i.value.toLocaleString()}<span className="ml-2 text-xs font-normal text-muted">{total ? `${Math.round((i.value / total) * 100)}%` : "0%"}</span></span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{summary} ({total})</figcaption>
    </figure>
  );
}

/** A row of figures with hairline dividers ("the business in detail"); it wraps on a narrow screen without leaving empty cells. */
export function MetricStrip({ items, label }: { items: { label: string; value: ReactNode; sub?: string; tone?: "ok" | "warn" | "bad" }[]; label: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]">
      <dl aria-label={label} className="-ml-px -mt-px flex flex-wrap">
        {items.map((i) => (
          <div key={i.label} className="min-w-[10.5rem] flex-1 basis-[10.5rem] border-l border-t border-line p-4">
            <dt className="text-xs text-muted">{i.label}</dt>
            <dd className={`mt-1 whitespace-nowrap text-xl font-semibold tabular-nums ${i.tone === "ok" ? "text-ok" : i.tone === "warn" ? "text-sun" : i.tone === "bad" ? "text-bad" : "text-heading"}`}>{i.value}</dd>
            {i.sub && <dd className="mt-0.5 text-xs text-muted">{i.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A coloured bar per row for rates (collection, attendance): green at the target, amber below, red far below. */
export function RateBars({ items, label, summary, good = 85, ok = 60, mode = "rate" }: { items: { label: string; value: number | null; note?: string }[]; label: string; summary: string; good?: number; ok?: number; mode?: "rate" | "fill" }) {
  return (
    <figure aria-label={label}>
      <ul className="space-y-3.5">
        {items.map((i) => {
          const c = i.value === null ? "var(--color-muted)" : mode === "fill" ? (i.value >= 100 ? "var(--color-bad)" : i.value >= 90 ? "var(--color-warn)" : "var(--color-ok)") : i.value >= good ? "var(--color-ok)" : i.value >= ok ? "var(--color-warn)" : "var(--color-bad)";
          return (
            <li key={i.label} title={`${i.label}: ${i.value === null ? "—" : `${i.value}%`}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate font-medium text-ink">{i.label}{i.note && <span className="ml-2 text-xs font-normal text-muted">{i.note}</span>}</span><span className="font-semibold tabular-nums text-ink">{i.value === null ? "—" : `${i.value}%`}</span></div>
              <div aria-hidden className="mt-1 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${Math.min(100, i.value ?? 0)}%`, background: c, minWidth: i.value ? 6 : 0 }} /></div>
            </li>
          );
        })}
      </ul>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
