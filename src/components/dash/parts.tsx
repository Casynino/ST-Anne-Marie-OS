import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Ring, Spark, type VizTone } from "./viz";

/** Section heading in the dashboard: a bold title with a one-line purpose, closed by a hairline. */
export function DashSection({ id, eyebrow, title, subtitle, children }: { id: string; eyebrow?: string; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-8 scroll-mt-24">
      {eyebrow && (
        <div className="mb-3 flex items-center gap-3"><span className="text-xs font-semibold text-muted">{eyebrow}</span><span aria-hidden className="h-px flex-1 bg-line" /></div>
      )}
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
        <h2 id={`${id}-h`} className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

const PILL = {
  ok: "bg-ok/12 text-ok ring-ok/25",
  warn: "bg-warn/12 text-warn ring-warn/25",
  bad: "bg-bad/12 text-bad ring-bad/25",
  info: "bg-indigo/12 text-indigo ring-indigo/25",
  brand: "bg-brand-600/12 text-link ring-brand-600/25",
  neutral: "bg-muted/12 text-muted ring-muted/25",
} as const;
export type PillTone = keyof typeof PILL;
export const Pill = ({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) => <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PILL[tone]}`}>{children}</span>;

/** A headline number: small capital label, big figure, one line of context and a status pill. It can carry a trend line (`spark`) or a progress ring (`ring`, a percentage) when the numbers exist. */
export function KpiCard({ label, value, caption, pill, icon: Icon, href, openLabel, spark, ring, tone = "ok" }: { label: string; value: ReactNode; caption?: string; pill?: { text: string; tone: PillTone }; icon: LucideIcon; href?: string; openLabel?: string; spark?: number[]; ring?: number | null; tone?: VizTone }) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {ring !== undefined && ring !== null
          ? <Ring value={ring} size={46} stroke={12} tone={tone} label={label}><span className="text-[10px] font-semibold tabular-nums text-ink">{Math.round(ring)}%</span></Ring>
          : <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-600/12 text-link"><Icon className="size-[1.15rem]" aria-hidden /></span>}
      </span>
      <span className={`mt-2 block font-semibold tabular-nums tracking-tight text-ink ${typeof value === "string" && value.length > 9 ? "whitespace-nowrap text-xl leading-8" : "text-3xl"}`}>{value}</span>
      {caption && <span className="mt-0.5 block text-sm text-muted">{caption}</span>}
      {spark && spark.length > 1 && <span className="mt-3 block"><Spark values={spark} tone={tone} /></span>}
      <span className="mt-auto flex items-center justify-between gap-2 pt-3">
        {pill ? <Pill tone={pill.tone}>{pill.text}</Pill> : <span />}
        {href && openLabel && <span className="inline-flex items-center gap-1 text-xs font-semibold text-link group-hover:underline">{openLabel}<ArrowRight className="size-3.5" aria-hidden /></span>}
      </span>
    </>
  );
  const cls = "group flex h-full min-h-[8rem] flex-col rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]";
  return href ? <Link href={href} className={`${cls} transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export const Panel = ({ title, subtitle, children, className = "", right }: { title: string; subtitle?: string; children: ReactNode; className?: string; right?: ReactNode }) => (
  <section className={`min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] ${className}`}>
    <header className="mb-4 flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-base font-semibold text-ink">{title}</h3>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>{right}</header>
    {children}
  </section>
);

export const SERIES_COLORS = ["#0f9462", "#4f46e5", "#e0a100", "#14a3b8", "#e5604d", "#8b95a1", "#a066d9"] as const;

const niceMax = (n: number) => { if (n <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(n))); const f = n / p; return (f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4 ? 4 : f <= 5 ? 5 : f <= 8 ? 8 : 10) * p; };

/**
 * Vertical bars, one stack per day (or per hour). Y-axis grid, a coloured legend, a native tooltip on every bar and a hidden table
 * with the same numbers, so nothing depends on colour or hovering.
 */
export function StackedBars({ points, series, label, summary, format = (n) => n.toLocaleString(), every = 2, height = 220 }: { points: { key: string; label: string; parts: Record<string, number> }[]; series: { key: string; label: string; color?: string }[]; label: string; summary: string; format?: (n: number) => string; every?: number; height?: number }) {
  const W = 640, H = height, L = 40, R = 8, T = 12, B = 28;
  const totals = points.map((p) => series.reduce((n, s) => n + (p.parts[s.key] ?? 0), 0));
  const top = niceMax(Math.max(1, ...totals));
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const bw = (W - L - R) / points.length;
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const colorOf = (i: number) => series[i]!.color ?? SERIES_COLORS[i % SERIES_COLORS.length]!;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        <desc>{summary}</desc>
        {ticks.map((t) => (<g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-line" strokeDasharray={t === 0 ? undefined : "3 4"} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="fill-muted text-[10px]">{format(Math.round(t * 10) / 10)}</text></g>))}
        {points.map((p, i) => {
          let acc = 0;
          const x = L + i * bw;
          return (
            <g key={p.key} className="[&_rect]:transition-opacity hover:[&_rect]:opacity-80">
              <title>{`${p.label}: ${series.map((s) => `${s.label} ${format(p.parts[s.key] ?? 0)}`).join(", ")}`}</title>
              {series.map((s, si) => { const v = p.parts[s.key] ?? 0; if (!v) return null; const h = (v / top) * (H - T - B); acc += v; return <rect key={s.key} x={x + bw * 0.14} y={y(acc)} width={bw * 0.72} height={Math.max(1.5, h)} rx={si === series.length - 1 || acc === totals[i] ? 3 : 0} fill={colorOf(si)} />; })}
              {i % every === (points.length - 1) % every && <text x={x + bw / 2} y={H - 9} textAnchor="middle" className="fill-muted text-[10px]">{p.label}</text>}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">{series.map((s, i) => <li key={s.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full" style={{ background: colorOf(i) }} />{s.label}</li>)}</ul>}
      <figcaption className="sr-only">{summary}</figcaption>
      <table className="sr-only"><caption>{label}</caption><tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th>{series.map((s) => <td key={s.key}>{s.label}: {format(p.parts[s.key] ?? 0)}</td>)}</tr>)}</tbody></table>
    </figure>
  );
}

/** Ranked list: name on the left, number on the right, a thin bar below (the "where the work happens" look). */
export function HBars({ items, label, summary, tone = "#0f9462", format = (n) => n.toLocaleString() }: { items: { label: string; value: number }[]; label: string; summary: string; tone?: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <figure aria-label={label}>
      <ul className="space-y-3.5">
        {items.map((i) => (
          <li key={i.label} title={`${i.label}: ${i.value}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate font-medium text-ink">{i.label}</span><span className="font-semibold tabular-nums text-ink">{format(i.value)}</span></div>
            <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: tone, minWidth: i.value ? 6 : 0 }} /></div>
          </li>
        ))}
      </ul>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

export const Avatar = ({ name }: { name: string }) => (
  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-600/12 text-xs font-bold text-link ring-1 ring-inset ring-brand-600/20">{name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"}</span>
);

export const PersonCell = ({ name, sub }: { name: string; sub?: string }) => (
  <span className="flex min-w-0 items-center gap-3"><Avatar name={name} /><span className="min-w-0"><span className="block truncate font-semibold text-ink">{name}</span>{sub && <span className="block truncate text-xs text-muted">{sub}</span>}</span></span>
);

export const EmptyLine = ({ children }: { children: ReactNode }) => <p className="rounded-xl bg-canvas px-4 py-6 text-center text-sm text-muted">{children}</p>;

/** A table inside a Panel: small capital column heads, hairline rows, numbers right-aligned. */
export function DashTable({ head, children, empty, min = "28rem" }: { head: { label: string; right?: boolean }[]; children: ReactNode; empty?: ReactNode; min?: string }) {
  if (empty) return <EmptyLine>{empty}</EmptyLine>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead><tr className="border-y border-line text-left text-[13px] font-medium text-muted">{head.map((h, i) => <th key={i} className={`px-5 py-2.5 ${h.right ? "text-right" : ""}`}>{h.label}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const Cell = ({ children, right, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) => <td className={`px-5 py-3 align-middle ${right ? "text-right tabular-nums" : ""} ${className}`}>{children}</td>;

/** Ring chart with a big figure in the middle and a legend of counts (never colour alone). */
export function DonutStat({ segments, center, caption, label }: { segments: { label: string; value: number; color: string; text?: string }[]; center: ReactNode; caption?: string; label: string }) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <figure aria-label={label} className="flex flex-wrap items-center gap-6">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 140 140" className="size-full -rotate-90" role="img" aria-label={label}>
          <circle cx="70" cy="70" r={R} fill="none" strokeWidth="14" className="stroke-line" />
          {total > 0 && segments.map((s) => {
            const len = (s.value / total) * C;
            const el = <circle key={s.label} cx="70" cy="70" r={R} fill="none" strokeWidth="14" stroke={s.color} strokeDasharray={`${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`} strokeDashoffset={-offset} strokeLinecap="butt"><title>{`${s.label}: ${s.value}`}</title></circle>;
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-semibold tabular-nums text-heading">{center}</div>{caption && <div className="text-[10px] font-bold uppercase tracking-[.16em] text-muted">{caption}</div>}</div></div>
      </div>
      <ul className="min-w-[10rem] flex-1 space-y-2 text-sm">
        {segments.map((s) => <li key={s.label} className="flex items-center justify-between gap-4"><span className="inline-flex items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span><span className="font-semibold tabular-nums text-ink">{s.text ?? s.value}</span></li>)}
      </ul>
    </figure>
  );
}
