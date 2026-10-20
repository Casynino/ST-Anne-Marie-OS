import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDate } from "@/lib/dates";
import { childPortfolio } from "@/server/portfolio";
import { childOrThrow } from "@/server/portal";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionForm, Field, inputClass } from "@/components/form";
import { FileList } from "@/components/learning/file-list";
import { addMyPortfolioAction, removeMyPortfolioFileAction } from "../../actions";

export const metadata: Metadata = { title: "Portfolio" };

export default async function ChildPortfolioPage({ params }: { params: Promise<{ studentId: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { studentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) notFound();
  try {
    const child = await childOrThrow(ctx, studentId);
    const d = await childPortfolio(ctx, studentId);
    return (
      <>
        <Link href={`/family/${studentId}`} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"><ArrowLeft className="size-4" aria-hidden />{child.name}</Link>
        <PageHeader title={t("learn.pf.title")} subtitle={child.name} />
        {d.items.length === 0 ? <EmptyState>{t("learn.pf.familyEmpty")}</EmptyState> : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {d.items.map((i) => {
              const images = i.files.filter((f) => f.mimeType.startsWith("image/"));
              const others = i.files.filter((f) => !f.mimeType.startsWith("image/"));
              return (
                <li key={i.id} className="overflow-hidden rounded-3xl border border-line bg-white shadow-[var(--shadow-card)]">
                  {images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a href={`/api/learning/files/${images[0].id}`} target="_blank" rel="noopener"><img src={`/api/learning/files/${images[0].id}`} alt={i.title} loading="lazy" className="aspect-[4/3] w-full bg-canvas object-cover" /></a>
                  )}
                  <div className="p-4">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="display text-lg text-brand-950">{i.title}</h2>{i.status === "PENDING" && <Badge tone="warn">{t("learn.pf.status.PENDING")}</Badge>}</div>
                    <p className="text-xs text-muted">{displayDate(i.publishedAt ?? i.createdAt, ctx.locale)}{i.subjectName ? ` · ${i.subjectName}` : ""}</p>
                    {i.description && <p className="mt-2 whitespace-pre-line text-sm">{i.description}</p>}
                    {i.teacherComment && <p className="mt-2 rounded-xl bg-brand-50 px-3 py-2 text-sm"><strong>{t("learn.pf.comment")}:</strong> {i.teacherComment}</p>}
                    {(others.length > 0 || images.length > 1) && <div className="mt-3"><FileList files={[...images.slice(1), ...others]} /></div>}
                    {d.canAdd && i.status === "PENDING" && <div className="mt-3"><FileList files={images.slice(0, 1)} remove={(f) => <ActionForm action={removeMyPortfolioFileAction} submitLabel={t("common.remove")} inline tone="danger" className=""><input type="hidden" name="fileId" value={f.id} /></ActionForm>} /></div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {d.canAdd && (
          <Card title={t("learn.pf.addMine")} className="mt-6">
            <ActionForm action={addMyPortfolioAction} submitLabel={t("learn.pf.sendForReview")}>
              <Field name="title" label={t("learn.title")} required />
              <Field name="description" type="textarea" rows={3} label={t("learn.pf.description")} optionalLabel={t("common.optional")} />
              <div>
                <label htmlFor="pf-files" className="mb-1 block text-sm font-medium">{t("learn.fam.files")} <span className="font-normal text-muted">({t("common.optional")})</span></label>
                <input id="pf-files" name="file" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-800`} />
                <p className="mt-1 text-sm text-muted">{t("learn.fam.filesHint")}</p>
              </div>
              <p className="text-sm text-muted">{t("learn.pf.teacherReviews")}</p>
            </ActionForm>
          </Card>
        )}
      </>
    );
  } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
}
