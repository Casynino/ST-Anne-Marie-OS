"use server";

import { run, str, list, type ActionState } from "@/lib/action";
import * as ac from "@/server/academics";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { makeT } from "@/lib/i18n";

const ok = (ctxLocale: "EN" | "SW") => ({ message: makeT(ctxLocale)("common.saved") });

export async function createYearAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.createAcademicYear(ctx, i), ok(ctx.locale)));
}
export async function setCurrentYearAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.setCurrentAcademicYear(ctx, str(i.id)), ok(ctx.locale)));
}
export async function createTermAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.createTerm(ctx, i), ok(ctx.locale)));
}
export async function setCurrentTermAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.setCurrentTerm(ctx, str(i.id)), ok(ctx.locale)));
}
export async function createLevelAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.createLevel(ctx, i), ok(ctx.locale)));
}
export async function deleteLevelAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.deleteLevel(ctx, str(i.id)), ok(ctx.locale)));
}
export async function createClassAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.createClass(ctx, i), ok(ctx.locale)));
}
export async function bulkClassesAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await ac.createClassesBulk(ctx, str(i.levelId), str(i.names).split(/\r?\n|,/));
    return { message: `${r.created} added${r.skipped ? `, ${r.skipped} already existed` : ""}.` };
  });
}
export async function toggleClassActiveAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const cls = await db.schoolClass.findFirst({ where: { id: str(i.id), schoolId: ctx.schoolId } });
    if (!cls) throw notFound("Class");
    await ac.updateClass(ctx, cls.id, { levelId: cls.levelId, name: cls.name, nameSw: cls.nameSw ?? "", sortOrder: String(cls.sortOrder), isActive: cls.isActive ? "" : "on" });
    return ok(ctx.locale);
  });
}
export async function createStreamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.createStream(ctx, str(i.classId), str(i.name)), ok(ctx.locale)));
}
export async function deleteStreamAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.deleteStream(ctx, str(i.id)), ok(ctx.locale)));
}
export async function createSubjectAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.createSubject(ctx, i), ok(ctx.locale)));
}
export async function toggleSubjectActiveAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const s = await db.subject.findFirst({ where: { id: str(i.id), schoolId: ctx.schoolId } });
    if (!s) throw notFound("Subject");
    await ac.updateSubject(ctx, s.id, { code: s.code, name: s.name, nameSw: s.nameSw ?? "", isActive: s.isActive ? "" : "on" });
    return ok(ctx.locale);
  });
}
export async function setClassSubjectsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.setClassSubjects(ctx, str(i.classId), list(i.subjectIds)), ok(ctx.locale)));
}
export async function setClassTeacherAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.setClassTeacher(ctx, i), ok(ctx.locale)));
}
export async function removeClassTeacherAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.removeClassTeacher(ctx, str(i.id)), ok(ctx.locale)));
}
export async function addSubjectTeacherAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.addSubjectTeacher(ctx, i), ok(ctx.locale)));
}
export async function removeSubjectTeacherAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await ac.removeSubjectTeacher(ctx, str(i.id)), ok(ctx.locale)));
}
