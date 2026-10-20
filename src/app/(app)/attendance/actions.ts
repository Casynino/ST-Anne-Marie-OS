"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as att from "@/server/attendance";
import { markNotificationRead } from "@/server/notifications";

export async function correctAttendanceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await att.correctAttendance(ctx, { attendanceId: str(i.attendanceId), status: str(i.status), reason: str(i.reason) });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function resolveConflictAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await att.resolveConflict(ctx, { operationId: str(i.operationId), action: str(i.action), reason: str(i.reason) });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function saveStaffAttendanceAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const entries = Object.entries(i)
      .filter(([k, v]) => k.startsWith("s_") && typeof v === "string" && v)
      .map(([k, v]) => ({ staffId: k.slice(2), status: v, note: str(i[`n_${k.slice(2)}`]) || undefined }));
    await att.recordStaffAttendance(ctx, { date: str(i.date), entries });
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function updateAttendanceSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await att.updateAttendanceSettings(ctx, i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function createSessionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await att.createAttendanceSession(ctx, i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function toggleSessionAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await att.setAttendanceSessionActive(ctx, str(i.sessionId), str(i.active) === "true");
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function markNotificationReadAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await markNotificationRead(ctx, str(i.id));
  });
}
