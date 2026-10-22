import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireContext, getT, getLocale } from "@/lib/auth/next";
import { getStudentProfile } from "@/server/students";
import { listClasses } from "@/server/academics";
import { AppError } from "@/lib/errors";
import { ageOn, displayDate, formatDateOnly, todayInTimezone } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { GuardianFields } from "@/components/guardian-fields";
import { guardianLabels } from "@/components/guardian-labels";
import { Badge, Card, DefList, LinkButton, PageHeader } from "@/components/ui";
import { studentAccountState } from "@/server/portal";
import { createStudentAccountAction, resetPortalPasswordAction, setPortalActiveAction } from "@/app/(app)/guardians/actions";
import { RELATIONSHIPS } from "@/server/guardians";
import { listDocuments } from "@/server/documents";
import { db } from "@/lib/db";
import { centsOf, formatMoney } from "@/lib/finance/money";
import { loadAdmissionAccount } from "@/server/admission-offers";
import { feeReviewFlag } from "@/server/fees";
import { listConcerns } from "@/server/concerns";
import { flagConcernAction } from "@/app/(app)/academic-office/actions";
import { classOccupancy } from "@/server/admission-queues";
import * as A from "../actions";
import { studentTimeline } from "@/server/year-readiness";
import { Timeline } from "@/components/lifecycle/timeline";

export const metadata: Metadata = { title: "Student" };
const STATUS_TONE = { ENROLLED: "ok", TRANSFERRED: "warn", WITHDRAWN: "bad", GRADUATED: "brand" } as const;

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getT();
  const locale = await getLocale();
  const s = await getStudentProfile(ctx, id).catch((e) => (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN") ? null : Promise.reject(e)));
  if (!s) notFound();

  const school = await getSchoolBasics(ctx.schoolId);
  const today = todayInTimezone(school.timezone);
  const canEnroll = ctx.permissions.has("student.enroll") && s.status === "ENROLLED";
  const classes = canEnroll ? await listClasses(ctx).catch(() => []) : [];
  const occupancy = canEnroll ? await classOccupancy(ctx.schoolId) : new Map();
  const placementOptions = classes.filter((c) => c.isActive).flatMap((c) => {
    const o = occupancy.get(c.id);
    const note = o?.capacity ? ` (${o.count}/${o.capacity}${o.count >= o.capacity ? ` ${t("adm.place.full")}` : ""})` : "";
    return c.streams.length ? c.streams.map((st) => ({ value: `${c.id}|${st.id}`, label: `${c.name} – ${st.name}${note}` })) : [{ value: c.id, label: `${c.name}${note}` }];
  });
  // How the student came in: the application (with its offer and the admission fee), or a direct registration.
  const application = ctx.permissions.has("admission.read") ? await db.application.findFirst({ where: { schoolId: ctx.schoolId, studentId: id }, select: { id: true, applicationNo: true, classAppliedId: true } }) : null;
  const admission = application ? await loadAdmissionAccount(db, ctx.schoolId, application.id) : null;
  const canFlag = ctx.permissions.has("concern.flag") || ctx.permissions.has("concern.manage");
  const concernRows = canFlag ? await listConcerns(ctx, { status: "open", studentId: id }).catch(() => []) : [];
  const feeFlag = ctx.permissions.has("fees.status.read") || ctx.permissions.has("fees.read") ? await feeReviewFlag(ctx, id).catch(() => null) : null;
  const current = s.enrollments.find((e) => e.status === "ACTIVE");
  // End-of-year decisions and yearly registrations (enrolments and status changes already have their own cards below).
  const yearHistory = ctx.permissions.has("progression.read") || ctx.permissions.has("registration.read") ? (await studentTimeline(ctx, s.id)).filter((e) => e.kind === "DECISION" || e.kind === "REGISTRATION") : [];
  const canManageGuardians = ctx.permissions.has("guardian.manage");
  const labels = await guardianLabels(ctx.permissions.has("guardian.read") || canManageGuardians);
  const fullName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
  const statusTargets = s.status === "ENROLLED" ? (["TRANSFERRED", "WITHDRAWN", "GRADUATED"] as const) : (["ENROLLED"] as const);
  const docs = ctx.permissions.has("document.read") ? await listDocuments(ctx, { studentId: id }).catch(() => []) : [];
  const portalAccount = ctx.permissions.has("portal.manage") ? await studentAccountState(ctx, id) : undefined;
  const canSeeAttendance = ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"].some((p) => ctx.permissions.has(p as "attendance.read"));
  const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: t(`student.rel.${r}` as "student.rel.FATHER") }));

  return (
    <>
      <PageHeader
        title={fullName}
        subtitle={`${s.admissionNo} · ${current ? `${current.class.name}${current.stream ? ` – ${current.stream.name}` : ""}` : t("student.notPlaced")}`}
        actions={<>
          {feeFlag?.status === "REVIEW" && <Badge tone="warn">{t("fin.fees.reviewBadge")}</Badge>}
          <Badge tone={STATUS_TONE[s.status]}>{t(`student.status.${s.status}`)}</Badge>
          {ctx.permissions.has("student.update") && <LinkButton href={`/students/${s.id}/edit`} variant="secondary"><Pencil className="size-4" aria-hidden /> {t("student.profile.edit")}</LinkButton>}
        </>}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={t("student.profile.details")}>
            <DefList items={[
              { label: t("student.dob"), value: `${displayDate(s.dateOfBirth, locale)} (${ageOn(s.dateOfBirth)})` },
              { label: t("student.gender"), value: s.gender === "MALE" ? t("student.male") : t("student.female") },
              { label: t("student.admissionDate"), value: displayDate(s.admissionDate, locale) },
              { label: t("student.nationality"), value: s.nationality },
              { label: t("student.religion"), value: s.religion },
              { label: t("student.birthCert"), value: s.birthCertificateNo },
              { label: t("student.previousSchool"), value: s.previousSchool },
              { label: t("common.address"), value: s.address },
              ...(s.exitedOn ? [{ label: t("common.status"), value: `${t(`student.status.${s.status}`)} — ${t("student.exited", { date: displayDate(s.exitedOn, locale) })}${s.exitReason ? `: ${s.exitReason}` : ""}` }] : []),
            ]} />
          </Card>

          <Card title={t("student.guardians")}>
            {!s.canSeeGuardians ? (
              <p className="text-sm text-muted">{t("student.noGuardianAccess")}</p>
            ) : (
              <div className="space-y-4">
                {s.guardians.map((g) => (
                  <div key={g.guardianId} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{g.guardian.fullName} <span className="font-normal text-muted">· {t(`student.rel.${g.relationship}` as "student.rel.FATHER")}</span></p>
                        <p className="text-sm text-muted">{g.guardian.phone}{g.guardian.altPhone ? ` · ${g.guardian.altPhone}` : ""}{g.guardian.email ? ` · ${g.guardian.email}` : ""}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {g.isPrimary && <Badge tone="brand">{t("student.primary")}</Badge>}
                        {g.isFinanciallyResponsible && <Badge>{t("student.financial")}</Badge>}
                        <Badge tone={g.verifiedAt ? "ok" : "warn"}>{g.verifiedAt ? t("student.verified") : t("student.unverified")}</Badge>
                      </div>
                    </div>
                    {(canManageGuardians || ctx.permissions.has("guardian.verify")) && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {ctx.permissions.has("guardian.verify") && (
                          <ActionForm action={A.verifyGuardianAction} submitLabel={g.verifiedAt ? t("student.unverify") : t("student.verify")} inline className="inline">
                            <input type="hidden" name="studentId" value={s.id} /><input type="hidden" name="guardianId" value={g.guardianId} /><input type="hidden" name="verified" value={g.verifiedAt ? "false" : "true"} />
                          </ActionForm>
                        )}
                        {canManageGuardians && (
                          <>
                            <details className="w-full">
                              <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium text-link">{t("common.edit")}</summary>
                              <div className="mt-2 grid gap-4 md:grid-cols-2">
                                <ActionForm action={A.updateRelationshipAction} submitLabel={t("common.save")} className="space-y-3">
                                  <input type="hidden" name="studentId" value={s.id} /><input type="hidden" name="guardianId" value={g.guardianId} />
                                  <Field name="relationship" label={t("student.relationship")} type="select" options={relOptions} defaultValue={g.relationship} required />
                                  <Field name="isPrimary" type="checkbox" label={t("student.primary")} defaultValue={g.isPrimary} />
                                  <Field name="isFinanciallyResponsible" type="checkbox" label={t("student.financial")} defaultValue={g.isFinanciallyResponsible} />
                                  <Field name="receivesNotifications" type="checkbox" label={t("student.notify")} defaultValue={g.receivesNotifications} />
                                </ActionForm>
                                <ActionForm action={A.updateGuardianAction} submitLabel={t("guardian.edit")} className="space-y-3">
                                  <input type="hidden" name="guardianId" value={g.guardianId} />
                                  <Field name="fullName" label={t("users.fullName")} defaultValue={g.guardian.fullName} required />
                                  <Field name="phone" label={t("common.phone")} type="tel" defaultValue={g.guardian.phone} required />
                                  <Field name="altPhone" label={t("guardian.altPhone")} type="tel" defaultValue={g.guardian.altPhone} optionalLabel={t("common.optional")} />
                                  <Field name="email" label={t("common.email")} type="email" defaultValue={g.guardian.email} optionalLabel={t("common.optional")} />
                                  <Field name="occupation" label={t("guardian.occupation")} defaultValue={g.guardian.occupation} optionalLabel={t("common.optional")} />
                                </ActionForm>
                              </div>
                            </details>
                            {!g.isPrimary && s.guardians.length > 1 && (
                              <details className="w-full">
                                <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium text-bad">{t("student.unlink")}</summary>
                                <ActionForm action={A.unlinkGuardianAction} submitLabel={t("student.unlink")} tone="danger" className="mt-2 space-y-3" confirm={t("common.confirmAction")}>
                                  <input type="hidden" name="studentId" value={s.id} /><input type="hidden" name="guardianId" value={g.guardianId} />
                                  <Field name="reason" label={t("common.reason")} required />
                                </ActionForm>
                              </details>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {canManageGuardians && (
                  <details>
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("student.link")}</summary>
                    <ActionForm action={A.linkGuardianAction} submitLabel={t("student.link")} className="mt-2 space-y-3">
                      <input type="hidden" name="studentId" value={s.id} />
                      <GuardianFields prefix="" labels={labels} canSearch={labels.canSearch} />
                    </ActionForm>
                  </details>
                )}
              </div>
            )}
          </Card>

          {s.canSeeGuardians && s.emergencyContacts.length > 0 && (
            <Card title={t("student.emergency")}>
              <ul className="divide-y divide-line text-sm">
                {s.emergencyContacts.map((c) => <li key={c.id} className="py-2"><strong>{c.name}</strong> · {c.relationship} · {c.phone}</li>)}
              </ul>
            </Card>
          )}
          {s.canSeeMedical && (
            <Card title={t("student.medical")}>
              <p className="whitespace-pre-wrap text-sm">{s.medicalNotes || "—"}</p>
            </Card>
          )}
          {docs.length > 0 && (
            <Card title={t("doc.title")}>
              <p className="mb-2 text-sm text-muted">{t("doc.access")}</p>
              <ul className="divide-y divide-line text-sm">
                {docs.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 break-words"><strong>{d.fileName}</strong> <span className="text-muted">· {t(`doc.type.${d.docType as "OTHER"}`)}</span></span>
                    <a href={`/api/documents/${d.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 font-medium text-link hover:bg-canvas">{t("doc.download")}</a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {canSeeAttendance && (
            <Card title={t("att.title")}>
              <Link href={`/attendance/reports?view=student&studentId=${id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:underline">{t("att.reports")}</Link>
            </Card>
          )}
          {canFlag && s.status === "ENROLLED" && (
            <Card title={t("concern.flag")}>
              {concernRows.length > 0 && (
                <ul className="mb-3 divide-y divide-line text-sm">{concernRows.map((c) => <li key={c.id} className="py-2"><Link href={`/academic-office/concerns/${c.id}`} className="font-medium text-link hover:underline">{t(`concern.cat.${c.category}` as "concern.cat.OTHER")}</Link> <span className="text-muted">· {c.summary}</span></li>)}</ul>
              )}
              <p className="mb-3 text-sm text-muted">{t("concern.flag.hint")}</p>
              <ActionForm action={flagConcernAction} submitLabel={t("concern.flag")} className="space-y-3">
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="category" type="select" label={t("concern.category")} required options={(["ABSENCE", "LOW_MARKS", "MISSING_WORK", "DECLINE", "BEHAVIOUR", "OTHER"] as const).map((k) => ({ value: k, label: t(`concern.cat.${k}` as "concern.cat.OTHER") }))} placeholder={t("common.select")} />
                <Field name="summary" label={t("concern.flag.summary")} required />
                <Field name="notes" type="textarea" rows={2} label={t("concern.flag.notes")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
          {ctx.permissions.has("fees.read") && (
            <Card title={t("fin.title")}>
              <Link href={`/finance/students/${id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:underline">{t("fin.student.statement")}</Link>
            </Card>
          )}
          {application && (
            <Card title={t("stu.admission.title")}>
              <ul className="space-y-1 text-sm">
                <li><span className="text-muted">{t("stu.admission.application")}:</span> <Link href={`/admissions/${application.id}`} className="font-medium text-link hover:underline">{application.applicationNo}</Link></li>
                {admission?.offer && <li><span className="text-muted">{t("stu.admission.offer")}:</span> {admission.offer.letterNo}</li>}
                {admission?.account && <li><span className="text-muted">{t("stu.admission.fee")}:</span> {formatMoney(admission.account.verifiedCents, school.currency)} / {formatMoney(admission.account.requiredCents, school.currency)} · {t(`adm.pay.status.${admission.account.status}` as "adm.pay.status.PAID")}</li>}
                {admission?.payments.filter((p) => p.receiptNo).map((p) => <li key={p.id}><a href={`/api/admission-receipts/${p.id}?lang=${locale}`} target="_blank" rel="noopener" className="font-medium text-link hover:underline">{t("adm.pay.receipt")} {p.receiptNo}</a> <span className="text-muted">({formatMoney(centsOf(p.amount), school.currency)})</span></li>)}
              </ul>
            </Card>
          )}
          {canEnroll && !current && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">{t("stu.awaitingClass")}</p>}
          {canEnroll && placementOptions.length > 0 && (
            <Card title={current ? t("student.enrol.move") : t("student.enrol.title")}>
              <ActionForm action={A.enrollStudentAction} submitLabel={t("student.enrol.button")} className="space-y-3">
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="placement" label={`${t("student.class")} / ${t("student.stream")}`} type="select" options={placementOptions} placeholder={t("common.select")} required />
                {ctx.permissions.has("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
              </ActionForm>
            </Card>
          )}
          {ctx.permissions.has("portal.manage") && s.status === "ENROLLED" && (
            <Card title={t("portal.admin.studentAccount")}>
              {portalAccount ? (
                <div className="space-y-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><Badge tone={portalAccount.status === "ACTIVE" ? "ok" : "bad"}>{portalAccount.status === "ACTIVE" ? t("common.active") : t("portal.admin.suspended")}</Badge>{portalAccount.mustChangePassword && <span className="text-muted">{t("portal.admin.notYetChanged")}</span>}</p>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={resetPortalPasswordAction} submitLabel={t("portal.admin.resetPassword")} inline confirm={t("portal.admin.resetConfirm")} className="space-y-1"><input type="hidden" name="userId" value={portalAccount.id} /></ActionForm>
                    <ActionForm action={setPortalActiveAction} submitLabel={portalAccount.status === "ACTIVE" ? t("portal.admin.suspend") : t("portal.admin.reactivate")} inline tone={portalAccount.status === "ACTIVE" ? "danger" : "neutral"} className="space-y-1"><input type="hidden" name="userId" value={portalAccount.id} /><input type="hidden" name="active" value={portalAccount.status === "ACTIVE" ? "false" : "true"} /></ActionForm>
                  </div>
                </div>
              ) : (
                <ActionForm action={createStudentAccountAction} submitLabel={t("portal.admin.create")} className="space-y-3">
                  <input type="hidden" name="studentId" value={s.id} />
                  <p className="text-sm text-muted">{t("portal.admin.studentHint")}</p>
                  <Field name="email" type="email" label={t("common.email")} optionalLabel={t("common.optional")} />
                  <Field name="phone" type="tel" label={t("common.phone")} optionalLabel={t("common.optional")} />
                </ActionForm>
              )}
            </Card>
          )}
          {ctx.permissions.has("student.status_change") && (
            <Card title={t("student.status.title")}>
              <ActionForm action={A.changeStatusAction} submitLabel={t("common.confirm")} tone="danger" className="space-y-3" confirm={t("common.confirmAction")}>
                <input type="hidden" name="studentId" value={s.id} />
                <Field name="status" label={t("student.status.new")} type="select" placeholder={t("common.select")} options={statusTargets.map((v) => ({ value: v, label: v === "ENROLLED" ? t("student.status.reinstate") : t(`student.status.${v}`) }))} required />
                <Field name="effectiveOn" label={t("student.status.effective")} type="date" defaultValue={today} required />
                <Field name="reason" label={t("common.reason")} type="textarea" rows={2} required />
              </ActionForm>
            </Card>
          )}
          <Card title={t("student.profile.enrollments")}>
            {s.enrollments.length === 0 ? <p className="text-sm text-muted">{t("student.notPlaced")}</p> : (
              <ul className="space-y-3 text-sm">
                {s.enrollments.map((e) => (
                  <li key={e.id}>
                    <p className="font-medium">{e.class.name}{e.stream ? ` – ${e.stream.name}` : ""} <span className="font-normal text-muted">· {e.academicYear.name}</span></p>
                    <p className="text-muted">{displayDate(e.startedOn, locale)} → {e.endedOn ? displayDate(e.endedOn, locale) : "…"} · <Badge tone={e.status === "ACTIVE" ? "ok" : "neutral"}>{t(`student.enrollment.${e.status}`)}</Badge></p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {yearHistory.length > 0 && (
            <Card title={t("lc.student.years")}>
              <Timeline entries={yearHistory} t={t} locale={ctx.locale} limit={12} />
            </Card>
          )}
          {s.statusHistory.length > 0 && (
            <Card title={t("student.profile.statusHistory")}>
              <ul className="space-y-3 text-sm">
                {s.statusHistory.map((h) => (
                  <li key={h.id}>
                    <p className="font-medium">{t(`student.status.${h.fromStatus}`)} → {t(`student.status.${h.toStatus}`)} <span className="font-normal text-muted">· {formatDateOnly(h.effectiveOn)}</span></p>
                    <p className="text-muted">{h.reason}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {s.siblings.length > 0 && (
            <Card title={t("student.profile.siblings")}>
              <ul className="space-y-1 text-sm">
                {s.siblings.map((x) => <li key={x.id}><Link href={`/students/${x.id}`} className="text-link hover:underline">{x.firstName} {x.lastName}</Link> <span className="text-muted">· {x.admissionNo}</span></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
