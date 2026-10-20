import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, formatDateOnly } from "@/lib/dates";
import { tDynamic } from "@/lib/i18n";
import { SUBMISSION_TONE } from "@/lib/results/ui";
import { getExam, listExamClasses } from "@/server/exams";
import { listScales } from "@/server/grading";
import { listSubmissions } from "@/server/marks";
import { Badge, Card, DataTable, DefList, EmptyState, NoAccess, PageHeader, Td } from "@/components/ui";
import { ActionForm, CheckGroup, Field } from "@/components/form";
import { addExamSubjectsAction, deleteExamAction, removeExamSubjectAction, updateExamAction } from "../actions";
import { bulkMarksAction } from "../../marks/actions";

export const metadata: Metadata = { title: "Examination" };

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["exam.read"])) return <NoAccess t={t} />;
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getExam>>;
  try {
    data = await getExam(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { exam, term } = data;
  const canManage = hasAny(ctx, ["exam.manage"]);
  const canApprove = hasAny(ctx, ["results.approve"]);
  const canLock = hasAny(ctx, ["results.lock"]);
  const [subs, classes, scales] = await Promise.all([listSubmissions(ctx, { examId: id }), canManage ? listExamClasses(ctx) : [], canManage ? listScales(ctx) : []]);
  const submitted = subs.filter((s) => s.status === "SUBMITTED").map((s) => s.id);
  const approved = subs.filter((s) => s.status === "APPROVED").map((s) => s.id);
  const count = (s: string) => subs.filter((x) => x.status === s).length;
  const esBySub = new Map(data.examSubjects.map((e) => [`${e.classId}:${e.subjectId}`, e.id]));

  return (
    <>
      <PageHeader
        title={exam.name}
        subtitle={`${term ? `${term.academicYear.name} · ${term.name}` : ""}`}
        actions={<Link href="/exams" className="text-sm font-medium text-link hover:underline">{t("exam.back")}</Link>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["DRAFT", "SUBMITTED", "APPROVED", "LOCKED", "RETURNED"] as const).map((s) => (
          <div key={s} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-xs uppercase tracking-wide text-muted">{t(`marks.status.${s}`)}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{count(s)}</p>
          </div>
        ))}
      </div>

      {(canApprove || canLock) && (submitted.length > 0 || approved.length > 0) && (
        <Card title={t("marks.bulk")} className="mb-6">
          <div className="flex flex-wrap gap-3">
            {canApprove && submitted.length > 0 && (
              <ActionForm action={bulkMarksAction} submitLabel={t("marks.approveAll", { count: submitted.length })} className="space-y-0" confirm={t("marks.confirmBulkApprove", { count: submitted.length })}>
                <input type="hidden" name="intent" value="approve" />
                {submitted.map((x) => <input key={x} type="hidden" name="ids" value={x} />)}
              </ActionForm>
            )}
            {canLock && approved.length > 0 && (
              <ActionForm action={bulkMarksAction} submitLabel={t("marks.lockAll", { count: approved.length })} className="space-y-0" confirm={t("marks.confirmBulkLock", { count: approved.length })} tone="neutral">
                <input type="hidden" name="intent" value="lock" />
                {approved.map((x) => <input key={x} type="hidden" name="ids" value={x} />)}
              </ActionForm>
            )}
          </div>
        </Card>
      )}

      {data.classes.length === 0 ? (
        <EmptyState>{t("exam.noSubjects")}</EmptyState>
      ) : (
        <div className="space-y-6">
          {data.classes.map((c) => {
            const rows = subs.filter((s) => s.classId === c.id);
            return (
              <section key={c.id}>
                <h2 className="mb-2 text-base font-semibold">{c.name}</h2>
                <DataTable head={[t("exam.subject"), t("exam.stream"), t("marks.status"), t("marks.progress"), ""]} empty={rows.length ? undefined : <p className="px-4 py-6 text-center text-sm text-muted">{t("exam.noVisible")}</p>}>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <Td className="font-medium">{s.subjectName}</Td>
                      <Td>{s.streamName ?? "—"}</Td>
                      <Td>
                        <Badge tone={SUBMISSION_TONE[s.status as keyof typeof SUBMISSION_TONE]}>{t(`marks.status.${s.status}` as never)}</Badge>
                        {s.overdue && <Badge tone="bad">{t("marks.overdue")}</Badge>}
                      </Td>
                      <Td className="tabular-nums">{s.entered}/{s.roster}</Td>
                      <Td className="text-right">
                        <span className="inline-flex items-center gap-3">
                          <Link href={`/marks/${s.id}`} className="text-sm font-medium text-link hover:underline">{s.canEnter && (s.status === "DRAFT" || s.status === "RETURNED") ? t("marks.enter") : t("common.view")}</Link>
                          {canManage && s.entered === 0 && esBySub.get(`${s.classId}:${s.subjectId}`) && (
                            <ActionForm action={removeExamSubjectAction} inline tone="danger" submitLabel={t("common.remove")} confirm={t("exam.confirmRemove")}>
                              <input type="hidden" name="examSubjectId" value={esBySub.get(`${s.classId}:${s.subjectId}`)} />
                            </ActionForm>
                          )}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </DataTable>
              </section>
            );
          })}
        </div>
      )}

      {canManage && (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Card title={t("exam.addSubjects")}>
            <p className="mb-3 text-sm text-muted">{t("exam.addSubjectsHint")}</p>
            <ActionForm action={addExamSubjectsAction} submitLabel={t("exam.add")}>
              <input type="hidden" name="examId" value={exam.id} />
              <CheckGroup name="classIds" selected={[]} options={classes.map((c) => ({ value: c.id, label: c.name, hint: t("exam.classSubjects", { count: c._count.subjects }), disabled: c._count.subjects === 0 }))} />
              <Field name="maxMarks" type="number" label={t("exam.maxMarksOverride")} optionalLabel={t("common.optional")} min={1} hint={t("exam.maxMarksOverrideHint", { value: Number(exam.maxMarks) })} />
            </ActionForm>
          </Card>
          <Card title={t("exam.settings")}>
            <ActionForm action={updateExamAction} submitLabel={t("common.save")}>
              <input type="hidden" name="id" value={exam.id} />
              <input type="hidden" name="termId" value={exam.termId} />
              <Field name="name" label={t("exam.name")} defaultValue={exam.name} required />
              <Field name="category" type="select" label={t("exam.category")} options={["MONTHLY", "MIDTERM", "TERMINAL", "ANNUAL", "OTHER"].map((c) => ({ value: c, label: tDynamic(t, "exam.cat", c) }))} defaultValue={exam.category} required />
              <div className="grid grid-cols-2 gap-3">
                <Field name="examDate" type="date" label={t("exam.date")} defaultValue={exam.examDate ? formatDateOnly(exam.examDate) : ""} />
                <Field name="submissionDeadline" type="date" label={t("exam.deadline")} defaultValue={exam.submissionDeadline ? formatDateOnly(exam.submissionDeadline) : ""} />
                <Field name="maxMarks" type="number" label={t("exam.maxMarks")} defaultValue={Number(exam.maxMarks)} required min={1} />
                <Field name="weight" type="number" label={t("exam.weight")} defaultValue={Number(exam.weight)} required min={1} max={100} />
              </div>
              <Field name="gradingScaleId" type="select" label={t("exam.scale")} options={scales.filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} defaultValue={exam.gradingScaleId ?? ""} placeholder={t("exam.scaleDefault")} />
            </ActionForm>
            <div className="mt-4 border-t border-line pt-4">
              <ActionForm action={deleteExamAction} submitLabel={t("exam.delete")} tone="danger" inline confirm={t("exam.confirmDelete")} className="space-y-0">
                <input type="hidden" name="id" value={exam.id} />
              </ActionForm>
              <p className="mt-2 text-xs text-muted">{t("exam.deleteHint")}</p>
            </div>
          </Card>
        </div>
      )}
      <div className="mt-6">
        <DefList items={[{ label: t("exam.date"), value: displayDate(exam.examDate, ctx.locale) }, { label: t("exam.deadline"), value: displayDate(exam.submissionDeadline, ctx.locale) }, { label: t("exam.maxMarks"), value: String(Number(exam.maxMarks)) }, { label: t("exam.weight"), value: `${Number(exam.weight)}%` }]} />
      </div>
    </>
  );
}
