"use server";

import { publicRun, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { getLocale, getRequestMeta, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { getPublicSchool } from "@/server/website";
import { submitOnlineApplication, trackApplication } from "@/server/public-applications";

export async function submitApplicationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    const { applicationNo } = await submitOnlineApplication(school.id, input, await getRequestMeta());
    return { redirectTo: applicationNo ? `/apply/received?ref=${encodeURIComponent(applicationNo)}` : "/apply/received" };
  });
}

export async function trackApplicationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    const t = await getT();
    const r = await trackApplication(school.id, input, await getRequestMeta());
    const lines = [t(`apply.status.${r.status}` as "apply.status.APPLIED"), t("apply.track.submitted", { date: displayDate(r.submittedOn, await getLocale()) })];
    if (r.className) lines.push(t("apply.track.class", { name: r.className }));
    return { message: lines.join(" ") };
  });
}
