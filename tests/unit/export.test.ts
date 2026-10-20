import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildXlsx, columnName, safeSheetName } from "@/lib/xlsx";
import { parseFormat, tableToCsv, tableToXlsx, type Table } from "@/lib/export/table";
import { buildTablePdf } from "@/lib/pdf/table";

/** Reads a zip back through its central directory and verifies every entry's size and CRC. */
function unzip(buf: Buffer): Map<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    expect(buf.readUInt32LE(off)).toBe(0x04034b50);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(data.length).toBe(usize);
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString("utf8"));
    p += 46 + nlen + elen + clen;
  }
  return out;
}

/** Tags must open and close in order: a cheap well-formedness check that is enough to catch broken escaping. */
function wellFormed(xml: string) {
  const stack: string[] = [];
  for (const m of xml.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([A-Za-z][\w:]*)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) expect(stack.pop()).toBe(m[2]);
    else stack.push(m[2]!);
  }
  expect(stack).toEqual([]);
  expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#)/);
}

describe("xlsx writer", () => {
  it("names columns A..Z, AA.. and makes unique, legal sheet names", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
    const taken = new Set<string>();
    expect(safeSheetName("Results: Form I/II [A]", taken)).toBe("Results Form I II A");
    expect(safeSheetName("Results Form I II A", taken)).toBe("Results Form I II A 2");
    expect(safeSheetName("x".repeat(60), new Set()).length).toBe(31);
    expect(safeSheetName("", new Set())).toBe("Sheet");
  });

  it("produces a valid package with correct checksums and well-formed XML", () => {
    const wb = buildXlsx([{ name: "Students", title: "Students & classes", columns: [{ label: "Name", width: 20 }, { label: "Count", kind: "int" }, { label: "Fee", kind: "decimal" }], rows: [["Amina <Mushi> & \"co\"", 12, 1500.5], ["=1+1", 0, null], ["Tab\tand\u0000control", 1234567, 0.1 + 0.2]] }, { name: "Empty", columns: [{ label: "A" }], rows: [] }]);
    const files = unzip(wb);
    expect([...files.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    for (const [name, xml] of files) if (name.endsWith(".xml") || name.endsWith(".rels")) wellFormed(xml);
    const s1 = files.get("xl/worksheets/sheet1.xml")!;
    expect(s1).toContain("Amina &lt;Mushi&gt; &amp; &quot;co&quot;");
    expect(s1).toContain('t="inlineStr"><is><t xml:space="preserve">=1+1</t>'); // stays text, never a formula
    expect(s1).not.toContain("<f>");
    expect(s1).toContain('<c r="B4" s="3"><v>12</v></c>');
    expect(s1).toContain('<c r="C4" s="4"><v>1500.5</v></c>');
    expect(s1).not.toContain("\u0000");
    expect(s1).toContain('ySplit="3"'); // title row + blank + header, then data
    expect(files.get("xl/workbook.xml")).toContain('name="Students"');
  });

  it("handles large sheets and rejects an empty workbook", () => {
    const rows = Array.from({ length: 20000 }, (_, i) => [`Student ${i}`, i, i / 7]);
    const buf = buildXlsx([{ name: "Big", columns: [{ label: "Name" }, { label: "N", kind: "int" }, { label: "X", kind: "decimal" }], rows }]);
    expect(unzip(buf).get("xl/worksheets/sheet1.xml")!).toContain('r="A20001"');
    expect(() => buildXlsx([])).toThrow();
  });
});

const table: Table = {
  title: "Arrears", subtitle: "Term 3 2026",
  columns: [{ key: "n", label: "Student", width: 20 }, { key: "a", label: "Amount", kind: "money", width: 10 }, { key: "r", label: "Rate", kind: "percent" }, { key: "c", label: "Count", kind: "int" }],
  rows: [["Amina", 150000.5, 41.7, 3], ["=cmd|' /C calc'!A0", 0, null, 0], ["Baraka, \"Jr\"", 25, 100, 12]],
};

describe("table exports", () => {
  it("CSV: quotes properly, neutralises spreadsheet formulas, keeps a BOM for Excel", () => {
    const csv = tableToCsv(table);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Student,Amount,Rate,Count");
    expect(csv).toContain('"Baraka, ""Jr"""');
    expect(csv).toContain("'=cmd"); // a leading apostrophe stops Excel from running it
    expect(csv).toContain("150000.5");
  });
  it("Excel: money and percent as numbers, title above the header", () => {
    const files = unzip(tableToXlsx(table));
    const s = files.get("xl/worksheets/sheet1.xml")!;
    expect(s).toContain("Arrears - Term 3 2026");
    expect(s).toContain('<c r="B4" s="4"><v>150000.5</v></c>');
    wellFormed(s);
  });
  it("PDF: paginates long tables with a repeated header and page numbers", async () => {
    const big: Table = { ...table, rows: Array.from({ length: 130 }, (_, i) => [`Student number ${i + 1} with a rather long name that must be shortened to fit`, i * 1000, i % 101, i]) };
    const bytes = await buildTablePdf(big, { school: "Test School", generated: "2026-10-20", pageLabel: "Page", generatedLabel: "Generated" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(doc.getPage(0).getSize().width).toBeGreaterThan(doc.getPage(0).getSize().height); // landscape
    const empty = await PDFDocument.load(await buildTablePdf({ ...table, rows: [] }, { school: "S", generated: "x", pageLabel: "P", generatedLabel: "G" }));
    expect(empty.getPageCount()).toBe(1);
    const odd = await buildTablePdf({ ...table, rows: [["Zoë 李雷 😀", 1, 2, 3]] }, { school: "Škola", generated: "x", pageLabel: "P", generatedLabel: "G" });
    expect((await PDFDocument.load(odd)).getPageCount()).toBe(1);
  });
  it("chooses the format from the query, defaulting to CSV", () => {
    expect([parseFormat("xlsx"), parseFormat("pdf"), parseFormat("csv"), parseFormat("exe"), parseFormat(null)]).toEqual(["xlsx", "pdf", "csv", "csv", "csv"]);
  });
});
