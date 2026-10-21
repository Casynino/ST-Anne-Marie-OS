import { randomUUID } from "node:crypto";
import { Check, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Translate } from "@/lib/i18n";
import { displayDate, displayDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import type { admissionAccount } from "@/lib/admissions/rules";
import type { InterviewRow } from "@/server/interviews";
import type { ReadinessItem } from "@/server/admission-offers";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card } from "@/components/ui";
import * as A from "../actions";
import * as FA from "../../finance/admission-actions";

type Tone = "ok" | "warn" | "bad" | "neutral" | "brand";
export type Can = (p: Parameters<import("@/lib/auth/context").AuthContext["permissions"]["has"]>[0]) => boolean;

const DOC_TONE: Record<string, Tone> = { VERIFIED: "ok", PENDING: "warn", NEEDS_CORRECTION: "bad", MISSING: "bad" };
const IV_TONE: Record<string, Tone> = { SCHEDULED: "brand", COMPLETED: "ok", CANCELLED: "neutral", NO_SHOW: "bad" };
const OUTCOME_TONE: Record<string, Tone> = { PASSED: "ok", NOT_PASSED: "bad", DEFERRED: "warn", FURTHER_ASSESSMENT: "warn", AWAITING_DECISION: "warn" };
export const PAY_TONE: Record<string, Tone> = { NOT_REQUIRED: "neutral", AWAITING_PAYMENT: "bad", VERIFICATION_PENDING: "warn", PARTIAL: "warn", PAID: "ok", WAIVED: "brand" };
const ROW_TONE: Record<string, Tone> = { PENDING: "warn", VERIFIED: "ok", REJECTED: "bad", REVERSED: "neutral" };

const hid = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
const Disclosure = ({ label, children }: { label: string; children: ReactNode }) => (
  <details className="rounded-lg border border-line bg-canvas/40 px-3 py-1">
    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-link">{label}</summary>
    <div className="pb-3 pt-1">{children}</div>
  </details>
);

// ───────────────────────── Next step and the enrolment checklist ─────────────────────────

export function GateList({ t, items }: { t: Translate; items: ReadinessItem[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((i) => (
        <li key={i.key} className="flex items-start gap-2">
          {i.ok ? <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />}
          <span><span className={i.ok ? "" : "font-medium"}>{t(`adm.gate.${i.key}` as "adm.gate.offer")}</span>{!i.ok && <span className="block text-muted">{i.message}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Papers and review ─────────────────────────

type DocRow = { id: string; docType: string; fileName: string; verification: string; verificationNote: string | null };

export function DocsReviewCard({ t, id, open, can, required, checklist, docs, review, exception }: {
  t: Translate; id: string; open: boolean; can: Can; required: string[];
  checklist: { docType: string; state: string; documentId: string | null }[]; docs: DocRow[];
  review: { status: string; note: string | null; by: string | null; at: Date | null; locale: "EN" | "SW"; timezone: string };
  exception: { reason: string; by: string | null } | null;
}) {
  const canVerify = can("admission.documents.verify") && open;
  return (
    <Card title={t("adm.docs.title")} actions={<Badge tone={review.status === "VERIFIED" ? "ok" : review.status === "RETURNED" ? "bad" : "neutral"}>{t(`adm.review.${review.status}` as "adm.review.PENDING")}</Badge>}>
      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t("adm.docs.required")}</h3>
          {required.length === 0 ? <p className="text-sm text-muted">{t("adm.docs.noneRequired")}</p> : (
            <ul className="divide-y divide-line text-sm">
              {checklist.map((c) => (
                <li key={c.docType} className="flex items-center justify-between gap-3 py-2">
                  <span>{t(`doc.type.${c.docType as "OTHER"}`)}</span>
                  <Badge tone={DOC_TONE[c.state]}>{t(`adm.docs.state.${c.state}` as "adm.docs.state.MISSING")}</Badge>
                </li>
              ))}
            </ul>
          )}
          {exception && <p className="mt-2 rounded-lg border border-tint-2 bg-tint px-3 py-2 text-sm text-link">{t("adm.docs.excepted", { reason: exception.reason })}{exception.by ? ` (${exception.by})` : ""}</p>}
        </div>

        {canVerify && docs.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {docs.map((d) => (
              <li key={d.id} className="space-y-2 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{d.fileName} <span className="font-normal text-muted">· {t(`doc.type.${d.docType as "OTHER"}`)}</span></span>
                  <Badge tone={DOC_TONE[d.verification]}>{t(`adm.docs.state.${d.verification}` as "adm.docs.state.PENDING")}</Badge>
                </div>
                {d.verificationNote && <p className="text-muted">{d.verificationNote}</p>}
                <div className="flex flex-wrap items-start gap-2">
                  {d.verification !== "VERIFIED" && (
                    <ActionForm action={A.verifyDocumentAction} submitLabel={t("adm.docs.verify")} inline className="space-y-0">{hid("documentId", d.id)}{hid("status", "VERIFIED")}</ActionForm>
                  )}
                  <Disclosure label={t("adm.docs.correct")}>
                    <ActionForm action={A.verifyDocumentAction} submitLabel={t("adm.docs.correct")} tone="danger" className="space-y-2">{hid("documentId", d.id)}{hid("status", "NEEDS_CORRECTION")}<Field name="note" label={t("adm.docs.note")} required /></ActionForm>
                  </Disclosure>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canVerify && (
          <div className="grid gap-3 lg:grid-cols-2">
            <ActionForm action={A.reviewApplicationAction} submitLabel={t("adm.review.markOk")} className="space-y-2">{hid("id", id)}{hid("decision", "VERIFIED")}</ActionForm>
            <Disclosure label={t("adm.review.return")}>
              <ActionForm action={A.reviewApplicationAction} submitLabel={t("adm.review.return")} tone="danger" className="space-y-2">{hid("id", id)}{hid("decision", "RETURNED")}<Field name="note" label={t("adm.review.note")} type="textarea" rows={2} required /></ActionForm>
            </Disclosure>
          </div>
        )}
        {review.note && <p className="text-sm text-muted">{review.note}</p>}
        {review.by && review.at && <p className="text-xs text-muted">{t("adm.review.last", { name: review.by })} · {displayDateTime(review.at, review.timezone, review.locale)}</p>}

        {can("admission.override") && open && !exception && checklist.some((c) => c.state !== "VERIFIED") && (
          <Disclosure label={t("adm.exception.docs")}>
            <p className="mb-2 text-sm text-muted">{t("adm.exception.docs.hint")}</p>
            <ActionForm action={A.grantDocsExceptionAction} submitLabel={t("adm.exception.docs")} className="space-y-2">{hid("id", id)}<Field name="reason" label={t("adm.exception.reason")} required /></ActionForm>
          </Disclosure>
        )}
      </div>
    </Card>
  );
}

// ───────────────────────── Interviews ─────────────────────────

function ScheduleFields({ t, interviewers, defaultMinutes, withException, location, interviewerId, minutes }: { t: Translate; interviewers: { id: string; fullName: string }[]; defaultMinutes: number; withException?: boolean; location?: string | null; interviewerId?: string | null; minutes?: number }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="kind" type="select" label={t("adm.iv.kind")} options={(["INTERVIEW", "ENTRANCE_EXAM", "ASSESSMENT"] as const).map((k) => ({ value: k, label: t(`adm.iv.kind.${k}` as "adm.iv.kind.INTERVIEW") }))} defaultValue="INTERVIEW" />
        <Field name="scheduledAt" type="datetime-local" label={t("adm.iv.when")} required />
        <Field name="durationMinutes" type="number" label={t("adm.iv.duration")} defaultValue={minutes ?? defaultMinutes} min={5} max={480} />
        <Field name="location" label={t("adm.iv.location")} defaultValue={location ?? ""} optionalLabel={t("common.optional")} />
        <Field name="method" label={t("adm.iv.method")} placeholder={t("adm.iv.method.ph")} optionalLabel={t("common.optional")} />
        <Field name="interviewerId" type="select" label={t("adm.iv.interviewer")} options={interviewers.map((u) => ({ value: u.id, label: u.fullName }))} defaultValue={interviewerId ?? ""} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
        <Field name="note" label={t("adm.iv.note")} optionalLabel={t("common.optional")} />
      </div>
      <Field name="confirmLocationClash" type="checkbox" label={t("adm.iv.clash")} />
      {withException && <Field name="exceptionReason" label={t("adm.iv.exception")} optionalLabel={t("common.optional")} />}
    </>
  );
}

export function InterviewCard({ t, id, status, open, can, rows, interviewers, defaultMinutes, now, locale, timezone, ready }: {
  t: Translate; id: string; status: string; open: boolean; can: Can; rows: InterviewRow[]; interviewers: { id: string; fullName: string }[]; defaultMinutes: number; now: number; locale: "EN" | "SW"; timezone: string; ready: boolean;
}) {
  const manage = can("admission.interview.manage");
  const live = rows.find((r) => r.status === "SCHEDULED");
  const canSchedule = manage && open && ["APPLIED", "INTERVIEW"].includes(status) && !live;
  return (
    <Card title={t("adm.iv.title")}>
      <div className="space-y-4">
        {rows.length === 0 && <p className="text-sm text-muted">{t("adm.iv.none")}</p>}
        <ul className="space-y-3">
          {rows.map((r) => {
            const held = r.status === "SCHEDULED" && r.scheduledAt.getTime() <= now;
            return (
              <li key={r.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{t(`adm.iv.kind.${r.kind}` as "adm.iv.kind.INTERVIEW")}</Badge>
                  <span className="font-medium">{displayDateTime(r.scheduledAt, timezone, locale)}</span>
                  <span className="text-muted">{r.durationMinutes} min</span>
                  <Badge tone={IV_TONE[r.status]}>{t(`adm.iv.status.${r.status}` as "adm.iv.status.SCHEDULED")}</Badge>
                  {r.outcome && <Badge tone={OUTCOME_TONE[r.outcome]}>{t(`adm.iv.outcome.${r.outcome}` as "adm.iv.outcome.PASSED")}</Badge>}
                  {r.score !== null && <span className="text-muted">{r.score}/100</span>}
                </div>
                <p className="mt-1 text-muted">{[r.location, r.method, r.interviewer].filter(Boolean).join(" · ")}</p>
                {r.recommendation && <p className="mt-1 text-sm"><span className="text-muted">{t("adm.iv.recommendation")}:</span> {t(`adm.iv.recommendation.${r.recommendation}` as "adm.iv.recommendation.RECOMMEND")}{r.recommendationNote ? ` - ${r.recommendationNote}` : ""}</p>}
                {r.scheduleNote && <p className="mt-1">{r.scheduleNote}</p>}
                {r.cancelReason && <p className="mt-1 text-muted">{r.cancelReason}</p>}
                {r.notes && <p className="mt-2 whitespace-pre-line rounded bg-canvas px-2 py-1">{r.notes}</p>}
                {r.status === "SCHEDULED" && (
                  <div className="mt-3 grid gap-2">
                    {held && (can("admission.interview.manage") || r.interviewerId !== null) && (
                      <Disclosure label={t("adm.iv.result")}>
                        <ActionForm action={A.recordInterviewResultAction} submitLabel={t("common.save")} className="space-y-3">
                          {hid("interviewId", r.id)}
                          <Field name="status" type="select" label={t("common.status")} required options={[{ value: "COMPLETED", label: t("adm.iv.attended") }, { value: "NO_SHOW", label: t("adm.iv.status.NO_SHOW") }]} defaultValue="COMPLETED" />
                          <Field name="outcome" type="select" label={t("adm.iv.title")} options={(["PASSED", "NOT_PASSED", "DEFERRED", "FURTHER_ASSESSMENT", "AWAITING_DECISION"] as const).map((o) => ({ value: o, label: t(`adm.iv.outcome.${o}` as "adm.iv.outcome.PASSED") }))} placeholder={t("common.select")} />
                          <Field name="score" type="number" label={t("adm.iv.score")} min={0} max={100} optionalLabel={t("common.optional")} />
                          <Field name="recommendation" type="select" label={t("adm.iv.recommendation")} options={(["RECOMMEND", "RECOMMEND_WITH_CONDITIONS", "NOT_RECOMMENDED"] as const).map((k) => ({ value: k, label: t(`adm.iv.recommendation.${k}` as "adm.iv.recommendation.RECOMMEND") }))} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
                          <Field name="recommendationNote" label={t("adm.iv.recommendation.note")} optionalLabel={t("common.optional")} />
                          <Field name="notes" type="textarea" rows={3} label={t("adm.iv.notes")} hint={t("adm.iv.hiddenNotes")} optionalLabel={t("common.optional")} />
                        </ActionForm>
                      </Disclosure>
                    )}
                    {manage && (
                      <>
                        <Disclosure label={t("adm.iv.reschedule")}>
                          <ActionForm action={A.rescheduleInterviewAction} submitLabel={t("adm.iv.reschedule")} className="space-y-3">
                            {hid("interviewId", r.id)}
                            <ScheduleFields t={t} interviewers={interviewers} defaultMinutes={defaultMinutes} location={r.location} interviewerId={r.interviewerId} minutes={r.durationMinutes} />
                            <Field name="reason" label={t("adm.iv.reason")} required />
                          </ActionForm>
                        </Disclosure>
                        <Disclosure label={t("adm.iv.cancel")}>
                          <ActionForm action={A.cancelInterviewAction} submitLabel={t("adm.iv.cancel")} tone="danger" className="space-y-2">{hid("interviewId", r.id)}<Field name="reason" label={t("adm.iv.reason")} required /></ActionForm>
                        </Disclosure>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canSchedule && (
          <Disclosure label={t("adm.iv.schedule")}>
            <ActionForm action={A.scheduleInterviewAction} submitLabel={t("adm.iv.schedule")} className="space-y-3">
              {hid("id", id)}
              <ScheduleFields t={t} interviewers={interviewers} defaultMinutes={defaultMinutes} withException={can("admission.override") && !ready} />
            </ActionForm>
          </Disclosure>
        )}
      </div>
    </Card>
  );
}

// ───────────────────────── Offer, admission payment ─────────────────────────

type Account = ReturnType<typeof admissionAccount>;
type PayRow = { id: string; amountCents: number; method: string; reference: string | null; paidOn: Date; status: string; receiptNo: string | null; recordedAt: Date; reverseReason: string | null; rejectReason: string | null };
type Offer = { status: string; letterNo: string; feeCents: number; expiresOn: Date | null; notes: string | null; issuedById: string; classOffered: string | null; waiver: { reason: string } | null } | null;

export function OfferCard({ t, id, status, open, can, userId, offer, account, payments, classes, defaultFeeCents, currency, locale, timezone, hasLiveInterview, enrolled }: {
  t: Translate; id: string; status: string; open: boolean; can: Can; userId: string; offer: Offer; account: Account | null; payments: PayRow[];
  classes: { value: string; label: string }[]; defaultFeeCents: number; currency: string; locale: "EN" | "SW"; timezone: string; hasLiveInterview: boolean; enrolled: boolean;
}) {
  const money = (c: number) => formatMoney(c, currency);
  const canDecide = can("admission.review") && ["APPLIED", "INTERVIEW"].includes(status) && !hasLiveInterview && (!offer || ["WITHDRAWN"].includes(offer.status));
  const liveOffer = offer && ["ISSUED", "PENDING_APPROVAL"].includes(offer.status) && !enrolled;
  return (
    <Card title={t("adm.offer.title")} actions={offer ? <Badge tone={offer.status === "ISSUED" ? "brand" : offer.status === "PENDING_APPROVAL" ? "warn" : "neutral"}>{t(`adm.offer.status.${offer.status}` as "adm.offer.status.ISSUED")}</Badge> : undefined}>
      <div className="space-y-4">
        {!offer && !canDecide && <p className="text-sm text-muted">{t("adm.offer.none")}</p>}
        {offer && (
          <div className="space-y-1 text-sm">
            <p><span className="text-muted">{t("adm.offer.letterNo")}:</span> <span className="font-medium tabular-nums">{offer.letterNo}</span>{offer.classOffered ? ` · ${offer.classOffered}` : ""}</p>
            <p><span className="text-muted">{t("adm.offer.fee")}:</span> <span className="font-medium">{offer.feeCents > 0 ? money(offer.feeCents) : t("adm.pay.status.NOT_REQUIRED")}</span>{offer.expiresOn ? ` · ${t("adm.offer.until", { date: displayDate(offer.expiresOn, locale) })}` : ""}</p>
            {offer.notes && <p className="text-muted">{offer.notes}</p>}
            {offer.status !== "PENDING_APPROVAL" && <p><a href={`/api/admissions/${id}/offer-letter?lang=${locale}`} target="_blank" rel="noopener" className="font-medium text-link hover:underline">{t("adm.offer.letter")}</a></p>}
          </div>
        )}

        {canDecide && (
          <Disclosure label={t("adm.offer.issue")}>
            <ActionForm action={A.issueOfferAction} submitLabel={t("adm.offer.issue")} className="space-y-3">
              {hid("id", id)}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field name="classOfferedId" type="select" label={t("adm.offer.class")} options={classes} placeholder={t("common.select")} optionalLabel={t("common.optional")} />
                <Field name="feeAmount" label={t("adm.offer.fee")} defaultValue={defaultFeeCents / 100} hint={t("adm.offer.fee.hint")} />
                <Field name="expiresOn" type="date" label={t("adm.offer.expires")} optionalLabel={t("common.optional")} />
                <Field name="notes" label={t("adm.offer.notes")} optionalLabel={t("common.optional")} />
              </div>
              {can("admission.override") && <Field name="exceptionReason" label={t("adm.offer.exception")} optionalLabel={t("common.optional")} />}
            </ActionForm>
          </Disclosure>
        )}

        {can("admission.review") && ["APPLIED", "INTERVIEW"].includes(status) && !hasLiveInterview && !offer?.status.match(/PENDING_APPROVAL|ISSUED/) && (
          <Disclosure label={t("adm.decision.title")}>
            <ActionForm action={A.recordDecisionAction} submitLabel={t("common.save")} className="space-y-3">
              {hid("id", id)}
              <Field name="outcome" type="select" label={t("adm.decision.outcome")} required options={(["DEFERRED", "FURTHER_ASSESSMENT", "AWAITING_DECISION", "NOT_ACCEPTED"] as const).map((k) => ({ value: k, label: t(`adm.decision.${k}` as "adm.decision.DEFERRED") }))} placeholder={t("common.select")} />
              <Field name="note" label={t("adm.decision.note")} />
            </ActionForm>
          </Disclosure>
        )}

        {offer?.status === "PENDING_APPROVAL" && can("admission.offer.approve") && (
          offer.issuedById === userId ? <p className="text-sm text-muted">{t("adm.offer.approve.hint")}</p> : <ActionForm action={A.approveOfferAction} submitLabel={t("adm.offer.approve")} className="space-y-2">{hid("id", id)}</ActionForm>
        )}

        {liveOffer && can("admission.review") && (
          <div className="grid gap-2">
            <Disclosure label={t("adm.offer.revise")}>
              <ActionForm action={A.reviseOfferAction} submitLabel={t("common.save")} className="space-y-3">
                {hid("id", id)}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field name="feeAmount" label={t("adm.offer.fee")} defaultValue={offer.feeCents / 100} optionalLabel={t("common.optional")} />
                  <Field name="expiresOn" type="date" label={t("adm.offer.expires")} optionalLabel={t("common.optional")} />
                </div>
                <Field name="reason" label={t("adm.offer.reason")} required />
              </ActionForm>
            </Disclosure>
            <Disclosure label={t("adm.offer.moreActions")}>
              <div className="grid gap-4 lg:grid-cols-2">
                <ActionForm action={A.withdrawOfferAction} submitLabel={t("adm.offer.withdraw")} tone="danger" confirm={t("common.confirmAction")} className="space-y-2">{hid("id", id)}<Field name="reason" label={t("adm.offer.reason")} required /></ActionForm>
                {offer.status === "ISSUED" && <ActionForm action={A.declineOfferAction} submitLabel={t("adm.offer.decline")} tone="danger" confirm={t("common.confirmAction")} className="space-y-2">{hid("id", id)}<Field name="reason" label={t("adm.offer.reason")} required /></ActionForm>}
              </div>
            </Disclosure>
          </div>
        )}

        {offer && account && (
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("adm.pay.title")}</h3>
              <Badge tone={PAY_TONE[account.status]}>{t(`adm.pay.status.${account.status}` as "adm.pay.status.PAID")}</Badge>
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted">{t("adm.pay.required")}</dt><dd className="font-semibold tabular-nums">{money(account.requiredCents)}</dd></div>
              <div><dt className="text-muted">{t("adm.pay.verified")}</dt><dd className="font-semibold tabular-nums text-ok">{money(account.verifiedCents)}</dd></div>
              <div><dt className="text-muted">{t("adm.pay.pending")}</dt><dd className="font-semibold tabular-nums">{money(account.pendingCents)}</dd></div>
              <div><dt className="text-muted">{t("adm.pay.balance")}</dt><dd className="font-semibold tabular-nums">{money(account.balanceCents)}</dd></div>
            </dl>
            {offer.waiver && <p className="rounded-lg border border-tint-2 bg-tint px-3 py-2 text-sm text-link">{t("adm.pay.waived", { reason: offer.waiver.reason })}</p>}
            {payments.length === 0 ? <p className="text-sm text-muted">{t("adm.pay.none")}</p> : (
              <ul className="divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="space-y-2 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span><span className="font-medium tabular-nums">{money(p.amountCents)}</span> <span className="text-muted">· {t(`fin.method.${p.method}` as "fin.method.CASH")}{p.reference ? ` · ${p.reference}` : ""} · {displayDate(p.paidOn, locale)}</span></span>
                      <span className="flex items-center gap-2">
                        {p.receiptNo && <a href={`/api/admission-receipts/${p.id}?lang=${locale}`} target="_blank" rel="noopener" className="font-medium text-link hover:underline">{t("adm.pay.receipt")} {p.receiptNo}</a>}
                        <Badge tone={ROW_TONE[p.status]}>{t(`adm.pay.row.${p.status}` as "adm.pay.row.PENDING")}</Badge>
                      </span>
                    </div>
                    {(p.rejectReason || p.reverseReason) && <p className="text-muted">{p.rejectReason ?? p.reverseReason}</p>}
                    {can("admission.payment.verify") && ["PENDING", "VERIFIED"].includes(p.status) && (
                      <PaymentActions t={t} paymentId={p.id} status={p.status} enrolled={enrolled} />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!enrolled && can("admission.payment.record") && offer.status === "ISSUED" && (
              <Disclosure label={t("adm.pay.record")}><PaymentForm t={t} applicationId={id} /></Disclosure>
            )}
            {!can("admission.payment.record") && !can("admission.payment.verify") && <p className="text-xs text-muted">{t("adm.pay.financeOnly")}</p>}
            {can("admission.override") && status === "ACCEPTED" && offer.status === "ISSUED" && !account.satisfied && (
              <Disclosure label={t("adm.pay.waive")}>
                <ActionForm action={A.waivePaymentAction} submitLabel={t("adm.pay.waive")} className="space-y-2">{hid("id", id)}<Field name="reason" label={t("adm.exception.reason")} required /></ActionForm>
              </Disclosure>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export function PaymentActions({ t, paymentId, status, enrolled }: { t: Translate; paymentId: string; status: string; enrolled: boolean }) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === "PENDING" && (
        <>
          <ActionForm action={FA.verifyAdmissionPaymentAction} submitLabel={t("adm.pay.verify")} inline className="space-y-0">{hid("paymentId", paymentId)}</ActionForm>
          <Disclosure label={t("adm.pay.reject")}><ActionForm action={FA.rejectAdmissionPaymentAction} submitLabel={t("adm.pay.reject")} tone="danger" className="space-y-2">{hid("paymentId", paymentId)}<Field name="reason" label={t("adm.pay.reason")} required /></ActionForm></Disclosure>
        </>
      )}
      {status === "VERIFIED" && (
        <Disclosure label={t("adm.pay.reverse")}>
          {enrolled && <p className="mb-2 text-sm text-warn">{t("adm.pay.reverseWarn")}</p>}
          <ActionForm action={FA.reverseAdmissionPaymentAction} submitLabel={t("adm.pay.reverse")} tone="danger" confirm={t("common.confirmAction")} className="space-y-2">{hid("paymentId", paymentId)}<Field name="reason" label={t("adm.pay.reason")} required /></ActionForm>
        </Disclosure>
      )}
    </div>
  );
}

export function PaymentForm({ t, applicationId }: { t: Translate; applicationId: string }) {
  return (
    <ActionForm action={FA.recordAdmissionPaymentAction} submitLabel={t("adm.pay.record")} className="space-y-3">
      {hid("applicationId", applicationId)}{hid("idempotencyKey", randomUUID())}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="amount" label={t("adm.pay.amount")} required />
        <Field name="method" type="select" label={t("adm.pay.method")} required options={(["CASH", "BANK", "MOBILE_MONEY", "OTHER"] as const).map((m) => ({ value: m, label: t(`fin.method.${m}` as "fin.method.CASH") }))} defaultValue="CASH" />
        <Field name="reference" label={t("adm.pay.reference")} optionalLabel={t("common.optional")} />
        <Field name="paidOn" type="date" label={t("adm.pay.paidOn")} optionalLabel={t("common.optional")} />
        <Field name="payerName" label={t("adm.pay.payer")} optionalLabel={t("common.optional")} />
        <Field name="notes" label={t("adm.pay.notes")} optionalLabel={t("common.optional")} />
      </div>
    </ActionForm>
  );
}

