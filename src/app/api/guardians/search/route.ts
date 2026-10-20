import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { searchGuardians } from "@/server/guardians";

export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const rows = await searchGuardians(ctx, q);
    return NextResponse.json({ items: rows.map((g) => ({ id: g.id, fullName: g.fullName, phone: g.phone, children: g._count.students })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error(JSON.stringify({ level: "error", msg: "guardian_search_failed", error: e instanceof Error ? e.message : String(e) }));
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
