"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import { formatMoney } from "@/lib/finance/money";
import * as fees from "@/server/fees";
import * as invoices from "@/server/invoices";
import * as payments from "@/server/payments";
import * as expenses from "@/server/expenses";
import * as events from "@/server/payment-events";

type Input = Record<string, string | string[] | undefined>;
const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

// ───────────── Fee setup ─────────────
export async function createFeeItemAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.createFeeItem(ctx, i); return saved(ctx); });
}
export async function updateFeeItemAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.updateFeeItem(ctx, str(i.id), i); return saved(ctx); });
}

/** Lines come from `amount:<feeItemId>` (blank = not charged) and `term:<feeItemId>` (blank = every term). */
function structureInput(i: Input) {
  const lines = Object.keys(i)
    .filter((k) => k.startsWith("amount:") && str(i[k]))
    .map((k) => {
      const feeItemId = k.slice(7);
      const term = str(i[`term:${feeItemId}`]);
      return { feeItemId, amount: str(i[k]), termSequence: term ? Number(term) : null };
    });
  return { academicYearId: str(i.academicYearId), name: str(i.name), levelId: str(i.levelId) || undefined, classId: str(i.classId) || undefined, lines };
}
export async function createStructureAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.createStructure(ctx, structureInput(i)); return { redirectTo: "/finance/fees" }; });
}
export async function updateStructureAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.updateStructure(ctx, str(i.id), structureInput(i)); return saved(ctx); });
}
export async function setStructureActiveAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.setStructureActive(ctx, str(i.id), str(i.active) === "true"); return saved(ctx); });
}
export async function updateFeeSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.updateFeeSettings(ctx, i); return saved(ctx); });
}
export async function grantDiscountAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.grantDiscount(ctx, i); return saved(ctx); });
}
export async function endDiscountAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await fees.endDiscount(ctx, str(i.id)); return saved(ctx); });
}

// ───────────── Invoices ─────────────
export async function generateInvoicesAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await invoices.generateTermInvoices(ctx, { termId: str(i.termId), classId: str(i.classId) || undefined, streamId: str(i.streamId) || undefined, dueDate: str(i.dueDate) });
    return { message: makeT(ctx.locale)("fin.invoices.generated", { created: r.created, skipped: r.alreadyInvoiced, billed: formatMoney(r.billedCents) }) };
  });
}
export async function createOtherInvoiceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { const inv = await invoices.createOtherInvoice(ctx, i); return { redirectTo: `/finance/invoices/${inv.id}` }; });
}
export async function addInvoiceLineAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await invoices.addInvoiceLine(ctx, str(i.invoiceId), i); return saved(ctx); });
}
export async function setInstalmentsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await invoices.setInstalments(ctx, str(i.invoiceId), { items: invoices.parseInstalmentLines(str(i.items)) }); return saved(ctx); });
}
export async function voidInvoiceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await invoices.voidInvoice(ctx, str(i.invoiceId), i); return saved(ctx); });
}

// ───────────── Payments & refunds ─────────────
export async function recordPaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await payments.recordPayment(ctx, i);
    return { redirectTo: `/finance/payments/${r.payment.id}` };
  });
}
export async function reversePaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await payments.reversePayment(ctx, str(i.paymentId), i); return saved(ctx); });
}
export async function requestRefundAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await payments.requestRefund(ctx, i); return { redirectTo: "/finance/refunds" }; });
}
export async function decideRefundAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await payments.decideRefund(ctx, str(i.refundId), i); return saved(ctx); });
}
export async function payRefundAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await payments.payRefund(ctx, str(i.refundId), i); return saved(ctx); });
}

// ───────────── Reconciliation ─────────────
export async function assignEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await events.assignPaymentEvent(ctx, str(i.eventId), { studentId: str(i.studentId), targetInvoiceId: str(i.targetInvoiceId) || undefined }); return saved(ctx); });
}
export async function rejectEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await events.rejectPaymentEvent(ctx, str(i.eventId), i); return saved(ctx); });
}

// ───────────── Expenses ─────────────
export async function createCategoryAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.createExpenseCategory(ctx, i); return saved(ctx); });
}
export async function toggleCategoryAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.setExpenseCategoryActive(ctx, str(i.id), str(i.active) === "true"); return saved(ctx); });
}
export async function recordExpenseAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.recordExpense(ctx, i); return saved(ctx); });
}
export async function approveExpenseAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.approveExpense(ctx, str(i.id)); return saved(ctx); });
}
export async function rejectExpenseAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.rejectExpense(ctx, str(i.id), i); return saved(ctx); });
}
export async function categoryApprovalAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.setExpenseCategoryApproval(ctx, str(i.id), str(i.required) === "true"); return saved(ctx); });
}
export async function voidExpenseAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await expenses.voidExpense(ctx, str(i.id), i); return saved(ctx); });
}

