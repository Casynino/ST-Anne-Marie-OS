import { degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const GREEN = rgb(0.008, 0.502, 0.318);
export const INK = rgb(0.1, 0.12, 0.11);
export const MUTED = rgb(0.4, 0.43, 0.41);
export const LINE = rgb(0.82, 0.85, 0.83);
export const TINT = rgb(0.94, 0.97, 0.95);
export const RED = rgb(0.72, 0.12, 0.12);

/** Standard PDF fonts only cover Latin-1: anything else is replaced so a stray character never breaks a whole batch. */
export const clean = (s: string) =>
  s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/…/g, "...").replace(/[^\n\x20-\x7E\xA0-\xFF]/g, "?");

export type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
      else {
        if (line) out.push(line);
        // A single very long word is cut so it can never run off the page.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > maxWidth && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export function draw(page: PDFPage, text: string, x: number, y: number, o: { font: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; width?: number }) {
  const size = o.size ?? 9;
  const t = clean(text);
  const w = o.font.widthOfTextAtSize(t, size);
  const dx = o.align === "right" ? (o.width ?? 0) - w : o.align === "center" ? ((o.width ?? 0) - w) / 2 : 0;
  page.drawText(t, { x: x + dx, y, size, font: o.font, color: o.color ?? INK });
}

/** Large diagonal marker across a page (VOID, REVERSED). */
export function watermark(page: PDFPage, font: PDFFont, text: string) {
  const { width, height } = page.getSize();
  const t = clean(text);
  // Long words (e.g. Swahili) shrink so the rotated text stays inside the page.
  const size = Math.min(Math.min(width, height) / 4.2, (width * 0.8) / (font.widthOfTextAtSize(t, 1) * Math.cos((35 * Math.PI) / 180)));
  page.drawText(t, { x: width * 0.1, y: height * 0.38, size, font, color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(35) });
}
