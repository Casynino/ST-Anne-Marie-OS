import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { AuthContext } from "@/lib/auth/context";
import * as expenses from "@/server/expenses";
import { executiveOverview } from "@/server/executive";
import { getApprovalLimits, updateApprovalLimits } from "@/server/approval-limits";
import { completeTask, openTask } from "@/server/workflow";
import { createTestSchool, createTestUser } from "../helpers";

/* The owner's view, the department accountability numbers and the owner-only approval tier. */

let schoolId: string, admin: AuthContext, head: AuthContext, accountant: AuthContext, registrar: AuthContext, teacher: AuthContext;
let categoryId: string;
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as AppError | null)?.code ?? null;

beforeAll(async () => {
  const school = await createTestSchool();
  schoolId = school.id;
  admin = (await createTestUser(schoolId, ["super_admin"])).ctx;
  head = (await createTestUser(schoolId, ["head_teacher"])).ctx;
  accountant = (await createTestUser(schoolId, ["accountant"])).ctx;
  registrar = (await createTestUser(schoolId, ["registrar"])).ctx;
  teacher = (await createTestUser(schoolId, ["class_teacher"])).ctx;
  categoryId = (await expenses.createExpenseCategory(accountant, { name: "Repairs" })).id;
});

describe("the executive overview", () => {
  it("is for the owner only, enforced on the server", async () => {
    for (const who of [head, accountant, registrar, teacher]) expect(await code(executiveOverview(who))).toBe("FORBIDDEN");
    expect(await code(executiveOverview(admin))).toBeNull();
  });

  it("reads the real records: an approved expense shows in the owner's money, and an empty month shows zeros, not invented figures", async () => {
    const before = await executiveOverview(admin, { period: "month" });
    expect(before.money.income).toBe(0);
    expect(before.money.trend.every((m) => m.income === 0)).toBe(true);
    await expenses.recordExpense(accountant, { categoryId, amount: "30,000", payee: "Plumber", method: "CASH" });
    const after = await executiveOverview(admin, { period: "month" });
    expect(after.money.expenses - before.money.expenses).toBe(3_000_000);
    expect(after.money.net).toBe(after.money.income - after.money.refundsPaid - after.money.expenses);
    expect(after.money.byCategory.find((c) => c.name === "Repairs")?.cents).toBeGreaterThanOrEqual(3_000_000);
  });

  it("shows each department's overdue work, who holds it, and counts a task as done only when it is really completed", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);
    await openTask(db, { schoolId, kind: "RETURNING_FEE", relatedType: "Test", relatedId: crypto.randomUUID(), relatedLabel: "Overdue fee task", sourceEvent: "test", dueOn: past, assignedToId: accountant.userId });
    await openTask(db, { schoolId, kind: "RETURNING_PLACEMENT", relatedType: "Test", relatedId: crypto.randomUUID(), relatedLabel: "Unassigned placement", sourceEvent: "test", dueOn: past });
    const o = await executiveOverview(admin);
    const fin = o.departments.find((d) => d.department === "FINANCE")!;
    expect(fin.overdue).toBeGreaterThanOrEqual(1);
    expect(fin.oldest?.daysLate).toBeGreaterThanOrEqual(5);
    expect(fin.responsible.map((r) => r.name)).toContain(accountant.fullName);
    expect(o.departments.find((d) => d.department === "ADMISSIONS")!.unassigned).toBeGreaterThanOrEqual(1);
    const task = await db.workflowTask.findFirstOrThrow({ where: { schoolId, relatedLabel: "Overdue fee task" } });
    // Looking at it (or the owner reading the dashboard) completes nothing.
    expect((await db.workflowTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("PENDING");
    await completeTask(accountant, task.id, { note: "paid" });
    const after = await executiveOverview(admin);
    expect(after.departments.find((d) => d.department === "FINANCE")!.completed30).toBe(fin.completed30 + 1);
    expect(after.departments.find((d) => d.department === "FINANCE")!.overdue).toBe(fin.overdue - 1);
  });
});

describe("what only the owner decides", () => {
  it("setting the limits is owner-level, audited, and 0 means nothing is reserved", async () => {
    expect(await code(updateApprovalLimits(accountant, { expenseOwnerAbove: "100,000" }))).toBe("FORBIDDEN");
    expect(await code(updateApprovalLimits(head, { expenseOwnerAbove: "100,000" }))).toBe("FORBIDDEN");
    expect((await getApprovalLimits(db, schoolId)).expenseOwnerAboveCents).toBe(0);
    await updateApprovalLimits(admin, { expenseOwnerAbove: "100,000", refundOwnerAbove: "50,000" });
    expect(await getApprovalLimits(db, schoolId)).toEqual({ expenseOwnerAboveCents: 10_000_000, refundOwnerAboveCents: 5_000_000 });
    expect(await db.auditLog.count({ where: { schoolId, action: "approval_limits.update" } })).toBe(1);
  });

  it("a routine expense is decided by the head teacher; one above the limit only by the owner", async () => {
    await expenses.setExpenseCategoryApproval(accountant, categoryId, true);
    const small = await expenses.recordExpense(accountant, { categoryId, amount: "20,000", payee: "Cleaner", method: "CASH" });
    const big = await expenses.recordExpense(accountant, { categoryId, amount: "150,000", payee: "Roofer", method: "CASH" });
    expect(small.approval).toBe("PENDING");
    expect(await code(expenses.approveExpense(head, small.id))).toBeNull();
    expect(await code(expenses.approveExpense(head, big.id))).toBe("FORBIDDEN");
    expect(await code(expenses.rejectExpense(head, big.id, { reason: "too much" }))).toBe("FORBIDDEN");
    expect((await db.expense.findUniqueOrThrow({ where: { id: big.id } })).approval).toBe("PENDING");
    const queue = await executiveOverview(admin);
    expect(queue.ownerQueue.expenses).toBeGreaterThanOrEqual(1);
    expect(await code(expenses.approveExpense(admin, big.id))).toBeNull();
    expect((await db.expense.findUniqueOrThrow({ where: { id: big.id } })).approval).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { schoolId, action: "expense.approve", entityId: big.id } })).toBe(1);
  });
});
