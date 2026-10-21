"use server";

import { run, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { getRequestMeta } from "@/lib/auth/next";
import { makeT } from "@/lib/i18n";
import { cancelMyApplication, sandboxPay } from "@/server/application-fee";
import { confirmMyApplication, removeMyDocument, resubmitMyApplication, updateMyApplication, uploadMyDocument } from "@/server/application-draft";
import { MAX_DOCUMENT_BYTES } from "@/server/documents";

/** Local testing only (refused unless the sandbox is on and the app is not in production): stands in for the provider's confirmation. */
export async function sandboxPayAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await sandboxPay(ctx, str(i.id), await getRequestMeta());
    const t = makeT(ctx.locale);
    return { message: r.outcome === "SUBMITTED" || r.outcome === "ALREADY" ? t("apf.paid.done") : t("apf.paid.hold") };
  });
}

export async function cancelApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await cancelMyApplication(ctx, str(i.id));
    return { redirectTo: "/family/applications" };
  });
}

export async function updateApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await updateMyApplication(ctx, str(i.id), i);
    return { redirectTo: `/family/applications/${str(i.id)}` };
  });
}

export async function confirmApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await confirmMyApplication(ctx, str(i.id));
    return { message: makeT(ctx.locale)("apf.confirm.done") };
  });
}

export async function uploadApplicationFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", t("apf.file.choose"), { file: "Required" });
    if (file.size > MAX_DOCUMENT_BYTES) throw new AppError("VALIDATION", t("apf.file.tooBig", { mb: String(Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)) }), { file: "File too large" });
    await uploadMyDocument(ctx, str(i.id), { docType: i.docType, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return { message: t("apf.file.added") };
  });
}

export async function removeApplicationFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await removeMyDocument(ctx, str(i.documentId));
    return { message: makeT(ctx.locale)("apf.file.removed") };
  });
}

export async function resubmitApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await resubmitMyApplication(ctx, str(i.id));
    return { message: makeT(ctx.locale)("apf.returned.sent") };
  });
}
