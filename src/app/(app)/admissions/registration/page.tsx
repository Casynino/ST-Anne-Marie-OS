import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { acceptedCounts, acceptedList, placementOptions } from "@/server/admission-stages";
import { awaitingPlacement } from "@/server/admission-queues";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { ActionForm, inputClass } from "@/components/form";
import { EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { registerFromListAction } from "../actions";

export const metadata: Metadata = { title: "Register new students" };

/**
 * New students are registered here in ONE step: the official student record, the permanent Student ID and the class are made together. Every
 * applicant who passed and whose school fee is cleared is listed with the class they asked for already chosen (the least-filled stream); change it if
 * needed and press Register. What still stops an applicant is shown on the row.
 */
export default async function RegistrationPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const [rows, counts, waiting, place] = await Promise.all([acceptedList(ctx, "registration"), acceptedCounts(ctx), awaitingPlacement(ctx), placementOptions(ctx)]);
  const canRegister = ctx.permissions.has("admission.enrol");
  const canPlace = ctx.permissions.has("student.enroll");
  const canOverride = ctx.permissions.has("class.capacity_override");
  return (
    <>
      <PageHeader title={t("adm.reg.title")} subtitle={t("adm.reg.sub")} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions/registration" badges={{ "/admissions/payment": counts.payment, "/admissions/registration": counts.registration, "/admissions/placement": waiting.length }} />
      {rows.length === 0 ? <EmptyState>{t("adm.reg.none")}</EmptyState> : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr><th className="px-3 py-3 font-medium">{t("adm.applicant")}</th><th className="px-3 py-3 font-medium">{t("adm.reg.list.applied")}</th><th className="px-3 py-3 font-medium">{t("adm.reg.list.register")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const ready = r.remaining.length === 0;
                const choice = place.preferredFor(r.classAppliedId);
                return (
                  <tr key={r.id} className="align-top hover:bg-canvas/50">
                    <td className="px-3 py-3"><Link href={`/admissions/accepted/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link><span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span>{r.decidedAt && <span className="block text-xs text-muted">{t("adm.reg.list.passed", { date: displayDate(r.decidedAt, ctx.locale) })}</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3">{r.className ?? "—"}{choice.appliedFull && <span className="block text-xs text-warn">{t("adm.reg.full", { class: choice.appliedClass ?? "", n: String(choice.appliedFull.count), cap: String(choice.appliedFull.capacity) })}</span>}</td>
                    <td className="px-3 py-3">
                      {ready && canRegister && canPlace ? (
                        <ActionForm action={registerFromListAction} submitLabel={t("adm.reg.list.go")} className="flex flex-wrap items-start gap-2" buttonClassName="min-h-11">
                          <input type="hidden" name="id" value={r.id} />
                          <select name="placement" required defaultValue={choice.preferred} aria-label={t("adm.reg.classLabel")} className={`${inputClass} w-56`}>
                            <option value="">{t("common.select")}</option>
                            {place.options.map((o) => <option key={o.value} value={o.value} disabled={o.full && !canOverride}>{o.full ? `${o.label} – ${t("adm.place.full")}` : o.label}</option>)}
                          </select>
                        </ActionForm>
                      ) : (
                        <div className="flex flex-wrap items-start gap-3">
                          {!ready && <ul className="space-y-0.5 text-muted">{r.remaining.map((m) => <li key={m}>{m}</li>)}</ul>}
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
      )}
      {rows.length > 0 && <p className="mt-3 text-xs text-muted">{t("adm.reg.list.hint")}</p>}
    </>
  );
}
