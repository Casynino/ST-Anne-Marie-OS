import { crc32, deflateRawSync } from "node:zlib";

/*
 * A small, dependency-free .xlsx writer: one or more sheets of text and numbers with a bold header row, column widths,
 * a frozen header and a few number formats. Text is written as inline strings, so a value such as "=1+1" stays text
 * and is never evaluated by Excel. Good enough for lists and reports; no formulas, images or merged cells.
 */

export type XlsxKind = "text" | "int" | "decimal";
export type XlsxColumn = { label: string; width?: number; kind?: XlsxKind };
export type XlsxCell = string | number | null;
export type XlsxSheet = { name: string; title?: string; columns: XlsxColumn[]; rows: XlsxCell[][] };

const escapeXml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

export function safeSheetName(name: string, taken: Set<string>): string {
  const base = (name.replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet").slice(0, 31);
  let out = base, i = 2;
  while (taken.has(out.toLowerCase())) { const suffix = ` ${i++}`; out = base.slice(0, 31 - suffix.length) + suffix; }
  taken.add(out.toLowerCase());
  return out;
}

// cellXfs indexes: 0 normal, 1 header, 2 title, 3 integer (#,##0), 4 decimal (#,##0.00)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF028051"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function sheetXml(sheet: XlsxSheet): string {
  const rows: string[] = [];
  let r = 1;
  const inline = (ref: string, text: string, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  if (sheet.title) { rows.push(`<row r="${r}" ht="22" customHeight="1">${inline(`A${r}`, sheet.title, 2)}</row>`); r += 2; }
  const headerRow = r;
  rows.push(`<row r="${r}" ht="22" customHeight="1">${sheet.columns.map((c, i) => inline(`${columnName(i)}${r}`, c.label, 1)).join("")}</row>`);
  r++;
  for (const row of sheet.rows) {
    const cells = row.map((v, i) => {
      const ref = `${columnName(i)}${r}`;
      if (v === null || v === undefined || v === "") return "";
      if (typeof v === "number") {
        if (!Number.isFinite(v)) return "";
        const kind = sheet.columns[i]?.kind;
        return `<c r="${ref}"${kind === "int" ? ' s="3"' : kind === "decimal" ? ' s="4"' : ""}><v>${v}</v></c>`;
      }
      return inline(ref, v);
    });
    rows.push(`<row r="${r}">${cells.join("")}</row>`);
    r++;
  }
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(8, c.width ?? Math.max(10, c.label.length + 2)))}" customWidth="1"/>`).join("");
  const last = `${columnName(Math.max(0, sheet.columns.length - 1))}${Math.max(r - 1, headerRow)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

// ───────────────────────── Zip (stored in memory, no ZIP64) ─────────────────────────

function dosDateTime(d: Date): { time: number; date: number } {
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

export function zip(files: { name: string; data: Buffer }[], when = new Date()): Buffer {
  const { time, date } = dosDateTime(when);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

export function buildXlsx(sheets: XlsxSheet[], when = new Date()): Buffer {
  if (!sheets.length) throw new Error("A workbook needs at least one sheet");
  const taken = new Set<string>();
  const named = sheets.map((s) => ({ ...s, name: safeSheetName(s.name, taken) }));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ].map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") }));
  return zip(files, when);
}
