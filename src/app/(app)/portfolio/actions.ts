"use server";

import { run, str, type ActionState } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as pf from "@/server/portfolio";
import { MAX_DOCUMENT_BYTES } from "@/server/documents";

async function fileFrom(form: FormData, required: boolean) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    if (required) throw invalid("Choose a file to upload.", { file: "Required" });
    return null;
  }
  if (file.size > MAX_DOCUMENT_BYTES) throw invalid(`The file is too large. The limit is ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
  return { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) };
}

export async function addPortfolioAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = await fileFrom(form, false);
    const item = await pf.addPortfolioItem(ctx, str(i.studentId), { title: str(i.title), description: str(i.description), subjectId: str(i.subjectId), comment: str(i.comment) });
    if (file) await pf.attachToPortfolio(ctx, item.id, file);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
export async function reviewPortfolioAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await pf.reviewPortfolioItem(ctx, str(i.id), { decision: str(i.intent) === "REMOVE" ? "REMOVE" : "PUBLISH", comment: str(i.comment) }); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function attachPortfolioFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await pf.attachToPortfolio(ctx, str(i.id), (await fileFrom(form, true))!); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function removePortfolioFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await pf.removePortfolioFile(ctx, str(i.fileId)); return { message: makeT(ctx.locale)("common.saved") }; });
}
