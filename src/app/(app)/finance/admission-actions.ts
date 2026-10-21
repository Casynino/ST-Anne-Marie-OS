"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as offers from "@/server/admission-offers";

const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function recordAdmissionPaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await offers.recordAdmissionPayment(ctx, str(i.applicationId), { amount: i.amount, method: i.method, reference: i.reference, paidOn: i.paidOn, payerName: i.payerName, notes: i.notes, idempotencyKey: i.idempotencyKey });
    return saved(ctx);
  });
}
export async function verifyAdmissionPaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.verifyAdmissionPayment(ctx, str(i.paymentId)); return saved(ctx); });
}
export async function rejectAdmissionPaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.rejectAdmissionPayment(ctx, str(i.paymentId), { reason: i.reason }); return saved(ctx); });
}
export async function reverseAdmissionPaymentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await offers.reverseAdmissionPayment(ctx, str(i.paymentId), { reason: i.reason }); return saved(ctx); });
}
