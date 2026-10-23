"use server";

import { revalidatePath } from "next/cache";
import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as web from "@/server/website";

const saved = (locale: "EN" | "SW") => ({ message: makeT(locale)("common.saved") });

/** Events added here are the school's own events: the same service and rules as the website editor, allowed with `calendar.manage` too. */
export async function addCalendarEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await web.createEvent(ctx, i); revalidatePath("/school-calendar"); return saved(ctx.locale); });
}
export async function updateCalendarEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await web.updateEvent(ctx, str(i.id), i); revalidatePath("/school-calendar"); return saved(ctx.locale); });
}
export async function deleteCalendarEventAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await web.deleteEvent(ctx, str(i.id)); revalidatePath("/school-calendar"); return saved(ctx.locale); });
}
