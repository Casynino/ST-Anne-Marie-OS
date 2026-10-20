"use server";

import { revalidatePath } from "next/cache";
import { run, str, list, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as marks from "@/server/marks";

export async function saveMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const id = str(i.submissionId);
    const entries = Object.keys(i)
      .filter((k) => k.startsWith("status:"))
      .map((k) => {
        const studentId = k.slice(7);
        return { studentId, status: str(i[k]) || null, score: str(i[`score:${studentId}`]) || null };
      });
    const expectedVersion = str(i.expectedVersion) ? Number(str(i.expectedVersion)) : undefined;
    const saved = await marks.saveMarks(ctx, id, { expectedVersion, entries });
    if (str(i.intent) === "submit") {
      try {
        await marks.submitMarks(ctx, id);
      } catch (e) {
        // The draft was saved; refresh the page data so the next attempt uses the new version.
        if (e instanceof AppError) revalidatePath("/", "layout");
        throw e;
      }
      return { message: t("marks.submitted") };
    }
    return { message: t("marks.saved", { count: saved.saved + saved.cleared }) };
  });
}

export async function approveMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await marks.approveMarks(ctx, str(i.id));
    return { message: makeT(ctx.locale)("marks.approved") };
  });
}

export async function returnMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await marks.returnMarks(ctx, str(i.id), { reason: str(i.reason) });
    return { message: makeT(ctx.locale)("marks.returned") };
  });
}

export async function lockMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await marks.lockMarks(ctx, str(i.id));
    return { message: makeT(ctx.locale)("marks.locked") };
  });
}

export async function unlockMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await marks.unlockMarks(ctx, str(i.id), { reason: str(i.reason) });
    return { message: makeT(ctx.locale)("marks.unlocked") };
  });
}

export async function bulkMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const action = str(i.intent) === "lock" ? "lock" : "approve";
    const r = await marks.bulkTransition(ctx, action, list(i.ids));
    if (r.failed.length && !r.done.length) throw new AppError("CONFLICT", r.failed[0]!.error);
    return { message: t("marks.bulkDone", { done: r.done.length, failed: r.failed.length }) };
  });
}
