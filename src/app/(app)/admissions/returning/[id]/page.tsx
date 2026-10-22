import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { registrationDetail } from "@/server/annual-registration";
import { studentTimeline } from "@/server/year-readiness";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, Field } from "@/components/form";
import { ClearanceBadge, OutcomeBadge, deptLabel, stageLabel } from "@/components/lifecycle/parts";
import { Timeline } from "@/components/lifecycle/timeline";
import { Card, DefList, NoAccess, PageHeader } from "@/components/ui";
import { activateAction, cancelRegistrationAction, clearanceExceptionAction, confirmRegistrationAction, placeReturningAction, removeClearanceExceptionAction, reopenRegistrationAction } from "../actions";

export const metadata: Metadata = { title: "Returning student" };

type Detail = Awaited<ReturnType<typeof registrationDetail>>;

/** Four steps in the order they happen, each marked done or waiting; only the step that is next shows its form. */
export default async function ReturningDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("registration.read")) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Detail;
  try {
    d = await registrationDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const timeline = await studentTimeline(ctx, d.student.id);
  const r = d.reg;
  const manage = can("registration.manage");
  const st = r.status;
  const done = { decision: true, place: r.classId !== null, register: st === "REGISTERED" || st === "ACTIVE", join: st === "ACTIVE" };
  const name = [d.student.firstName, d.student.middleName, d.student.lastName].filter(Boolean).join(" ");
  const step = (ok: boolean, title: string) => <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">{ok ? <Check className="size-4 text-ok" aria-hidden /> : <Circle className="size-4 text-muted" aria-hidden />}{title}</h3>;
  const open = st !== "ACTIVE" && st !== "CANCELLED";

  return (
    <>
      <PageHeader title={name} subtitle={`${d.student.admissionNo} · ${d.year.name}`} actions={<Link href="/admissions/returning" className="text-sm font-medium text-link hover:underline">{t("lc.back")}</Link>} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/returning" />
      <p className="mb-4 text-sm"><span className={d.step.blocked ? "font-medium text-warn" : "font-medium"}>{stageLabel(t, d.step.stage)}</span>{d.step.department !== "NONE" && <span className="text-muted"> · {deptLabel(t, d.step.department)}</span>}</p>

      <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <Card>
            {step(done.decision, t("lc.step.decision"))}
            <p className="flex flex-wrap items-center gap-2 text-sm"><OutcomeBadge outcome={r.progression.outcome} t={t} />{d.decidedClass && <span>{d.fromClass} → <strong>{d.decidedClass}</strong></span>}</p>
            <p className="mt-1 text-xs text-muted">{t("lc.step.decisionHint")}</p>
            {can("progression.read") && <Link href={`/academic-office/progression/${r.studentId}?year=${r.progression.fromAcademicYearId}`} className="mt-2 inline-block text-sm font-medium text-link hover:underline">{t("lc.step.openDecision")}</Link>}
          </Card>

          <Card>
            {step(done.place, t("lc.step.place"))}
            {d.placedClass && <p className="mb-3 text-sm">{t("lc.step.placedIn")} <strong>{d.placedClass}{d.placedStream ? ` · ${d.placedStream}` : ""}</strong></p>}
            {d.places && <p className="mb-3 text-xs text-muted">{d.places.capacity ? t("lc.step.places", { name: d.places.name, taken: d.places.inClass + d.places.reserved, cap: d.places.capacity, left: d.places.left ?? 0 }) : t("lc.step.noLimit", { name: d.places.name })}</p>}
            {manage && open ? (
              <details open={!done.place}>
                {done.place && <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("lc.step.placeChange")}</summary>}
                <ActionForm action={placeReturningAction} submitLabel={done.place ? t("lc.step.placeChange") : t("lc.step.placeGo")} className="space-y-3">
                  <input type="hidden" name="id" value={r.id} />
                  <Field name="placement" type="select" label={t("lc.step.placeLabel")} hint={t("lc.step.placeHint")} defaultValue={d.preferred} placeholder={t("common.select")} required options={d.options.map((o) => ({ value: o.value, label: o.full ? `${o.label} – ${t("adm.place.full")}` : o.label }))} />
                  {(can("progression.exception") || can("class.capacity_override")) && (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">{t("lc.step.exceptions")}</summary>
                      <div className="space-y-3">
                        {can("progression.exception") && <Field name="gradeReason" label={t("lc.step.gradeReason")} optionalLabel={t("common.optional")} hint={t("lc.step.gradeReasonHint")} />}
                        {can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
                      </div>
                    </details>
                  )}
                  {r.gradeOverrideReason && <p className="text-xs text-warn">{t("lc.step.gradeNote", { reason: r.gradeOverrideReason })}</p>}
                  {r.capacityOverrideReason && <p className="text-xs text-warn">{t("lc.step.capNote", { reason: r.capacityOverrideReason })}</p>}
                </ActionForm>
              </details>
            ) : null}
          </Card>

          <Card>
            {step(done.register, t("lc.step.register"))}
            {r.registeredAt && <p className="mb-2 text-sm text-muted">{t("lc.step.registeredOn", { date: displayDate(r.registeredAt, ctx.locale) })}</p>}
            {manage && st === "PENDING" && r.classId ? (
              <ActionForm action={confirmRegistrationAction} submitLabel={t("lc.step.registerGo")} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <Field name="confirmed" type="checkbox" label={t("lc.step.confirmed")} hint={t("lc.step.confirmedHint")} />
                <Field name="note" label={t("lc.bulk.note")} optionalLabel={t("common.optional")} />
              </ActionForm>
            ) : st === "PENDING" ? <p className="text-sm text-muted">{t("lc.step.registerWait")}</p> : null}
          </Card>

          <Card>
            {step(done.join, t("lc.step.join"))}
            {st === "ACTIVE" ? <p className="text-sm text-ok">{t("lc.step.joined", { date: r.activatedAt ? displayDate(r.activatedAt, ctx.locale) : "" })}</p> : st === "REGISTERED" ? (
              manage ? (
                <ActionForm action={activateAction} submitLabel={t("lc.step.joinGo")} className="space-y-2">
                  <input type="hidden" name="ids" value={r.id} />
                  {!d.open && <p className="text-sm text-muted">{t("lc.step.yearNotOpen", { year: d.year.name, date: displayDate(d.year.startsOn, ctx.locale) })}</p>}
                  {d.step.stage === "NEEDS_FEE" && <p className="text-sm text-warn">{t("lc.step.feeHolds")}</p>}
                </ActionForm>
              ) : null
            ) : <p className="text-sm text-muted">{t("lc.step.joinWait")}</p>}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title={t("lc.col.fees")} actions={<ClearanceBadge state={d.clearance} t={t} />}>
            <p className="text-sm text-muted">{t(`lc.ret.policy.${d.settings.feePolicy}` as "lc.ret.policy.INFORM_ONLY")}</p>
            {d.money ? (
              <DefList items={[
                { label: t("lc.fee.firstTerm"), value: d.money.firstTerm.billed ? `${formatMoney(d.money.firstTerm.paid)} / ${formatMoney(d.money.firstTerm.charged)}` : t("lc.clear.NOT_BILLED") },
                { label: t("lc.fee.owed"), value: formatMoney(d.money.firstTerm.outstanding) },
                { label: t("lc.fee.older"), value: d.money.previousOutstanding > 0 ? `${formatMoney(d.money.previousOutstanding)} (${d.money.previous.map((p) => p.yearName).join(", ")})` : "—" },
              ]} />
            ) : d.hasPreviousDebt ? <p className="mt-3 text-sm text-warn">{t("lc.ret.olderDebt")}</p> : null}
            {r.clearanceExceptionReason && <p className="mt-3 rounded-lg bg-tint px-3 py-2 text-sm">{t("lc.fee.arrangement", { reason: r.clearanceExceptionReason })}</p>}
            {can("fees.clearance.exception") && open && (r.clearanceExceptionReason ? (
              <ActionForm action={removeClearanceExceptionAction} submitLabel={t("lc.fee.withdraw")} inline className="mt-3"><input type="hidden" name="id" value={r.id} /></ActionForm>
            ) : (
              <details className="mt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-link">{t("lc.fee.arrange")}</summary>
                <ActionForm action={clearanceExceptionAction} submitLabel={t("lc.fee.arrangeGo")} className="mt-2 space-y-2"><input type="hidden" name="id" value={r.id} /><Field name="reason" label={t("lc.fee.arrangeReason")} hint={t("lc.fee.arrangeHint")} required /></ActionForm>
              </details>
            ))}
            {!can("fees.read") && <p className="mt-3 text-xs text-muted">{t("lc.fee.financeOwns")}</p>}
          </Card>

          {manage && st === "CANCELLED" && (
            <Card title={t("lc.step.cancelledTitle")}>
              <p className="text-sm text-muted">{r.cancelReason}</p>
              <ActionForm action={reopenRegistrationAction} submitLabel={t("lc.step.reopen")} inline className="mt-3"><input type="hidden" name="id" value={r.id} /></ActionForm>
            </Card>
          )}
          {manage && open && (
            <Card>
              <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-bad">{t("lc.step.cancel")}</summary>
                <ActionForm action={cancelRegistrationAction} submitLabel={t("lc.step.cancelGo")} tone="danger" className="mt-2 space-y-2"><input type="hidden" name="id" value={r.id} /><Field name="reason" label={t("lc.step.cancelReason")} required /></ActionForm>
              </details>
            </Card>
          )}

          <Card title={t("lc.timeline")}>
            <Timeline entries={timeline} t={t} locale={ctx.locale} limit={14} />
          </Card>
        </div>
      </div>
    </>
  );
}
