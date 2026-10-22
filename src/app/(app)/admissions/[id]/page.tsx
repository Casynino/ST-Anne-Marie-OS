import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import { getApplication, OPEN_STATUSES } from "@/server/admissions";
import { listClasses } from "@/server/academics";
import { listDocuments, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/server/documents";
import { getSchoolBasics } from "@/server/settings";
import { getAdmissionPolicy, requiredDocsFor } from "@/server/admission-policy";
import { documentReadiness } from "@/server/admission-review";
import { enrolmentReadiness, loadAdmissionAccount } from "@/server/admission-offers";
import { interviewsOfApplication, listInterviewers, upcomingInterviewSlots } from "@/server/interviews";
import { Printer } from "lucide-react";
import { deskRow } from "@/server/admission-desk";
import { acceptanceReadiness } from "@/server/admission-offers";
import { } from "@/server/admission-review";
import { noticesOf } from "@/server/application-notices";
import { classOccupancy } from "@/server/admission-queues";
import { ActionForm, Field } from "@/components/form";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { stageOf } from "@/lib/admissions/rules";
import { QuickBar } from "../quick-actions";
import { missingLabels, quickActs, quickLabels, quickSlots } from "../quick-line";
import { quickDecisionAction } from "../actions";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { ConfirmBoxes, FileInput } from "./parts";
import { DocsReviewCard, GateList, InterviewCard, OfferCard } from "./sections";
import { DeskCard } from "./desk";
import { deleteDocumentAction, enrolApplicationAction, transitionApplicationAction, uploadDocumentAction } from "../actions";

export const metadata: Metadata = { title: "Application" };
const TONE = { APPLIED: "neutral", INTERVIEW: "warn", ACCEPTED: "brand", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const { id } = await params;
  let app: Awaited<ReturnType<typeof getApplication>>;
  try {
    app = await getApplication(ctx, id);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  const school = await getSchoolBasics(ctx.schoolId);
  const open = (OPEN_STATUSES as readonly string[]).includes(app.status);
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  const now = Date.now();

  const [policy, docs, ivs, interviewers, acct, docsReady, gate, allClasses, occupancy, exceptionUser, row, ready, notices, slotRows, feeDraft] = await Promise.all([
    getAdmissionPolicy(db, ctx.schoolId),
    can("document.read") ? listDocuments(ctx, { applicationId: id }) : [],
    interviewsOfApplication(ctx, id),
    can("admission.interview.manage") ? listInterviewers(ctx) : [],
    loadAdmissionAccount(db, ctx.schoolId, id),
    documentReadiness(db, ctx.schoolId, app),
    open ? enrolmentReadiness(db, ctx.schoolId, app) : null,
    can("academic.read") ? listClasses(ctx) : [],
    classOccupancy(ctx.schoolId),
    app.docsExceptionById ? db.user.findFirst({ where: { id: app.docsExceptionById, schoolId: ctx.schoolId }, select: { fullName: true } }) : null,
    deskRow(ctx, id),
    acceptanceReadiness(db, ctx.schoolId, app),
    
    noticesOf(db, ctx.schoolId, id),
    can("admission.interview.manage") ? upcomingInterviewSlots(ctx) : [],
    db.applicationDraft.findUnique({ where: { applicationId: id }, select: { id: true, paidAt: true, receiptNo: true } }),
  ]);
  const reviewer = app.reviewedById ? await db.user.findFirst({ where: { id: app.reviewedById, schoolId: ctx.schoolId }, select: { fullName: true } }) : null;
  const classes = allClasses.filter((c) => c.isActive);
  const classOptions = classes.map((c) => ({ value: c.id, label: c.name }));
  const offer = acct.offer;
  const live = ivs.find((i) => i.status === "SCHEDULED");
  const photo = docs.find((d) => d.docType === "PASSPORT_PHOTO");
  const emergency = app.emergencyContact as { name?: string; phone?: string; relationship?: string } | null;

  // Placement choices show how full each class is, so nobody is surprised by a "class is full" message.
  const placementOptions = classes.flatMap((c) => {
    const o = occupancy.get(c.id);
    const note = o?.capacity ? ` (${o.count}/${o.capacity}${o.count >= o.capacity ? ` ${t("adm.place.full")}` : ""})` : "";
    return c.streams.length ? c.streams.map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} – ${s.name}${note}` })) : [{ value: c.id, label: `${c.name}${note}` }];
  });
  const preferredFull = (() => { const o = app.classAppliedId ? occupancy.get(app.classAppliedId) : null; return !!o?.capacity && o.count >= o.capacity; })();

  return (
    <>
      <PageHeader
        title={`${app.firstName} ${app.middleName ?? ""} ${app.lastName}`}
        subtitle={`${app.applicationNo} · ${t(`adm.status.${app.status}`)} · ${t(`adm.channel.${app.source}` as "adm.channel.ONLINE")}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/applications/${id}/form`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-canvas"><Printer className="size-4" aria-hidden />{t("adm.app.print")}</a>
            {feeDraft?.paidAt && feeDraft.receiptNo && <a href={`/api/applications/${feeDraft.id}/receipt`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold hover:bg-canvas"><Printer className="size-4" aria-hidden />{t("adm.app.receipt")}</a>}
            {open && can("admission.create") && <LinkButton href={`/admissions/${id}/edit`} variant="secondary">{t("adm.edit")}</LinkButton>}
          </div>
        }
      />
      <AdmissionsNav ctx={ctx} t={t} current={stageOf(row.state) === "interview" ? "/admissions?stage=interview" : "/admissions"} />
      {/* The same steps as the list, here on the application: Accept, Send back, Decline (and Result, Enrol), each asking in a pop-up first. */}
      <div className="mb-5">
        <QuickBar
          line={{ id, name: `${app.firstName} ${app.lastName}`, className2: row.className ?? t("adm.noClass"), classId: row.classAppliedId, acts: quickActs(row, t, can, now), afterReview: row.afterReview, pendingDocs: row.pendingDocs, missing: missingLabels(row, t), interviewDetail: row.interviewAt ? displayDateTime(row.interviewAt, school.timezone, ctx.locale) : null }}
          labels={quickLabels(t)} dismiss={t("adm.bulk.dismiss")} quick={quickDecisionAction} slots={quickSlots(slotRows)}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <DeskCard
            t={t} id={id} name={`${app.firstName} ${app.lastName}`} row={row} status={app.status} reviewStatus={app.reviewStatus} reviewNote={app.reviewNote} reviewedAt={app.reviewedAt} reviewerName={reviewer?.fullName ?? null}
            interviewWaivedReason={app.interviewWaivedReason} open={open} can={can} interviewers={interviewers} defaultMinutes={policy.interviewMinutes} ready={ready}
            checklistOpen={docsReady.checklist.filter((c) => c.state !== "VERIFIED" && !app.docsExceptionAt)} offerStatus={offer?.status ?? null} account={acct.account ? { requiredCents: acct.account.requiredCents } : null}
            currency={school.currency} notices={notices} locale={ctx.locale} timezone={school.timezone}
            slots={slotRows.map((x) => ({ local: x.local, label: t("adm.slot.label", { when: x.when, n: x.count }) }))}
          />
          {app.student && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-ok">
              {t("adm.studentRecord")}: <Link className="font-semibold underline" href={`/students/${app.student.id}`}>{app.student.admissionNo}</Link>
            </p>
          )}

          <DocsReviewCard
            t={t} id={id} open={open} can={can} required={requiredDocsFor(policy, app.entryType)} checklist={docsReady.checklist}
            docs={docs.map((d) => ({ id: d.id, docType: d.docType, fileName: d.fileName, verification: d.verification, verificationNote: d.verificationNote }))}
            review={{ status: app.reviewStatus, note: app.reviewNote, by: reviewer?.fullName ?? null, at: app.reviewedAt, locale: ctx.locale, timezone: school.timezone }}
            exception={app.docsExceptionAt ? { reason: app.docsExceptionReason ?? "", by: exceptionUser?.fullName ?? null } : null}
          />

          <InterviewCard t={t} id={id} status={app.status} open={open} can={can} rows={ivs} interviewers={interviewers} defaultMinutes={policy.interviewMinutes} now={now} locale={ctx.locale} timezone={school.timezone} ready={docsReady.ok && app.reviewStatus !== "RETURNED"} />

          <OfferCard
            t={t} id={id} status={app.status} open={open} can={can} userId={ctx.userId} locale={ctx.locale} timezone={school.timezone} currency={school.currency} classes={classOptions} defaultFeeCents={policy.admissionFeeCents}
            hasLiveInterview={!!live} enrolled={app.status === "ENROLLED"} account={acct.account}
            offer={offer ? { status: offer.status, letterNo: offer.letterNo, feeCents: centsOf(offer.feeAmount), expiresOn: offer.expiresOn, notes: offer.notes, issuedById: offer.issuedById, classOffered: allClasses.find((c) => c.id === offer.classOfferedId)?.name ?? null, waiver: offer.paymentWaivedAt ? { reason: offer.paymentWaiverReason ?? "" } : null } : null}
            payments={acct.payments.map((p) => ({ id: p.id, amountCents: centsOf(p.amount), method: p.method, reference: p.reference, paidOn: p.paidOn, status: p.status, receiptNo: p.receiptNo, recordedAt: p.recordedAt, reverseReason: p.reverseReason, rejectReason: p.rejectReason }))}
          />

          {app.status === "ACCEPTED" && can("admission.enrol") && gate && (
            <Card title={t("adm.enrol.title")}>
              <div className="space-y-4">
                <div><h3 className="mb-2 text-sm font-semibold">{t("adm.gate.title")}</h3><GateList t={t} items={gate.items} /></div>
                {gate.ready ? (
                  <ActionForm action={enrolApplicationAction} submitLabel={t("adm.action.enrol")} className="space-y-3 border-t border-line pt-4">
                    <input type="hidden" name="id" value={id} />
                    <p className="text-sm text-ok">{t("adm.gate.ready")}</p>
                    {app.className && <p className="text-sm text-muted">{t("adm.enrol.preferred", { class: app.className })}{preferredFull ? ` (${t("adm.place.full")})` : ""}</p>}
                    {can("student.enroll") && placementOptions.length > 0 && <Field name="placement" label={t("adm.reg.classLabel")} hint={t("adm.reg.classHint")} type="select" required options={placementOptions} placeholder={t("common.select")} />}
                    {can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
                    <ConfirmBoxes duplicate={t("student.confirmDuplicate")} sharedPhone={t("adm.confirmSharedPhone")} />
                  </ActionForm>
                ) : <p className="text-sm text-bad">{t("adm.gate.blocked")}</p>}
              </div>
            </Card>
          )}

          <Card title={t("doc.title")}>
            <p className="mb-3 text-sm text-muted">{t("doc.access")}</p>
            {docs.length === 0 ? (
              <p className="text-sm text-muted">{can("document.read") ? t("doc.none") : t("common.noAccess.body")}</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{d.fileName}</p>
                      <p className="text-muted">{t(`doc.type.${d.docType as "OTHER"}`)} · {kb(d.sizeBytes)} · {t("doc.uploadedBy", { name: d.uploadedBy })} · {displayDateTime(d.createdAt, school.timezone, ctx.locale)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a href={`/api/documents/${d.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 font-medium text-link hover:bg-canvas">{t("doc.download")}</a>
                      {can("document.delete") && (
                        <details>
                          <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-bad">{t("doc.remove")}</summary>
                          <ActionForm action={deleteDocumentAction} submitLabel={t("doc.remove")} tone="danger" className="mt-2 w-64 max-w-full space-y-2">
                            <input type="hidden" name="documentId" value={d.id} />
                            <Field name="reason" label={t("doc.remove.reason")} required />
                          </ActionForm>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {can("document.upload") && (
              <ActionForm action={uploadDocumentAction} submitLabel={t("doc.upload")} className="mt-4 space-y-3 border-t border-line pt-4">
                <input type="hidden" name="applicationId" value={id} />
                <Field name="docType" label={t("doc.type")} type="select" required options={DOCUMENT_TYPES.map((d) => ({ value: d, label: t(`doc.type.${d}`) }))} placeholder={t("common.select")} />
                <FileInput label={t("doc.file")} hint={t("doc.file.hint", { size: Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024) })} />
              </ActionForm>
            )}
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title={t("adm.details")}>
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/documents/${photo.id}`} alt={t("apf.photo.alt", { name: `${app.firstName} ${app.lastName}` })} className="mb-4 aspect-[3/4] w-28 rounded-xl border border-line object-cover" />
            )}
            <DefList
              items={[
                { label: t("student.dob"), value: displayDate(app.dateOfBirth, ctx.locale) },
                { label: t("student.gender"), value: app.gender === "MALE" ? t("student.male") : t("student.female") },
                { label: t("adm.classApplied"), value: app.className ?? t("adm.noClass") },
                { label: t("adm.channel"), value: t(`adm.channel.${app.source}` as "adm.channel.ONLINE") },
                { label: t("adm.submittedOn"), value: app.submittedOn ? displayDate(app.submittedOn, ctx.locale) : null },
                { label: t("student.nationality"), value: app.nationality },
                { label: t("student.religion"), value: app.religion },
                { label: t("student.birthCert"), value: app.birthCertificateNo },
                { label: t("student.previousSchool"), value: app.previousSchool },
                { label: t("apply.entry.title"), value: app.entryType === "TRANSFER" ? t("apply.entry.transfer") : t("apply.entry.new") },
                { label: t("apply.previousClass"), value: app.previousClass },
                { label: t("apply.transfer.admissionNo"), value: app.previousAdmissionNo },
                { label: t("apply.transfer.reason"), value: app.entryType === "TRANSFER" ? app.transferReason : null },
                { label: t("common.address"), value: app.address },
                { label: t("adm.emergency"), value: emergency ? `${emergency.name} (${emergency.relationship}) ${emergency.phone}` : null },
                { label: t("adm.health"), value: app.healthNotes },
                { label: t("adm.assessmentNotes"), value: app.assessmentNotes },
                { label: t("adm.decision"), value: app.decisionReason },
              ]}
            />
          </Card>

          <Card title={t("adm.guardians")}>
            <ul className="divide-y divide-line text-sm">
              {app.guardians.map((g, i) => (
                <li key={i} className="py-2">
                  <p className="font-medium">{g.fullName ?? "—"} {g.relationship && <span className="font-normal text-muted">· {t(`student.rel.${g.relationship as "FATHER"}`)}</span>}</p>
                  <p className="text-muted">{g.phone ?? ""} {g.email ?? ""}</p>
                  {g.occupation && <p className="text-muted">{g.occupation}</p>}
                </li>
              ))}
            </ul>
          </Card>

          {open && (can("admission.review") || can("admission.create")) && (
            <Card title={t("common.actions")}>
              <p className="mb-3 text-sm text-muted">{t("adm.closeNote")}</p>
              {acct.payments.some((p) => p.status === "VERIFIED") && <p className="mb-3 text-sm text-warn">{t("adm.heldMoney")}</p>}
              <div className="grid gap-4">
                {can("admission.review") && (
                  <ActionForm action={transitionApplicationAction} submitLabel={t("adm.action.reject")} tone="danger" confirm={t("common.confirmAction")} className="space-y-3">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="to" value="REJECTED" />
                    <Field name="reason" label={t("adm.reason")} hint={t("adm.reason.hint")} required />
                  </ActionForm>
                )}
                <ActionForm action={transitionApplicationAction} submitLabel={t("adm.action.withdraw")} tone="danger" confirm={t("common.confirmAction")} className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="to" value="WITHDRAWN" />
                  <Field name="reason" label={t("adm.reason")} hint={t("adm.reason.hint")} required />
                </ActionForm>
              </div>
            </Card>
          )}

          <Card title={t("adm.history")}>
            <ol className="space-y-2 text-sm">
              {app.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                  {e.kind === "STATUS" ? <Badge tone={TONE[e.toStatus]}>{t(`adm.status.${e.toStatus}`)}</Badge> : <Badge>{t(`adm.event.kind.${e.kind}` as "adm.event.kind.STATUS")}</Badge>}
                  <span className="text-muted">{displayDateTime(e.createdAt, school.timezone, ctx.locale)} · {e.byApplicant ? t("adm.byApplicant") : e.by}</span>
                  {e.reason && <span className="basis-full">{e.reason}</span>}
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
