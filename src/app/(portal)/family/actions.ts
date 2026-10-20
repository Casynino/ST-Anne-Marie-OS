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

// ───────── Learning hub (student hand-in and portfolio; parents cannot call these) ─────────
import { invalid } from "@/lib/errors";
import * as asg from "@/server/assignments";
import * as pf from "@/server/portfolio";
import { MAX_DOCUMENT_BYTES } from "@/server/documents";
import { MAX_FILES_PER_OWNER } from "@/server/learning-store";

async function filesFrom(form: FormData) {
  const picked = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (picked.length > MAX_FILES_PER_OWNER) throw invalid(`At most ${MAX_FILES_PER_OWNER} files can be attached here.`, { file: "Too many files" });
  const out: { fileName: string; bytes: Buffer }[] = [];
  for (const f of picked) {
    if (f.size > MAX_DOCUMENT_BYTES) throw invalid(`The file is too large. The limit is ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
    out.push({ fileName: f.name, bytes: Buffer.from(await f.arrayBuffer()) });
  }
  return out;
}

export async function submitWorkAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await asg.submitWork(ctx, str(i.assignmentId), { text: str(i.text) }, await filesFrom(form));
    return { message: makeT(ctx.locale)(r.late ? "learn.sub.sentLate" : "learn.sub.sent") };
  });
}
export async function removeMyFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.removeMySubmissionFile(ctx, str(i.fileId)); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function addMyPortfolioAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const files = await filesFrom(form);
    const item = await pf.addMyPortfolioItem(ctx, { title: str(i.title), description: str(i.description) });
    for (const f of files) await pf.attachToPortfolio(ctx, item.id, f);
    return { message: makeT(ctx.locale)("learn.pf.sentForReview") };
  });
}
export async function removeMyPortfolioFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await pf.removePortfolioFile(ctx, str(i.fileId)); return { message: makeT(ctx.locale)("common.saved") }; });
}
