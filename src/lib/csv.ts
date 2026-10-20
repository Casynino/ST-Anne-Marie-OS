/**
 * Small RFC 4180 CSV reader/writer (quotes, escaped quotes, CRLF/LF/CR, BOM, `,` `;` or tab delimiter).
 * No dependency: the import needs nothing more. Excel users save as "CSV UTF-8".
 */

export type CsvLimits = { maxRows: number; maxCols: number; maxCell: number };
export class CsvError extends Error {
  constructor(public readonly code: "TOO_MANY_ROWS" | "TOO_MANY_COLUMNS" | "CELL_TOO_LONG" | "EMPTY" | "UNTERMINATED_QUOTE", message: string) {
    super(message);
  }
}

function detectDelimiter(text: string): "," | ";" | "\t" {
  // Count candidates in the first line outside quotes.
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch]!++;
  }
  return counts[";"]! > counts[","]! && counts[";"]! >= counts["\t"]! ? ";" : counts["\t"]! > counts[","]! ? "\t" : ",";
}

export function parseCsv(input: string, limits: CsvLimits = { maxRows: 5000, maxCols: 60, maxCell: 2000 }): { rows: string[][]; delimiter: string } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!text.trim()) throw new CsvError("EMPTY", "The file is empty.");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const pushCell = () => {
    if (cell.length > limits.maxCell) throw new CsvError("CELL_TOO_LONG", "A cell in the file is too long.");
    row.push(cell);
    cell = "";
    if (row.length > limits.maxCols) throw new CsvError("TOO_MANY_COLUMNS", "The file has too many columns.");
  };
  const pushRow = () => {
    pushCell();
    // Skip completely blank lines.
    if (!(row.length === 1 && row[0]!.trim() === "")) {
      rows.push(row);
      if (rows.length > limits.maxRows + 1) throw new CsvError("TOO_MANY_ROWS", `The file has more than ${limits.maxRows} rows.`);
    }
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === delimiter) pushCell();
    else if (ch === "\n") pushRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else cell += ch;
    i++;
  }
  if (inQuotes) throw new CsvError("UNTERMINATED_QUOTE", "A quoted value was not closed.");
  if (cell !== "" || row.length) pushRow();
  return { rows, delimiter };
}

/** Prevents spreadsheet formula injection when a file that contains user-typed text is opened in Excel. */
export const neutralise = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function toCsv(rows: string[][], opts: { bom?: boolean } = {}): string {
  const esc = (v: string) => (/[",\r\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return (opts.bom ? "﻿" : "") + rows.map((r) => r.map((c) => esc(neutralise(c))).join(",")).join("\r\n") + "\r\n";
}
