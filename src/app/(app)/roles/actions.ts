"use server";

import { run, str, list, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as rbac from "@/server/rbac";

export async function createRoleAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await rbac.createRole(ctx, i), { message: makeT(ctx.locale)("common.saved") }));
}
export async function saveRolePermissionsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await rbac.setRolePermissions(ctx, str(i.roleId), list(i.permissions)), { message: makeT(ctx.locale)("common.saved") }));
}
export async function deleteRoleAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await rbac.deleteRole(ctx, str(i.roleId)), { message: makeT(ctx.locale)("common.saved") }));
}
