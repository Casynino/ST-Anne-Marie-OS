"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as comm from "@/server/communication";
import * as msg from "@/server/messaging";
import { markAllNotificationsRead, markNotificationRead } from "@/server/notifications";

export async function startMessageAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { const t = await msg.startThread(ctx, i); return { redirectTo: `/family/messages/${t.id}` }; });
}
export async function replyMessageAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.replyAsGuardian(ctx, str(i.threadId), i); return { message: makeT(ctx.locale)("msg.sent") }; });
}
export async function flagFamilyMessageAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.flagMessage(ctx, str(i.messageId), i); return { message: makeT(ctx.locale)("msg.flagged") }; });
}
export async function markReadAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await markNotificationRead(ctx, str(i.id)); });
}
export async function markAllReadAction(_: ActionState, form: FormData) {
  return run(form, async (ctx) => { await markAllNotificationsRead(ctx); });
}
export async function setPreferenceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await comm.setMyPreference(ctx, { category: str(i.category), smsEnabled: str(i.smsEnabled) === "on", inAppEnabled: str(i.inAppEnabled) === "on" });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
