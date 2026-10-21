import Link from "next/link";

export type PipelineTab = { key: string; label: string; n: number; to: string; on: boolean; color: string; alert?: boolean; bar?: number };

/**
 * Where every application stands, at a glance: a slim bar cut by stage (width = how many), and under it one line of tabs, each with the
 * colour of its part of the bar and its count. Choosing a tab filters the list.
 */
export function Pipeline({ tabs, label }: { tabs: PipelineTab[]; label: string }) {
  const parts = tabs.map((x) => ({ ...x, w: x.key === "all" || x.key === "attention" ? 0 : (x.bar ?? x.n) })).filter((x) => x.w > 0);
  const total = parts.reduce((n, x) => n + x.w, 0);
  return (
    <div className="mb-4">
      <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-line">
        {parts.map((x) => <Link key={x.key} href={x.to} tabIndex={-1} title={`${x.label}: ${x.n}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(x.w / (total || 1)) * 100}%`, background: x.color, minWidth: 8 }} />)}
      </div>
      <nav aria-label={label} className="-mx-4 mt-1 flex overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {tabs.map((x) => (
          <Link key={x.key} href={x.to} aria-current={x.on ? "page" : undefined} className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm font-medium transition-colors ${x.on ? "text-heading" : "text-muted hover:text-ink"}`}>
            {x.key !== "all" && <span aria-hidden className="size-2 rounded-sm" style={{ background: x.color }} />}
            {x.label}
            <span className={`tabular-nums ${x.alert && x.n > 0 ? "font-semibold text-warn" : x.on ? "text-heading" : "text-muted"}`}>{x.n}</span>
            {x.on && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-brand-500" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
