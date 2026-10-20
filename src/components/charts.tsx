import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/** Card that frames a chart: a real heading, an optional link to the detail page and a text summary for assistive tech. */
export function ChartCard({ title, subtitle, href, hrefLabel, children, className = "" }: { title: string; subtitle?: string; href?: string; hrefLabel?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)] ${className}`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="text-base font-semibold text-ink">{title}</h2>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>
        {href && <Link href={href} className="inline-flex min-h-9 shrink-0 items-center gap-1 text-sm font-medium text-brand-700 hover:underline">{hrefLabel}<ArrowRight className="size-4" aria-hidden /></Link>}
      </header>
      {children}
    </section>
  );
}

export function EmptyChart({ children }: { children: ReactNode }) {
  return <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-line bg-canvas px-4 py-8 text-center text-sm text-muted">{children}</div>;
}

const TONE: Record<string, string> = { brand: "bg-brand-600", sun: "bg-sun-600", indigo: "bg-indigo", warn: "bg-warn", bad: "bg-bad", muted: "bg-muted/60" };

/** Horizontal bars. Values are printed next to every bar, so nothing depends on colour or on hovering. */
export function BarList({ items, label, summary }: { items: { label: string; value: number; tone?: string }[]; label: string; summary: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((n, i) => n + i.value, 0);
  return (
    <figure aria-label={label}>
      <ul className="space-y-2.5">
        {items.map((i) => (
          <li key={i.label} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-sm" title={`${i.label}: ${i.value}`}>
            <span className="truncate text-ink/85">{i.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-canvas" aria-hidden><span className={`block h-full rounded-full ${TONE[i.tone ?? "brand"]}`} style={{ width: `${(i.value / max) * 100}%`, minWidth: i.value ? "0.35rem" : 0 }} /></span>
            <span className="min-w-8 text-right font-semibold tabular-nums">{i.value.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{summary} ({total})</figcaption>
    </figure>
  );
}

/** Line chart for a percentage over time. Axis labels, point tooltips and a hidden table carry the same data. */
export function TrendChart({ points, label, summary, formatDate, unit = "%" }: { points: { date: string; rate: number }[]; label: string; summary: string; formatDate: (iso: string) => string; unit?: string }) {
  const W = 560, H = 210, L = 38, R = 14, T = 14, B = 30;
  const lo = Math.max(0, Math.floor((Math.min(...points.map((p) => p.rate)) - 5) / 10) * 10);
  const hi = 100;
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i / (points.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.rate).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="mx-auto h-auto max-h-64 w-full">
        <title>{label}</title>
        <desc>{summary}</desc>
        {ticks.map((t) => (
          <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth="1" /><text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-muted text-[11px]">{t}{unit}</text></g>
        ))}
        <path d={area} className="fill-brand-600/10" />
        <path d={line} className="fill-none stroke-brand-600" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.rate)} r="4" className="fill-white stroke-brand-700" strokeWidth="2"><title>{`${formatDate(p.date)}: ${p.rate}${unit}`}</title></circle>)}
        <text x={x(0)} y={H - 8} textAnchor={points.length === 1 ? "middle" : "start"} className="fill-muted text-[11px]">{formatDate(points[0]!.date)}</text>
        {points.length > 1 && <text x={x(points.length - 1)} y={H - 8} textAnchor="end" className="fill-muted text-[11px]">{formatDate(points[points.length - 1]!.date)}</text>}
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only"><caption>{label}</caption><tbody>{points.map((p) => <tr key={p.date}><th scope="row">{formatDate(p.date)}</th><td>{p.rate}{unit}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** Proportion ring with a printed legend (never colour alone). */
export function Donut({ segments, label, summary }: { segments: { label: string; value: number; tone?: string }[]; label: string; summary: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  const STROKE: Record<string, string> = { brand: "stroke-brand-600", sun: "stroke-sun-600", indigo: "stroke-indigo" };
  return (
    <figure className="flex items-center gap-5" aria-label={label}>
      <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90" role="img" aria-label={summary}>
        <circle cx="50" cy="50" r={R} className="fill-none stroke-canvas" strokeWidth="14" />
        {segments.map((s) => { const len = total ? (s.value / total) * C : 0; const el = <circle key={s.label} cx="50" cy="50" r={R} className={`fill-none ${STROKE[s.tone ?? "brand"]}`} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}><title>{`${s.label}: ${s.value}`}</title></circle>; acc += len; return el; })}
      </svg>
      <figcaption>
        <ul className="space-y-1.5 text-sm">
          {segments.map((s) => <li key={s.label} className="flex items-center gap-2"><span aria-hidden className={`size-3 rounded-full ${TONE[s.tone ?? "brand"]}`} /><span>{s.label}</span><span className="font-semibold tabular-nums">{s.value}{total ? ` (${Math.round((s.value / total) * 100)}%)` : ""}</span></li>)}
        </ul>
      </figcaption>
    </figure>
  );
}
