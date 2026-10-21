import { db } from "@/lib/db";
import { requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { loadFinance, schoolToday } from "@/server/balances";
import { closeTasks, openTask } from "@/server/workflow";

/*
 * Reminders for Finance from the real fee schedule: an unpaid instalment due within the next week becomes a "due soon" task, and one that
 * is past its date becomes an "overdue" task. Each is tied to the invoice and the due date, so running this again (every night, or by hand)
 * never makes a second task; a task closes itself as soon as that instalment is paid. Nothing here changes a balance.
 */

const SOON_DAYS = 7;

export async function generateFinanceTasks(schoolId: string): Promise<{ due: number; overdue: number; closed: number }> {
  const today = await schoolToday(db, schoolId);
  const limit = new Date(new Date(`${today}T00:00:00Z`).getTime() + SOON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const invoices = await db.invoice.findMany({ where: { schoolId, status: "ISSUED" }, select: { id: true, studentId: true, number: true }, take: 20000 });
  const studentIds = [...new Set(invoices.map((i) => i.studentId))];
  const finance = await loadFinance(db, schoolId, studentIds, today);
  const students = await db.student.findMany({ where: { schoolId, id: { in: studentIds } }, select: { id: true, firstName: true, lastName: true, admissionNo: true } });
  const name = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName} (${s.admissionNo})`]));
  let due = 0, overdue = 0, closed = 0;
  for (const inv of invoices) {
    const b = finance.get(inv.studentId)?.ledger.invoices.get(inv.id);
    if (!b) continue;
    for (const item of b.schedule) {
      const key = item.dueDate;
      if (item.paid >= item.amount) {
        closed += await closeTasks(db, { schoolId, relatedType: "Invoice", relatedId: inv.id, kinds: ["INSTALMENT_DUE", "INSTALMENT_OVERDUE"], discriminator: key, by: null, note: "Paid" });
      } else if (item.dueDate < today) {
        await closeTasks(db, { schoolId, relatedType: "Invoice", relatedId: inv.id, kinds: ["INSTALMENT_DUE"], discriminator: key, by: null, note: "Now overdue" });
        await openTask(db, { schoolId, kind: "INSTALMENT_OVERDUE", relatedType: "Invoice", relatedId: inv.id, relatedLabel: `${name.get(inv.studentId) ?? ""} · ${inv.number} · ${item.dueDate}`, sourceEvent: "instalment.overdue", dueOn: new Date(`${today}T00:00:00Z`), discriminator: key });
        overdue++;
      } else if (item.dueDate <= limit) {
        await openTask(db, { schoolId, kind: "INSTALMENT_DUE", relatedType: "Invoice", relatedId: inv.id, relatedLabel: `${name.get(inv.studentId) ?? ""} · ${inv.number} · ${item.dueDate}`, sourceEvent: "instalment.due_soon", dueOn: new Date(`${item.dueDate}T00:00:00Z`), discriminator: key });
        due++;
      }
    }
  }
  return { due, overdue, closed };
}

/** The same run, started by hand from the Tasks page by someone in Finance or Administration. */
export async function refreshFinanceTasks(ctx: AuthContext) {
  requireAnyPermission(ctx, ["tasks.finance", "tasks.admin"]);
  return generateFinanceTasks(ctx.schoolId);
}
