import { z } from "zod";
import { db } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { requirePermission, requireAnyPermission, type AuthContext } from "@/lib/auth/context";
import { formatDateOnly } from "@/lib/dates";
import { centsOf, decimalOf, formatMoney, positiveAmount } from "@/lib/finance/money";
import { actorOf, writeAudit } from "@/server/audit";
import { schoolToday } from "@/server/balances";
import { getFeeSettings } from "@/server/fees";
import { getApprovalLimits } from "@/server/approval-limits";
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

export async function setExpenseCategoryApproval(ctx: AuthContext, id: string, required: boolean) {
  requirePermission(ctx, "expense.manage");
  const c = await db.expenseCategory.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!c) throw notFound("Category");
  await db.$transaction(async (tx) => {
    await tx.expenseCategory.update({ where: { id }, data: { requiresApproval: required } });
    await writeAudit(tx, actorOf(ctx), { action: "expense_category.approval", entityType: "ExpenseCategory", entityId: id, summary: c.name, changes: { requiresApproval: [c.requiresApproval, required] } });
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
  // The school decides which expenses need a second person: whole categories, and anything at or above a set amount.
  const settings = await getFeeSettings(db, ctx.schoolId);
  const needsApproval = cat.requiresApproval || (settings.expenseApprovalAboveCents > 0 && d.amount >= settings.expenseApprovalAboveCents);
  return db.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { schoolId: ctx.schoolId, categoryId: d.categoryId, amount: decimalOf(d.amount), spentOn, payee: d.payee, description: d.description ?? null, method: d.method, reference: d.reference ?? null, createdById: ctx.userId, approval: needsApproval ? "PENDING" : "APPROVED" } });
    await writeAudit(tx, actorOf(ctx), { action: "expense.record", entityType: "Expense", entityId: e.id, summary: `${cat.name} · ${formatMoney(d.amount)}`, changes: { payee: d.payee, amountCents: d.amount, needsApproval } });
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

/**
 * At or above the owner's limit only a person holding `expense.approve_high` may decide; below it only a person holding
 * `expense.approve` (the head teacher). Each tier has its own holder, so the owner does not decide routine expenses and the head teacher
 * cannot decide the big ones.
 */
async function requireApproverFor(tx: Parameters<typeof getApprovalLimits>[0], ctx: AuthContext, cents: number) {
  const { expenseOwnerAboveCents } = await getApprovalLimits(tx, ctx.schoolId);
  const high = expenseOwnerAboveCents > 0 && cents >= expenseOwnerAboveCents;
  if (!ctx.permissions.has(high ? "expense.approve_high" : "expense.approve")) throw forbidden(high ? "This expense is above the owner's approval limit. Only the owner can decide it." : undefined);
}

/** PENDING -> APPROVED by someone other than the person who recorded it. Until then the expense is in no total. */
export async function approveExpense(ctx: AuthContext, id: string) {
  requireAnyPermission(ctx, ["expense.approve", "expense.approve_high"]);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM expenses WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Expense");
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    if (e.approval !== "PENDING") throw conflict("This expense is not waiting for approval.");
    if (e.createdById === ctx.userId) throw conflict("An expense must be approved by someone other than the person who recorded it.");
    await requireApproverFor(tx, ctx, centsOf(e.amount));
    await tx.expense.update({ where: { id }, data: { approval: "APPROVED", approvedById: ctx.userId, approvedAt: new Date() } });
    await writeAudit(tx, actorOf(ctx), { action: "expense.approve", entityType: "Expense", entityId: id, summary: formatMoney(centsOf(e.amount)), changes: { payee: e.payee } });
  });
}

export async function rejectExpense(ctx: AuthContext, id: string, input: unknown) {
  requireAnyPermission(ctx, ["expense.approve", "expense.approve_high"]);
  const { reason } = parse(z.object({ reason: text(300) }), input);
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM expenses WHERE id = ${id}::uuid AND "schoolId" = ${ctx.schoolId}::uuid FOR UPDATE`;
    if (!rows.length) throw notFound("Expense");
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    if (e.approval !== "PENDING") throw conflict("This expense is not waiting for approval.");
    if (e.createdById === ctx.userId) throw conflict("An expense must be decided by someone other than the person who recorded it.");
    await requireApproverFor(tx, ctx, centsOf(e.amount));
    await tx.expense.update({ where: { id }, data: { approval: "REJECTED", approvedById: ctx.userId, approvedAt: new Date(), approvalNote: reason } });
    await writeAudit(tx, actorOf(ctx), { action: "expense.reject", entityType: "Expense", entityId: id, summary: formatMoney(centsOf(e.amount)), reason });
  });
}

/** Expenses waiting for a decision, for the approvers' queue. */
export async function pendingExpenseCount(ctx: AuthContext): Promise<number> {
  requireAnyPermission(ctx, ["expense.approve", "expense.manage"]);
  return db.expense.count({ where: { schoolId: ctx.schoolId, approval: "PENDING", voided: false, ...(ctx.permissions.has("expense.approve") ? { createdById: { not: ctx.userId } } : {}) } });
}

const listSchema = z.object({ from: optDateOnly(), to: optDateOnly(), categoryId: optUuid(), approval: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["PENDING", "REJECTED"]).optional()), includeVoid: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()), page: z.coerce.number().int().min(1).default(1) });

export async function listExpenses(ctx: AuthContext, input: unknown = {}) {
  requirePermission(ctx, "expense.read");
  const f = parse(listSchema, input);
  const pageSize = 25;
  const where = { schoolId: ctx.schoolId, ...(f.includeVoid ? {} : { voided: false }), ...(f.approval ? { approval: f.approval } : {}), ...(f.categoryId ? { categoryId: f.categoryId } : {}), ...(f.from || f.to ? { spentOn: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) };
  const [items, total, sum] = await Promise.all([
    db.expense.findMany({ where, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], skip: (f.page - 1) * pageSize, take: pageSize, include: { category: { select: { name: true } } } }),
    db.expense.count({ where }),
    // Totals count only approved expenses: waiting and rejected ones are shown in the list but never added up.
    db.expense.aggregate({ where: { ...where, voided: false, approval: "APPROVED" }, _sum: { amount: true } }),
  ]);
  return { items: items.map((e) => ({ ...e, amountCents: centsOf(e.amount) })), total, page: f.page, pageSize, totalCents: centsOf(sum._sum.amount) };
}
