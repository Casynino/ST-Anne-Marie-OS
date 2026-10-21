"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as users from "@/server/users";

export async function createUserAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const { user } = await users.createStaffUser(ctx, i);
    // The administrator chose the password, so it is not shown again; the person signs in with it.
    return { message: `${makeT(ctx.locale)("users.created")}: ${user.fullName}` };
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
    await users.resetUserPassword(ctx, str(i.id), str(i.password));
    return { message: makeT(ctx.locale)("users.reset.done") };
  });
}
