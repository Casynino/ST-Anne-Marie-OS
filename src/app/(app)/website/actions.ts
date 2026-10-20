"use server";

import { run, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as web from "@/server/website";
import * as media from "@/server/media";

const saved = (locale: "EN" | "SW") => ({ message: makeT(locale)("common.saved") });

export async function saveContentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.updateWebsiteSettings(ctx, i), saved(ctx.locale)));
}
export async function createNewsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.createNews(ctx, i), saved(ctx.locale)));
}
export async function updateNewsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.updateNews(ctx, str(i.id), i), saved(ctx.locale)));
}
export async function publishNewsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.setNewsPublished(ctx, str(i.id), str(i.published) === "true"), saved(ctx.locale)));
}
export async function deleteNewsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.deleteNews(ctx, str(i.id)), saved(ctx.locale)));
}
export async function createEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.createEvent(ctx, i), saved(ctx.locale)));
}
export async function updateEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.updateEvent(ctx, str(i.id), i), saved(ctx.locale)));
}
export async function deleteEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await web.deleteEvent(ctx, str(i.id)), saved(ctx.locale)));
}

export async function uploadMediaAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Choose an image to upload.", { file: "Required" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await media.uploadMedia(ctx, { name: file.name, bytes }, i);
    return saved(ctx.locale);
  });
}
export async function deleteMediaAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await media.deleteMedia(ctx, str(i.id)), saved(ctx.locale)));
}
