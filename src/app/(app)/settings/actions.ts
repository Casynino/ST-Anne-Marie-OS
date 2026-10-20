"use server";

import { run, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as settings from "@/server/settings";

export async function updateSchoolAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await settings.updateSchoolProfile(ctx, i), { message: makeT(ctx.locale)("common.saved") }));
}
export async function updateAdmissionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await settings.updateAdmissionSettings(ctx, i), { message: makeT(ctx.locale)("common.saved") }));
}
