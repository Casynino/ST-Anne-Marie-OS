import type { Translate } from "@/lib/i18n";

/** Download links for one report: CSV (any spreadsheet), Excel (.xlsx) and PDF (print). `base` already carries the report's filters. */
export function ExportMenu({ base, t, formats = ["xlsx", "pdf", "csv"] }: { base: string; t: Translate; formats?: ("csv" | "xlsx" | "pdf")[] }) {
  const sep = base.includes("?") ? "&" : "?";
  const label = { csv: "CSV", xlsx: "Excel", pdf: "PDF" } as const;
  return (
    <span role="group" aria-label={t("export.title")} className="no-print inline-flex overflow-hidden rounded-lg border border-line bg-white text-sm font-semibold">
      <span className="inline-flex items-center border-r border-line bg-canvas px-3 text-xs font-medium uppercase tracking-wide text-muted">{t("export.title")}</span>
      {formats.map((f, i) => (
        <a key={f} href={`${base}${sep}format=${f}`} download className={`inline-flex min-h-11 items-center px-3 hover:bg-canvas ${i > 0 ? "border-l border-line" : ""}`}>{label[f]}</a>
      ))}
    </span>
  );
}
