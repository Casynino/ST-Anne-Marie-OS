import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { getRecruitmentSettings, listCandidates } from "@/server/recruitment";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Td } from "@/components/ui";
import { createCandidateAction, updateRecruitmentSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Staff recruitment" };
const TONE = { APPLIED: "neutral", INTERVIEW_SCHEDULED: "warn", INTERVIEWED: "warn", AWAITING_DECISION: "warn", ACCEPTED: "brand", ONBOARDING: "brand", ACTIVE: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;

export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("staff.recruit") && !ctx.permissions.has("staff.recruit.decide")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const status = sp.status === "all" ? undefined : "open";
  const [rows, settings] = await Promise.all([listCandidates(ctx, { status }), getRecruitmentSettings(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("rec.title")} subtitle={t("rec.sub")} />
      <ul className="mb-4 flex gap-2">
        {([["open", "concern.filter.open"], ["all", "concern.filter.all"]] as const).map(([k, l]) => <li key={k}><Link href={`/staff-recruitment?status=${k}`} aria-current={(sp.status === "all" ? "all" : "open") === k ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm ${(sp.status === "all" ? "all" : "open") === k ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface hover:bg-canvas"}`}>{t(l)}</Link></li>)}
      </ul>
      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div>
          {rows.length === 0 ? <EmptyState>{t("rec.none")}</EmptyState> : (
            <DataTable head={[t("rec.candidate"), t("rec.position"), t("rec.interview"), t("common.status")]}>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-canvas">
                  <Td><Link href={`/staff-recruitment/${c.id}`} className="font-medium text-link hover:underline">{c.fullName}</Link><span className="block text-xs text-muted">{c.candidateNo}</span></Td>
                  <Td>{c.positionApplied}{c.subjects ? <span className="block text-xs text-muted">{c.subjects}</span> : null}</Td>
                  <Td className="whitespace-nowrap">{c.interviewAt ? displayDate(c.interviewAt, ctx.locale) : "—"}</Td>
                  <Td><Badge tone={TONE[c.status]}>{t(`rec.status.${c.status}` as "rec.status.APPLIED")}</Badge></Td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
        <div className="space-y-5">
          {ctx.permissions.has("staff.recruit") && (
            <Card title={t("rec.new")}>
              <ActionForm action={createCandidateAction} submitLabel={t("common.save")} className="space-y-3">
                <Field name="fullName" label={t("grade.name")} required />
                <Field name="positionApplied" label={t("rec.position")} placeholder={t("rec.position.ph")} required />
                <Field name="subjects" label={t("rec.subjects")} optionalLabel={t("common.optional")} />
                <Field name="phone" type="tel" label={t("common.phone")} optionalLabel={t("common.optional")} />
                <Field name="email" type="email" label={t("common.email")} optionalLabel={t("common.optional")} />
                <Field name="qualifications" type="textarea" rows={2} label={t("rec.qualifications")} optionalLabel={t("common.optional")} />
                <Field name="experience" type="textarea" rows={2} label={t("rec.experience")} optionalLabel={t("common.optional")} />
                <Field name="notes" type="textarea" rows={2} label={t("concern.notes")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
          {ctx.permissions.has("school.settings.update") && (
            <Card title={t("rec.docs.settings")}>
              <ActionForm action={updateRecruitmentSettingsAction} submitLabel={t("common.save")} className="space-y-3">
                <Field name="docs" type="textarea" rows={4} label={t("rec.docs.required")} defaultValue={settings.requiredDocs.join("\n")} hint={t("rec.docs.required.hint")} optionalLabel={t("common.optional")} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
