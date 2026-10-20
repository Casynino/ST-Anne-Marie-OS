"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as tt from "@/server/timetable";

export async function createPeriodAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await tt.createPeriod(ctx, i); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function updatePeriodAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await tt.updatePeriod(ctx, str(i.id), i); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function deletePeriodAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await tt.deletePeriod(ctx, str(i.id)); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function setLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await tt.setTimetableEntry(ctx, i); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function clearLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await tt.clearTimetableEntry(ctx, str(i.id)); return { message: makeT(ctx.locale)("common.saved") }; });
}
