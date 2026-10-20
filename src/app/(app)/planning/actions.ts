"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as plans from "@/server/lesson-plans";
import { unitFrom, weeksFrom } from "./_lib";

export async function createSchemeAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const u = unitFrom(str(i.unit));
    const s = await plans.createScheme(ctx, { classId: u.classId, subjectId: u.subjectId, termId: str(i.termId), title: str(i.title), weeks: weeksFrom(i) });
    return { redirectTo: `/planning/schemes/${s.id}` };
  });
}
export async function updateSchemeAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.updateScheme(ctx, str(i.id), { title: str(i.title), termId: str(i.termId), weeks: weeksFrom(i) }); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function submitSchemeAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.submitScheme(ctx, str(i.id)); return { message: makeT(ctx.locale)("learn.plan.submitted") }; });
}
export async function reviewSchemeAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.reviewScheme(ctx, str(i.id), { decision: str(i.decision), note: str(i.note) }); return { message: makeT(ctx.locale)("common.saved") }; });
}

export async function createLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const u = unitFrom(str(i.unit));
    const p = await plans.createLessonPlan(ctx, { classId: u.classId, subjectId: u.subjectId, streamId: u.streamId, lessonDate: str(i.lessonDate), topic: str(i.topic), objectives: str(i.objectives), activities: str(i.activities), resources: str(i.resources), assessment: str(i.assessment), homework: str(i.homework) });
    return { redirectTo: `/planning/lessons/${p.id}` };
  });
}
export async function updateLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.updateLessonPlan(ctx, str(i.id), i); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function submitLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.submitLessonPlan(ctx, str(i.id)); return { message: makeT(ctx.locale)("learn.plan.submitted") }; });
}
export async function reflectLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.addReflection(ctx, str(i.id), { reflection: str(i.reflection) }); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function reviewLessonAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await plans.reviewLessonPlan(ctx, str(i.id), { decision: str(i.decision), note: str(i.note) }); return { message: makeT(ctx.locale)("common.saved") }; });
}
