"use server";

import { run, str, type ActionState } from "@/lib/action";
import { zonedToUtc } from "@/lib/dates";
import { invalid } from "@/lib/errors";
import { makeT } from "@/lib/i18n";
import * as asg from "@/server/assignments";
import { schoolTimezone } from "@/server/learning-access";
import { MAX_DOCUMENT_BYTES } from "@/server/documents";

type Input = Record<string, string | string[] | undefined>;

async function dueFrom(schoolId: string, i: Input) {
  const at = zonedToUtc(str(i.dueAt), await schoolTimezone(schoolId));
  if (!at) throw invalid("Please correct the highlighted fields.", { dueAt: "Enter a valid date and time" });
  return at.toISOString();
}

export async function createAssignmentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const [classId, subjectId, streamId] = str(i.unit).split("|");
    const a = await asg.createAssignment(ctx, { classId, subjectId, streamId: streamId ?? "", title: str(i.title), instructions: str(i.instructions), dueAt: await dueFrom(ctx.schoolId, i), maxScore: str(i.maxScore) });
    return { redirectTo: `/assignments/${a.id}` };
  });
}
export async function updateAssignmentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.updateAssignment(ctx, str(i.id), { title: str(i.title), instructions: str(i.instructions), dueAt: await dueFrom(ctx.schoolId, i), maxScore: str(i.maxScore) }); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function publishAssignmentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.publishAssignment(ctx, str(i.id)); return { message: makeT(ctx.locale)("learn.asg.published") }; });
}
export async function closeAssignmentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.closeAssignment(ctx, str(i.id)); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function reopenAssignmentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.reopenAssignment(ctx, str(i.id)); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function deleteAssignmentAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.deleteAssignment(ctx, str(i.id)); return { redirectTo: "/assignments" }; });
}
export async function releaseResultsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { const n = await asg.releaseResults(ctx, str(i.id)); return { message: makeT(ctx.locale)("learn.asg.released", { count: n }) }; });
}
export async function gradeAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await asg.gradeSubmission(ctx, str(i.assignmentId), str(i.studentId), { decision: str(i.intent) === "RETURN" ? "RETURN" : "GRADE", score: str(i.score), feedback: str(i.feedback), release: str(i.release) });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
export async function recordPaperAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.recordPaper(ctx, str(i.assignmentId), str(i.studentId), { note: str(i.note), late: str(i.late) }); return { message: makeT(ctx.locale)("common.saved") }; });
}
export async function attachFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw invalid("Choose a file to upload.", { file: "Required" });
    if (file.size > MAX_DOCUMENT_BYTES) throw invalid(`The file is too large. The limit is ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
    await asg.attachToAssignment(ctx, str(i.id), { fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
export async function removeFileAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => { await asg.removeAssignmentFile(ctx, str(i.fileId)); return { message: makeT(ctx.locale)("common.saved") }; });
}
