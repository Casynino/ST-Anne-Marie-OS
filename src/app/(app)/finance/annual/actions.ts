"use server";

import { run, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import { billReturningStudents } from "@/server/annual-fees";

export async function billReturningAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await billReturningStudents(ctx, { yearId: i.yearId, dueDate: i.dueDate });
    const t = makeT(ctx.locale);
    return { message: t("lc.fee.billed", { n: r.created, skipped: r.alreadyInvoiced }) };
  });
}
