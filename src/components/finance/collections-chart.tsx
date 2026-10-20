import type { CollectionsPoint } from "@/server/dashboard";

/** Daily collections as bars. Values are readable without hovering: the busiest days are labelled and a text summary precedes the chart. */
export function CollectionsChart({ points, label, summary, format, dayLabel }: { points: CollectionsPoint[]; label: string; summary: string; format: (cents: number) => string; dayLabel: (iso: string) => string }) {
  const W = 560, H = 170, L = 8, R = 8, T = 22, B = 26;
  const max = Math.max(1, ...points.map((p) => p.cents));
  const bw = (W - L - R) / points.length;
  const top = [...points].sort((a, b) => b.cents - a.cents).slice(0, 2).filter((p) => p.cents > 0).map((p) => p.date);
  return (
    <figure aria-label={label}>
      <figcaption className="mb-2 text-sm text-muted">{summary}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="stroke-line" />
        {points.map((p, i) => {
          const h = (p.cents / max) * (H - T - B);
          const x = L + i * bw;
          return (
            <g key={p.date}>
              <title>{`${dayLabel(p.date)}: ${format(p.cents)}`}</title>
              <rect x={x + 1.5} y={H - B - h} width={Math.max(2, bw - 3)} height={Math.max(h, p.cents > 0 ? 1.5 : 0)} rx={2} className="fill-brand-600" />
              {top.includes(p.date) && <text x={i > points.length * 0.7 ? x + bw : i < points.length * 0.3 ? x : x + bw / 2} y={H - B - h - 5} textAnchor={i > points.length * 0.7 ? "end" : i < points.length * 0.3 ? "start" : "middle"} className="fill-ink text-[10px] font-medium">{format(p.cents)}</text>}
            </g>
          );
        })}
        <text x={L} y={H - 8} className="fill-muted text-[10px]">{dayLabel(points[0]!.date)}</text>
        <text x={W - R} y={H - 8} textAnchor="end" className="fill-muted text-[10px]">{dayLabel(points[points.length - 1]!.date)}</text>
      </svg>
      <table className="sr-only"><caption>{label}</caption><tbody>{points.filter((p) => p.cents > 0).map((p) => <tr key={p.date}><th scope="row">{dayLabel(p.date)}</th><td>{format(p.cents)}</td></tr>)}</tbody></table>
    </figure>
  );
}
