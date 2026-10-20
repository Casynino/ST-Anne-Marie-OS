import { toCsv } from "@/lib/csv";
import { buildXlsx, type XlsxKind } from "@/lib/xlsx";

/** One report as a table: the same data can be downloaded as CSV, Excel or PDF. Money is passed in major units (e.g. 150000.5). */
export type TableKind = "text" | "int" | "money" | "percent";
export type TableColumn = { key: string; label: string; kind?: TableKind; width?: number };
export type Table = { title: string; subtitle?: string; columns: TableColumn[]; rows: (string | number | null)[][]; footnote?: string };

export type ExportFormat = "csv" | "xlsx" | "pdf";
export const parseFormat = (v: string | null | undefined): ExportFormat => (v === "xlsx" || v === "pdf" ? v : "csv");

const xlsxKind = (k?: TableKind): XlsxKind => (k === "int" ? "int" : k === "money" || k === "percent" ? "decimal" : "text");

export function tableToCsv(t: Table): string {
  const cell = (v: string | number | null) => (v === null ? "" : typeof v === "number" ? String(v) : v);
  return toCsv([t.columns.map((c) => c.label), ...t.rows.map((r) => r.map(cell))], { bom: true });
}

export function tableToXlsx(t: Table, when = new Date()): Buffer {
  return buildXlsx([{ name: t.title, title: t.subtitle ? `${t.title} - ${t.subtitle}` : t.title, columns: t.columns.map((c) => ({ label: c.label, width: c.width, kind: xlsxKind(c.kind) })), rows: t.rows }], when);
}

export const CONTENT_TYPE = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pdf: "application/pdf" } as const;

/** Plain-text cell for CSV/PDF: money with two decimals, percentages with a sign. */
export function formatCell(v: string | number | null, kind?: TableKind): string {
  if (v === null || v === "") return "";
  if (typeof v === "string") return v;
  if (kind === "money") return v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  if (kind === "percent") return `${v}%`;
  return String(v);
}
