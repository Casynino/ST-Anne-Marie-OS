"use server";

import { run, str, list, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as exams from "@/server/exams";

export async function createExamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const exam = await exams.createExam(ctx, i);
    return { redirectTo: `/exams/${exam.id}` };
  });
}

export async function updateExamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await exams.updateExam(ctx, str(i.id), i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function deleteExamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await exams.deleteExam(ctx, str(i.id));
    return { redirectTo: "/exams" };
  });
}

export async function addExamSubjectsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await exams.addExamSubjects(ctx, str(i.examId), { classIds: list(i.classIds), maxMarks: str(i.maxMarks) || undefined });
    return { message: makeT(ctx.locale)("exam.subjectsAdded", { count: r.added }) };
  });
}

export async function removeExamSubjectAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await exams.removeExamSubject(ctx, str(i.examSubjectId));
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
