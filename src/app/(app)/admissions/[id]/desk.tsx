import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import { displayDate, displayDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import type { DeskRow } from "@/server/admission-desk";
import type { AcceptanceReadiness } from "@/server/admission-offers";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card } from "@/components/ui";
import * as A from "../actions";

type Can = (p: Parameters<import("@/lib/auth/context").AuthContext["permissions"]["has"]>[0]) => boolean;
const TONE = { NEW: "neutral", UNDER_REVIEW: "brand", NEEDS_INFO: "warn", REVIEWED: "brand", INTERVIEW_SCHEDULED: "brand", AWAITING_DECISION: "warn", ACCEPTED: "ok", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;
const NOTICE_TONE = { SENT_IN_APP: "ok", NO_ACCOUNT: "warn" } as const;
const hid = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

const Step = ({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) => (
  <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
    <span aria-hidden className="mt-0.5 grid size-6 place-items-center rounded-md text-xs text-ok">{done ? <Check className="size-5" /> : null}</span>
    <div className="min-w-0 space-y-2"><h3 className="text-sm font-semibold text-heading">{title}</h3>{children}</div>
  </li>
);
const Option = ({ label, children }: { label: string; children: ReactNode }) => (
  <details name="arrange" className="rounded-lg border border-line bg-canvas/40 px-3 py-0.5 open:bg-canvas/70">
    <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-link">{label}</summary>
    <div className="space-y-3 pb-3 pt-1">{children}</div>
  </details>
);

/**
 * The page's main card: where the application stands in four steps (review, interview, decision, enrolment), what stops the next one in
 * plain words, and the action for it. Reviewing never accepts; the interview can be arranged four ways without repeating anything; accepting
 * is one confirmed action using the school's own defaults.
 */
export function DeskCard(p: {
  t: Translate; id: string; name: string; row: DeskRow; status: string; reviewStatus: string; reviewNote: string | null; reviewedAt: Date | null; reviewerName: string | null;
  interviewWaivedReason: string | null; open: boolean; can: Can; reviewers: { id: string; fullName: string }[]; interviewers: { id: string; fullName: string }[]; defaultMinutes: number;
  ready: AcceptanceReadiness; checklistOpen: { docType: string }[]; offerStatus: string | null; account: { requiredCents: number } | null; currency: string;
  notices: { id: string; kind: string; status: string; createdAt: Date }[]; locale: "EN" | "SW"; timezone: string;
}) {
  const { t, id, row, can, ready } = p;
  const consideration = p.open && ["APPLIED", "INTERVIEW"].includes(p.status);
  const live = row.interview === "SCHEDULED";
  const reviewed = p.reviewStatus === "VERIFIED";
  const money = (c: number) => formatMoney(c, p.currency);
  const waiveForbidden = row.interviewRequired && !can("admission.override");
  const onlyInterviewMissing = ready.hard.length === 0 && !ready.live && !!ready.interview;
  const canAccept = can("admission.review") && consideration && !["PENDING_APPROVAL"].includes(p.offerStatus ?? "");
  const exceptionNeeded = onlyInterviewMissing && can("admission.override");
  const blockers: string[] = [
    ...(p.reviewStatus === "RETURNED" ? [t("adm.accept.blocker.returned")] : []),
    ...(p.checklistOpen.length ? [t("adm.accept.blocker.docs", { list: p.checklistOpen.map((d) => t(`doc.type.${d.docType as "OTHER"}`)).join(", ") })] : []),
    ...(ready.live ? [t("adm.accept.blocker.live", { when: displayDateTime(ready.live.scheduledAt, p.timezone, p.locale) })] : []),
    ...(ready.interview ? [ready.interview] : []),
  ];

  return (
    <Card title={t("adm.desk.title")} actions={<Badge tone={TONE[row.state]}>{t(`adm.state.${row.state}`)}</Badge>}>
      <div className="space-y-5">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr]">
          <div>
            <dt className="text-muted">{t("adm.desk.complete")}</dt>
            <dd className="mt-1 flex items-center gap-2"><span aria-hidden className="h-1.5 w-20 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${row.completeness.percent}%`, background: row.completeness.percent === 100 ? "var(--color-ok)" : "var(--color-warn)" }} /></span><span className="font-semibold tabular-nums">{row.completeness.percent}%</span></dd>
            {row.completeness.missing.length > 0 && <dd className="mt-1 text-xs text-warn">{t("adm.desk.missing", { list: row.completeness.missing.map((k) => (k.startsWith("doc:") ? t(`doc.type.${k.slice(4) as "OTHER"}`) : k === "class" ? t("adm.missing.class") : t("adm.missing.contact"))).join(", ") })}</dd>}
          </div>
          <div>
            <dt className="text-muted">{t("adm.desk.interview")}</dt>
            <dd className="mt-1 font-medium">{t(`adm.ivs.${row.interview}`)}{row.interviewAt ? ` · ${displayDateTime(row.interviewAt, p.timezone, p.locale)}` : ""}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("adm.desk.owner")}</dt>
            <dd className="mt-1 font-medium">{row.assignedTo ?? t("adm.unassigned")}</dd>
            {p.open && can("admission.review") && p.reviewers.length > 0 && (
              <dd className="mt-1">
                <ActionForm key={row.assignedToId ?? "none"} action={A.assignApplicationAction} submitLabel={t("adm.desk.assign.go")} inline className="flex flex-wrap items-end gap-2">
                  {hid("id", id)}
                  <Field name="assigneeId" type="select" label={t("adm.desk.assign")} defaultValue={row.assignedToId ?? ""} placeholder={t("adm.unassigned")} options={p.reviewers.map((r) => ({ value: r.id, label: r.fullName }))} />
                </ActionForm>
              </dd>
            )}
          </div>
        </dl>

        {consideration && (
          <ol className="space-y-5 border-t border-line pt-5">
            <Step title={t("adm.desk.step.review")} done={reviewed}>
              <p className="text-sm text-muted">
                {reviewed ? t("adm.desk.review.done", { name: p.reviewerName ?? "—", date: p.reviewedAt ? displayDate(p.reviewedAt, p.locale) : "—" })
                  : p.reviewStatus === "IN_REVIEW" ? t("adm.desk.review.started")
                  : p.reviewStatus === "RETURNED" ? t("adm.desk.review.returned", { note: p.reviewNote ?? "" })
                  : t("adm.desk.review.new")}
              </p>
              {can("admission.documents.verify") && (
                <div className="flex flex-wrap items-start gap-2">
                  {(p.reviewStatus === "PENDING" || p.reviewStatus === "RETURNED") && (
                    <ActionForm action={A.startReviewAction} submitLabel={t("adm.desk.review.start")} inline>{hid("id", id)}</ActionForm>
                  )}
                  {p.reviewStatus === "IN_REVIEW" && (
                    <ActionForm action={A.reviewApplicationAction} submitLabel={t("adm.desk.review.mark")} inline>{hid("id", id)}{hid("decision", "VERIFIED")}</ActionForm>
                  )}
                  {p.reviewStatus !== "RETURNED" && (
                    <details className="min-w-0 max-w-full rounded-lg border border-line px-3 py-0.5">
                      <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-link">{t("adm.desk.review.info")}</summary>
                      <ActionForm action={A.reviewApplicationAction} submitLabel={t("adm.desk.review.info.send")} className="w-80 max-w-full space-y-2 pb-3 pt-1">
                        {hid("id", id)}{hid("decision", "RETURNED")}
                        <Field name="note" type="textarea" rows={3} label={t("adm.desk.review.info.note")} required />
                      </ActionForm>
                    </details>
                  )}
                </div>
              )}
            </Step>

            <Step title={t("adm.desk.step.interview")} done={row.interview === "COMPLETED" || row.interview === "WAIVED" || row.interview === "NOT_REQUIRED"}>
              <p className="text-sm text-muted">
                {live && row.interviewAt ? t("adm.desk.iv.scheduled", { when: displayDateTime(row.interviewAt, p.timezone, p.locale) })
                  : row.interview === "COMPLETED" ? t("adm.desk.iv.completed")
                  : row.interview === "WAIVED" ? (p.interviewWaivedReason ? t("adm.desk.iv.waived", { reason: p.interviewWaivedReason }) : t("adm.desk.iv.waived.plain"))
                  : row.interview === "NOT_REQUIRED" ? t("adm.desk.iv.notRequired")
                  : t("adm.desk.iv.toArrange")}
              </p>
              {can("admission.interview.manage") && !live && row.interview !== "COMPLETED" && (
                <div className="space-y-2">
                  <Option label={t("adm.arr.A")}>
                    <p className="text-xs text-muted">{t("adm.arr.A.hint")}</p>
                    <ActionForm action={A.scheduleInterviewAction} submitLabel={t("adm.iv.schedule")} className="space-y-3">
                      {hid("id", id)}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field name="kind" type="select" label={t("adm.iv.kind")} options={(["INTERVIEW", "ENTRANCE_EXAM", "ASSESSMENT"] as const).map((k) => ({ value: k, label: t(`adm.iv.kind.${k}` as "adm.iv.kind.INTERVIEW") }))} defaultValue="INTERVIEW" />
                        <Field name="scheduledAt" type="datetime-local" label={t("adm.iv.when")} required />
                        <Field name="durationMinutes" type="number" label={t("adm.iv.duration")} defaultValue={p.defaultMinutes} min={5} max={480} />
                        <Field name="location" label={t("adm.iv.location")} optionalLabel={t("common.optional")} />
                        <Field name="method" label={t("adm.iv.method")} placeholder={t("adm.iv.method.ph")} optionalLabel={t("common.optional")} />
                        <Field name="interviewerId" type="select" label={t("adm.iv.interviewer")} options={p.interviewers.map((u) => ({ value: u.id, label: u.fullName }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
                        <Field name="note" label={t("adm.iv.note")} optionalLabel={t("common.optional")} />
                      </div>
                      <Field name="confirmLocationClash" type="checkbox" label={t("adm.iv.clash")} />
                      {can("admission.override") && (p.reviewStatus === "RETURNED" || p.checklistOpen.length > 0) && <Field name="exceptionReason" label={t("adm.iv.exception")} optionalLabel={t("common.optional")} />}
                    </ActionForm>
                  </Option>
                  <Option label={`${t("adm.arr.B")}`}>
                    <p className="text-xs text-muted">{t("adm.arr.B.hint")}</p>
                    <ActionForm action={A.confirmExistingInterviewAction} submitLabel={t("common.save")} className="space-y-3">
                      {hid("id", id)}{hid("kind", "INTERVIEW")}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field name="scheduledAt" type="datetime-local" label={t("adm.iv.when")} required />
                        <Field name="location" label={t("adm.iv.location")} optionalLabel={t("common.optional")} />
                        <Field name="interviewerId" type="select" label={t("adm.iv.interviewer")} options={p.interviewers.map((u) => ({ value: u.id, label: u.fullName }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
                        <Field name="note" label={t("adm.iv.note")} optionalLabel={t("common.optional")} />
                      </div>
                    </ActionForm>
                  </Option>
                  {row.interview !== "WAIVED" && (
                    <Option label={t("adm.arr.C")}>
                      <p className="text-xs text-muted">{t("adm.arr.C.hint")}</p>
                      {waiveForbidden ? <p className="text-sm text-warn">{t("adm.arr.needsOverride")}</p> : (
                        <ActionForm action={A.markInterviewNotRequiredAction} submitLabel={t("common.save")} className="space-y-3">
                          {hid("id", id)}
                          <Field name="reason" label={row.interviewRequired ? t("adm.arr.reason.required") : t("adm.arr.reason")} required={row.interviewRequired} optionalLabel={row.interviewRequired ? undefined : t("common.optional")} />
                        </ActionForm>
                      )}
                    </Option>
                  )}
                  <Option label={t("adm.arr.D")}>
                    <p className="text-xs text-muted">{t("adm.arr.D.hint")}</p>
                    <ActionForm action={A.recordCompletedInterviewAction} submitLabel={t("common.save")} className="space-y-3">
                      {hid("id", id)}{hid("kind", "INTERVIEW")}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field name="heldAt" type="datetime-local" label={t("adm.arr.heldAt")} required />
                        <Field name="outcome" type="select" label={t("adm.arr.outcome")} required defaultValue="PASSED" options={(["PASSED", "NOT_PASSED", "DEFERRED", "FURTHER_ASSESSMENT", "AWAITING_DECISION"] as const).map((o) => ({ value: o, label: t(`adm.iv.outcome.${o}` as "adm.iv.outcome.PASSED") }))} />
                        <Field name="score" type="number" label={t("adm.iv.score")} min={0} max={100} optionalLabel={t("common.optional")} />
                        <Field name="interviewerId" type="select" label={t("adm.iv.interviewer")} options={p.interviewers.map((u) => ({ value: u.id, label: u.fullName }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
                      </div>
                      <Field name="notes" type="textarea" rows={2} label={t("adm.iv.notes")} hint={t("adm.iv.hiddenNotes")} optionalLabel={t("common.optional")} />
                    </ActionForm>
                  </Option>
                </div>
              )}
            </Step>

            <Step title={t("adm.desk.step.decision")}>
              {p.offerStatus === "PENDING_APPROVAL" ? <p className="text-sm text-warn">{t("adm.accept.pending")}</p> : !can("admission.review") ? null : (
                <>
                  {blockers.length > 0 && (
                    <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                      <p className="font-semibold text-warn">{t("adm.accept.blocked")}</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                    </div>
                  )}
                  {canAccept && (ready.ready || exceptionNeeded) && (
                    <details className="rounded-lg border border-brand-500/50 bg-tint px-3 py-1">
                      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-link">{t("adm.accept.button")}</summary>
                      <ActionForm action={A.acceptApplicationAction} submitLabel={t("adm.accept.go")} className="space-y-3 pb-3 pt-1">
                        {hid("id", id)}
                        <p className="font-medium">{t("adm.accept.confirm", { name: p.name, class: row.className ?? t("adm.noClass") })}</p>
                        <p className="text-xs text-muted">{t("adm.accept.after")}</p>
                        <Field name="note" label={t("adm.accept.note")} optionalLabel={t("common.optional")} />
                        {exceptionNeeded && <Field name="exceptionReason" label={t("adm.accept.exception")} hint={t("adm.accept.exception.hint")} required />}
                      </ActionForm>
                    </details>
                  )}
                </>
              )}
            </Step>
          </ol>
        )}

        {(p.status === "ACCEPTED" || p.status === "ENROLLED") && (
          <p className="border-t border-line pt-4 text-sm text-muted">
            <span className="font-semibold text-heading">{t("adm.accept.next")}: </span>
            {p.status === "ENROLLED" ? t("adm.step.place") : p.account && p.account.requiredCents > 0 ? t("adm.accept.fee", { amount: money(p.account.requiredCents) }) : t("adm.accept.nofee")}
          </p>
        )}

        <div className="border-t border-line pt-4">
          <h3 className="text-sm font-semibold text-heading">{t("adm.notices.title")}</h3>
          {p.notices.length === 0 ? <p className="mt-1 text-sm text-muted">{t("adm.notice.none")}</p> : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {p.notices.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{t(`adm.notice.kind.${n.kind}` as "adm.notice.kind.INTERVIEW")}</span>
                  <Badge tone={NOTICE_TONE[n.status as keyof typeof NOTICE_TONE] ?? "neutral"}>{t(`adm.notice.status.${n.status}` as "adm.notice.status.SENT_IN_APP")}</Badge>
                  <span className="text-xs text-muted">{displayDateTime(n.createdAt, p.timezone, p.locale)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">{t("adm.notice.sms")}</p>
        </div>
      </div>
    </Card>
  );
}
