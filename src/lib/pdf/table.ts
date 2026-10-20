import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatCell, type Table } from "@/lib/export/table";
import { GREEN, INK, LINE, MUTED, TINT, clean, draw, type Fonts } from "@/lib/pdf/common";

const LANDSCAPE: [number, number] = [841.89, 595.28];
const M = 30;

function fit(font: { widthOfTextAtSize(t: string, s: number): number }, text: string, size: number, width: number): string {
  const t = clean(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  let end = t.length;
  while (end > 1 && font.widthOfTextAtSize(`${t.slice(0, end)}...`, size) > width) end--;
  return `${t.slice(0, end)}...`;
}

/** A table report as a landscape A4 PDF: repeated header row on every page, page numbers, long text shortened with "...". */
export async function buildTablePdf(t: Table, o: { school: string; generated: string; pageLabel: string; generatedLabel: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(t.title);
  const f: Fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), italic: await pdf.embedFont(StandardFonts.HelveticaOblique) };
  const W = LANDSCAPE[0] - 2 * M;
  const totalWeight = t.columns.reduce((n, c) => n + (c.width ?? 12), 0);
  const widths = t.columns.map((c) => ((c.width ?? 12) / totalWeight) * W);
  const size = t.columns.length > 12 ? 6.5 : t.columns.length > 8 ? 7.5 : 8.5;
  const rowH = size + 8;
  const top = LANDSCAPE[1] - M;
  const bodyTop = top - 62;
  const bottom = M + 14;
  const perPage = Math.max(1, Math.floor((bodyTop - bottom - rowH) / rowH));
  const pages = Math.max(1, Math.ceil(t.rows.length / perPage));
  const alignOf = (kind?: string) => (kind === "int" || kind === "money" || kind === "percent" ? "right" : "left") as "left" | "right";

  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage(LANDSCAPE);
    draw(page, o.school.toUpperCase(), M, top - 12, { font: f.bold, size: 11, color: GREEN });
    draw(page, t.title, M, top - 30, { font: f.bold, size: 14, color: INK });
    if (t.subtitle) draw(page, clean(t.subtitle), M, top - 44, { font: f.regular, size: 9, color: MUTED });
    page.drawRectangle({ x: M, y: top - 52, width: W, height: 1.2, color: GREEN });
    let y = bodyTop;
    page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: GREEN });
    let x = M;
    t.columns.forEach((c, i) => { draw(page, fit(f.bold, c.label, size, widths[i]! - 6), x + 3, y, { font: f.bold, size, color: rgb(1, 1, 1), align: alignOf(c.kind), width: widths[i]! - 6 }); x += widths[i]!; });
    y -= rowH;
    t.rows.slice(p * perPage, (p + 1) * perPage).forEach((row, ri) => {
      if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - 4, width: W, height: rowH, color: TINT });
      let cx = M;
      row.forEach((v, i) => { draw(page, fit(f.regular, formatCell(v, t.columns[i]?.kind), size, widths[i]! - 6), cx + 3, y, { font: f.regular, size, align: alignOf(t.columns[i]?.kind), width: widths[i]! - 6 }); cx += widths[i]!; });
      page.drawRectangle({ x: M, y: y - 4.5, width: W, height: 0.3, color: LINE });
      y -= rowH;
    });
    if (t.rows.length === 0) draw(page, "-", M + 3, y, { font: f.italic, size, color: MUTED });
    if (p === pages - 1 && t.footnote) draw(page, clean(t.footnote), M, bottom + 4, { font: f.italic, size: 7.5, color: MUTED });
    draw(page, `${o.generatedLabel} ${o.generated}`, M, M - 4, { font: f.regular, size: 7, color: MUTED });
    draw(page, `${o.pageLabel} ${p + 1}/${pages}`, M, M - 4, { font: f.regular, size: 7, color: MUTED, align: "right", width: W });
  }
  return pdf.save();
}
