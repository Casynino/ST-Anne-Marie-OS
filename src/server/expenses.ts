import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { centsOf, decimalOf, formatMoney, positiveAmount } from "@/lib/finance/money";
import { actorOf, writeAudit } from "@/server/audit";
import { schoolToday } from "@/server/balances";
import { optDateOnly, optText, optUuid, parse, text, uuid } from "@/lib/validation";

const METHODS = ["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const;

export async function listExpenseCategories(ctx: AuthContext) {
  requirePermission(ctx, "expense.read");
  return db.expenseCategory.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { expenses: true } } } });
}

export async function createExpenseCategory(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "expense.manage");
  const { name } = parse(z.object({ name: text(80) }), input);
  if (await db.expenseCategory.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name } } })) throw invalid("Please correct the highlighted fields.", { name: "This category already exists" });
  return db.$transaction(async (tx) => {
    const c = await tx.expenseCategory.create({ data: { schoolId: ctx.schoolId, name } });
    await writeAudit(tx, actorOf(ctx), { action: "expense_category.create", entityType: "ExpenseCategory", entityId: c.id, summary: name });
    return c;
  });
}

export async function setExpenseCategoryActive(ctx: AuthContext, id: string, active: boolean) {
  requirePermission(ctx, "expense.manage");
  const c = await db.expenseCategory.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!c) throw notFound("Category");
  await db.$transaction(async (tx) => {
    await tx.expenseCategory.update({ where: { id }, data: { isActive: active } });
    await writeAudit(tx, actorOf(ctx), { action: active ? "expense_category.activate" : "expense_category.deactivate", entityType: "ExpenseCategory", entityId: id, summary: c.name });
  });
}

const expenseSchema = z
  .object({ categoryId: uuid(), amount: positiveAmount("Amount"), spentOn: optDateOnly(), payee: text(120), description: optText(300), method: z.enum(METHODS), reference: optText(80) })
  .refine((v) => v.method === "CASH" || v.method === "OTHER" || !!v.reference, { path: ["reference"], message: "Enter the bank or transaction reference" });

export async function recordExpense(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "expense.manage");
  const d = parse(expenseSchema, input);
  const cat = await db.expenseCategory.findFirst({ where: { id: d.categoryId, schoolId: ctx.schoolId, isActive: true } });
  if (!cat) throw invalid("Please correct the highlighted fields.", { categoryId: "Choose an active category" });
  const today = await schoolToday(db, ctx.schoolId);
  const spentOn = d.spentOn ?? new Date(`${today}T00:00:00Z`);
  if (formatDateOnly(spentOn) > today) throw invalid("Please correct the highlighted fields.", { spentOn: "The date cannot be in the future" });
  return db.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { schoolId: ctx.schoolId, categoryId: d.categoryId, amount: decimalOf(d.amount), spentOn, payee: d.payee, description: d.description ?? null, method: d.method, reference: d.reference ?? null, createdById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "expense.record", entityType: "Expense", entityId: e.id, summary: `${cat.name} · ${formatMoney(d.amount)}`, changes: { payee: d.payee, amountCents: d.amount } });
    return e;
  });
}

export async function voidExpense(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "expense.manage");
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const e = await tx.expense.findFirst({ where: { id, schoolId: ctx.schoolId } });
    if (!e) throw notFound("Expense");
    if (e.voided) throw conflict("This expense is already void.");
    await tx.expense.update({ where: { id }, data: { voided: true, voidReason: reason, voidedAt: new Date(), voidedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "expense.void", entityType: "Expense", entityId: id, summary: formatMoney(centsOf(e.amount)), reason });
  });
}

const listSchema = z.object({ from: optDateOnly(), to: optDateOnly(), categoryId: optUuid(), includeVoid: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()), page: z.coerce.number().int().min(1).default(1) });

export async function listExpenses(ctx: AuthContext, input: unknown = {}) {
  requirePermission(ctx, "expense.read");
  const f = parse(listSchema, input);
  const pageSize = 25;
  const where = { schoolId: ctx.schoolId, ...(f.includeVoid ? {} : { voided: false }), ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.from || f.to ? { spentOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) };
  const [items, total, sum] = await Promise.all([
    db.expense.findMany({ where, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], skip: (f.page - 1) * pageSize, take: pageSize, include: { category: { select: { name: true } } } }),
    db.expense.count({ where }),
    db.expense.aggregate({ where: { ...where, voided: false }, _sum: { amount: true } }),
  ]);
  return { items: items.map((e) => ({ ...e, amountCents: centsOf(e.amount) })), total, page: f.page, pageSize, totalCents: centsOf(sum._sum.amount) };
}
