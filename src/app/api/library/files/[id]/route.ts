import { NextResponse } from "next/server";
import { getLibraryViewer } from "@/lib/library/next";
import { getStorage } from "@/lib/storage";
import { openLibraryFile } from "@/server/library";

export const dynamic = "force-dynamic";

const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/** Parses one `Range: bytes=a-b` request (what phones and PDF readers send); anything else is served whole. */
function parseRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Number(m[2]);
  if (start < 0) start = 0;
  if (end >= size) end = size - 1;
  return start > end || start >= size ? "bad" : { start, end };
}

/**
 * The only way to a library file. The viewer (verified school ID or signed-in account) is checked against the resource on every request; there
 * is no public address for a protected file. A person who is not allowed (or whose session has run out) is sent back to the resource page with
 * a clear message instead of a bare error. The file is streamed, never read whole into memory, and ranges are supported for phones.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(request.url);
  const lv = await getLibraryViewer();
  const download = url.searchParams.get("download") === "1";
  const version = Number(url.searchParams.get("v")) || undefined;
  const r = await openLibraryFile({ viewer: lv.viewer, viewerSchoolId: lv.schoolId, account: lv.account, resourceId: id, kind: download ? "DOWNLOAD" : "VIEW", version });
  if (!r.ok) {
    if (r.reason === "NOT_FOUND") return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.redirect(new URL(`/library/r/${id}?notice=${r.reason}`, request.url), { status: 303, headers: { "Cache-Control": "no-store" } });
  }
  const storage = getStorage();
  if (!storage) return new NextResponse("File storage is not available.", { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const range = parseRange(request.headers.get("range"), r.file.sizeBytes);
    if (range === "bad") return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${r.file.sizeBytes}`, "Cache-Control": "no-store" } });
    const { body, size } = await storage.stream(r.file.storageKey, range ?? undefined);
    const inline = !download && INLINE.has(r.file.mimeType);
    const ascii = r.file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const headers: Record<string, string> = {
      "Content-Type": r.file.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.file.fileName)}`,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Length": String(range ? range.end - range.start + 1 : size),
    };
    if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "library_file_failed", resourceId: id, error: e instanceof Error ? e.message.slice(0, 200) : String(e) }));
    return NextResponse.redirect(new URL(`/library/r/${id}?notice=FAILED`, request.url), { status: 303, headers: { "Cache-Control": "no-store" } });
  }
}
