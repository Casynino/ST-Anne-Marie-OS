import Link from "next/link";
import type { Metadata } from "next";
import { Printer } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/server/documents";
import { getOfficeDraft } from "@/server/office-application";
import { ActionForm, Field } from "@/components/form";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { FileInput } from "../../[id]/parts";
import { cancelOfficeDraftAction, uploadOfficeDraftDocumentAction } from "../../actions";

export const metadata: Metadata = { title: "Application waiting for its fee" };
const TONE = { AWAITING_PAYMENT: "warn", SUBMITTED: "ok", PAID_HOLD: "bad", CANCELLED: "neutral" } as const;

/** An application filled in at the office, before and after its fee is paid: the details, the payment reference, the papers, the printed form. */
export default async function OfficeDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getOfficeDraft>>;
  try { d = await getOfficeDraft(ctx, id); } catch (e) { if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>; throw e; }
  const f = d.form;
  const waiting = d.status === "AWAITING_PAYMENT";
  const canEdit = waiting && ctx.permissions.has("admission.create");
  const rel = (r: string) => t(`student.rel.${r as "FATHER"}`);
  return (
    <>
      <PageHeader
        title={[f.firstName, f.middleName, f.lastName].filter(Boolean).join(" ")}
        subtitle={`${d.reference} · ${t(`apf.status.${d.status}` as "apf.status.SUBMITTED")}`}
        actions={<div className="flex flex-wrap gap-2">
          {(waiting || d.status === "SUBMITTED") && <a href={`/api/applications/${d.id}/form`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 btn-primary"><Printer className="size-4" aria-hidden />{t("adm.draft.print")}</a>}
          {canEdit && <LinkButton href={`/admissions/drafts/${d.id}/edit`} variant="secondary">{t("adm.draft.edit")}</LinkButton>}
        </div>}
      />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/drafts" />
      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          {waiting && (
            <div className="rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
              <p className="font-semibold text-warn">{t("adm.draft.banner", { amount: formatMoney(d.feeCents, d.currency), reference: d.reference })}</p>
              {d.instructions && <p className="mt-2 text-ink">{t("adm.draft.howto", { text: d.instructions })}</p>}
            </div>
          )}
          {d.status === "SUBMITTED" && d.application && (
            <p className="rounded-xl border border-ok/40 bg-ok/10 p-4 text-sm text-ok">{t("adm.draft.paid")} <Link href={`/admissions/${d.application.id}`} className="font-semibold underline">{t("adm.draft.paid.open")} ({d.application.applicationNo})</Link>{d.receiptNo ? ` · ${d.receiptNo}` : ""}</p>
          )}
          {d.status === "PAID_HOLD" && <p className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">{t("adm.draft.hold", { note: d.holdNote ?? "" })}</p>}
          {d.status === "CANCELLED" && <p className="rounded-xl border border-line bg-surface p-4 text-sm text-muted">{t("adm.draft.cancelled")}</p>}

          <Card title={t("adm.draft.details")}>
            <DefList items={[
              { label: t("adm.classApplied"), value: d.className },
              { label: t("apply.entry.title"), value: f.entryType === "TRANSFER" ? t("apply.entry.transfer") : t("apply.entry.new") },
              { label: t("student.dob"), value: displayDate(new Date(f.dateOfBirth), ctx.locale) },
              { label: t("student.gender"), value: f.gender === "MALE" ? t("student.male") : t("student.female") },
              { label: t("student.nationality"), value: f.nationality }, { label: t("student.religion"), value: f.religion }, { label: t("student.birthCert"), value: f.birthCertificateNo },
              { label: t("student.previousSchool"), value: f.previousSchool }, { label: t("apply.previousClass"), value: f.previousClass },
              { label: t("apply.transfer.admissionNo"), value: f.previousAdmissionNo }, { label: t("apply.transfer.reason"), value: f.entryType === "TRANSFER" ? f.transferReason : null },
              { label: t("common.address"), value: f.address }, { label: t("adm.health"), value: f.healthNotes },
              { label: t("adm.emergency"), value: f.ec_name ? `${f.ec_name} (${f.ec_relationship}) ${f.ec_phone}` : null },
            ]} />
          </Card>
          <Card title={t("adm.guardians")}>
            <ul className="divide-y divide-line text-sm">
              {[{ n: f.g1_fullName, r: f.g1_relationship, p: f.g1_phone, e: f.g1_email, o: f.g1_occupation }, ...(f.g2_fullName ? [{ n: f.g2_fullName, r: f.g2_relationship ?? "", p: f.g2_phone ?? "", e: f.g2_email, o: f.g2_occupation }] : [])].map((g, i) => (
                <li key={i} className="py-2"><p className="font-medium">{g.n} <span className="font-normal text-muted">· {g.r ? rel(g.r) : ""}</span></p><p className="text-muted">{g.p} {g.e ?? ""}</p>{g.o && <p className="text-muted">{g.o}</p>}</li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card title={t("adm.draft.papers")} actions={<Badge tone={TONE[d.status]}>{t(`apf.status.${d.status}` as "apf.status.SUBMITTED")}</Badge>}>
            {d.documents.length === 0 ? <p className="text-sm text-muted">{t("adm.draft.papers.none")}</p> : (
              <ul className="divide-y divide-line text-sm">{d.documents.map((x) => <li key={x.id} className="py-2"><p className="break-words font-medium">{x.fileName}</p><p className="text-muted">{t(`doc.type.${x.docType as "OTHER"}`)}</p></li>)}</ul>
            )}
            {canEdit && (
              <ActionForm action={uploadOfficeDraftDocumentAction} submitLabel={t("adm.draft.papers.add")} className="mt-4 space-y-3 border-t border-line pt-4">
                <input type="hidden" name="id" value={d.id} />
                <Field name="docType" label={t("doc.type")} type="select" required options={DOCUMENT_TYPES.map((x) => ({ value: x, label: t(`doc.type.${x}`) }))} placeholder={t("common.select")} />
                <FileInput label={t("doc.file")} hint={t("doc.file.hint", { size: Math.floor(MAX_DOCUMENT_BYTES / 1024 / 1024) })} />
              </ActionForm>
            )}
          </Card>
          <Card title={t("adm.draft.by", { name: d.createdBy ?? "—", date: displayDate(d.createdAt, ctx.locale) })}>
            {canEdit && (
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-bad">{t("adm.draft.cancel")}</summary>
                <ActionForm action={cancelOfficeDraftAction} submitLabel={t("adm.draft.cancel.go")} tone="danger" confirm={t("common.confirmAction")} className="mt-2 space-y-2">
                  <input type="hidden" name="id" value={d.id} />
                  <Field name="reason" label={t("adm.draft.cancel.reason")} required />
                </ActionForm>
              </details>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
