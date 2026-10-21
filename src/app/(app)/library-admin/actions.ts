"use server";

import { run, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as lib from "@/server/library";
import { setStudentPin, setStudentPins } from "@/server/library-identity";
import { updateLibrarySettings } from "@/server/library-settings";

const fileOf = (form: FormData, name: string) => {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
};
const asInput = async (f: File) => ({ fileName: f.name, bytes: Buffer.from(await f.arrayBuffer()) });

export async function createResourceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = fileOf(form, "file");
    if (!file) throw new AppError("VALIDATION", makeT(ctx.locale)("lib.m.chooseFile"), { file: "Required" });
    const cover = fileOf(form, "cover");
    const r = await lib.createResource(ctx, i, await asInput(file), cover ? await asInput(cover) : null);
    return { redirectTo: `/library-admin/${r.id}` };
  });
}

export async function updateResourceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const cover = fileOf(form, "cover");
    await lib.updateResource(ctx, str(i.id), i, cover ? await asInput(cover) : null);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function replaceFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = fileOf(form, "file");
    if (!file) throw new AppError("VALIDATION", makeT(ctx.locale)("lib.m.chooseFile"), { file: "Required" });
    await lib.replaceFile(ctx, str(i.id), await asInput(file), str(i.note) || undefined);
    return { message: makeT(ctx.locale)("lib.m.replaced") };
  });
}

const step = (fn: (ctx: Parameters<typeof lib.submitResource>[0], id: string, i: Record<string, string | string[] | undefined>) => Promise<unknown>, done: Parameters<ReturnType<typeof makeT>>[0]) =>
  async (_: ActionState, form: FormData) => run(form, async (ctx, i) => { await fn(ctx, str(i.id), i); return { message: makeT(ctx.locale)(done) }; });

export const submitResourceAction = step((c, id) => lib.submitResource(c, id), "lib.m.submitted");
export const approveResourceAction = step((c, id, i) => lib.approveResource(c, id, str(i.note) || undefined), "lib.m.approved");
export const returnResourceAction = step((c, id, i) => lib.returnResource(c, id, i.note), "lib.m.returned");
export const publishResourceAction = step((c, id) => lib.publishResource(c, id), "lib.m.published");
export const archiveResourceAction = step((c, id, i) => lib.archiveResource(c, id, str(i.reason) || undefined), "lib.m.archived");
export const restoreResourceAction = step((c, id) => lib.restoreResource(c, id), "lib.m.restored");

export async function createCategoryAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await lib.createCategory(ctx, i); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function updateCategoryAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await lib.updateCategory(ctx, str(i.id), i); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function updateLibrarySettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await updateLibrarySettings(ctx, i); return { message: makeT(ctx.locale)("common.saved") }; });
}

/** PINs are shown once, here, to be read out or printed; they are stored only as hashes. */
export async function setPinsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const list = await setStudentPins(ctx, { classId: str(i.classId), mode: str(i.mode) === "reset" ? "reset" : "missing" });
    if (list.length === 0) return { message: t("lib.pin.none") };
    return { message: `${t("lib.pin.once")}\n${list.map((s) => `${s.name} (${s.schoolId}): ${s.pin}`).join("\n")}` };
  });
}
export async function setPinAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const s = await setStudentPin(ctx, str(i.studentId));
    return { message: `${makeT(ctx.locale)("lib.pin.once")}\n${s.name} (${s.schoolId}): ${s.pin}` };
  });
}
