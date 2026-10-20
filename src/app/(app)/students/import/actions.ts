"use server";

import { run, str, type ActionState } from "@/lib/action";
import { invalid } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as imports from "@/server/import";

export async function uploadImportAction(_: ActionState, form: FormData) {
  return run(form, async (ctx) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw invalid("Choose a CSV file.", { file: "Required" });
    if (file.size > imports.MAX_IMPORT_BYTES) throw invalid("The file is too large. Split it into files of at most 1,000 students.", { file: "File too large" });
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw invalid("The file is not saved as UTF-8. In Excel choose Save As, then CSV UTF-8.", { file: "Not UTF-8" });
    }
    const batch = await imports.createImportBatch(ctx, { fileName: file.name, text });
    return { redirectTo: `/students/import/${batch.id}` };
  });
}

export async function confirmImportAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const res = await imports.confirmImport(ctx, str(i.id), { includeWarnings: i.includeWarnings === "on" });
    return { message: makeT(ctx.locale)("imp.done.summary", { imported: res.imported, skipped: res.skipped, errors: res.errors, duplicates: res.duplicates }) };
  });
}

export async function cancelImportAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await imports.cancelImport(ctx, str(i.id));
    return { redirectTo: "/students/import" };
  });
}
