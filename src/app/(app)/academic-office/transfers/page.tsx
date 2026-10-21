import type { Metadata } from "next";
import Link from "next/link";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { listClasses, listAcademicYears } from "@/server/academics";
import { listTransfers } from "@/server/transfers";
import { classOccupancy } from "@/server/admission-queues";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Td } from "@/components/ui";
import { applyTransferAction, cancelTransferAction, decideTransferAction, proposePromotionsAction, requestTransferAction } from "../actions";

export const metadata: Metadata = { title: "Transfers and promotions" };
const TONE = { REQUESTED: "warn", APPROVED: "brand", REJECTED: "bad", APPLIED: "ok", CANCELLED: "neutral" } as const;
const hid = (v: string) => <input type="hidden" name="id" value={v} />;

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("transfer.request") && !can("transfer.approve") && !can("academic.office")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const status = ["REQUESTED", "APPROVED", "APPLIED", "REJECTED", "CANCELLED"].includes(sp.status ?? "") ? sp.status : undefined;
  const [rows, classes, years, occupancy, today] = await Promise.all([listTransfers(ctx, { status }), can("academic.read") ? listClasses(ctx) : [], can("academic.read") ? listAcademicYears(ctx).catch(() => []) : [], classOccupancy(ctx.schoolId), db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { timezone: true } })]);
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: today.timezone }).format(new Date());
  const options = classes.filter((c) => c.isActive).flatMap((c) => {
    const o = occupancy.get(c.id);
    const note = o?.capacity ? ` (${o.count}/${o.capacity}${o.count >= o.capacity ? ` ${t("adm.place.full")}` : ""})` : "";
    return c.streams.length ? c.streams.map((s) => ({ value: `${c.id}|${s.id}`, label: `${c.name} – ${s.name}${note}` })) : [{ value: c.id, label: `${c.name}${note}` }];
  });
  const classOnly = classes.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name }));
  const yearOptions = years.map((y) => ({ value: y.id, label: y.name }));
  return (
    <>
      <PageHeader title={t("tr.title")} subtitle={t("tr.sub")} actions={<Link href="/academic-office" className="text-sm font-medium text-link hover:underline">{t("ac.title")}</Link>} />
      <ul className="mb-4 flex flex-wrap gap-2">
        {[undefined, "REQUESTED", "APPROVED", "APPLIED", "REJECTED", "CANCELLED"].map((s) => <li key={s ?? "all"}><Link href={s ? `/academic-office/transfers?status=${s}` : "/academic-office/transfers"} aria-current={status === s ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm ${status === s ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface hover:bg-canvas"}`}>{s ? t(`tr.status.${s}` as "tr.status.REQUESTED") : t("adm.stage.all")}</Link></li>)}
      </ul>
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div>
          {rows.length === 0 ? <EmptyState>{t("tr.none")}</EmptyState> : (
            <DataTable head={[t("learn.student"), t("tr.move"), t("tr.effective"), t("tr.reason"), t("common.status"), ""]}>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/students/${r.studentId}`} className="font-medium text-link hover:underline">{r.studentName}</Link><span className="block text-xs text-muted">{r.admissionNo}</span></Td>
                  <Td>{r.from || "—"} → {r.to}<span className="block text-xs text-muted">{t(`tr.kind.${r.kind}` as "tr.kind.TRANSFER")} · {r.yearName}</span></Td>
                  <Td className="whitespace-nowrap">{displayDate(r.effectiveOn, ctx.locale)}</Td>
                  <Td className="max-w-xs">{r.reason ?? "—"}{r.decisionNote ? <span className="block text-xs text-muted">{r.decisionNote}</span> : null}<span className="block text-xs text-muted">{t("tr.requestedBy", { name: r.requestedBy })}{r.decidedBy ? ` · ${t("tr.decidedBy", { name: r.decidedBy })}` : ""}</span></Td>
                  <Td><Badge tone={TONE[r.status as keyof typeof TONE]}>{t(`tr.status.${r.status}` as "tr.status.REQUESTED")}</Badge></Td>
                  <Td>
                    {r.status === "REQUESTED" && can("transfer.approve") && r.requestedById !== ctx.userId && (
                      <div className="space-y-2">
                        <ActionForm action={decideTransferAction} submitLabel={t("fin.expenses.approve")} inline className="space-y-1">{hid(r.id)}<input type="hidden" name="decision" value="APPROVE" />
                          {can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} /></>}
                        </ActionForm>
                        <details><summary className="min-h-9 cursor-pointer text-xs text-bad">{t("fin.expenses.reject")}</summary><ActionForm action={decideTransferAction} submitLabel={t("fin.expenses.reject")} inline tone="danger" className="mt-2 space-y-1">{hid(r.id)}<input type="hidden" name="decision" value="REJECT" /><Field name="note" label={t("marks.reason")} required /></ActionForm></details>
                      </div>
                    )}
                    {r.status === "APPROVED" && can("transfer.approve") && r.effectiveOn.toISOString().slice(0, 10) <= todayStr && (
                      <ActionForm action={applyTransferAction} submitLabel={t("tr.apply")} inline className="space-y-1">{hid(r.id)}{can("class.capacity_override") && <><Field name="overrideCapacity" type="checkbox" label={t("adm.enrol.override")} /><Field name="overrideReason" label={t("adm.enrol.overrideReason")} /></>}</ActionForm>
                    )}
                    {(r.status === "REQUESTED" || r.status === "APPROVED") && (r.requestedById === ctx.userId || can("transfer.approve")) && (
                      <details><summary className="min-h-9 cursor-pointer text-xs text-muted">{t("tr.cancel")}</summary><ActionForm action={cancelTransferAction} submitLabel={t("tr.cancel")} inline tone="danger" className="mt-2 space-y-1">{hid(r.id)}<Field name="reason" label={t("marks.reason")} required /></ActionForm></details>
                    )}
                  </Td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
        <div className="space-y-5">
          {can("transfer.request") && (
            <Card title={t("tr.request")}>
              <ActionForm action={requestTransferAction} submitLabel={t("tr.request")} className="space-y-3">
                <Field name="admissionNo" label={t("rc.admissionNo")} required />
                <Field name="kind" type="select" label={t("tr.kindLabel")} options={[{ value: "TRANSFER", label: t("tr.kind.TRANSFER") }, { value: "PROMOTION", label: t("tr.kind.PROMOTION") }]} defaultValue="TRANSFER" />
                <Field name="placement" type="select" label={t("tr.to")} options={options} placeholder={t("common.select")} required />
                <Field name="academicYearId" type="select" label={t("tr.year")} options={yearOptions} placeholder={t("tr.year.default")} optionalLabel={t("common.optional")} />
                <Field name="effectiveOn" type="date" label={t("tr.effective")} defaultValue={todayStr} min={undefined} />
                <Field name="reason" type="textarea" rows={2} label={t("tr.reason")} hint={t("tr.reason.hint")} />
              </ActionForm>
            </Card>
          )}
          {can("transfer.request") && (
            <Card title={t("tr.bulk")}>
              <p className="mb-3 text-sm text-muted">{t("tr.bulk.hint")}</p>
              <ActionForm action={proposePromotionsAction} submitLabel={t("tr.bulk.go")} className="space-y-3">
                <Field name="fromClassId" type="select" label={t("tr.from")} options={classOnly} placeholder={t("common.select")} required />
                <Field name="placement" type="select" label={t("tr.to")} options={options} placeholder={t("common.select")} required />
                <Field name="academicYearId" type="select" label={t("tr.year")} options={yearOptions} placeholder={t("common.select")} required />
                <Field name="effectiveOn" type="date" label={t("tr.effective")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
