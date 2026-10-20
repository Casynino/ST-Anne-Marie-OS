import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth/next";
import { errorResponse, jsonError } from "@/lib/http";
import { toCsv } from "@/lib/csv";
import { decimalOf } from "@/lib/finance/money";
import { arrearsReport, classCollectionReport, collectionsReport, expensesReport } from "@/server/finance-reports";
import { listPayments } from "@/server/payments";
import { listInvoices } from "@/server/invoices";

export const dynamic = "force-dynamic";

const money = (c: number) => decimalOf(c);

/** CSV exports of finance reports. Each type is gated by the same permission as its on-screen report. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.mustChangePassword) return jsonError(401, "Unauthorized", { code: "UNAUTHENTICATED" });
  if (ctx.userType !== "STAFF") return jsonError(403, "Forbidden", { code: "FORBIDDEN" });
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") ?? "";
  const range = { from: sp.get("from") ?? "", to: sp.get("to") ?? "" };
  try {
    let rows: string[][];
    if (type === "arrears") {
      const r = await arrearsReport(ctx, { termId: sp.get("termId") || undefined, classId: sp.get("classId") || undefined });
      rows = [["Admission no", "Student", "Class", "Outstanding", "Overdue", "1-30 days", "31-60 days", "61-90 days", "90+ days", "Oldest due date", "Guardian", "Phone"],
        ...r.rows.map((x) => [x.admissionNo, x.name, x.className ?? "", money(x.outstanding), money(x.overdue), money(x.ageing["1-30"]), money(x.ageing["31-60"]), money(x.ageing["61-90"]), money(x.ageing["90+"]), x.oldestDue ?? "", x.guardian ?? "", x.phone ?? ""])];
    } else if (type === "collections") {
      const r = await collectionsReport(ctx, range);
      rows = [["Date", "Payments", "Amount"], ...r.byDay.map((d) => [d.date, String(d.count), money(d.cents)]), [], ["Method", "Payments", "Amount"], ...r.byMethod.map((m) => [m.method, String(m.count), money(m.cents)]), [], ["Total collected", "", money(r.collected)], ["Refunds paid", "", money(r.refundsPaid)], ["Net", "", money(r.net)]];
    } else if (type === "classes") {
      const r = await classCollectionReport(ctx, { termId: sp.get("termId") ?? "" });
      rows = [["Class", "Students", "Billed", "Paid", "Outstanding", "Collected %"], ...r.map((c) => [c.className, String(c.students), money(c.billed), money(c.paid), money(c.outstanding), c.ratePct === null ? "" : String(c.ratePct)])];
    } else if (type === "expenses") {
      const r = await expensesReport(ctx, range);
      rows = [["Category", "Entries", "Amount"], ...r.rows.map((x) => [x.category, String(x.count), money(x.cents)]), ["Total", "", money(r.total)]];
    } else if (type === "payments") {
      const all: string[][] = [["Date", "Receipt", "Admission no", "Student", "Method", "Reference", "Status", "Source", "Amount"]];
      for (let page = 1; page <= 40; page++) {
        const r = await listPayments(ctx, { from: range.from || undefined, to: range.to || undefined, page });
        for (const p of r.items) all.push([formatD(p.receivedOn), p.receipt?.number ?? "", p.admissionNo, p.studentName, p.method, p.reference ?? "", p.status, p.source, money(p.amountCents)]);
        if (page * r.pageSize >= r.total) break;
      }
      rows = all;
    } else if (type === "invoices") {
      const all: string[][] = [["Number", "Admission no", "Student", "Class", "Term", "Issued", "Due", "Total", "Paid", "Outstanding", "Status"]];
      for (let page = 1; page <= 200; page++) {
        const r = await listInvoices(ctx, { termId: sp.get("termId") || undefined, classId: sp.get("classId") || undefined, page });
        for (const i of r.items) all.push([i.number, i.admissionNo, i.studentName, i.className ?? "", i.termName ?? "", i.issueDate, i.dueDate, money(i.balance?.total ?? 0), money(i.balance?.paid ?? 0), money(i.balance?.outstanding ?? 0), i.balance?.state ?? i.status]);
        if (page * r.pageSize >= r.total) break;
      }
      rows = all;
    } else return jsonError(400, "Unknown export type.");
    return new NextResponse(toCsv(rows, { bom: true }), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="finance-${type}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e, "finance_export_failed");
  }
}

const formatD = (d: Date) => d.toISOString().slice(0, 10);
