"use server";

import { run, str, type ActionState } from "@/lib/action";
import { getRequestMeta } from "@/lib/auth/next";
import { makeT } from "@/lib/i18n";
import { cancelMyApplication, sandboxPay } from "@/server/application-fee";

/** Local testing only (refused unless the sandbox is on and the app is not in production): stands in for the provider's confirmation. */
export async function sandboxPayAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await sandboxPay(ctx, str(i.id), await getRequestMeta());
    const t = makeT(ctx.locale);
    return { message: r.outcome === "SUBMITTED" || r.outcome === "ALREADY" ? t("apf.paid.done") : t("apf.paid.hold") };
  });
}

export async function cancelApplicationAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await cancelMyApplication(ctx, str(i.id));
    return { redirectTo: "/family/applications" };
  });
}
