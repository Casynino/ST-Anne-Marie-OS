import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { getApplication, OPEN_STATUSES } from "@/server/admissions";
import { listClasses } from "@/server/academics";
import { listDocuments, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@/server/documents";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DefList, EmptyState, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { ConfirmBoxes, FileInput } from "./parts";
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
  const docs = can("document.read") ? await listDocuments(ctx, { applicationId: id }) : [];
  const classes = app.status === "ACCEPTED" && can("admission.enrol") && can("student.enroll") ? (await listClasses(ctx)).filter((c) => c.isActive) : [];
  const placementOptions = classes.flatMap((c) => (c.streams.length ? c.streams.map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} – ${s.name}` })) : [{ value: c.id, label: c.name }]));
  const preselected = app.classAppliedId && !classes.find((c) => c.id === app.classAppliedId)?.streams.length ? app.classAppliedId : undefined;

  return (
    <>
      <PageHeader
        title={`${app.firstName} ${app.middleName ?? ""} ${app.lastName}`}
        subtitle={`${app.applicationNo} · ${t(`adm.status.${app.status}`)}`}
        actions={open && can("admission.create") ? <LinkButton href={`/admissions/${id}/edit`} variant="secondary">{t("adm.edit")}</LinkButton> : undefined}
      />
      <div className="space-y-5">
        {app.status === "ACCEPTED" && <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{t("adm.acceptedNote")}</p>}
        {app.student && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-ok">
            {t("adm.studentRecord")}: <Link className="font-semibold underline" href={`/students/${app.student.id}`}>{app.student.admissionNo}</Link>
          </p>
        )}

        <Card title={t("adm.details")}>
          <DefList
            items={[
              { label: t("student.dob"), value: displayDate(app.dateOfBirth, ctx.locale) },
              { label: t("student.gender"), value: app.gender === "MALE" ? t("student.male") : t("student.female") },
              { label: t("adm.classApplied"), value: app.className ?? t("adm.noClass") },
              { label: t("student.nationality"), value: app.nationality },
              { label: t("student.religion"), value: app.religion },
              { label: t("student.birthCert"), value: app.birthCertificateNo },
              { label: t("student.previousSchool"), value: app.previousSchool },
              { label: t("common.address"), value: app.address },
              { label: t("adm.interviewOn"), value: app.interviewOn ? displayDate(app.interviewOn, ctx.locale) : null },
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
              </li>
            ))}
          </ul>
        </Card>

        {open && (can("admission.review") || can("admission.create")) && (
          <Card title={t("common.actions")}>
            <div className="grid gap-4 lg:grid-cols-2">
              {app.status === "APPLIED" && can("admission.review") && (
                <ActionForm action={transitionApplicationAction} submitLabel={t("adm.action.interview")} className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="to" value="INTERVIEW" />
                  <Field name="interviewOn" type="date" label={t("adm.interviewOn")} optionalLabel={t("common.optional")} />
                </ActionForm>
              )}
              {can("admission.review") && app.status !== "ACCEPTED" && (
                <ActionForm action={transitionApplicationAction} submitLabel={t("adm.action.accept")} className="space-y-3">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="to" value="ACCEPTED" />
                  <Field name="assessmentNotes" label={t("adm.assessmentNotes")} type="textarea" rows={2} optionalLabel={t("common.optional")} />
                </ActionForm>
              )}
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

        {app.status === "ACCEPTED" && can("admission.enrol") && (
          <Card title={t("adm.enrol.title")}>
            <p className="mb-3 text-sm text-muted">{t("adm.enrol.hint")}</p>
            <ActionForm action={enrolApplicationAction} submitLabel={t("adm.action.enrol")} className="space-y-3">
              <input type="hidden" name="id" value={id} />
              {placementOptions.length > 0 && <Field name="placement" label={t("adm.enrol.class")} type="select" options={placementOptions} defaultValue={preselected} placeholder={t("common.select")} />}
              <Field name="admissionDate" label={t("student.admissionDate")} type="date" optionalLabel={t("common.optional")} />
              <ConfirmBoxes duplicate={t("student.confirmDuplicate")} sharedPhone={t("adm.confirmSharedPhone")} />
            </ActionForm>
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
                    <a href={`/api/documents/${d.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 font-medium text-brand-700 hover:bg-canvas">{t("doc.download")}</a>
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

        <Card title={t("adm.history")}>
          <ol className="space-y-2 text-sm">
            {app.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2">
                <Badge tone={TONE[e.toStatus]}>{t(`adm.status.${e.toStatus}`)}</Badge>
                <span className="text-muted">{displayDateTime(e.createdAt, school.timezone, ctx.locale)} · {e.byApplicant ? t("adm.byApplicant") : e.by}</span>
                {e.reason && <span className="basis-full">{e.reason}</span>}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

