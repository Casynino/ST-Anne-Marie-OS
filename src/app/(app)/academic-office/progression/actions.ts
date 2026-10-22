"use server";

import { run, str, list, type ActionState } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as prog from "@/server/progression";
import { updateLifecycleSettings } from "@/server/lifecycle-settings";

type Line = { name: string; ok: boolean; message: string };

/** One message for a whole selection: how many were done, and each one that was not, with the reason. If nothing was done it is shown as an error. */
function summary(locale: "EN" | "SW", rows: Line[]) {
  const t = makeT(locale);
  const ok = rows.filter((r) => r.ok).length;
  const bad = rows.filter((r) => !r.ok);
  const lines = [t("lc.result.done", { n: ok })];
  if (bad.length) lines.push(t("lc.result.failed", { n: bad.length }), ...bad.slice(0, 12).map((b) => `• ${b.name ? `${b.name}: ` : ""}${b.message}`));
  if (ok === 0 && bad.length) throw invalid(lines.slice(1).join("\n"), {});
  return { message: lines.join("\n") };
}

export async function progressionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const studentIds = list(i.studentIds);
    if (studentIds.length === 0) throw invalid(makeT(ctx.locale)("lc.pick"), {});
    if (i.intent === "approve") return summary(ctx.locale, (await prog.approveForStudents(ctx, { yearId: i.yearId, studentIds })).map((r) => ({ name: r.name, ok: r.ok, message: r.message })));
    const res = await prog.decideProgressions(ctx, { yearId: i.yearId, studentIds, outcome: i.outcome, toClassId: i.toClassId, note: i.note, exceptionReason: i.exceptionReason });
    return summary(ctx.locale, res);
  });
}

export async function prepareAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await prog.prepareProgressions(ctx, { yearId: i.yearId, classId: i.classId });
    return { message: makeT(ctx.locale)("lc.prepare.done", { created: r.created, promoted: r.promoted, review: r.review, skipped: r.skipped }) };
  });
}

export async function sendBackAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await prog.sendBackProgression(ctx, { id: i.id, reason: i.reason }); return { message: makeT(ctx.locale)("common.saved") }; });
}

export async function reviseAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await prog.reviseProgression(ctx, { id: i.id, outcome: i.outcome, toClassId: i.toClassId, note: i.note, exceptionReason: i.exceptionReason }); return { message: makeT(ctx.locale)("common.saved") }; });
}

export async function lifecycleSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await updateLifecycleSettings(ctx, { requireHeadApproval: i.requireHeadApproval, promotionMinAverage: str(i.promotionMinAverage), feePolicy: i.feePolicy, previousDebtCounts: i.previousDebtCounts }); return { message: makeT(ctx.locale)("common.saved") }; });
}
