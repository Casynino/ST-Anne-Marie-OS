"use server";

import { publicRun, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { getContext, getLocale, getRequestMeta, getT, setSessionCookie } from "@/lib/auth/next";
import { authenticate } from "@/lib/auth/login";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { getPublicSchool } from "@/server/website";
import { submitOnlineApplication, trackApplication, uploadApplicantDocument } from "@/server/public-applications";
import { MAX_DOCUMENT_BYTES } from "@/server/documents";

export async function submitApplicationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    const meta = await getRequestMeta();
    const me = await getContext();
    const r = await submitOnlineApplication(school.id, input, meta, { userId: me?.userType === "GUARDIAN" && me.schoolId === school.id ? me.userId : null });
    // A family that just signed up is signed in with the details they typed, so they land straight on their application.
    if (r.accountCreated) {
      try {
        const login = await authenticate(String(input.g1_email ?? ""), String(input.password ?? ""), meta);
        await setSessionCookie(login.token);
      } catch {
        return { redirectTo: "/login" };
      }
    }
    if (r.draftId) return { redirectTo: `/family/applications/${r.draftId}` };
    return { redirectTo: r.applicationNo ? `/apply/received?ref=${encodeURIComponent(r.applicationNo)}` : "/apply/received" };
  });
}

export async function trackApplicationAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    const t = await getT();
    const r = await trackApplication(school.id, input, await getRequestMeta());
    const locale = await getLocale();
    const money = (c: number) => formatMoney(c, r.currency);
    const lines = [t(`apply.status.${r.status}` as "apply.status.APPLIED"), t("apply.track.submitted", { date: displayDate(r.submittedOn, locale) })];
    if (r.className) lines.push(t("apply.track.class", { name: r.className }));
    if (r.correction !== null) lines.push("", t("apply.track.returned", { note: r.correction || "-" }));
    if (r.interview) {
      const when = new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone: r.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(r.interview.at);
      lines.push("", t("apply.track.interview", { when, place: [r.interview.location, r.interview.method].filter(Boolean).join(", ") ? ` (${[r.interview.location, r.interview.method].filter(Boolean).join(", ")})` : "" }));
    }
    if (r.offer) {
      lines.push("", t("apply.track.offer", { fee: r.offer.feeCents > 0 ? money(r.offer.feeCents) : t("apply.track.noFee") }));
      if (r.offer.expiresOn) lines.push(t("apply.track.offerUntil", { date: displayDate(r.offer.expiresOn, locale) }));
      if (r.offer.howToPay && r.offer.feeCents > 0) lines.push(t("apply.track.howToPay", { text: r.offer.howToPay }));
      if (r.payment && r.payment.requiredCents > 0) {
        if (r.payment.verifiedCents > 0) lines.push(t("apply.track.verified", { paid: money(r.payment.verifiedCents), required: money(r.payment.requiredCents) }));
        if (r.payment.pendingCents > 0) lines.push(t("apply.track.pending", { pending: money(r.payment.pendingCents) }));
      }
      lines.push(t("apply.track.enrolNext"));
    }
    return { message: lines.join("\n") };
  });
}

export async function uploadApplicantDocumentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return publicRun(form, async (input) => {
    const school = await getPublicSchool();
    if (!school) throw new AppError("NOT_FOUND", "The school is not set up yet.");
    const t = await getT();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION", "Choose a file to upload.", { file: "Required" });
    if (file.size > MAX_DOCUMENT_BYTES) throw new AppError("VALIDATION", `The file is too large. The limit is ${Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`, { file: "File too large" });
    await uploadApplicantDocument(school.id, { applicationNo: input.applicationNo, phone: input.phone, docType: input.docType, fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, await getRequestMeta());
    return { message: t("apply.upload.done") };
  });
}
