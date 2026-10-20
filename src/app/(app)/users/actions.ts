"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as users from "@/server/users";

export async function createUserAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const { user, temporaryPassword } = await users.createStaffUser(ctx, i);
    const t = makeT(ctx.locale);
    // Show the one-time password on the form instead of redirecting, so the admin can hand it over.
    return { message: `${t("users.created")}: ${user.fullName}`, data: { temporaryPassword, temporaryPasswordLabel: t("common.tempPassword"), temporaryPasswordNote: `${t("common.copyOnce")} ${t("common.tempPassword.note")}` } };
  });
}

export async function updateUserAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await users.updateStaffUser(ctx, str(i.id), i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function setUserStatusAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await users.setUserStatus(ctx, str(i.id), str(i.status) === "SUSPENDED" ? "SUSPENDED" : "ACTIVE", str(i.reason) || undefined);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

export async function resetPasswordAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const { temporaryPassword } = await users.resetUserPassword(ctx, str(i.id));
    const t = makeT(ctx.locale);
    return { message: t("users.reset.done"), data: { temporaryPassword, temporaryPasswordLabel: t("common.tempPassword"), temporaryPasswordNote: `${t("common.copyOnce")} ${t("common.tempPassword.note")}` } };
  });
}
