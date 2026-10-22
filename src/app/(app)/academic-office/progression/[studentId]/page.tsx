import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { progressionDetail, progressionYear, type ProgressionDetail } from "@/server/progression";
import { ActionForm, Field } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { DecisionStatus, OutcomeBadge, ResultsCell } from "@/components/lifecycle/parts";
import { Card, DefList, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { progressionAction, reviseAction, sendBackAction } from "../actions";

export const metadata: Metadata = { title: "Student: end of year" };
const OUTCOMES = ["PROMOTED", "REPEAT", "PENDING_REVIEW", "COMPLETED", "WITHDRAWN", "TRANSFERRED"] as const;

export default async function StudentProgressionPage({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("progression.read")) return <NoAccess t={t} />;
  const { studentId } = await params;
  const { year: yearParam } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  const { year } = await progressionYear(ctx, yearParam);
  if (!year) return <EmptyState>{t("lc.noYear")}</EmptyState>;
  let d: ProgressionDetail;
  try {
    d = await progressionDetail(ctx, year.id, studentId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const live = d.live;
  const canDecide = can("progression.prepare") && live?.status !== "APPROVED";
  const waitingHead = live?.status === "AWAITING_HEAD";
  const canApprove = live && live.status === "DRAFT" && live.outcome !== "PENDING_REVIEW" && can("progression.approve");
  const canHead = waitingHead && can("progression.head_approve");
  const signalText = t(`lc.signal.${d.signal}` as "lc.signal.READY", { avg: d.settings.promotionMinAverage ?? 0 });

  return (
    <>
      <PageHeader
        title={d.student.name}
        subtitle={`${d.student.admissionNo} · ${d.className}${d.streamName ? ` · ${d.streamName}` : ""} · ${d.year.name}`}
        actions={<Link href={`/academic-office/progression?year=${d.year.id}`} className="text-sm font-medium text-link hover:underline">{t("lc.back")}</Link>}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <Card title={t("lc.detail.results")}>
            <p className="text-sm"><ResultsCell c={d.completion} t={t} /></p>
            {d.completion.missing.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{d.completion.missing.map((m) => <li key={m}>{m}</li>)}</ul>}
            <p className="mt-3 text-sm text-muted">{signalText}</p>
            <p className="mt-1 text-xs text-muted">{d.suggested ? t("lc.detail.next", { to: d.suggested.className }) : t("lc.detail.final")}</p>
          </Card>

          <Card title={t("lc.detail.decision")} actions={live ? <DecisionStatus status={live.status} t={t} /> : undefined}>
            {live ? (
              <DefList items={[
                { label: t("lc.detail.outcome"), value: <OutcomeBadge outcome={live.outcome} t={t} /> },
                { label: t("lc.detail.toGrade"), value: live.toClassName },
                { label: t("lc.detail.note"), value: live.note },
                { label: t("lc.detail.exception"), value: live.exceptionReason },
              ]} />
            ) : <p className="text-sm text-muted">{t("lc.detail.noDecision")}</p>}

            {canDecide && (
              <ActionForm action={progressionAction} submitLabel={t("lc.detail.save")} className="mt-5 space-y-3 border-t border-line pt-4">
                <input type="hidden" name="yearId" value={d.year.id} />
                <input type="hidden" name="studentIds" value={d.student.id} />
                <input type="hidden" name="intent" value="decide" />
                <Field name="outcome" type="select" label={t("lc.detail.outcome")} defaultValue={live?.outcome ?? (d.signal === "ELIGIBLE" ? "PROMOTED" : "")} placeholder={t("common.select")} required options={OUTCOMES.map((o) => ({ value: o, label: t(`lc.outcome.${o}` as "lc.outcome.PROMOTED") }))} />
                {can("progression.exception") && <Field name="toClassId" type="select" label={t("lc.detail.otherGrade")} defaultValue="" placeholder={t("lc.detail.sameOrder")} optionalLabel={t("common.optional")} hint={t("lc.detail.otherGradeHint")} options={d.grades.filter((g) => g.id !== d.classId).map((g) => ({ value: g.id, label: g.name }))} />}
                <Field name="note" type="textarea" rows={2} label={t("lc.detail.note")} optionalLabel={t("common.optional")} hint={t("lc.detail.noteHint")} defaultValue={live?.note ?? ""} />
                {can("progression.exception") && <Field name="exceptionReason" label={t("lc.bulk.exception")} optionalLabel={t("common.optional")} hint={t("lc.detail.exceptionHint")} />}
              </ActionForm>
            )}

            {(canApprove || canHead) && live && (
              <ActionForm action={progressionAction} hideSubmit className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <input type="hidden" name="yearId" value={d.year.id} />
                <input type="hidden" name="studentIds" value={d.student.id} />
                <SubmitButton intent="approve">{canHead ? t("lc.detail.headApprove") : d.settings.requireHeadApproval && !can("progression.head_approve") ? t("lc.detail.sendHead") : t("lc.detail.approve")}</SubmitButton>
                <span className="text-xs text-muted">{t("lc.detail.approveHint")}</span>
              </ActionForm>
            )}
            {waitingHead && (can("progression.head_approve") || can("progression.approve")) && live && (
              <ActionForm action={sendBackAction} submitLabel={t("lc.detail.sendBack")} inline className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={live.id} />
                <Field name="reason" label={t("lc.detail.sendBackReason")} required className="w-72" />
              </ActionForm>
            )}
            {waitingHead && !can("progression.head_approve") && <p className="mt-4 text-sm text-warn">{t("lc.detail.waitingHead")}</p>}

            {live?.status === "APPROVED" && (live.outcome === "PROMOTED" || live.outcome === "REPEAT") && can("progression.exception") && (
              <details className="mt-5 border-t border-line pt-3">
                <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("lc.detail.revise")}</summary>
                <ActionForm action={reviseAction} submitLabel={t("lc.detail.reviseGo")} className="mt-2 space-y-3">
                  <input type="hidden" name="id" value={live.id} />
                  <Field name="outcome" type="select" label={t("lc.detail.outcome")} defaultValue={live.outcome} options={[{ value: "PROMOTED", label: t("lc.outcome.PROMOTED") }, { value: "REPEAT", label: t("lc.outcome.REPEAT") }]} />
                  <Field name="toClassId" type="select" label={t("lc.detail.otherGrade")} defaultValue="" placeholder={t("lc.detail.sameOrder")} optionalLabel={t("common.optional")} options={d.grades.filter((g) => g.id !== d.classId).map((g) => ({ value: g.id, label: g.name }))} />
                  <Field name="exceptionReason" label={t("lc.detail.reviseReason")} required />
                  <p className="text-xs text-muted">{t("lc.detail.reviseHint")}</p>
                </ActionForm>
              </details>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {d.registration && (
            <Card title={t("lc.detail.registration")}>
              <p className="text-sm">{t(`lc.reg.${d.registration.status}` as "lc.reg.PENDING")}</p>
              {can("registration.read") && <Link href={`/admissions/returning/${d.registration.id}`} className="mt-2 inline-block text-sm font-medium text-link hover:underline">{t("lc.detail.openReg")}</Link>}
            </Card>
          )}
          <Card title={t("lc.detail.history")}>
            {d.history.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ol className="space-y-3 text-sm">
                {d.history.map((h) => (
                  <li key={h.id} className={h.status === "SUPERSEDED" ? "text-muted" : ""}>
                    <p className="flex flex-wrap items-center gap-2"><OutcomeBadge outcome={h.outcome} t={t} />{h.toClassName && <span>→ {h.toClassName}</span>}{h.status === "SUPERSEDED" && <span className="text-xs">({t("lc.detail.replaced")})</span>}</p>
                    <p className="mt-1 text-xs text-muted">{t("lc.detail.preparedBy", { name: h.preparedBy, date: displayDate(h.preparedAt, ctx.locale) })}</p>
                    {h.approvedAt && <p className="text-xs text-muted">{t("lc.detail.approvedBy", { name: h.approvedBy ?? "", date: displayDate(h.approvedAt, ctx.locale) })}</p>}
                    {h.headApprovedAt && <p className="text-xs text-muted">{t("lc.detail.headApprovedBy", { name: h.headApprovedBy ?? "", date: displayDate(h.headApprovedAt, ctx.locale) })}</p>}
                    {h.exceptionReason && <p className="text-xs text-warn">{t("lc.detail.exception")}: {h.exceptionReason}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
