"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import { updateEnquiry } from "@/server/enquiries";

export async function updateEnquiryAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => (await updateEnquiry(ctx, str(i.id), i), { message: makeT(ctx.locale)("common.saved") }));
}
