"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as comm from "@/server/communication";
import * as msg from "@/server/messaging";
import { processPendingEvents } from "@/server/notifications";
import { getSchoolBasics } from "@/server/settings";
import { broadcastInput } from "./_lib";

const saved = (ctx: { locale: "EN" | "SW" }) => ({ message: makeT(ctx.locale)("common.saved") });

export async function sendBroadcastAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const school = await getSchoolBasics(ctx.schoolId);
    const b = await comm.createBroadcast(ctx, broadcastInput(i, school.timezone));
    // Send now what is due now; scheduled or large sends continue from the cron route.
    if (b.sendAt.getTime() <= Date.now() + 1000) await processPendingEvents({ schoolId: ctx.schoolId, limit: 200 }).catch(() => undefined);
    return { redirectTo: `/communication/${b.id}` };
  });
}

export async function cancelBroadcastAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await comm.cancelBroadcast(ctx, str(i.id));
    return { message: makeT(ctx.locale)("comm.cancelled", { count: r.stopped }) };
  });
}

export async function saveTemplateAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await comm.saveTemplate(ctx, i); return saved(ctx); });
}

// ───────────── Staff messaging ─────────────
export async function startStaffThreadAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { const t = await msg.startThreadAsStaff(ctx, i); return { redirectTo: `/communication/messages/${t.id}` }; });
}
export async function replyStaffAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.replyAsStaff(ctx, str(i.threadId), i); return saved(ctx); });
}
export async function setThreadStatusAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.setThreadStatus(ctx, str(i.threadId), str(i.status) === "CLOSED" ? "CLOSED" : "OPEN"); return saved(ctx); });
}
export async function assignThreadAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.assignThread(ctx, str(i.threadId), str(i.staffUserId) || null); return saved(ctx); });
}
export async function flagMessageAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.flagMessage(ctx, str(i.messageId), i); return { message: makeT(ctx.locale)("msg.flagged") }; });
}
export async function hideMessageAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.hideMessage(ctx, str(i.messageId), i); return saved(ctx); });
}
export async function unhideMessageAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.unhideMessage(ctx, str(i.messageId)); return saved(ctx); });
}
export async function dismissFlagAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await msg.dismissFlag(ctx, str(i.messageId)); return saved(ctx); });
}
