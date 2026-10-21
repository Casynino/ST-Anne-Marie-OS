import { NextResponse } from "next/server";
import { getLibraryViewer } from "@/lib/library/next";
import { getStorage } from "@/lib/storage";
import { openCover } from "@/server/library";

export const dynamic = "force-dynamic";

/** The cover picture of a resource, only for someone who may see that resource in the library. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const lv = await getLibraryViewer();
  const cover = await openCover({ viewer: lv.viewer, viewerSchoolId: lv.schoolId, account: lv.account, resourceId: id });
  const storage = getStorage();
  if (!cover || !storage) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const { body, size } = await storage.stream(cover.storageKey);
    return new NextResponse(body, { headers: { "Content-Type": cover.mime, "Content-Length": String(size), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300" } });
  } catch {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
