import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import type { Translate } from "@/lib/i18n";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-canvas text-muted ring-line",
  ok: "bg-green-50 text-ok ring-green-200",
  warn: "bg-amber-50 text-warn ring-amber-200",
  bad: "bg-red-50 text-bad ring-red-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold ${
        variant === "primary" ? "bg-brand-700 text-white hover:bg-brand-800" : "border border-line bg-white text-ink hover:bg-canvas"
      }`}
    >
      {children}
    </Link>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line bg-white px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

export function NoAccess({ t }: { t: Translate }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-white p-8 text-center">
      <Lock className="mx-auto size-8 text-muted" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">{t("common.noAccess.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("common.noAccess.body")}</p>
    </div>
  );
}

export function DataTable({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;

export function Pagination({ page, pageSize, total, basePath, params, t }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined>; t: Translate }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>
        {t("common.results", { count: total })} · {t("common.page", { page, pages })}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-white px-3 text-ink hover:bg-canvas">
            <ChevronLeft className="size-4" aria-hidden /> {t("common.previous")}
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-white px-3 text-ink hover:bg-canvas">
            {t("common.next")} <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function DefList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm">{i.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Searchable GET filter form (server-rendered, works without JS). */
export function FilterBar({ children, t, resetHref }: { children: ReactNode; t: Translate; resetHref: string }) {
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3">
      {children}
      <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("common.filter")}</button>
      <Link href={resetHref} className="inline-flex min-h-11 items-center px-2 text-sm text-muted hover:text-ink">
        {t("common.clear")}
      </Link>
    </form>
  );
}
