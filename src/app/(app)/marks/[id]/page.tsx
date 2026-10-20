import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { SUBMISSION_TONE } from "@/lib/results/ui";
import { getSchoolBasics } from "@/server/settings";
import { getMarkSheet, markHistory } from "@/server/marks";
import { resolveScale } from "@/server/grading";
import { db } from "@/lib/db";
import { Badge, Card, DataTable, NoAccess, PageHeader, Td } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { MarkGrid } from "@/components/results/mark-grid";
import { approveMarksAction, lockMarksAction, returnMarksAction, saveMarksAction, unlockMarksAction } from "../actions";

export const metadata: Metadata = { title: "Marks" };

export default async function MarkSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["marks.enter", "marks.enter_any", "results.read", "results.read_assigned"])) return <NoAccess t={t} />;
  const { id } = await params;
  let sheet: Awaited<ReturnType<typeof getMarkSheet>>;
  try {
    sheet = await getMarkSheet(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const school = await getSchoolBasics(ctx.schoolId);
  const sub = await db.resultSubmission.findFirstOrThrow({ where: { id, schoolId: ctx.schoolId }, include: { examSubject: { include: { exam: true } } } });
  const cls = await db.schoolClass.findUniqueOrThrow({ where: { id: sub.examSubject.classId }, select: { levelId: true } });
  const scale = await resolveScale(db, ctx.schoolId, { examScaleId: sub.examSubject.exam.gradingScaleId, levelId: cls.levelId });
  const history = hasAny(ctx, ["results.read", "results.approve", "marks.enter_any"]) && sheet.submission.version > 1 ? await markHistory(ctx, id) : [];
  const { can, submission } = sheet;
  const className = ctx.locale === "SW" && sheet.classNameSw ? sheet.classNameSw : sheet.className;
  const subjectName = ctx.locale === "SW" && sheet.subjectNameSw ? sheet.subjectNameSw : sheet.subjectName;

  return (
    <>
      <PageHeader
        title={`${subjectName} · ${className}${sheet.streamName ? ` ${sheet.streamName}` : ""}`}
        subtitle={`${sheet.exam.name} · ${sheet.termName} · ${t("marks.outOf", { max: sheet.maxMarks })}`}
        actions={<Link href={hasAny(ctx, ["marks.enter", "marks.enter_any"]) ? "/marks" : `/exams/${sheet.exam.id}`} className="text-sm font-medium text-brand-800 hover:underline">{t("marks.back")}</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={SUBMISSION_TONE[submission.status]}>{t(`marks.status.${submission.status}`)}</Badge>
        {sheet.overdue && <Badge tone="bad">{t("marks.overdue")}</Badge>}
        {sheet.exam.deadline && <span className="text-muted">{t("exam.deadline")}: {displayDate(sheet.exam.deadline, ctx.locale)}</span>}
        {sheet.scaleName ? <span className="text-muted">· {t("exam.scale")}: {sheet.scaleName}</span> : <Badge tone="warn">{t("marks.noScale")}</Badge>}
      </div>
      {submission.status === "RETURNED" && (submission.returnReason || submission.unlockReason) && (
        <div role="note" className="mb-4 rounded-lg border border-warn/30 bg-amber-50 px-4 py-3 text-sm">
          <p className="font-medium text-warn">{submission.returnReason ? t("marks.returnedWith") : t("marks.unlockedWith")}</p>
          <p className="mt-1 text-ink">{submission.returnReason ?? submission.unlockReason}</p>
        </div>
      )}

      <MarkGrid
        action={saveMarksAction}
        submissionId={id}
        version={submission.version}
        max={sheet.maxMarks}
        bands={scale?.bands ?? []}
        editable={can.edit}
        rows={sheet.rows.map((r) => ({ studentId: r.studentId, admissionNo: r.admissionNo, name: r.name, studentStatus: r.studentStatus, status: r.mark && r.mark.status !== "SCORED" ? r.mark.status : "", score: r.mark?.score === null || r.mark?.score === undefined ? "" : String(r.mark.score) }))}
        labels={{
          student: t("marks.student"), score: t("marks.score"), mode: t("marks.mode"), scoreMode: t("marks.mode.score"), absent: t("marks.mode.absent"), exempt: t("marks.mode.exempt"), grade: t("marks.grade"),
          save: t("marks.saveDraft"), submit: t("marks.submit"), confirmSubmit: t("marks.confirmSubmit"), entered: t("marks.entered", { done: "{done}", total: "{total}" }),
          outOf: "", withdrawn: t("marks.withdrawn"), notEntered: t("marks.notEntered"), readOnly: t(`marks.readonly.${submission.status}` as never),
        }}
      />

      {(can.approve || can.return || can.lock || can.unlock) && (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {(can.approve || can.lock) && (
            <Card title={t("marks.review")}>
              <div className="flex flex-wrap gap-3">
                {can.approve && <ActionForm action={approveMarksAction} submitLabel={t("marks.approve")} className="space-y-0"><input type="hidden" name="id" value={id} /></ActionForm>}
                {can.lock && <ActionForm action={lockMarksAction} submitLabel={t("marks.lock")} className="space-y-0" confirm={t("marks.confirmLock")}><input type="hidden" name="id" value={id} /></ActionForm>}
              </div>
              <p className="mt-3 text-xs text-muted">{can.lock ? t("marks.lockHint") : t("marks.approveHint")}</p>
            </Card>
          )}
          {can.return && (
            <Card title={t("marks.return")}>
              <ActionForm action={returnMarksAction} submitLabel={t("marks.return")} tone="neutral">
                <input type="hidden" name="id" value={id} />
                <Field name="reason" type="textarea" label={t("marks.reason")} required rows={2} hint={t("marks.returnHint")} />
              </ActionForm>
            </Card>
          )}
          {can.unlock && (
            <Card title={t("marks.unlock")}>
              <ActionForm action={unlockMarksAction} submitLabel={t("marks.unlock")} tone="danger" confirm={t("marks.confirmUnlock")}>
                <input type="hidden" name="id" value={id} />
                <Field name="reason" type="textarea" label={t("marks.reason")} required rows={2} hint={t("marks.unlockHint")} />
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">{t("marks.history")}</h2>
          <DataTable head={[t("marks.when"), t("marks.student"), t("marks.from"), t("marks.to"), t("marks.by"), t("marks.reason")]}>
            {history.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap">{displayDateTime(h.at, school.timezone)}</Td>
                <Td>{h.student}</Td>
                <Td className="tabular-nums">{h.from}</Td>
                <Td className="tabular-nums">{h.to}</Td>
                <Td>{h.by}</Td>
                <Td>{h.reason ?? "—"}</Td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}
    </>
  );
}
