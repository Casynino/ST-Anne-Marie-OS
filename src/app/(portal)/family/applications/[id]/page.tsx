import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Check, Download, FileText, Pencil } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import type { Translate } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { AppError } from "@/lib/errors";
import { getApplicationReview } from "@/server/application-draft";
import { DOCUMENT_TYPES } from "@/server/documents";
import type { StoredForm } from "@/server/online-application";
import { ActionForm, Field, inputClass } from "@/components/form";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { cancelApplicationAction, confirmApplicationAction, removeApplicationFileAction, sandboxPayAction, uploadApplicationFileAction } from "../actions";

export const metadata: Metadata = { title: "Application" };

const FILE_CLASS = `${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-tint file:px-3 file:py-2 file:text-sm file:font-medium file:text-link`;
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** One labelled value of the application; empty values are left out so the page shows only what was entered. */
function Item({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-0.5 whitespace-pre-line text-sm font-medium">{value}</dd></div>;
}

function Steps({ t, steps }: { t: Translate; steps: { label: string; done: boolean; current: boolean }[] }) {
  return (
    <ol className="mb-5 grid gap-2 sm:grid-cols-5" aria-label={t("apf.steps")}>
      {steps.map((s, i) => (
        <li key={s.label} aria-current={s.current ? "step" : undefined} className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm ${s.current ? "border-brand-500 bg-surface font-semibold ring-1 ring-brand-500" : s.done ? "border-ok/40 bg-surface" : "border-line bg-surface text-muted"}`}>
          <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold ${s.done ? "bg-ok text-white" : s.current ? "bg-brand-700 text-white" : "bg-canvas text-muted"}`}>{s.done ? <Check className="size-3.5" /> : i + 1}</span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

export default async function MyApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getT();
  const a = await getApplicationReview(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!a) notFound();
  const f: StoredForm = a.form;
  const money = (c: number) => formatMoney(c, a.currency);
  const awaiting = a.draftStatus === "AWAITING_PAYMENT";
  const confirmed = a.confirmedAt !== null;
  const rel = (r?: string) => (r ? t(`student.rel.${r}` as "student.rel.FATHER") : null);
  const docsOf = (type: string) => a.documents.filter((d) => d.docType === type);
  const otherTypes = DOCUMENT_TYPES.filter((d) => d !== "PASSPORT_PHOTO");
  const requiredTypes = new Set(a.checklist.papers.map((p) => p.docType));
  const extraDocs = a.documents.filter((d) => d.docType !== "PASSPORT_PHOTO" && !requiredTypes.has(d.docType));
  const dl = (href: string, label: string) => <a href={href} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:border-brand-500"><Download className="size-4" aria-hidden />{label}</a>;
  const steps = [
    { label: t("apf.step.details"), done: true, current: false },
    { label: t("apf.step.files"), done: a.checklist.complete, current: awaiting && !a.checklist.complete },
    { label: t("apf.step.confirm"), done: confirmed || !awaiting, current: awaiting && a.checklist.complete && !confirmed },
    { label: t("apf.step.pay"), done: a.paid, current: awaiting && confirmed },
    { label: t("apf.step.sent"), done: a.draftStatus === "SUBMITTED", current: false },
  ];

  const uploadForm = (docType: string, label: string, accept: string) => (
    <ActionForm action={uploadApplicationFileAction} submitLabel={label} className="space-y-2">
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="docType" value={docType} />
      <label htmlFor={`file-${docType}`} className="sr-only">{label}</label>
      <input id={`file-${docType}`} name="file" type="file" required accept={accept} className={FILE_CLASS} />
    </ActionForm>
  );
  const fileRow = (d: (typeof a.documents)[number]) => (
    <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
      <FileText className="size-4 shrink-0 text-muted" aria-hidden />
      <a href={`/api/my-documents/${d.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-sm font-medium text-link hover:underline">{d.fileName}</a>
      <span className="text-xs text-muted">{kb(d.sizeBytes)}</span>
      <Badge tone={d.verification === "VERIFIED" ? "ok" : d.verification === "NEEDS_CORRECTION" ? "warn" : "neutral"}>{t(`apf.doc.${d.verification}` as "apf.doc.PENDING")}</Badge>
      {awaiting && <ActionForm action={removeApplicationFileAction} submitLabel={t("common.delete")} inline tone="danger"><input type="hidden" name="documentId" value={d.id} /></ActionForm>}
    </li>
  );

  return (
    <>
      <PageHeader title={a.childName} subtitle={[a.className, a.applicationNo].filter(Boolean).join(" · ")} actions={<Badge tone={a.draftStatus === "SUBMITTED" ? "ok" : a.draftStatus === "AWAITING_PAYMENT" ? "warn" : "neutral"}>{t(`apf.status.${a.draftStatus}` as "apf.status.SUBMITTED")}</Badge>} />
      {a.draftStatus !== "CANCELLED" && <Steps t={t} steps={steps} />}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {a.draftStatus === "SUBMITTED" && (
            <Card title={t("apf.done.title")}>
              <p className="text-sm">{t("apf.done.body", { number: a.applicationNo ?? "" })}</p>
              {a.publicStatus && <p className="mt-2 text-sm"><span className="text-muted">{t("apf.done.status")}: </span><strong>{t(`apply.status.${a.publicStatus}` as "apply.status.APPLIED")}</strong></p>}
              <div className="mt-4 flex flex-wrap gap-3">
                {dl(`/api/applications/${a.id}/form`, t("apf.download.form"))}
                {a.paid && dl(`/api/applications/${a.id}/receipt`, t("apf.download.receipt"))}
              </div>
              <p className="mt-4 text-sm text-muted">{t("apf.done.track")}</p>
            </Card>
          )}
          {a.draftStatus === "PAID_HOLD" && (
            <Card title={t("apf.hold.title")}>
              <p className="text-sm">{t("apf.hold.body")}</p>
              {a.paid && <div className="mt-4">{dl(`/api/applications/${a.id}/receipt`, t("apf.download.receipt"))}</div>}
            </Card>
          )}
          {a.draftStatus === "CANCELLED" && <Card><p className="text-sm text-muted">{t("apf.cancelled")}</p></Card>}

          {awaiting && (
            <Card title={t("apf.pay.title")}>
              {!a.checklist.complete ? (
                <div>
                  <p className="text-sm">{t("apf.pay.locked")} <a href="#files" className="font-semibold text-link hover:underline">{t("apf.pay.goFiles")}</a></p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-warn">
                    {a.checklist.photo.required && !a.checklist.photo.present && <li>{t("apf.photo.title")}</li>}
                    {a.checklist.papers.filter((p) => !p.present).map((p) => <li key={p.docType}>{t(`doc.type.${p.docType}` as "doc.type.OTHER")}</li>)}
                  </ul>
                </div>
              ) : !confirmed ? (
                <div>
                  <p className="text-sm">{t("apf.confirm.body")}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-4"><ActionForm action={confirmApplicationAction} submitLabel={t("apf.confirm.button")}><input type="hidden" name="id" value={a.id} /></ActionForm><Link href={`/family/applications/${a.id}/edit`} className="text-sm font-semibold text-link hover:underline">{t("apf.edit")}</Link></div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted">{t("apf.pay.intro")}</p>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div><dt className="text-xs text-muted">{t("apf.pay.amount")}</dt><dd className="text-2xl font-semibold tabular-nums">{money(a.feeCents)}</dd></div>
                    <div><dt className="text-xs text-muted">{t("apf.pay.reference")}</dt><dd className="font-mono text-2xl font-semibold tracking-wider">{a.reference}</dd></div>
                  </dl>
                  {a.ready && a.instructions && (
                    <div className="mt-4 rounded-xl border border-line bg-canvas p-4">
                      <p className="text-sm font-semibold">{t("apf.pay.how")}</p>
                      <p className="mt-1 whitespace-pre-line text-sm">{a.instructions}</p>
                      <p className="mt-2 text-sm text-muted">{t("apf.pay.useReference", { reference: a.reference })}</p>
                    </div>
                  )}
                  {!a.ready && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("apf.pay.notReady")}</p>}
                  <p className="mt-4 text-sm text-muted">{t("apf.pay.after")}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <LinkButton href={`/family/applications/${a.id}`} variant="secondary">{t("apf.pay.check")}</LinkButton>
                    <Link href={`/family/applications/${a.id}/edit`} className="text-sm font-semibold text-link hover:underline">{t("apf.pay.change")}</Link>
                  </div>
                  {a.sandbox && (
                    <div className="mt-5 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-warn">{t("apf.sandbox.title")}</p>
                      <p className="mb-3 text-sm text-warn">{t("apf.sandbox.body")}</p>
                      <ActionForm action={sandboxPayAction} submitLabel={t("apf.sandbox.button")}><input type="hidden" name="id" value={a.id} /></ActionForm>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          <Card title={t("apf.review.title")} actions={awaiting ? <LinkButton href={`/family/applications/${a.id}/edit`} variant="secondary"><Pencil className="size-4" aria-hidden /> {t("apf.edit")}</LinkButton> : undefined}>
            {awaiting && <p className="mb-4 text-sm text-muted">{t("apf.review.intro")}</p>}
            <div className="space-y-6">
              <section aria-labelledby="rv-child">
                <h3 id="rv-child" className="mb-2 text-sm font-semibold text-brand-700">{t("apply.child")}</h3>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                  <Item label={t("apply.entry.title")} value={f.entryType === "TRANSFER" ? t("apply.entry.transfer") : t("apply.entry.new")} />
                  <Item label={t("student.firstName")} value={f.firstName} />
                  <Item label={t("student.middleName")} value={f.middleName} />
                  <Item label={t("student.lastName")} value={f.lastName} />
                  <Item label={t("student.dob")} value={displayDate(new Date(f.dateOfBirth), ctx.locale)} />
                  <Item label={t("student.gender")} value={t(f.gender === "MALE" ? "student.male" : "student.female")} />
                  <Item label={t("apply.class")} value={a.className} />
                  <Item label={t("student.nationality")} value={f.nationality} />
                  <Item label={t("student.religion")} value={f.religion} />
                  <Item label={t("student.birthCert")} value={f.birthCertificateNo} />
                  <Item label={t("student.previousSchool")} value={f.previousSchool} />
                  <Item label={t("apply.previousClass")} value={f.previousClass} />
                  <Item label={t("apply.transfer.admissionNo")} value={f.previousAdmissionNo} />
                  <Item label={t("common.address")} value={f.address} />
                  <div className="sm:col-span-3"><Item label={t("apply.transfer.reason")} value={f.entryType === "TRANSFER" ? f.transferReason : null} /></div>
                  <div className="sm:col-span-3"><Item label={t("apply.health")} value={f.healthNotes} /></div>
                </dl>
              </section>
              <section aria-labelledby="rv-g1">
                <h3 id="rv-g1" className="mb-2 text-sm font-semibold text-brand-700">{t("apply.guardian")}</h3>
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                  <Item label={t("apply.guardian.name")} value={f.g1_fullName} />
                  <Item label={t("apply.relationship")} value={rel(f.g1_relationship)} />
                  <Item label={t("apply.guardian.phone")} value={f.g1_phone} />
                  <Item label={t("common.email")} value={f.g1_email} />
                  <Item label={t("apply.occupation")} value={f.g1_occupation} />
                </dl>
              </section>
              {f.g2_fullName && (
                <section aria-labelledby="rv-g2">
                  <h3 id="rv-g2" className="mb-2 text-sm font-semibold text-brand-700">{t("apply.guardian2")}</h3>
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                    <Item label={t("apply.guardian.name")} value={f.g2_fullName} />
                    <Item label={t("apply.relationship")} value={rel(f.g2_relationship)} />
                    <Item label={t("apply.guardian.phone")} value={f.g2_phone} />
                    <Item label={t("common.email")} value={f.g2_email} />
                    <Item label={t("apply.occupation")} value={f.g2_occupation} />
                  </dl>
                </section>
              )}
              {f.ec_name && (
                <section aria-labelledby="rv-ec">
                  <h3 id="rv-ec" className="mb-2 text-sm font-semibold text-brand-700">{t("apply.emergency")}</h3>
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                    <Item label={t("apply.guardian.name")} value={f.ec_name} />
                    <Item label={t("apply.relationship")} value={f.ec_relationship} />
                    <Item label={t("apply.guardian.phone")} value={f.ec_phone} />
                  </dl>
                </section>
              )}
            </div>
          </Card>

          {a.draftStatus !== "CANCELLED" && (
            <div id="files" className="scroll-mt-24"><Card title={t("apf.files.title")}>
              <p className="mb-4 text-sm text-muted">{awaiting ? t("apf.files.intro") : t("apf.files.later")}</p>
              <div className="grid gap-5 sm:grid-cols-[9rem_1fr]">
                <div>
                  {a.photoId
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/my-documents/${a.photoId}`} alt={t("apf.photo.alt", { name: a.childName })} className="aspect-[3/4] w-36 rounded-xl border border-line object-cover" />
                    : <div className="grid aspect-[3/4] w-36 place-items-center rounded-xl border-2 border-dashed border-line px-2 text-center text-xs text-muted">{t("apf.photo.none")}</div>}
                </div>
                <div>
                  <h3 className="text-sm font-semibold">{t("apf.photo.title")} {a.checklist.photo.required && <span className="text-bad">*</span>}</h3>
                  <p className="mb-2 text-sm text-muted">{t("apf.photo.hint")}</p>
                  {uploadForm("PASSPORT_PHOTO", a.photoId ? t("apf.photo.replace") : t("apf.photo.upload"), "image/jpeg,image/png,image/webp")}
                </div>
              </div>

              {a.checklist.papers.length > 0 && (
                <div className="mt-6 space-y-4">
                  <h3 className="text-sm font-semibold">{t("apf.papers.required")}</h3>
                  {a.checklist.papers.map((p) => (
                    <div key={p.docType} className="rounded-xl border border-line p-3">
                      <p className="flex items-center gap-2 text-sm font-medium"><span aria-hidden className={`grid size-5 place-items-center rounded-md text-white ${p.present ? "bg-ok" : "bg-line"}`}>{p.present && <Check className="size-3.5" />}</span>{t(`doc.type.${p.docType}` as "doc.type.OTHER")} <span className="text-bad">*</span></p>
                      {docsOf(p.docType).length > 0 && <ul className="mt-1 divide-y divide-line">{docsOf(p.docType).map(fileRow)}</ul>}
                      {awaiting && <div className="mt-2">{uploadForm(p.docType, t("apf.papers.add"), "application/pdf,image/jpeg,image/png,image/webp")}</div>}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-sm font-semibold">{t("apf.papers.other")}</h3>
                <ActionForm action={uploadApplicationFileAction} submitLabel={t("apf.papers.add")} className="mt-2 space-y-3">
                  <input type="hidden" name="id" value={a.id} />
                  <Field name="docType" label={t("apf.papers.type")} type="select" options={otherTypes.map((d) => ({ value: d, label: t(`doc.type.${d}` as "doc.type.OTHER") }))} defaultValue="OTHER" />
                  <div>
                    <label htmlFor="file-other" className="mb-1 block text-sm font-medium">{t("apf.papers.file")}</label>
                    <input id="file-other" name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className={FILE_CLASS} />
                    <p className="mt-1 text-sm text-muted">{t("apf.papers.hint")}</p>
                  </div>
                </ActionForm>
                {extraDocs.length > 0 && <ul className="mt-3 divide-y divide-line">{extraDocs.map(fileRow)}</ul>}
              </div>
            </Card></div>
          )}

        </div>
        <div className="space-y-5">
          <Card title={t("apf.details")}>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted">{t("apf.pay.reference")}</dt><dd className="font-mono">{a.reference}</dd></div>
              <div><dt className="text-muted">{t("apf.started")}</dt><dd>{displayDate(a.createdAt, ctx.locale)}</dd></div>
              {a.paid && a.paidAt && <div><dt className="text-muted">{t("apf.paidOn")}</dt><dd>{displayDate(a.paidAt, ctx.locale)}{a.test ? ` (${t("apf.test")})` : ""}</dd></div>}
              {a.receiptNo && <div><dt className="text-muted">{t("fin.pdf.receiptNo")}</dt><dd>{a.receiptNo}</dd></div>}
            </dl>
          </Card>
          {awaiting && (
            <Card title={t("apf.cancel.title")}>
              <ActionForm action={cancelApplicationAction} submitLabel={t("apf.cancel.button")} tone="danger" confirm={t("apf.cancel.confirm")}><input type="hidden" name="id" value={a.id} /></ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
