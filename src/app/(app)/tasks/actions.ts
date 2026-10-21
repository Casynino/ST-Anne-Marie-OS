"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as workflow from "@/server/workflow";

const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function startTaskAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await workflow.startTask(ctx, str(i.id)); return saved(ctx); });
}
export async function completeTaskAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await workflow.completeTask(ctx, str(i.id), { note: i.note }); return saved(ctx); });
}
export async function assignTaskAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await workflow.assignTask(ctx, str(i.id), { userId: i.userId }); return saved(ctx); });
}
import { refreshFinanceTasks } from "@/server/finance-tasks";
export async function refreshFinanceTasksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx) => { const r = await refreshFinanceTasks(ctx); return { message: `${makeT(ctx.locale)("common.saved")}: ${r.due} / ${r.overdue}` }; });
}
