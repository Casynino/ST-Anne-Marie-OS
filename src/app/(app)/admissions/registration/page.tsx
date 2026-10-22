import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { acceptedCounts, acceptedList, placementOptions } from "@/server/admission-stages";
import { awaitingPlacement } from "@/server/admission-queues";
import { classRoom } from "@/server/admission-registration";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, Field, inputClass } from "@/components/form";
import { TickAll, TickBox, TickCount, TickFields, TickProvider } from "@/components/lifecycle/tick";
import { Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { registerManyAction } from "../actions";

export const metadata: Metadata = { title: "Register new students" };

/**
 * New students are registered here in ONE step: the official student record, the permanent Student ID and the class are made together.
 * Every applicant who passed and whose school fee is cleared is listed with the class they asked for already chosen. Register one with the button
 * on the row, or tick several and put them all in one class. The panel beside the list shows how full every class is, so a full class is easy to avoid.
 */
export default async function RegistrationPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const [rows, counts, waiting, place] = await Promise.all([acceptedList(ctx, "registration"), acceptedCounts(ctx), awaitingPlacement(ctx), placementOptions(ctx)]);
  const room = await classRoom(ctx, rows.map((r) => r.classAppliedId));
  const canRegister = ctx.permissions.has("admission.enrol") && ctx.permissions.has("student.enroll");
  const canOverride = ctx.permissions.has("class.capacity_override");
  const ready = rows.filter((r) => r.remaining.length === 0);
  return (
    <>
      <PageHeader title={t("adm.reg.title")} subtitle={t("adm.reg.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/registration" badges={{ "/admissions/payment": counts.payment, "/admissions/registration": counts.registration, "/admissions/placement": waiting.length }} />
      {rows.length === 0 ? <EmptyState>{t("adm.reg.none")}</EmptyState> : (
        <TickProvider all={ready.map((r) => r.id)}>
        <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
          <div className="space-y-4">
            {canRegister && ready.length > 1 && (
              <Card title={t("adm.reg.many.title")}>
                <p className="mb-3 text-sm text-muted">{t("adm.reg.many.hint")}</p>
                <ActionForm action={registerManyAction} submitLabel={t("adm.reg.many.go")} className="flex flex-wrap items-end gap-3" buttonClassName="order-2 min-h-11">
                  <TickFields name="ids" />
                  <Field name="placement" type="select" required label={t("adm.reg.many.class")} placeholder={t("common.select")} className="order-1 w-72"
                    options={place.bulkOptions.map((o) => ({ value: o.value, label: o.label.replace(" – any stream", ` – ${t("adm.reg.many.anyStream")}`) + (o.full ? ` – ${t("adm.place.full")}` : "") }))} />
                  <TickCount className="order-2 pb-3" template={t("adm.reg.many.count", { n: "{n}" })} />
                  {canOverride && <details className="order-3 basis-full"><summary className="min-h-11 cursor-pointer py-2 text-sm text-muted">{t("adm.reg.many.override")}</summary><div className="space-y-3"><Field name="overrideCapacity" type="checkbox" label={t("adm.reg.many.overrideLabel")} /><Field name="overrideReason" label={t("adm.reg.many.overrideReason")} optionalLabel={t("common.optional")} /></div></details>}
                </ActionForm>
              </Card>
            )}
            <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-10 px-3 py-3">{canRegister && ready.length > 1 ? <TickAll label={t("lc.selectAll")} /> : null}</th>
                    <th className="px-3 py-3 font-medium">{t("adm.applicant")}</th><th className="px-3 py-3 font-medium">{t("adm.reg.list.applied")}</th><th className="px-3 py-3 font-medium">{t("adm.reg.list.register")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const isReady = r.remaining.length === 0;
                    const choice = place.preferredFor(r.classAppliedId);
                    return (
                      <tr key={r.id} className="align-top hover:bg-canvas/50">
                        <td className="px-3 py-3">{canRegister && isReady && ready.length > 1 ? <TickBox id={r.id} label={r.name} /> : null}</td>
                        <td className="px-3 py-3"><Link href={`/admissions/accepted/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span>{r.decidedAt && <span className="block text-xs text-muted">{t("adm.reg.list.passed", { date: displayDate(r.decidedAt, ctx.locale) })}</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3">{r.className ?? "—"}{choice.appliedFull && <span className="block text-xs text-warn">{t("adm.reg.full", { class: choice.appliedClass ?? "", n: String(choice.appliedFull.count), cap: String(choice.appliedFull.capacity) })}</span>}</td>
                        <td className="px-3 py-3">
                          {isReady && canRegister ? (
                            <ActionForm action={registerManyAction} submitLabel={t("adm.reg.list.go")} className="flex flex-wrap items-start gap-2" buttonClassName="min-h-11">
                              <input type="hidden" name="ids" value={r.id} />
                              <select name="placement" required defaultValue={choice.preferred} aria-label={t("adm.reg.classLabel")} className={`${inputClass} w-56`}>
                                <option value="">{t("common.select")}</option>
                                {place.options.map((o) => <option key={o.value} value={o.value} disabled={o.full && !canOverride}>{o.full ? `${o.label} – ${t("adm.place.full")}` : o.label}</option>)}
                              </select>
                            </ActionForm>
                          ) : (
                            <div className="flex flex-wrap items-start gap-3">
                              {!isReady && <ul className="space-y-0.5 text-muted">{r.remaining.map((m) => <li key={m}>{m}</li>)}</ul>}
                              <Link href={`/admissions/accepted/${r.id}`} className="inline-flex min-h-9 items-center rounded-md border border-line px-3 text-[13px] font-medium hover:border-brand-500 hover:bg-tint">{t("common.view")}</Link>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">{t("adm.reg.list.hint")}</p>
          </div>

          <Card title={t("adm.reg.room.title")}>
            <p className="mb-3 text-xs text-muted">{t("adm.reg.room.sub")}</p>
            <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto text-sm">
              {room.map((c) => (
                <li key={c.classId} className="py-2">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className={`tabular-nums ${c.full ? "font-medium text-bad" : c.left !== null && c.left <= 2 ? "text-warn" : "text-ok"}`}>
                      {c.capacity === null ? t("adm.reg.room.noLimit") : c.full ? t("adm.reg.room.full") : t("adm.reg.room.left", { left: c.left ?? 0 })}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {c.capacity === null ? c.taken : t("adm.reg.room.of", { n: c.taken, cap: c.capacity })}
                    {c.streams.length > 0 && ` · ${c.streams.map((s) => `${s.name} ${s.count}`).join(" · ")}`}
                    {c.waiting > 0 && ` · ${t("adm.reg.room.waiting", { n: c.waiting })}`}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        </TickProvider>
      )}
    </>
  );
}
