import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { Ring, Spark, type VizTone } from "./viz";

/** Section heading in the dashboard: a short yellow bar, a spaced capital title, one line of purpose, and an optional link on the right. */
export function DashSection({ id, eyebrow, title, subtitle, link, children }: { id: string; eyebrow?: string; title: string; subtitle?: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-10 scroll-mt-24">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <span aria-hidden className="mb-2 block h-[3px] w-9 rounded-sm bg-sun" />
          {eyebrow && <p className="mb-0.5 text-xs text-muted">{eyebrow}</p>}
          <h2 id={`${id}-h`} className="text-[13px] font-semibold uppercase tracking-[.16em] text-ink">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {link && <Link href={link.href} className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{link.label}<ArrowRight className="size-4" aria-hidden /></Link>}
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

const ACCENT = {
  ok: { tile: "bg-ok/15 text-ok", bar: "bg-ok/70", glow: "from-ok/10" },
  warn: { tile: "bg-warn/15 text-warn", bar: "bg-warn/70", glow: "from-warn/10" },
  bad: { tile: "bg-bad/15 text-bad", bar: "bg-bad/70", glow: "from-bad/12" },
  info: { tile: "bg-[#8b80ff]/15 text-[#a9a0ff]", bar: "bg-[#8b80ff]/70", glow: "from-[#8b80ff]/10" },
  brand: { tile: "bg-brand-500/15 text-link", bar: "bg-brand-500/70", glow: "from-brand-500/10" },
} as const;
function accentOf(pill: PillTone | undefined, tone: VizTone): keyof typeof ACCENT {
  if (pill === "bad" || tone === "bad") return "bad";
  if (pill === "warn" || tone === "warn" || tone === "sun") return "warn";
  if (pill === "info" || tone === "indigo" || tone === "sky") return "info";
  if (pill === "ok" || tone === "ok") return "ok";
  return "brand";
}

/** A headline number: a label with a tinted icon, a big figure, one line of context and a status pill. The card's colour follows its status; it can carry a trend line (`spark`) or a progress ring (`ring`, a percentage) when the numbers exist. */
export function KpiCard({ label, value, caption, pill, icon: Icon, href, openLabel, spark, ring, tone = "ok" }: { label: string; value: ReactNode; caption?: string; pill?: { text: string; tone: PillTone }; icon: LucideIcon; href?: string; openLabel?: string; spark?: number[]; ring?: number | null; tone?: VizTone }) {
  const a = ACCENT[accentOf(pill?.tone, tone)];
  const body = (
    <>
      <span aria-hidden className={`absolute inset-x-0 top-0 h-[2px] ${a.bar}`} />
      <span aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${a.glow} to-transparent`} />
      <span className="relative flex h-full flex-col">
        <span className="flex items-start justify-between gap-3">
          <span className="text-[13px] font-medium text-muted">{label}</span>
          {ring !== undefined && ring !== null
            ? <Ring value={ring} size={46} stroke={12} tone={tone} label={label}><span className="text-[10px] font-semibold tabular-nums text-ink">{Math.round(ring)}%</span></Ring>
            : <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${a.tile}`}><Icon className="size-[1.15rem]" aria-hidden /></span>}
        </span>
        <span className={`mt-2 block font-semibold tabular-nums tracking-tight text-ink ${typeof value === "string" && value.length > 9 ? "whitespace-nowrap text-2xl leading-9" : "text-[2rem] leading-9"}`}>{value}</span>
        {caption && <span className="mt-0.5 block text-sm text-muted">{caption}</span>}
        {spark && spark.length > 1 && <span className="mt-3 block"><Spark values={spark} tone={tone} /></span>}
        <span className="mt-auto flex items-center justify-between gap-2 pt-3">
          {pill ? <Pill tone={pill.tone}>{pill.text}</Pill> : <span />}
          {href && openLabel && <span className="inline-flex items-center gap-1 text-xs font-medium text-link group-hover:underline">{openLabel}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>}
        </span>
      </span>
    </>
  );
  const cls = "group relative flex h-full min-h-[8.5rem] flex-col overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]";
  return href ? <Link href={href} className={`${cls} transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-link/40 hover:shadow-[var(--shadow-lift)]`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export const GRADIENT = {
  green: "from-[#0a7048] to-[#1aa971]",
  teal: "from-[#0a6f82] to-[#14a5bd]",
  violet: "from-[#5446cf] to-[#8579f0]",
  orange: "from-[#bd4f08] to-[#e8801f]",
  rose: "from-[#b8362a] to-[#e8634e]",
  indigo: "from-[#2a3590] to-[#4a5cc9]",
} as const;
export type GradientTone = keyof typeof GRADIENT;

/**
 * A headline figure on a solid colour: the label, a big number, one line of context, a white icon tile, and (when there is a series) a
 * sparkline. Colour only tells the cards apart; every card still carries its label and number in text.
 */
export function GradientTile({ label, value, caption, icon: Icon, tone = "green", spark, href }: { label: string; value: ReactNode; caption?: string; icon: LucideIcon; tone?: GradientTone; spark?: number[]; href?: string }) {
  const long = typeof value === "string" && value.length > 7;
  const body = (
    <>
      <span className="relative z-10 min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-white/90">{label}</span>
        <span className={`block whitespace-nowrap font-semibold tabular-nums tracking-tight text-white ${long ? "text-[1.3rem] leading-7" : "text-[1.65rem] leading-8"}`}>{value}</span>
        {caption && <span className="block truncate text-[11px] leading-4 text-white/80">{caption}</span>}
      </span>
      {spark && spark.length > 1 && <span aria-hidden className="pointer-events-none absolute bottom-1 right-2 h-7 w-20 overflow-hidden opacity-60 [&_svg]:h-7"><Spark values={spark} tone="white" /></span>}
      <span className="relative z-10 grid size-8 shrink-0 place-items-center self-start rounded-lg bg-white/95 shadow-sm"><Icon className="size-4 text-[#10231a]" aria-hidden /></span>
    </>
  );
  const cls = `group relative flex h-full items-start justify-between gap-2 overflow-hidden rounded-xl bg-gradient-to-br ${GRADIENT[tone]} px-3.5 py-2.5 shadow-[var(--shadow-card)]`;
  return href ? <Link href={href} className={`${cls} transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Thick coloured bars, one per row, with the figure inside the bar (the way a subject or class comparison reads best). `mark` draws a tick, e.g. the class average. */
export function ColorBars({ items, label, max, unit = "", labelWidth = "6.5rem" }: { items: { label: string; value: number; mark?: number | null }[]; label: string; max?: number; unit?: string; labelWidth?: string }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {items.map((i, k) => (
        <li key={i.label} className="grid items-center gap-3 text-sm" style={{ gridTemplateColumns: `${labelWidth} 1fr` }}>
          <span className="truncate font-medium text-ink" title={i.label}>{i.label}</span>
          <span className="relative h-7 rounded-md bg-line/60">
            <span className="flex h-full items-center justify-end rounded-md px-2 text-xs font-semibold tabular-nums text-white" style={{ width: `${Math.max(12, (i.value / top) * 100)}%`, background: SERIES_COLORS[k % SERIES_COLORS.length] }}>{Math.round(i.value * 10) / 10}{unit}</span>
            {i.mark !== undefined && i.mark !== null && <span aria-hidden className="absolute -top-1 h-9 w-0.5 rounded-sm bg-ink/70" style={{ left: `calc(${Math.min(100, (i.mark / top) * 100)}% - 1px)` }} title={`${Math.round(i.mark * 10) / 10}${unit}`} />}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const Panel = ({ title, subtitle, children, className = "", right, icon: Icon }: { title: string; subtitle?: string; children: ReactNode; className?: string; right?: ReactNode; icon?: LucideIcon }) => (
  <section className={`min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] ${className}`}>
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>{subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}</div>
      {right ?? (Icon ? <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-link"><Icon className="size-[1.1rem]" aria-hidden /></span> : null)}
    </header>
    {children}
  </section>
);

/** A department's standing at a glance: a coloured top edge, a capital label, a big number with its noun, what it means, and the one thing wrong. */
export function DeskCard({ label, value, noun, note, foot, tone = "brand", href }: { label: string; value: ReactNode; noun: string; note?: string; foot?: { text: string; tone: "ok" | "warn" | "bad" | "brand" }; tone?: keyof typeof ACCENT; href?: string }) {
  const a = ACCENT[tone];
  const FOOT = { ok: "text-ok", warn: "text-warn", bad: "text-bad", brand: "text-link" } as const;
  const body = (
    <>
      <span aria-hidden className={`absolute inset-x-0 top-0 h-[3px] ${a.bar}`} />
      <span className="flex items-center justify-between gap-2"><span className="text-xs font-semibold uppercase tracking-[.14em] text-muted">{label}</span>{href && <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />}</span>
      <span className="mt-2 flex items-baseline gap-2"><span className="text-[2rem] font-semibold leading-9 tabular-nums text-ink">{value}</span><span className="text-sm text-muted">{noun}</span></span>
      {note && <span className="mt-1 block text-sm text-muted">{note}</span>}
      {foot && <span className={`mt-3 block border-t border-line pt-3 text-sm font-medium ${FOOT[foot.tone]}`}>{foot.text}</span>}
    </>
  );
  const cls = "group relative block overflow-hidden rounded-xl border border-line bg-surface p-4 pt-5 shadow-[var(--shadow-card)]";
  return href ? <Link href={href} className={`${cls} transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]`}>{body}</Link> : <div className={cls}>{body}</div>;
}

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
        <div className="absolute inset-0 grid place-items-center text-center"><div className="max-w-[5.75rem]"><div className="text-3xl font-semibold leading-8 tabular-nums text-heading">{center}</div>{caption && <div className="mt-0.5 text-[9px] font-bold uppercase leading-[1.15] tracking-[.08em] text-muted">{caption}</div>}</div></div>
      </div>
      <ul className="min-w-[10rem] flex-1 space-y-2 text-sm">
        {segments.map((s) => <li key={s.label} className="flex items-center justify-between gap-4"><span className="inline-flex items-center gap-2 text-ink/90"><span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span><span className="font-semibold tabular-nums text-ink">{s.text ?? s.value}</span></li>)}
      </ul>
    </figure>
  );
}
