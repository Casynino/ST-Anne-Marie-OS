"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as bh from "@/server/behaviour";

export async function recordBehaviourAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await bh.recordBehaviour(ctx, { studentId: str(i.studentId), occurredOn: str(i.occurredOn), type: str(i.type), category: str(i.category), description: str(i.description), action: str(i.action), share: str(i.share) });
    return { redirectTo: "/behaviour" };
  });
}
export async function shareBehaviourAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await bh.setBehaviourShared(ctx, str(i.id), str(i.share) === "1"); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function voidBehaviourAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await bh.voidBehaviour(ctx, str(i.id), str(i.reason)); return { message: makeT(ctx.locale)("common.saved") }; });
}
