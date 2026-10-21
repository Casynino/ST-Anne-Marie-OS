/*
 * What may be uploaded to the library. The type is decided from the file's own bytes and name together, never from what the browser says.
 * Office files are ZIP packages: they must carry the marker folder of their kind and no macro project.
 */

export type LibraryKind = "PDF" | "DOCUMENT" | "SLIDES" | "SHEET" | "IMAGE";
export type SniffedLibraryFile = { mime: string; ext: string; kind: LibraryKind };

export const MAX_LIBRARY_BYTES = Number(process.env.LIBRARY_MAX_BYTES) || 25 * 1024 * 1024;
export const MAX_COVER_BYTES = 2 * 1024 * 1024;

const OFFICE: Record<string, { mime: string; marker: string; kind: LibraryKind }> = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", marker: "word/", kind: "DOCUMENT" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", marker: "ppt/", kind: "SLIDES" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", marker: "xl/", kind: "SHEET" },
};

export function sniffLibraryFile(bytes: Buffer, fileName: string): SniffedLibraryFile | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf", kind: "PDF" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", kind: "IMAGE" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png", kind: "IMAGE" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { mime: "image/webp", ext: "webp", kind: "IMAGE" };
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const ext = (fileName.split(".").pop() ?? "").toLowerCase();
    const kind = OFFICE[ext];
    if (!kind) return null;
    if (!bytes.includes(Buffer.from(kind.marker)) || bytes.includes(Buffer.from("vbaProject.bin"))) return null;
    return { mime: kind.mime, ext, kind: kind.kind };
  }
  return null;
}

/** Cover pictures: JPEG, PNG or WebP only. */
export function sniffCover(bytes: Buffer): SniffedLibraryFile | null {
  const t = sniffLibraryFile(bytes, "cover");
  return t && t.kind === "IMAGE" ? t : null;
}

export const kindLabel: Record<LibraryKind, string> = { PDF: "PDF", DOCUMENT: "Word", SLIDES: "PowerPoint", SHEET: "Excel", IMAGE: "Image" };
export const kindOfMime = (mime: string): LibraryKind => (mime === "application/pdf" ? "PDF" : mime.startsWith("image/") ? "IMAGE" : mime.includes("presentation") ? "SLIDES" : mime.includes("spreadsheet") ? "SHEET" : "DOCUMENT");

/** A file name that is safe to show and to put in a download header: no paths, no control characters. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "").trim().slice(-120) || "resource";
}

export const humanSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
