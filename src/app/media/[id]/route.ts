import { getMediaBytes } from "@/server/media";

/** Serves an uploaded website image. IDs are unguessable and immutable, so responses can be cached for a year. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getMediaBytes(id);
  if (!asset) return new Response("Not found", { status: 404 });
  const etag = `"${id}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.sizeBytes),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: etag,
    },
  });
}
