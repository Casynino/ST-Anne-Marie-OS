/** Image helpers that need no dependency: format sniffing from file bytes and dimension reading. */

export type ImageKind = "jpeg" | "png" | "webp";
export const IMAGE_MIME: Record<ImageKind, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Decides the format from the bytes themselves (never from the file name or the browser-supplied type). */
export function sniffImage(b: Uint8Array): ImageKind | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length > 30 && String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === "RIFF" && String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === "WEBP") return "webp";
  return null;
}

/** Pixel size read from the image header; null if the file is malformed. */
export function imageSize(b: Uint8Array, kind: ImageKind): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (kind === "png") return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (kind === "jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = dv.getUint16(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  // webp: VP8 (lossy), VP8L (lossless), VP8X (extended)
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === "VP8 ") return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
  if (chunk === "VP8L") { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
  if (chunk === "VP8X") return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  return null;
}

/** An image reference is either a bundled file (/site/...) or an uploaded asset (/media/<uuid>). Nothing else is accepted. */
export const IMAGE_REF = /^(\/site\/[A-Za-z0-9_\-./]+\.(png|jpe?g|webp|avif|svg)|\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export const isImageRef = (v: string) => IMAGE_REF.test(v) && !v.includes("..");
export const mediaIdOf = (ref: string): string | null => (ref.startsWith("/media/") ? ref.slice(7) : null);

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
