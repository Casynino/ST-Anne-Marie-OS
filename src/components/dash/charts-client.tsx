"use client";

import { useId, useState, type PointerEvent } from "react";
import { formatMoney } from "@/lib/finance/money";
import { niceTop, smoothPath } from "./path";

/*
 * The two interactive charts of the dashboards: a smooth area (one measure over time) and bars with a line (a measure and its trend).
 * Hover or touch a day to see its numbers; a period switch shows 7, 14 or 30 days. Every number also sits in a hidden table, so nothing
 * depends on the pointer. Values arrive as plain numbers (money in cents) because a server page cannot pass functions to a client chart.
 */

type Kind = "percent" | "money" | "count";
type Tone = "ok" | "sun" | "indigo" | "sky";
const TONE: Record<Tone, string> = { ok: "text-ok", sun: "text-sun", indigo: "text-[#8b80ff]", sky: "text-[#14a3b8]" };
export type Period = { label: string; count: number };

const compact = (n: number) => (Math.abs(n) >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 10) / 10));
function fmt(v: number, kind: Kind, currency: string, short = false) {
  if (kind === "percent") return `${Math.round(v * 10) / 10}%`;
  if (kind === "money") return short ? compact(v / 100) : formatMoney(Math.round(v), currency);
  return short ? compact(v) : Math.round(v).toLocaleString();
}

function Periods({ periods, value, onChange, label }: { periods: Period[]; value: number; onChange: (i: number) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-canvas p-1 text-xs font-semibold">
      {periods.map((p, i) => <button key={p.label} type="button" aria-pressed={i === value} onClick={() => onChange(i)} className={`min-h-8 rounded-md px-3 transition-colors ${i === value ? "bg-surface text-heading shadow-sm" : "text-muted hover:text-ink"}`}>{p.label}</button>)}
    </div>
  );
}

const W = 800, L = 46, R = 14, T = 14, B = 30;

type Frame = { n: number; x: (i: number) => number; y: (v: number) => number; ticks: number[]; H: number };
function frame(n: number, top: number, bottom: number, height: number): Frame {
  const H = height;
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - bottom) / (top - bottom || 1)) * (H - T - B);
  return { n, x, y, ticks: [0, 1, 2, 3, 4].map((i) => bottom + ((top - bottom) / 4) * i), H };
}

function Grid({ fr, kind, currency, xs, every }: { fr: Frame; kind: Kind; currency: string; xs: string[]; every: number }) {
  return (
    <>
      {fr.ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={fr.y(t)} y2={fr.y(t)} className="stroke-line" strokeDasharray={t === fr.ticks[0] ? undefined : "3 5"} /><text x={L - 8} y={fr.y(t) + 3.5} textAnchor="end" className="fill-muted text-[11px]">{fmt(t, kind, currency, true)}</text></g>)}
      {xs.map((l, i) => (i % every === (xs.length - 1) % every ? <text key={i} x={fr.x(i)} y={fr.H - 9} textAnchor="middle" className="fill-muted text-[11px]">{l}</text> : null))}
    </>
  );
}

function useHover(n: number) {
  const [hover, setHover] = useState<number | null>(null);
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((rel - L) / (W - L - R)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return { hover, onMove, onLeave: () => setHover(null) };
}

const Tip = ({ left, children }: { left: number; children: React.ReactNode }) => (
  <div className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.max(9, Math.min(91, left))}%` }}>{children}</div>
);

/** One measure over time as a smooth area. */
export function AreaChart({ points, periods, periodLabel = "Period", kind = "count", currency = "TZS", yMin, yMax, tone = "ok", label, summary, height = 260, goal }: {
  points: { key: string; label: string; value: number }[]; periods?: Period[]; periodLabel?: string; kind?: Kind; currency?: string; yMin?: number; yMax?: number; tone?: Tone; label: string; summary: string; height?: number; goal?: { value: number; label: string };
}) {
  const id = useId();
  const [p, setP] = useState(periods ? periods.length - 1 : 0);
  const shown = periods ? points.slice(-periods[p]!.count) : points;
  const n = shown.length;
  const { hover, onMove, onLeave } = useHover(n);
  const values = shown.map((s) => s.value);
  const bottom = yMin ?? 0;
  const top = yMax ?? niceTop(Math.max(1, ...values));
  const fr = frame(n, top, bottom, height);
  const pts = shown.map((s, i) => ({ x: fr.x(i), y: fr.y(s.value) }));
  const line = smoothPath(pts);
  const at = hover ?? n - 1;
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <figure>
      {periods && periods.length > 1 && <div className="mb-3 flex justify-end"><Periods periods={periods} value={p} onChange={setP} label={periodLabel} /></div>}
      <div className="relative touch-pan-y" onPointerMove={onMove} onPointerLeave={onLeave}>
        <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className={`h-auto w-full ${TONE[tone]}`}>
          <desc>{summary}</desc>
          <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".32" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
          <Grid fr={fr} kind={kind} currency={currency} xs={shown.map((s) => s.label)} every={every} />
          {goal && goal.value >= bottom && goal.value <= top && <g><line x1={L} x2={W - R} y1={fr.y(goal.value)} y2={fr.y(goal.value)} className="stroke-warn" strokeDasharray="6 5" strokeWidth="1.2" /><text x={W - R} y={fr.y(goal.value) - 5} textAnchor="end" className="fill-warn text-[11px]">{goal.label}</text></g>}
          {n > 1 && <path d={`${line} L${fr.x(n - 1)} ${fr.y(bottom)} L${fr.x(0)} ${fr.y(bottom)} Z`} fill={`url(#${id})`} />}
          <path d={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {n > 0 && <g>{hover !== null && <line x1={fr.x(at)} x2={fr.x(at)} y1={T} y2={fr.y(bottom)} className="stroke-muted" strokeDasharray="4 4" />}<circle cx={fr.x(at)} cy={fr.y(shown[at]!.value)} r="5" fill="var(--color-surface)" stroke="currentColor" strokeWidth="2.5" /></g>}
        </svg>
        {hover !== null && shown[hover] && <Tip left={(fr.x(hover) / W) * 100}><p className="text-muted">{shown[hover]!.label}</p><p className="mt-0.5 text-base font-semibold tabular-nums text-heading">{fmt(shown[hover]!.value, kind, currency)}</p></Tip>}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only"><caption>{label}</caption><tbody>{shown.map((s) => <tr key={s.key}><th scope="row">{s.label}</th><td>{fmt(s.value, kind, currency)}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** A measure as bars with its own trend as a line over them (for example daily takings and their weekly average). */
export function BarLineChart({ points, periods, periodLabel = "Period", kind = "money", currency = "TZS", barLabel, lineLabel, label, summary, height = 280 }: {
  points: { key: string; label: string; bar: number; line: number }[]; periods?: Period[]; periodLabel?: string; kind?: Kind; currency?: string; barLabel: string; lineLabel: string; label: string; summary: string; height?: number;
}) {
  const [p, setP] = useState(periods ? periods.length - 1 : 0);
  const shown = periods ? points.slice(-periods[p]!.count) : points;
  const n = shown.length;
  const { hover, onMove, onLeave } = useHover(n);
  const top = niceTop(Math.max(1, ...shown.map((s) => Math.max(s.bar, s.line))));
  const fr = frame(n, top, 0, height);
  const slot = (W - L - R) / Math.max(1, n);
  const bw = Math.min(26, slot * 0.58);
  const line = smoothPath(shown.map((s, i) => ({ x: fr.x(i) + (n === 1 ? 0 : 0), y: fr.y(s.line) })));
  const every = Math.max(1, Math.ceil(n / 8));
  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted"><li className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-sm bg-brand-500" />{barLabel}</li><li className="inline-flex items-center gap-2"><span aria-hidden className="h-0.5 w-4 rounded bg-sun" />{lineLabel}</li></ul>
        {periods && periods.length > 1 && <Periods periods={periods} value={p} onChange={setP} label={periodLabel} />}
      </div>
      <div className="relative touch-pan-y" onPointerMove={onMove} onPointerLeave={onLeave}>
        <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="h-auto w-full">
          <desc>{summary}</desc>
          <Grid fr={fr} kind={kind} currency={currency} xs={shown.map((s) => s.label)} every={every} />
          {shown.map((s, i) => { const h = Math.max(s.bar > 0 ? 2 : 0, fr.y(0) - fr.y(s.bar)); return <rect key={s.key} x={fr.x(i) - bw / 2} y={fr.y(0) - h} width={bw} height={h} rx="3" className={hover === i ? "fill-brand-400" : "fill-brand-500"} opacity={hover === null || hover === i ? 1 : 0.55} />; })}
          {n > 1 && <path d={line} fill="none" className="stroke-sun" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
          {hover !== null && <line x1={fr.x(hover)} x2={fr.x(hover)} y1={T} y2={fr.y(0)} className="stroke-muted" strokeDasharray="4 4" />}
        </svg>
        {hover !== null && shown[hover] && <Tip left={(fr.x(hover) / W) * 100}><p className="text-muted">{shown[hover]!.label}</p><p className="mt-0.5 font-semibold tabular-nums text-heading">{barLabel}: {fmt(shown[hover]!.bar, kind, currency)}</p><p className="font-semibold tabular-nums text-sun">{lineLabel}: {fmt(shown[hover]!.line, kind, currency)}</p></Tip>}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only"><caption>{label}</caption><tbody>{shown.map((s) => <tr key={s.key}><th scope="row">{s.label}</th><td>{barLabel}: {fmt(s.bar, kind, currency)}</td><td>{lineLabel}: {fmt(s.line, kind, currency)}</td></tr>)}</tbody></table>
    </figure>
  );
}
