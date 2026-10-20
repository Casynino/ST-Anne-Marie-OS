"use server";

import { publicRun, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { getRequestMeta, getT } from "@/lib/auth/next";
import { getPublicSchool } from "@/server/website";
import { submitEnquiry } from "@/server/enquiries";

export async function submitEnquiryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    await submitEnquiry(school.id, input, await getRequestMeta());
    const t = await getT();
    return { message: t("site.form.sentBody") };
  });
}
