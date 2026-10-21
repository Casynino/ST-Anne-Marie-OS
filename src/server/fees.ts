import { z } from "zod";
import { db, type Db, type Tx } from "@/lib/db";
import { conflict, invalid, notFound } from "@/lib/errors";
import { requireAnyPermission, requirePermission, type AuthContext } from "@/lib/auth/context";
import { centsOf, decimalOf, parseAmount, positiveAmount } from "@/lib/finance/money";
import { actorOf, writeAudit } from "@/server/audit";
import { loadFinance } from "@/server/balances";
import { optText, optUuid, parse, text, uuid } from "@/lib/validation";

// ───────────────────────── Settings ─────────────────────────

export type FeeSettings = { paymentInstructions: string; defaultDueDays: number; clearanceMaxOutstandingCents: number; /** An expense of this size or more waits for approval (0 = only categories marked as needing approval). */ expenseApprovalAboveCents: number; /** Show academic staff a plain "fees need review" flag for a student (no amounts). The school chooses; nothing is blocked by it. */ academicReviewFlag: boolean };
export const DEFAULT_FEE_SETTINGS: FeeSettings = { paymentInstructions: "", defaultDueDays: 14, clearanceMaxOutstandingCents: 0, expenseApprovalAboveCents: 0, academicReviewFlag: false };

export async function getFeeSettings(client: Db | Tx, schoolId: string): Promise<FeeSettings> {
  const row = await client.schoolSetting.findUnique({ where: { schoolId_key: { schoolId, key: "fees" } } });
  const s = (row?.value ?? {}) as Partial<FeeSettings>;
  return {
    paymentInstructions: typeof s.paymentInstructions === "string" ? s.paymentInstructions : "",
    defaultDueDays: Number.isInteger(s.defaultDueDays) ? (s.defaultDueDays as number) : DEFAULT_FEE_SETTINGS.defaultDueDays,
    clearanceMaxOutstandingCents: Number.isInteger(s.clearanceMaxOutstandingCents) ? (s.clearanceMaxOutstandingCents as number) : 0,
    expenseApprovalAboveCents: Number.isInteger(s.expenseApprovalAboveCents) && (s.expenseApprovalAboveCents as number) >= 0 ? (s.expenseApprovalAboveCents as number) : 0,
    academicReviewFlag: s.academicReviewFlag === true,
  };
}

const settingsSchema = z.object({
  paymentInstructions: optText(1000),
  defaultDueDays: z.coerce.number().int().min(0).max(120),
  clearanceMaxOutstanding: z.preprocess((v) => (v === "" || v === undefined ? "0" : v), z.union([z.string(), z.number()])),
  expenseApprovalAbove: z.preprocess((v) => (v === "" || v === undefined ? undefined : v), z.union([z.string(), z.number()]).optional()),
  academicReviewFlag: z.preprocess((v) => (v === undefined ? undefined : v === "on" || v === "true" || v === true), z.boolean().optional()),
});

export async function updateFeeSettings(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "fees.manage");
  const d = parse(settingsSchema, input);
  const max = parseAmount(d.clearanceMaxOutstanding);
  if (max === null) throw invalid("Please correct the highlighted fields.", { clearanceMaxOutstanding: "Enter an amount such as 0 or 50000" });
  const before = await getFeeSettings(db, ctx.schoolId);
  // A form that does not send the field leaves the threshold as it was; an explicit 0 turns it off.
  const approvalAbove = d.expenseApprovalAbove === undefined ? before.expenseApprovalAboveCents : parseAmount(d.expenseApprovalAbove);
  if (approvalAbove === null) throw invalid("Please correct the highlighted fields.", { expenseApprovalAbove: "Enter an amount such as 0 or 500000" });
  const value: FeeSettings = { paymentInstructions: d.paymentInstructions ?? "", defaultDueDays: d.defaultDueDays, clearanceMaxOutstandingCents: max, expenseApprovalAboveCents: approvalAbove, academicReviewFlag: d.academicReviewFlag ?? before.academicReviewFlag };
  await db.$transaction(async (tx) => {
    await tx.schoolSetting.upsert({ where: { schoolId_key: { schoolId: ctx.schoolId, key: "fees" } }, create: { schoolId: ctx.schoolId, key: "fees", value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "fees.settings_update", entityType: "SchoolSetting", entityId: "fees", changes: { before: { ...before, paymentInstructions: undefined }, after: { ...value, paymentInstructions: undefined } } });
  });
}

// ───────────────────────── Fee items ─────────────────────────

const CATEGORIES = ["TUITION", "TRANSPORT", "MEALS", "BOARDING", "UNIFORM", "EXAM", "ADMISSION", "OTHER"] as const;
const itemSchema = z.object({ name: text(80), nameSw: optText(80), category: z.enum(CATEGORIES).default("TUITION") });

export async function listFeeItems(ctx: AuthContext) {
  requirePermission(ctx, "fees.read");
  return db.feeItem.findMany({ where: { schoolId: ctx.schoolId }, orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { lines: true } } } });
}

export async function createFeeItem(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "fees.manage");
  const d = parse(itemSchema, input);
  if (await db.feeItem.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: d.name } } })) throw invalid("Please correct the highlighted fields.", { name: "A fee item with this name already exists" });
  return db.$transaction(async (tx) => {
    const item = await tx.feeItem.create({ data: { schoolId: ctx.schoolId, name: d.name, nameSw: d.nameSw ?? null, category: d.category } });
    await writeAudit(tx, actorOf(ctx), { action: "fee_item.create", entityType: "FeeItem", entityId: item.id, summary: item.name });
    return item;
  });
}

export async function updateFeeItem(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "fees.manage");
  const d = parse(itemSchema.extend({ isActive: z.preprocess((v) => v === undefined ? true : v === "true" || v === "on" || v === true, z.boolean()) }), input);
  const item = await db.feeItem.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!item) throw notFound("Fee item");
  if (d.name !== item.name && (await db.feeItem.findUnique({ where: { schoolId_name: { schoolId: ctx.schoolId, name: d.name } } }))) throw invalid("Please correct the highlighted fields.", { name: "A fee item with this name already exists" });
  await db.$transaction(async (tx) => {
    await tx.feeItem.update({ where: { id }, data: { name: d.name, nameSw: d.nameSw ?? null, category: d.category, isActive: d.isActive } });
    await writeAudit(tx, actorOf(ctx), { action: "fee_item.update", entityType: "FeeItem", entityId: id, summary: d.name, changes: { isActive: [item.isActive, d.isActive] } });
  });
}

// ───────────────────────── Fee structures ─────────────────────────

const lineSchema = z.object({ feeItemId: uuid(), amount: positiveAmount("Amount"), termSequence: z.number().int().min(1).max(12).nullable() });
const structureSchema = z
  .object({ academicYearId: uuid(), name: text(80), levelId: optUuid(), classId: optUuid(), lines: z.array(lineSchema).min(1, "Add at least one fee line") })
  .refine((v) => !(v.levelId && v.classId), { path: ["classId"], message: "Choose a level or a class, not both" });

async function assertStructureRefs(client: Db | Tx, schoolId: string, d: { academicYearId: string; levelId?: string; classId?: string; lines: { feeItemId: string }[] }) {
  if (!(await client.academicYear.findFirst({ where: { id: d.academicYearId, schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { academicYearId: "Choose an academic year" });
  if (d.levelId && !(await client.academicLevel.findFirst({ where: { id: d.levelId, schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { levelId: "Invalid level" });
  if (d.classId && !(await client.schoolClass.findFirst({ where: { id: d.classId, schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { classId: "Invalid class" });
  const ids = [...new Set(d.lines.map((l) => l.feeItemId))];
  if ((await client.feeItem.count({ where: { id: { in: ids }, schoolId, isActive: true } })) !== ids.length) throw invalid("Please correct the highlighted fields.", { lines: "Every fee line needs an active fee item" });
}

function noDuplicateLines(lines: { feeItemId: string; termSequence: number | null }[]) {
  const seen = new Set<string>();
  for (const l of lines) {
    const k = `${l.feeItemId}:${l.termSequence ?? "*"}`;
    if (seen.has(k)) throw invalid("Please correct the highlighted fields.", { lines: "The same fee item is listed twice for the same term" });
    seen.add(k);
  }
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

export async function listStructures(ctx: AuthContext, filter: { academicYearId?: string } = {}) {
  requirePermission(ctx, "fees.read");
  return db.feeStructure.findMany({
    where: { schoolId: ctx.schoolId, ...(filter.academicYearId ? { academicYearId: filter.academicYearId } : {}) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { lines: { orderBy: { sortOrder: "asc" }, include: { feeItem: { select: { name: true, nameSw: true } } } } },
  });
}

export async function createStructure(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "fees.manage");
  const d = parse(structureSchema, input);
  await assertStructureRefs(db, ctx.schoolId, d);
  noDuplicateLines(d.lines);
  try {
    return await db.$transaction(async (tx) => {
      const s = await tx.feeStructure.create({
        data: {
          schoolId: ctx.schoolId, academicYearId: d.academicYearId, name: d.name, levelId: d.levelId ?? null, classId: d.classId ?? null, createdById: ctx.userId,
          lines: { create: d.lines.map((l, i) => ({ feeItemId: l.feeItemId, amount: decimalOf(l.amount), termSequence: l.termSequence, sortOrder: i })) },
        },
      });
      await writeAudit(tx, actorOf(ctx), { action: "fee_structure.create", entityType: "FeeStructure", entityId: s.id, summary: s.name, changes: { lines: d.lines.length } });
      return s;
    });
  } catch (e) {
    if (isUnique(e)) throw invalid("Please correct the highlighted fields.", { classId: "An active fee structure already exists for this class, level and year" });
    throw e;
  }
}

/** Replaces the lines. Invoices that were already issued keep the amounts they were issued with. */
export async function updateStructure(ctx: AuthContext, id: string, input: unknown) {
  requirePermission(ctx, "fees.manage");
  const d = parse(structureSchema, input);
  const s = await db.feeStructure.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!s) throw notFound("Fee structure");
  if (d.academicYearId !== s.academicYearId || (d.levelId ?? null) !== s.levelId || (d.classId ?? null) !== s.classId) throw invalid("Please correct the highlighted fields.", { academicYearId: "The year and scope of a fee structure cannot be changed. Create a new structure instead." });
  await assertStructureRefs(db, ctx.schoolId, d);
  noDuplicateLines(d.lines);
  await db.$transaction(async (tx) => {
    await tx.feeStructureLine.deleteMany({ where: { structureId: id } });
    await tx.feeStructureLine.createMany({ data: d.lines.map((l, i) => ({ structureId: id, feeItemId: l.feeItemId, amount: decimalOf(l.amount), termSequence: l.termSequence, sortOrder: i })) });
    await tx.feeStructure.update({ where: { id }, data: { name: d.name } });
    await writeAudit(tx, actorOf(ctx), { action: "fee_structure.update", entityType: "FeeStructure", entityId: id, summary: d.name, changes: { lines: d.lines.length, total: d.lines.reduce((n, l) => n + l.amount, 0) } });
  });
}

export async function setStructureActive(ctx: AuthContext, id: string, active: boolean) {
  requirePermission(ctx, "fees.manage");
  const s = await db.feeStructure.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!s) throw notFound("Fee structure");
  try {
    await db.$transaction(async (tx) => {
      await tx.feeStructure.update({ where: { id }, data: { isActive: active } });
      await writeAudit(tx, actorOf(ctx), { action: active ? "fee_structure.activate" : "fee_structure.deactivate", entityType: "FeeStructure", entityId: id, summary: s.name });
    });
  } catch (e) {
    if (isUnique(e)) throw conflict("Another active fee structure already covers this class, level and year.");
    throw e;
  }
}

/** Most specific active structure wins: class, then level, then everyone. */
export async function resolveStructure(client: Db | Tx, schoolId: string, academicYearId: string, classId: string, levelId: string) {
  const include = { lines: { orderBy: { sortOrder: "asc" as const }, include: { feeItem: { select: { id: true, name: true } } } } };
  return (
    (await client.feeStructure.findFirst({ where: { schoolId, academicYearId, isActive: true, classId }, include })) ??
    (await client.feeStructure.findFirst({ where: { schoolId, academicYearId, isActive: true, classId: null, levelId }, include })) ??
    (await client.feeStructure.findFirst({ where: { schoolId, academicYearId, isActive: true, classId: null, levelId: null }, include }))
  );
}

// ───────────────────────── Discounts / scholarships ─────────────────────────

const discountSchema = z.object({
  studentId: uuid(),
  academicYearId: uuid(),
  name: text(80),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.union([z.string(), z.number()]),
  feeItemId: optUuid(),
  reason: text(300),
});

export async function listStudentDiscounts(ctx: AuthContext, studentId: string) {
  requirePermission(ctx, "fees.read");
  return db.studentDiscount.findMany({ where: { schoolId: ctx.schoolId, studentId }, orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
}

/** Percent values are stored as a percentage (12.5 = 12.5%); fixed values as money. Both use two decimals. */
export async function grantDiscount(ctx: AuthContext, input: unknown) {
  requirePermission(ctx, "fees.discount");
  const d = parse(discountSchema, input);
  const raw = parseAmount(d.value);
  if (raw === null || raw <= 0) throw invalid("Please correct the highlighted fields.", { value: d.kind === "PERCENT" ? "Enter a percentage such as 10 or 12.5" : "Enter an amount such as 50000" });
  if (d.kind === "PERCENT" && raw > 10_000) throw invalid("Please correct the highlighted fields.", { value: "A percentage cannot be more than 100" });
  if (!(await db.student.findFirst({ where: { id: d.studentId, schoolId: ctx.schoolId }, select: { id: true } }))) throw notFound("Student");
  if (!(await db.academicYear.findFirst({ where: { id: d.academicYearId, schoolId: ctx.schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { academicYearId: "Choose an academic year" });
  if (d.feeItemId && !(await db.feeItem.findFirst({ where: { id: d.feeItemId, schoolId: ctx.schoolId }, select: { id: true } }))) throw invalid("Please correct the highlighted fields.", { feeItemId: "Invalid fee item" });
  return db.$transaction(async (tx) => {
    const row = await tx.studentDiscount.create({ data: { schoolId: ctx.schoolId, studentId: d.studentId, academicYearId: d.academicYearId, name: d.name, kind: d.kind, value: decimalOf(raw), feeItemId: d.feeItemId ?? null, reason: d.reason, approvedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "discount.grant", entityType: "StudentDiscount", entityId: row.id, summary: d.name, reason: d.reason, changes: { studentId: d.studentId, kind: d.kind, value: decimalOf(raw) } });
    return row;
  });
}

export async function endDiscount(ctx: AuthContext, id: string) {
  requirePermission(ctx, "fees.discount");
  const row = await db.studentDiscount.findFirst({ where: { id, schoolId: ctx.schoolId } });
  if (!row) throw notFound("Discount");
  if (!row.isActive) return;
  await db.$transaction(async (tx) => {
    await tx.studentDiscount.update({ where: { id }, data: { isActive: false, endedAt: new Date(), endedById: ctx.userId } });
    await writeAudit(tx, actorOf(ctx), { action: "discount.end", entityType: "StudentDiscount", entityId: id, summary: row.name });
  });
}

// ───────────────────────── Financial clearance ─────────────────────────

/**
 * Students who are financially cleared for a term: they have at least one live invoice for the term (a student who
 * was never billed is NOT cleared) and their total outstanding over all live invoices is within the school's limit.
 */
export async function clearedStudents(client: Db | Tx, schoolId: string, termId: string, studentIds: string[]): Promise<Set<string>> {
  const [settings, finance] = await Promise.all([getFeeSettings(client, schoolId), loadFinance(client, schoolId, studentIds)]);
  const cleared = new Set<string>();
  for (const [id, f] of finance) {
    const billed = f.invoices.some((i) => i.termId === termId);
    if (billed && f.ledger.outstanding <= settings.clearanceMaxOutstandingCents) cleared.add(id);
  }
  return cleared;
}


/**
 * For academic staff: does this student's fee account need a look? Only a flag, never an amount, and only when the school has switched the
 * flag on in Fee settings. It blocks nothing: any restriction on examinations or report cards is a separate, explicit school policy.
 * Returns null when the flag is off or the student has no bill this term.
 */
export async function feeReviewFlag(ctx: AuthContext, studentId: string): Promise<{ status: "CLEARED" | "REVIEW" | "NOT_BILLED" } | null> {
  requireAnyPermission(ctx, ["fees.status.read", "fees.read"]);
  const settings = await getFeeSettings(db, ctx.schoolId);
  if (!settings.academicReviewFlag) return null;
  const term = await db.term.findFirst({ where: { schoolId: ctx.schoolId, isCurrent: true }, select: { id: true } });
  if (!term) return null;
  if (!(await db.student.findFirst({ where: { id: studentId, schoolId: ctx.schoolId }, select: { id: true } }))) throw notFound("Student");
  const billed = await db.invoice.count({ where: { schoolId: ctx.schoolId, studentId, termId: term.id, status: "ISSUED" } });
  if (!billed) return { status: "NOT_BILLED" };
  return { status: (await clearedStudents(db, ctx.schoolId, term.id, [studentId])).has(studentId) ? "CLEARED" : "REVIEW" };
}
