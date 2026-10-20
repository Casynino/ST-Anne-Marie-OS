"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as grading from "@/server/grading";

export async function createScaleAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await grading.createScale(ctx, i);
    return { redirectTo: "/grading" };
  });
}

export async function updateScaleAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await grading.updateScale(ctx, str(i.id), i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function deleteScaleAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await grading.deleteScale(ctx, str(i.id));
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function updateResultsSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await grading.updateResultsSettings(ctx, i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
