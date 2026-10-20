"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as portal from "@/server/portal";

const withPassword = (t: ReturnType<typeof makeT>, temporaryPassword: string) => ({
  temporaryPassword,
  temporaryPasswordLabel: t("common.tempPassword"),
  temporaryPasswordNote: `${t("common.copyOnce")} ${t("portal.admin.passwordNote")}`,
});

export async function createGuardianAccountAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const r = await portal.createGuardianAccount(ctx, str(i.guardianId), { email: str(i.email) || undefined, phone: str(i.phone) || undefined });
    return { message: t("portal.admin.created"), data: withPassword(t, r.temporaryPassword) };
  });
}

export async function createStudentAccountAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const r = await portal.createStudentAccount(ctx, str(i.studentId), { email: str(i.email) || undefined, phone: str(i.phone) || undefined });
    return { message: t("portal.admin.created"), data: withPassword(t, r.temporaryPassword) };
  });
}

export async function resetPortalPasswordAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const t = makeT(ctx.locale);
    const r = await portal.resetPortalPassword(ctx, str(i.userId));
    return { message: t("portal.admin.reset"), data: withPassword(t, r.temporaryPassword) };
  });
}

export async function setPortalActiveAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await portal.setPortalAccountActive(ctx, str(i.userId), str(i.active) === "true");
    return { message: makeT(ctx.locale)("common.saved") };
  });
}
