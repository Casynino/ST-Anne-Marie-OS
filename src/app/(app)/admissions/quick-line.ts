import type { Translate } from "@/lib/i18n";
import { stageOf } from "@/lib/admissions/rules";
import type { AuthContext } from "@/lib/auth/context";
import type { DeskRow } from "@/server/admission-desk";
import type { QuickLabels, QuickLine, QuickSlot } from "./quick-actions";

/** What each person may do with an application at the step it is at, and the words for the buttons and pop-ups. Used by the list and by the application page. */
type Can = (p: Parameters<AuthContext["permissions"]["has"]>[0]) => boolean;

export const missingLabels = (r: DeskRow, t: Translate) =>
  r.completeness.missing.map((k) => (k.startsWith("doc:") ? t(`doc.type.${k.slice(4) as "OTHER"}`) : k === "class" ? t("adm.missing.class") : t("adm.missing.contact")));

/**
 * Under review: Accept (only a complete application; anything missing is sent back to the family, who resend it, so nothing incomplete is
 * accepted), Send back and Decline. In the interview list: Result (after the interview time) and Decline; Accept after a result that is not a
 * pass is for the office to decide. Every service checks its own conditions again.
 */
export function quickActs(r: DeskRow, t: Translate, can: Can, now: number): QuickLine["acts"] {
  const out: QuickLine["acts"] = [];
  const decide = can("admission.review"), verify = can("admission.documents.verify"), iv = can("admission.interview.manage");
  if ((r.state === "NEW" || r.state === "UNDER_REVIEW" || r.state === "REVIEWED") && verify) {
    const missing = missingLabels(r, t);
    out.push({ kind: "REVIEW", why: missing.length ? t("adm.q.wait.incomplete", { list: missing.join(", ") }) : null });
    out.push({ kind: "BACK", why: null });
  }
  if (r.state === "INTERVIEW_SCHEDULED" && iv) out.push({ kind: "RESULT", why: r.interviewAt && r.interviewAt.getTime() > now ? t("adm.q.wait.date") : null });
  if (r.state === "AWAITING_DECISION" && decide) out.push({ kind: "ACCEPT", why: null });
  if (r.state === "ACCEPTED" && can("student.enroll")) out.push({ kind: "ENROL", why: null });
  if (decide && r.state !== "ACCEPTED" && ["review", "interview"].includes(stageOf(r.state))) out.push({ kind: "DECLINE", why: null });
  return out;
}

export function quickSlots(rows: { local: string; when: string; venue: string; name: string; classIds: string[] | null; count: number }[]): QuickSlot[] {
  return rows.map((x) => ({ value: x.local, classIds: x.classIds, label: `${x.when}${x.name ? ` · ${x.name}` : ""}${x.venue ? ` · ${x.venue}` : ""}${x.count > 0 ? ` (${x.count})` : ""}` }));
}

export function quickLabels(t: Translate): QuickLabels {
  return {
    column: t("adm.col.action"), view: t("common.view"), accept: t("adm.q.accept"), decline: t("adm.q.decline"), date: t("adm.q.date"), result: t("adm.q.result"),
    acceptQ: t("adm.accept.confirm", { name: "{name}", class: "{class}" }), acceptAfter: t("adm.q.accept.after"), declineQ: t("adm.q.decline.q", { name: "{name}" }), declineReason: t("adm.q.decline.reason"), declineGo: t("adm.q.decline.go"),
    confirm: t("adm.accept.go"), open: t("adm.q.open"), cancel: t("adm.bulk.cancel"),
    reviewQ: t("adm.q.review.q", { name: "{name}" }), reviewToInterview: t("adm.q.review.toInterview"), reviewToAccepted: t("adm.q.review.toAccepted"), reviewHasDate: t("adm.q.review.hasDate", { date: "{date}" }), papersChecked: t("adm.q.papersChecked", { n: "{n}" }),
    dateQ: t("adm.q.date.q", { name: "{name}" }), dateSlot: t("adm.q.date.slot"), dateOther: t("adm.q.date.other"), dateWhen: t("adm.q.date.when"), dateGo: t("adm.q.date.go"),
    resultQ: t("adm.q.result.q", { name: "{name}" }), resultPassed: t("adm.q.result.passed"), resultNot: t("adm.q.result.not"), resultNote: t("adm.q.result.note"), resultGo: t("adm.q.result.go"), resultHint: t("adm.q.result.hint"),
    back: t("adm.q.back"), backQ: t("adm.q.back.q", { name: "{name}" }), backNote: t("adm.q.back.note"), backDefault: t("adm.q.back.default", { list: "{list}" }), backAfter: t("adm.q.back.after"), backGo: t("adm.q.back.go"),
    enrol: t("adm.q.enrol"), enrolQ: t("adm.q.enrol.q", { name: "{name}" }), enrolAfter: t("adm.q.enrol.after"), enrolGo: t("adm.q.enrol.go"),
  };
}
