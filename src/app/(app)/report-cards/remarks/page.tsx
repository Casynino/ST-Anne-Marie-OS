import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { getCurrentAcademicContext } from "@/server/academics";
import { listExamClasses, listExamTerms } from "@/server/exams";
import { listRemarks } from "@/server/report-cards";
import { Badge, EmptyState, FilterBar, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field, inputClass } from "@/components/form";
import { saveRemarksAction } from "../actions";

export const metadata: Metadata = { title: "Remarks" };
type Search = { termId?: string; classId?: string; streamId?: string };

export default async function RemarksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["remarks.class", "remarks.head", "reportcard.read"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [terms, classes, current] = await Promise.all([listExamTerms(ctx), listExamClasses(ctx), getCurrentAcademicContext(ctx.schoolId)]);
  const termId = sp.termId && terms.some((x) => x.id === sp.termId) ? sp.termId : (current.term?.id ?? terms[0]?.id);
  const cls = classes.find((c) => c.id === sp.classId);
  const streamId = cls?.streams.some((s) => s.id === sp.streamId) ? sp.streamId : undefined;

  let data: Awaited<ReturnType<typeof listRemarks>> | null = null;
  let problem: string | null = null;
  if (termId && cls) {
    try {
      data = await listRemarks(ctx, { termId, classId: cls.id, streamId });
    } catch (e) {
      if (e instanceof AppError) problem = e.message;
      else throw e;
    }
  }
  const editable = !!data && (data.can.class || data.can.head);

  return (
    <>
      <PageHeader title={t("rc.remarks.title")} subtitle={t("rc.remarks.subtitle")} actions={<Link href="/report-cards" className="text-sm font-medium text-link hover:underline">{t("rc.page.title")}</Link>} />
      <FilterBar t={t} resetHref="/report-cards/remarks">
        <Field name="termId" type="select" label={t("exam.term")} options={terms.map((x) => ({ value: x.id, label: `${x.academicYear.name} · ${x.name}` }))} defaultValue={termId ?? ""} />
        <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={sp.classId ?? ""} placeholder={t("res.chooseClass")} />
        {cls && cls.streams.length > 0 && <Field name="streamId" type="select" label={t("exam.stream")} options={cls.streams.map((s) => ({ value: s.id, label: s.name }))} defaultValue={streamId ?? ""} placeholder={t("res.allStreams")} />}
      </FilterBar>
      {!cls ? (
        <EmptyState>{t("res.pick")}</EmptyState>
      ) : problem ? (
        <EmptyState>{problem}</EmptyState>
      ) : !data ? null : data.rows.length === 0 ? (
        <EmptyState>{t("res.noStudents")}</EmptyState>
      ) : (
        <ActionForm action={saveRemarksAction} submitLabel={t("rc.remarks.save")} hideSubmit={!editable} className="space-y-4">
          <input type="hidden" name="termId" value={termId} />
          <input type="hidden" name="classId" value={cls.id} />
          {streamId && <input type="hidden" name="streamId" value={streamId} />}
          <ul className="space-y-3">
            {data.rows.map((r) => (
              <li key={r.studentId} className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{r.name}</p><span className="text-xs text-muted">{r.admissionNo}</span>
                  {r.cardStatus === "PUBLISHED" && <Badge tone="ok">{t("rc.status.PUBLISHED")}</Badge>}
                  {r.cardStatus === "GENERATED" && <Badge tone="warn">{t("rc.remarks.regenerate")}</Badge>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block text-sm"><span className="mb-1 block font-medium">{t("rc.remarks.class")}</span>
                    <textarea name={`class:${r.studentId}`} defaultValue={r.classRemark} rows={3} maxLength={500} readOnly={!data.can.class || r.cardStatus === "PUBLISHED"} className={inputClass} />
                  </label>
                  <label className="block text-sm"><span className="mb-1 block font-medium">{t("rc.remarks.head")}</span>
                    <textarea name={`head:${r.studentId}`} defaultValue={r.headRemark} rows={3} maxLength={500} readOnly={!data.can.head || r.cardStatus === "PUBLISHED"} className={inputClass} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </ActionForm>
      )}
    </>
  );
}
