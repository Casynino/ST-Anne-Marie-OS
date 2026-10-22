import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Check, CircleDot, Lock } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { ageOn, displayDate } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { registrationDetail, registrationFamily } from "@/server/annual-registration";
import { studentInsights } from "@/server/student-profile";
import { registrationFollowUps } from "@/server/registration-followups";
import { studentTimeline } from "@/server/year-readiness";
import { ActionForm, Field } from "@/components/form";
import { ClearanceBadge, FollowUpForm, OutcomeBadge, deptLabel, stageLabel } from "@/components/lifecycle/parts";
import { Timeline } from "@/components/lifecycle/timeline";
import { DefList, NoAccess } from "@/components/ui";
import { Avatar, Panel } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";
import { activateAction, cancelRegistrationAction, clearanceExceptionAction, confirmRegistrationAction, followUpAction, placeReturningAction, removeClearanceExceptionAction, reopenRegistrationAction } from "../actions";

export const metadata: Metadata = { title: "Returning student" };

type Detail = Awaited<ReturnType<typeof registrationDetail>>;

/**
 * One registered returning student: who they are and where they are going, the four steps as a row (done, now, waiting), the step that is
 * next with its form right here, and beside it the fees, the places in the grade, the history and, last, the way to say they are not returning.
 */
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
  const [timeline, followUps, family, insights] = await Promise.all([
    studentTimeline(ctx, d.student.id), registrationFollowUps(ctx, d.reg.id), registrationFamily(ctx, d.student.id),
    can("student.read") ? studentInsights(ctx, d.student.id).catch(() => null) : Promise.resolve(null),
  ]);
  const latest = insights?.performance?.terms.at(-1) ?? null;
  const att = insights?.attendance ?? null;
  const r = d.reg;
  const manage = can("registration.manage");
  const st = r.status;
  const open = st !== "ACTIVE" && st !== "CANCELLED";
  const placed = r.classId !== null;
  const done = { decision: true, place: placed, register: st === "REGISTERED" || st === "ACTIVE", join: st === "ACTIVE" };
  // The step that is next: the first one not done (nothing is next once the student is in the class or the registration was cancelled).
  const now: "place" | "register" | "join" | null = !open ? null : !placed ? "place" : st === "PENDING" ? "register" : "join";
  const name = [d.student.firstName, d.student.middleName, d.student.lastName].filter(Boolean).join(" ");
  const classLabel = d.placedClass ? `${d.placedClass}${d.placedStream ? ` · ${d.placedStream}` : ""}` : null;
  const steps = [
    { key: "decision" as const, title: t("lc.step.decision"), text: <span className="flex flex-wrap items-center gap-1.5"><OutcomeBadge outcome={r.progression.outcome} t={t} />{d.decidedClass && <span className="text-ink">→ {d.decidedClass}</span>}</span> },
    { key: "place" as const, title: t("lc.step.place"), text: classLabel ?? <span className="text-muted">{t("lc.stage.NEEDS_PLACEMENT")}</span> },
    { key: "register" as const, title: t("lc.step.register"), text: r.registeredAt ? displayDate(r.registeredAt, ctx.locale) : <span className="text-muted">{t("lc.d.waiting")}</span> },
    { key: "join" as const, title: t("lc.step.join"), text: r.activatedAt ? displayDate(r.activatedAt, ctx.locale) : <span className="text-muted">{t("lc.d.waiting")}</span> },
  ];
  const places = d.places;
  const taken = places ? places.inClass + places.reserved : 0;

  return (
    <>
      <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span aria-hidden className="grid size-16 shrink-0 place-items-center rounded-full bg-brand-600/15 text-xl font-bold text-link ring-1 ring-inset ring-brand-600/25">{name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("")}</span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">{name}</h1>
              <p className="mt-0.5 text-sm tabular-nums text-muted">{d.student.admissionNo} · {d.year.name}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <OutcomeBadge outcome={r.progression.outcome} t={t} />
                <ClearanceBadge state={d.clearance} t={t} />
                <span className={d.step.blocked ? "font-medium text-warn" : "font-medium text-ink"}>{stageLabel(t, d.step.stage)}</span>
                {d.step.department !== "NONE" && <span className="text-muted">· {deptLabel(t, d.step.department)}</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {now && manage && <a href="#now" className="btn-primary btn-sm inline-flex items-center font-medium">{t(now === "place" ? "lc.step.placeGo" : now === "register" ? "lc.step.registerGo" : "lc.step.joinGo")}</a>}
            {can("student.read") && <Link href={`/students/${d.student.id}`} className="btn-secondary btn-sm inline-flex items-center font-medium">{t("lc.d.profile")}</Link>}
            {can("progression.read") && <Link href={`/academic-office/progression/${r.studentId}?year=${r.progression.fromAcademicYearId}`} className="btn-secondary btn-sm inline-flex items-center font-medium">{t("lc.step.openDecision")}</Link>}
            <Link href="/students/returning" className="px-1.5 text-sm font-medium text-link hover:underline">{t("lc.back")}</Link>
          </div>
        </div>

        <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t("lc.ret.title")}>
          {steps.map((x, i) => {
            const ok = done[x.key];
            const current = now === x.key;
            return (
              <li key={x.key} className={`rounded-xl border px-4 py-3 ${current ? "border-link/60 bg-link/10" : ok ? "border-ok/30 bg-ok/5" : "border-line bg-canvas/50"}`} aria-current={current ? "step" : undefined}>
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.08em] text-muted">
                  {ok ? <Check className="size-4 text-ok" aria-hidden /> : current ? <CircleDot className="size-4 text-link" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
                  {t("lc.d.step", { n: i + 1 })}
                </span>
                <span className="mt-1 block text-[15px] font-semibold text-ink">{x.title}</span>
                <span className="mt-0.5 block text-sm text-ink/90">{x.text}</span>
                {current && manage && <a href="#now" className="mt-2 inline-block text-sm font-medium text-link hover:underline">{t("lc.d.doNow")} ↓</a>}
              </li>
            );
          })}
        </ol>
      </section>

      <Row>
        <div className="flex flex-[2_1_34rem] flex-col gap-4">
          {now === "place" && manage && (
            <Panel id="now" title={t("lc.d.now")} subtitle={t("lc.step.place")}>
              <PlaceForm d={d} r={r} t={t} can={can} />
            </Panel>
          )}
          {now === "register" && (
            <Panel id="now" title={t("lc.d.now")} subtitle={t("lc.step.register")}>
              {manage ? (
                <ActionForm action={confirmRegistrationAction} submitLabel={t("lc.step.registerGo")} className="space-y-3" buttonClassName="btn-sm">
                  <input type="hidden" name="id" value={r.id} />
                  <Field name="confirmed" type="checkbox" label={t("lc.step.confirmed")} hint={t("lc.step.confirmedHint")} />
                  <Field name="note" label={t("lc.bulk.note")} optionalLabel={t("common.optional")} />
                </ActionForm>
              ) : <p className="text-sm text-muted">{t("lc.step.registerWait")}</p>}
            </Panel>
          )}
          {now === "join" && (
            <Panel id="now" title={t("lc.d.now")} subtitle={t("lc.step.join")}>
              {manage ? (
                <ActionForm action={activateAction} submitLabel={t("lc.step.joinGo")} className="space-y-2" buttonClassName="btn-sm">
                  <input type="hidden" name="ids" value={r.id} />
                  {!d.open && <p className="text-sm text-muted">{t("lc.step.yearNotOpen", { year: d.year.name, date: displayDate(d.year.startsOn, ctx.locale) })}</p>}
                  {d.step.stage === "NEEDS_FEE" && <p className="text-sm text-warn">{t("lc.step.feeHolds")}</p>}
                </ActionForm>
              ) : <p className="text-sm text-muted">{t("lc.step.joinWait")}</p>}
            </Panel>
          )}
          {st === "ACTIVE" && <Panel title={t("lc.d.now")}><p className="text-sm text-ok">{r.activatedAt ? t("lc.step.joined", { date: displayDate(r.activatedAt, ctx.locale) }) : t("lc.d.allDone")}</p></Panel>}
          {manage && st === "CANCELLED" && (
            <Panel title={t("lc.step.cancelledTitle")}>
              <p className="text-sm text-muted">{r.cancelReason}</p>
              <ActionForm action={reopenRegistrationAction} submitLabel={t("lc.step.reopen")} inline className="mt-3"><input type="hidden" name="id" value={r.id} /></ActionForm>
            </Panel>
          )}

          {manage && open && placed && (
            <Panel title={t("lc.d.changeGrade")} subtitle={classLabel ?? undefined}>
              <details>
                <summary className="min-h-10 cursor-pointer py-1.5 text-sm font-medium text-link">{t("lc.step.placeChange")}</summary>
                <div className="mt-3"><PlaceForm d={d} r={r} t={t} can={can} change /></div>
              </details>
            </Panel>
          )}

          {(st === "PENDING" || followUps.length > 0) && (
            <Panel title={t("lc.nr.history")}>
              {followUps.length === 0 ? <p className="text-sm text-muted">{t("lc.nr.empty")}</p> : (
                <ol className="mb-4 space-y-2.5 text-sm">
                  {followUps.map((f) => (
                    <li key={f.id} className="border-l-2 border-line pl-3">
                      <p className={f.outcome === "NOT_RETURNING" ? "font-medium text-warn" : "font-medium text-ink"}>{t(`lc.nr.o.${f.outcome}` as "lc.nr.o.OTHER")}</p>
                      {f.note && <p className="text-ink">{f.note}</p>}
                      <p className="text-xs text-muted">{[f.by, displayDate(f.at, ctx.locale)].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ol>
              )}
              {manage && st === "PENDING" && <FollowUpForm id={r.id} t={t} action={followUpAction} />}
              {manage && st === "PENDING" && <p className="mt-3 text-xs text-muted">{t("lc.nr.cancelHint")}</p>}
            </Panel>
          )}

          <Panel title={t("lc.timeline")}>
            <Timeline entries={timeline} t={t} locale={ctx.locale} limit={14} />
          </Panel>
        </div>

        <div className="flex flex-[1_1_20rem] flex-col gap-4">
          <Panel title={t("lc.d.profile")}>
            <DefList items={[
              { label: t("lc.d.lastYear"), value: d.fromClass || "—" },
              { label: t("lc.d.movingTo"), value: classLabel ?? d.decidedClass ?? "—" },
              { label: t("student.gender"), value: d.student.gender === "MALE" ? t("student.male") : t("student.female") },
              { label: t("student.age"), value: String(ageOn(d.student.dateOfBirth)) },
            ]} />
            <Link href={`/students/${d.student.id}`} className="mt-3 inline-block text-sm font-medium text-link hover:underline">{t("common.view")}</Link>
            {can("progression.read") && <Link href={`/academic-office/progression/${r.studentId}?year=${r.progression.fromAcademicYearId}`} className="ml-4 mt-3 inline-block text-sm font-medium text-link hover:underline">{t("lc.step.openDecision")}</Link>}
          </Panel>

          <Panel title={t("lc.d.family")}>
            {family.length === 0 ? <p className="text-sm text-muted">—</p> : (
              <ul className="divide-y divide-line text-sm">
                {family.map((g) => (
                  <li key={`${g.name}${g.phone}`} className="py-2 first:pt-0 last:pb-0">
                    <p className="font-medium text-ink">{g.name}<span className="ml-2 text-xs font-normal text-muted">{t(`student.rel.${g.relationship}` as "student.rel.MOTHER")}{g.primary ? ` · ${t("lc.d.mainContact")}` : ""}</span></p>
                    <p className="tabular-nums text-muted">{[g.phone, g.altPhone].filter(Boolean).join(" · ")}</p>
                    {g.email && <p className="text-muted">{g.email}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {insights && (
            <Panel title={t("lc.d.results")} subtitle={latest?.term}>
              {latest ? (
                <>
                  <p className="text-sm font-medium text-ink">{latest.average !== null ? t("lc.d.avgLine", { avg: latest.average.toFixed(1), grade: latest.grade ?? "—", pos: latest.position ?? "—", n: latest.classSize }) : null}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {latest.subjects.slice(0, 8).map((x) => <li key={x.id} className="flex justify-between gap-3"><span className="text-muted">{x.name}</span><span className="font-medium tabular-nums text-ink">{Math.round(x.percent)}%</span></li>)}
                  </ul>
                </>
              ) : <p className="text-sm text-muted">{t("lc.d.noReport")}</p>}
            </Panel>
          )}

          {att && (
            <Panel title={t("lc.d.attendance")}>
              <p className={`text-sm font-medium ${att.low ? "text-warn" : "text-ink"}`}>{att.rate === null ? "—" : t("lc.d.rateLine", { rate: Math.round(att.rate), days: att.records.length })}</p>
              <p className="mt-1 text-xs tabular-nums text-muted">{Object.entries(att.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k.toLowerCase()} ${n}`).join(" · ")}</p>
            </Panel>
          )}

          {places && (
            <Panel title={t("lc.d.places")} subtitle={places.name}>
              {places.capacity ? (
                <>
                  <p className="text-sm"><span className="text-2xl font-semibold tabular-nums text-ink">{taken}</span><span className="text-muted">/{places.capacity}</span><span className={`ml-3 text-sm font-medium ${(places.left ?? 0) <= 0 ? "text-bad" : (places.left ?? 0) <= 2 ? "text-warn" : "text-ok"}`}>{(places.left ?? 0) <= 0 ? t("reg.room.full") : t("reg.room.left", { n: places.left ?? 0 })}</span></p>
                  <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-sm bg-line"><div className={`h-full rounded-sm ${(places.left ?? 0) <= 0 ? "bg-bad" : (places.left ?? 0) <= 2 ? "bg-warn" : "bg-ok"}`} style={{ width: `${Math.min(100, (taken / places.capacity) * 100)}%` }} /></div>
                  {places.streams.length > 0 && <p className="mt-3 text-xs text-muted">{places.streams.map((s) => `${s.name} ${s.count}`).join(" · ")}</p>}
                </>
              ) : <p className="text-sm text-muted">{t("lc.step.noLimit", { name: places.name })}</p>}
            </Panel>
          )}

          <Panel title={t("lc.col.fees")} right={<ClearanceBadge state={d.clearance} t={t} />}>
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
              <details className="mt-3"><summary className="min-h-10 cursor-pointer py-1.5 text-sm font-medium text-link">{t("lc.fee.arrange")}</summary>
                <ActionForm action={clearanceExceptionAction} submitLabel={t("lc.fee.arrangeGo")} className="mt-2 space-y-2"><input type="hidden" name="id" value={r.id} /><Field name="reason" label={t("lc.fee.arrangeReason")} hint={t("lc.fee.arrangeHint")} required /></ActionForm>
              </details>
            ))}
            {!can("fees.read") && <p className="mt-3 text-xs text-muted">{t("lc.fee.financeOwns")}</p>}
          </Panel>

          {manage && open && (
            <Panel title={t("lc.step.cancel")}>
              <details><summary className="min-h-10 cursor-pointer py-1.5 text-sm font-medium text-bad">{t("lc.step.cancelGo")}</summary>
                <ActionForm action={cancelRegistrationAction} submitLabel={t("lc.step.cancelGo")} tone="danger" className="mt-2 space-y-2"><input type="hidden" name="id" value={r.id} /><Field name="reason" label={t("lc.step.cancelReason")} required /></ActionForm>
              </details>
            </Panel>
          )}
        </div>
      </Row>
    </>
  );
}

/** The place-in-a-grade form (one place to keep it): the decided grade is chosen for you, with the emptiest stream; exceptions are for people who hold them. */
function PlaceForm({ d, r, t, can, change = false }: { d: Detail; r: Detail["reg"]; t: Awaited<ReturnType<typeof getT>>; can: (p: Parameters<import("@/lib/auth/context").AuthContext["permissions"]["has"]>[0]) => boolean; change?: boolean }) {
  return (
    <ActionForm action={placeReturningAction} submitLabel={change ? t("lc.step.placeChange") : t("lc.step.placeGo")} className="space-y-3" buttonClassName="btn-sm">
      <input type="hidden" name="id" value={r.id} />
      <Field name="placement" type="select" label={t("lc.step.placeLabel")} hint={t("lc.step.placeHint")} defaultValue={d.preferred} placeholder={t("common.select")} required options={d.options.map((o) => ({ value: o.value, label: o.full ? `${o.label} – ${t("adm.place.full")}` : o.label }))} />
      {(can("progression.exception") || can("class.capacity_override")) && (
        <details>
          <summary className="min-h-10 cursor-pointer py-1.5 text-sm text-muted">{t("lc.step.exceptions")}</summary>
          <div className="space-y-3">
            {can("progression.exception") && <Field name="gradeReason" label={t("lc.step.gradeReason")} optionalLabel={t("common.optional")} hint={t("lc.step.gradeReasonHint")} />}
            {can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} optionalLabel={t("common.optional")} /></>}
          </div>
        </details>
      )}
      {r.gradeOverrideReason && <p className="text-xs text-warn">{t("lc.step.gradeNote", { reason: r.gradeOverrideReason })}</p>}
      {r.capacityOverrideReason && <p className="text-xs text-warn">{t("lc.step.capNote", { reason: r.capacityOverrideReason })}</p>}
    </ActionForm>
  );
}
