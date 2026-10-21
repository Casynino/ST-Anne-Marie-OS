"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as exams from "@/server/admission-exams";

/** Admissions or the Academic Office assigns a teacher to one subject of an interview. Every rule is in the service. */
export async function assignExamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await exams.assignExam(ctx, str(i.interviewId), { subjectId: i.subjectId, teacherId: i.teacherId, maxMark: i.maxMark, dueOn: i.dueOn, instructions: i.instructions });
    return { message: makeT(ctx.locale)(r.already ? "exam.assign.already" : "exam.assign.done") };
  });
}

export async function removeExamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await exams.removeExam(ctx, str(i.examId), str(i.reason));
    return { message: makeT(ctx.locale)("exam.remove.done") };
  });
}

/** The assigned teacher saves a draft or submits the result (the button's intent). */
export async function saveMarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await exams.saveExamMarks(ctx, str(i.examId), { mark: i.mark, outcome: i.outcome, comment: i.comment, submit: str(i.intent) === "SUBMIT" });
    return { message: makeT(ctx.locale)(r.status === "SUBMITTED" ? "exam.marks.submitted" : "exam.marks.saved") };
  });
}

export async function reviewExamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await exams.reviewExam(ctx, str(i.examId), { decision: str(i.intent), note: i.note });
    return { message: makeT(ctx.locale)(r.status === "RETURNED" ? "exam.review.returned" : "exam.review.approved") };
  });
}
