import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { AuthContext } from "@/lib/auth/context";
import { todayInTimezone } from "@/lib/dates";
import { CONTENT_TYPE, tableToCsv, tableToXlsx, type ExportFormat, type Table } from "@/lib/export/table";
import { makeT } from "@/lib/i18n";
import { buildTablePdf } from "@/lib/pdf/table";
import { auditExport } from "@/server/exports";

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "export";

/** Turns a table into a download in the requested format, audits it, and never caches it. */
export async function respondTable(ctx: AuthContext, table: Table, format: ExportFormat, kind: string): Promise<NextResponse> {
  const school = await db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true, timezone: true } });
  const t = makeT(ctx.locale);
  const stamp = todayInTimezone(school.timezone);
  let body: BodyInit;
  if (format === "xlsx") body = new Uint8Array(tableToXlsx(table));
  else if (format === "pdf") body = new Uint8Array(await buildTablePdf(table, { school: school.name, generated: stamp, pageLabel: t("export.page"), generatedLabel: t("export.generated") }));
  else body = tableToCsv(table);
  await auditExport(ctx, kind, format, table.rows.length);
  return new NextResponse(body, {
    headers: {
      "Content-Type": CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename="${fileSafe(`${table.title}-${stamp}`)}.${format}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
