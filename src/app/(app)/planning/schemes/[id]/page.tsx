import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { currentTerms, getScheme } from "@/server/lesson-plans";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { WeeksEditor } from "@/components/learning/weeks-editor";
import { ReviewBox } from "@/components/learning/review-box";
import { STATUS_TONE } from "@/lib/learning/labels";
import { reviewSchemeAction, submitSchemeAction, updateSchemeAction } from "../../actions";

export const metadata: Metadata = { title: "Scheme of work" };

export default async function SchemePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["plans.write", "plans.review"])) return <NoAccess t={t} />;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let s: Awaited<ReturnType<typeof getScheme>>;
  try { s = await getScheme(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const terms = s.editable ? await currentTerms(ctx) : [];
  const wl = { week: t("learn.week"), topic: t("learn.topic"), objectives: t("learn.objectives"), activities: t("learn.activities"), resources: t("learn.resources"), assessment: t("learn.assessment"), add: t("learn.addWeek"), remove: t("learn.removeWeek") };
  return (
    <>
      <PageHeader title={s.title} subtitle={`${s.className} · ${s.subjectName} · ${s.teacherName}`} actions={<Badge tone={STATUS_TONE[s.status]}>{t(`learn.status.${s.status}`)}</Badge>} />
      {s.reviewNote && <p role="note" className="mb-4 rounded-xl border border-warn/30 bg-amber-50 px-4 py-3 text-sm"><strong>{t("learn.plan.reviewerNote")}:</strong> {s.reviewNote}</p>}
      <div className="space-y-6">
        {s.editable ? (
          <Card>
            <ActionForm action={updateSchemeAction} submitLabel={t("common.save")}>
              <input type="hidden" name="id" value={s.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field name="title" label={t("learn.title")} required defaultValue={s.title} />
                <Field name="termId" type="select" label={t("learn.term")} optionalLabel={t("common.optional")} placeholder={t("learn.wholeYear")} options={terms.map((x) => ({ value: x.id, label: x.name }))} defaultValue={s.termId ?? ""} />
              </div>
              <WeeksEditor initial={s.weeks.map((w) => ({ topic: w.topic, objectives: w.objectives ?? "", activities: w.activities ?? "", resources: w.resources ?? "", assessment: w.assessment ?? "" }))} labels={wl} />
            </ActionForm>
          </Card>
        ) : (
          <ol className="space-y-3">
            {s.weeks.map((w) => (
              <li key={w.id} className="rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-700">{t("learn.week")} {w.weekNo}</p>
                <h2 className="display mt-1 text-xl text-brand-950">{w.topic}</h2>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                  {([["objectives", w.objectives], ["activities", w.activities], ["resources", w.resources], ["assessment", w.assessment]] as const).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="font-semibold text-brand-900">{t(`learn.${k}`)}</dt><dd className="mt-0.5 whitespace-pre-line text-muted">{v}</dd></div>)}
                </dl>
              </li>
            ))}
          </ol>
        )}
        {s.editable && s.weeks.length > 0 && (
          <Card title={t("learn.plan.sendTitle")}>
            <p className="mb-3 text-sm text-muted">{t("learn.plan.sendHint")}</p>
            <ActionForm action={submitSchemeAction} submitLabel={t("learn.plan.submit")}><input type="hidden" name="id" value={s.id} /></ActionForm>
          </Card>
        )}
        {s.canReview && <ReviewBox id={s.id} action={reviewSchemeAction} labels={{ title: t("learn.plan.review"), send: t("learn.plan.sendReview"), decision: t("learn.plan.decision"), approve: t("learn.plan.approve"), return: t("learn.plan.return"), note: t("learn.plan.note"), noteHint: t("learn.plan.noteHint") }} />}
      </div>
    </>
  );
}
