import { db, type Db, type Tx } from "@/lib/db";
import { formatDateOnly, todayInTimezone } from "@/lib/dates";
import { centsOf, type Cents } from "@/lib/finance/money";
import { computeLedger, type Ledger, type LedgerInvoice, type LedgerPayment } from "@/lib/finance/ledger";

/**
 * The single authoritative balance service. Every screen, report, receipt, clearance check and the parent portal
 * read balances through here; none of them adds up fees on its own.
 */

export type InvoiceFacts = LedgerInvoice & { number: string; termId: string | null; type: "TERM_FEES" | "OTHER"; studentId: string; classId: string | null };
export type StudentFinance = { studentId: string; invoices: InvoiceFacts[]; ledger: Ledger };

export async function schoolToday(client: Db | Tx, schoolId: string): Promise<string> {
  const s = await client.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return todayInTimezone(s.timezone);
}

/** Refund states that have already taken (or reserved) money from the student's credit. */
export const ACTIVE_REFUND = ["REQUESTED", "APPROVED", "PAID"] as const;

export async function loadFinance(client: Db | Tx, schoolId: string, studentIds: string[], today?: string): Promise<Map<string, StudentFinance>> {
  const day = today ?? (await schoolToday(client, schoolId));
  const out = new Map<string, StudentFinance>();
  if (!studentIds.length) return out;
  const [invoices, payments, refunds] = await Promise.all([
    client.invoice.findMany({
      where: { schoolId, studentId: { in: studentIds }, status: "ISSUED" },
      include: { lines: { select: { kind: true, amount: true } }, instalments: { select: { dueDate: true, amount: true } } },
    }),
    client.payment.findMany({ where: { schoolId, studentId: { in: studentIds }, status: "POSTED" }, select: { id: true, studentId: true, amount: true, targetInvoiceId: true, receivedOn: true } }),
    client.refund.groupBy({ by: ["studentId"], where: { schoolId, studentId: { in: studentIds }, status: { in: [...ACTIVE_REFUND] } }, _sum: { amount: true } }),
  ]);
  const refundBy = new Map(refunds.map((r) => [r.studentId, centsOf(r._sum.amount)]));
  for (const id of studentIds) {
    const inv: InvoiceFacts[] = invoices
      .filter((i) => i.studentId === id)
      .map((i) => ({
        id: i.id, studentId: i.studentId, number: i.number, termId: i.termId, type: i.type, classId: i.classId,
        issueDate: formatDateOnly(i.issueDate), dueDate: formatDateOnly(i.dueDate),
        total: i.lines.reduce((n, l) => n + (l.kind === "CHARGE" ? centsOf(l.amount) : -centsOf(l.amount)), 0),
        instalments: i.instalments.map((x) => ({ dueDate: formatDateOnly(x.dueDate), amount: centsOf(x.amount) })),
      }));
    const pay: LedgerPayment[] = payments.filter((p) => p.studentId === id).map((p) => ({ id: p.id, amount: centsOf(p.amount), targetInvoiceId: p.targetInvoiceId, receivedOn: formatDateOnly(p.receivedOn) }));
    out.set(id, { studentId: id, invoices: inv, ledger: computeLedger(inv, pay, refundBy.get(id) ?? 0, day) });
  }
  return out;
}

export async function loadStudentFinance(client: Db | Tx, schoolId: string, studentId: string, today?: string): Promise<StudentFinance> {
  return (await loadFinance(client, schoolId, [studentId], today)).get(studentId)!;
}

/** Serialises money movements for one student (payments, reversals, refunds) so balance checks cannot race. */
export async function lockStudentFinance(tx: Tx, studentId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`finance:${studentId}`}, 0))::text AS locked`;
}

export type { Cents };
