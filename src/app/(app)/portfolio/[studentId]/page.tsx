import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { studentPortfolio } from "@/server/portfolio";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field, inputClass } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import { FileList } from "@/components/learning/file-list";
import { addPortfolioAction, attachPortfolioFileAction, removePortfolioFileAction, reviewPortfolioAction } from "../actions";

export const metadata: Metadata = { title: "Portfolio" };
const fileInput = `${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-800`;

export default async function StudentPortfolioPage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["portfolio.manage"])) return <NoAccess t={t} />;
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  let d: Awaited<ReturnType<typeof studentPortfolio>>;
  try { d = await studentPortfolio(ctx, studentId); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  return (
    <>
      <Link href="/portfolio" className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft className="size-4" aria-hidden />{t("learn.pf.title")}</Link>
      <PageHeader title={d.student.name} subtitle={`${d.student.admissionNo} · ${t("learn.pf.title")}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {d.items.length === 0 && <EmptyState>{t("learn.pf.empty")}</EmptyState>}
          {d.items.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="display text-xl text-brand-950">{i.title}</h2>
                <Badge tone={i.status === "PENDING" ? "warn" : "ok"}>{t(i.status === "PENDING" ? "learn.pf.status.PENDING" : "learn.pf.status.PUBLISHED")}</Badge>
                {i.createdByStudent && <Badge tone="brand">{t("learn.pf.byStudent")}</Badge>}
                <span className="ml-auto text-sm text-muted">{displayDate(i.createdAt, ctx.locale)}</span>
              </div>
              {i.description && <p className="mt-2 whitespace-pre-line text-sm">{i.description}</p>}
              {i.teacherComment && <p className="mt-2 text-sm text-muted"><strong>{t("learn.pf.comment")}:</strong> {i.teacherComment}</p>}
              <div className="mt-3"><FileList files={i.files} remove={(f) => <ActionForm action={removePortfolioFileAction} submitLabel={t("common.remove")} inline tone="danger" className=""><input type="hidden" name="fileId" value={f.id} /></ActionForm>} /></div>
              <details className="mt-3 border-t border-line pt-3">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand-800">{i.status === "PENDING" ? t("learn.pf.review") : t("common.edit")}</summary>
                <div className="mt-3 space-y-4">
                  <ActionForm action={reviewPortfolioAction} hideSubmit className="space-y-3">
                    <input type="hidden" name="id" value={i.id} />
                    <Field name="comment" label={t("learn.pf.comment")} optionalLabel={t("learn.pf.removeNeedsNote")} defaultValue={i.teacherComment ?? ""} />
                    <div className="flex flex-wrap gap-2">
                      {i.status === "PENDING" && <SubmitButton intent="PUBLISH">{t("learn.pf.publish")}</SubmitButton>}
                      <SubmitButton intent="REMOVE" variant="danger" confirm={t("learn.pf.removeConfirm")}>{t("learn.pf.remove")}</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm action={attachPortfolioFileAction} submitLabel={t("learn.asg.attach")} className="space-y-2">
                    <input type="hidden" name="id" value={i.id} />
                    <input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" aria-label={t("learn.asg.file")} className={fileInput} />
                  </ActionForm>
                </div>
              </details>
            </Card>
          ))}
        </div>
        <Card title={t("learn.pf.add")}>
          <ActionForm action={addPortfolioAction} submitLabel={t("learn.pf.addSubmit")}>
            <input type="hidden" name="studentId" value={d.student.id} />
            <Field name="title" label={t("learn.title")} required />
            <Field name="description" type="textarea" rows={3} label={t("learn.pf.description")} optionalLabel={t("common.optional")} />
            <Field name="comment" label={t("learn.pf.comment")} optionalLabel={t("common.optional")} />
            <div>
              <label htmlFor="pf-file" className="mb-1 block text-sm font-medium">{t("learn.asg.file")} <span className="font-normal text-muted">({t("common.optional")})</span></label>
              <input id="pf-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={fileInput} />
              <p className="mt-1 text-sm text-muted">{t("learn.asg.fileHint")}</p>
            </div>
            <p className="text-sm text-muted">{t("learn.pf.addHint")}</p>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
