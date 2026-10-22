"use server";

import { run, str, list, type ActionState } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as reg from "@/server/annual-registration";
import { addRegistrationFollowUp } from "@/server/registration-followups";

const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function createRegistrationsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await reg.createMissingRegistrations(ctx, { yearId: i.yearId });
    return { message: makeT(ctx.locale)("lc.ret.created", { n: r.created }) };
  });
}

export async function placeReturningAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [classId, streamId] = str(i.placement).split("|");
    await reg.placeReturning(ctx, { registrationId: i.id, classId, streamId: streamId || undefined, overrideCapacity: i.overrideCapacity, overrideReason: i.overrideReason, gradeReason: i.gradeReason });
    return saved(ctx);
  }, { mapFieldErrors: (e) => ({ ...e, placement: e.classId ?? e.streamId ?? "" }) });
}

export async function confirmRegistrationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await reg.confirmRegistration(ctx, { registrationId: i.id, confirmed: i.confirmed, note: i.note }); return saved(ctx); });
}

/** Puts the ticked students in the class roster; each one is reported on its own. */
export async function activateAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const ids = list(i.ids);
    const t = makeT(ctx.locale);
    if (ids.length === 0) throw invalid(t("lc.pick"), {});
    const res = await reg.activateRegistrations(ctx, ids);
    const ok = res.filter((r) => r.ok).length;
    const bad = res.filter((r) => !r.ok);
    const lines = [t("lc.result.done", { n: ok })];
    if (bad.length) lines.push(t("lc.result.failed", { n: bad.length }), ...bad.slice(0, 12).map((b) => `• ${b.name ? `${b.name}: ` : ""}${b.message}`));
    if (ok === 0) throw invalid(lines.slice(1).join("\n"), {});
    return { message: lines.join("\n") };
  });
}

export async function cancelRegistrationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await reg.cancelRegistration(ctx, { registrationId: i.id, reason: i.reason }); return saved(ctx); });
}
export async function reopenRegistrationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await reg.reopenRegistration(ctx, { registrationId: i.id }); return saved(ctx); });
}
export async function clearanceExceptionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await reg.setClearanceException(ctx, { registrationId: i.id, reason: i.reason }); return saved(ctx); });
}
export async function removeClearanceExceptionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await reg.removeClearanceException(ctx, { registrationId: i.id }); return saved(ctx); });
}

export async function followUpAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await addRegistrationFollowUp(ctx, { registrationId: i.id, outcome: i.outcome, note: i.note }); return saved(ctx); });
}
