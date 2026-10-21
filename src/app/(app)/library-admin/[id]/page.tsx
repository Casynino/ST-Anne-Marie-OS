import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { displayDate, displayDateTime } from "@/lib/dates";
import { humanSize } from "@/lib/library/files";
import { getLibrarySettings } from "@/server/library-settings";
import { getManageResource, libraryFormOptions } from "@/server/library";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";
import { ResourceFields } from "@/components/library/resource-form";
import { approveResourceAction, archiveResourceAction, publishResourceAction, replaceFileAction, restoreResourceAction, returnResourceAction, submitResourceAction, updateResourceAction } from "../actions";

export const metadata: Metadata = { title: "Library resource" };
const TONE = { DRAFT: "neutral", PENDING_REVIEW: "warn", APPROVED: "brand", PUBLISHED: "ok", ARCHIVED: "neutral" } as const;

export default async function ManageResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx, t] = await Promise.all([params, requireContext(), getT()]);
  const r = await getManageResource(ctx, id).catch((e) => (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN") ? null : Promise.reject(e)));
  if (!r) notFound();
  const can = (p: string) => ctx.permissions.has(p as never);
  const settings = await getLibrarySettings(db, ctx.schoolId);
  const school = await getSchoolBasics(ctx.schoolId);
  const own = r.createdById === ctx.userId;
  const anyone = can("library.manage") || can("library.publish");
  const editable = r.status !== "ARCHIVED" && ((own && can("library.upload") && r.status === "DRAFT") || anyone);
  const o = editable ? await libraryFormOptions(ctx) : null;
  const id1 = <input type="hidden" name="id" value={id} />;
  const status = r.status;
  return (
    <>
      <PageHeader title={r.title} subtitle={`${r.category.name} · ${t(`lib.aud.${r.audience}` as "lib.aud.PUBLIC")}`} actions={<Badge tone={TONE[status]}>{t(`lib.status.${status}` as "lib.status.DRAFT")}</Badge>} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={t("lib.w.title")}>
            <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{t("lib.w.uploadedBy")}</dt><dd>{r.createdBy ?? "—"} · {displayDate(r.createdAt, ctx.locale)}</dd></div>
              {r.reviewedBy && <div><dt className="text-muted">{t("lib.w.reviewedBy")}</dt><dd>{r.reviewedBy}{r.reviewedAt ? ` · ${displayDate(r.reviewedAt, ctx.locale)}` : ""}</dd></div>}
              {r.publishedBy && <div><dt className="text-muted">{t("lib.w.publishedBy")}</dt><dd>{r.publishedBy}{r.publishedAt ? ` · ${displayDate(r.publishedAt, ctx.locale)}` : ""}</dd></div>}
              {r.reviewNote && <div className="sm:col-span-2"><dt className="text-muted">{t("lib.w.note")}</dt><dd className="whitespace-pre-line">{r.reviewNote}</dd></div>}
            </dl>
            <div className="flex flex-wrap gap-3">
              {status === "DRAFT" && (own || can("library.manage")) && <ActionForm action={submitResourceAction} submitLabel={settings.requireApproval ? t("lib.w.submit") : t("lib.w.submit.noApproval")} inline>{id1}</ActionForm>}
              {(status === "APPROVED" || (status === "DRAFT" && !settings.requireApproval)) && can("library.publish") && <ActionForm action={publishResourceAction} submitLabel={t("lib.w.publish")} confirm={t("common.confirmAction")}>{id1}</ActionForm>}
              {status === "PENDING_REVIEW" && can("library.review") && !own && <ActionForm action={approveResourceAction} submitLabel={t("lib.w.approve")}>{id1}</ActionForm>}
              {status === "ARCHIVED" && can("library.publish") && <ActionForm action={restoreResourceAction} submitLabel={t("lib.w.restore")} inline>{id1}</ActionForm>}
            </div>
            {status === "PENDING_REVIEW" && can("library.review") && !own && (
              <ActionForm action={returnResourceAction} submitLabel={t("lib.w.return")} tone="danger" className="mt-4 space-y-2 border-t border-line pt-4">{id1}<Field name="note" label={t("lib.w.return.note")} required /></ActionForm>
            )}
            {status === "PENDING_REVIEW" && own && <p className="mt-3 text-sm text-muted">{t("lib.w.waiting")}</p>}
            {status !== "ARCHIVED" && can("library.publish") && (
              <ActionForm action={archiveResourceAction} submitLabel={t("lib.w.archive")} tone="danger" confirm={t("common.confirmAction")} className="mt-4 space-y-2 border-t border-line pt-4">{id1}<Field name="reason" label={t("lib.w.archive.reason")} optionalLabel={t("common.optional")} /></ActionForm>
            )}
          </Card>

          <Card title={t("lib.m.details")}>
            {editable && o ? (
              <ActionForm action={updateResourceAction} submitLabel={t("common.save")}>
                {id1}
                <ResourceFields t={t} o={o} canFeature={anyone} allowIdOnly={settings.allowIdOnly} d={{ title: r.title, description: r.description, categoryId: r.categoryId, language: r.language, author: r.author, academicYearId: r.academicYearId, audience: r.audience, idOnly: r.idOnly, featured: r.featured, availableFrom: r.availableFrom, copyright: r.copyright, classIds: r.classes.map((c) => c.classId), subjectIds: r.subjects.map((c) => c.subjectId), staffIds: r.staff.map((c) => c.staffId) }} />
                <div>
                  <label htmlFor="cover" className="mb-1 block text-sm font-medium">{t("lib.m.cover")} <span className="font-normal text-muted">({t("common.optional")})</span></label>
                  <input id="cover" name="cover" type="file" accept="image/jpeg,image/png,image/webp" className="block min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
                </div>
              </ActionForm>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="sm:col-span-2"><dt className="text-muted">{t("lib.m.description")}</dt><dd className="whitespace-pre-line">{r.description ?? "—"}</dd></div>
                <div><dt className="text-muted">{t("lib.m.audience")}</dt><dd>{t(`lib.aud.${r.audience}` as "lib.aud.PUBLIC")}</dd></div>
                <div><dt className="text-muted">{t("lib.f.class")}</dt><dd>{r.classNames.map((c) => c.name).join(", ") || "—"}</dd></div>
                <div><dt className="text-muted">{t("lib.f.subject")}</dt><dd>{r.subjectNames.map((c) => c.name).join(", ") || "—"}</dd></div>
                {r.audience === "RESTRICTED" && <div><dt className="text-muted">{t("lib.m.staff")}</dt><dd>{r.staffNames.map((c) => c.name).join(", ") || "—"}</dd></div>}
              </dl>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title={t("lib.f.file")}>
            <ul className="divide-y divide-line text-sm">
              {r.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="block break-words font-medium">v{v.version} · {v.fileName}</span><span className="text-muted">{humanSize(v.sizeBytes)} · {v.uploadedBy ?? "—"} · {displayDateTime(v.createdAt, school.timezone, ctx.locale)}{v.note ? ` · ${v.note}` : ""}</span></span>
                  <span className="flex items-center gap-2">{v.isCurrent && <Badge tone="ok">{t("lib.m.current")}</Badge>}<a href={`/api/library/files/${id}?v=${v.version}&download=1`} className="inline-flex min-h-11 items-center gap-1 text-link hover:underline"><Download className="size-4" aria-hidden />{t("lib.download")}</a></span>
                </li>
              ))}
            </ul>
            {editable && (
              <ActionForm action={replaceFileAction} submitLabel={t("lib.m.replace")} className="mt-4 space-y-3 border-t border-line pt-4">
                {id1}
                <div><label htmlFor="rf" className="mb-1 block text-sm font-medium">{t("lib.m.replace.file")}</label><input id="rf" name="file" type="file" required accept=".pdf,.docx,.pptx,.xlsx,image/jpeg,image/png,image/webp" className="block min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" /></div>
                <Field name="note" label={t("lib.m.replace.note")} optionalLabel={t("common.optional")} />
              </ActionForm>
            )}
          </Card>
          <Card title={t("lib.m.use")}>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted">{t("lib.m.views")}</dt><dd className="text-xl font-semibold tabular-nums">{r.use.views}</dd></div><div><dt className="text-muted">{t("lib.m.downloads")}</dt><dd className="text-xl font-semibold tabular-nums">{r.use.downloads}</dd></div></dl>
            <p className="mt-2 text-xs text-muted">{t("lib.m.use.note")}</p>
          </Card>
        </div>
      </div>
    </>
  );
}
