import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireContext, getT } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDateTime } from "@/lib/dates";
import { getSchoolBasics } from "@/server/settings";
import { getConcern } from "@/server/concerns";
import { assignableStaff } from "@/server/workflow";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { assignConcernAction, concernActionAction, resolveConcernAction, shareConcernAction } from "../../actions";

export const metadata: Metadata = { title: "Academic concern" };
const TONE = { OPEN: "warn", IN_PROGRESS: "brand", RESOLVED: "ok", DISMISSED: "neutral" } as const;
const hid = (v: string) => <input type="hidden" name="id" value={v} />;

export default async function ConcernPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("concern.manage") && !ctx.permissions.has("concern.flag")) return <NoAccess t={t} />;
  const { id } = await params;
  const data = await getConcern(ctx, id).catch((e) => (e instanceof AppError && e.code === "NOT_FOUND" ? null : Promise.reject(e)));
  if (!data) notFound();
  const { concern: c, actions } = data;
  const school = await getSchoolBasics(ctx.schoolId);
  const manage = ctx.permissions.has("concern.manage");
  const open = c.status === "OPEN" || c.status === "IN_PROGRESS";
  const staff = manage ? await assignableStaff(ctx).catch(() => []) : [];
  return (
    <>
      <PageHeader title={c.studentName} subtitle={`${c.admissionNo}${c.className ? ` · ${c.className}` : ""} · ${t(`concern.cat.${c.category}` as "concern.cat.OTHER")}`} actions={<span className="flex items-center gap-2"><Badge tone={TONE[c.status as keyof typeof TONE]}>{t(`concern.status.${c.status}` as "concern.status.OPEN")}</Badge><Link href={`/students/${c.studentId}`} className="text-sm font-medium text-link hover:underline">{t("concern.student")}</Link></span>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Card title={t("concern.summary")}>
            <p className="text-sm">{c.summary}</p>
            {c.notes && <><h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">{t("concern.notes")}</h3><p className="whitespace-pre-line text-sm">{c.notes}</p></>}
            <p className="mt-3 text-xs text-muted">{t("concern.flaggedBy")}: {c.flaggedBy} · {displayDateTime(c.flaggedAt, school.timezone, ctx.locale)}{c.assignedTo ? ` · ${t("task.col.assigned")}: ${c.assignedTo}` : ""}</p>
            {c.resolution && <p className="mt-3 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">{t("concern.resolution")}: {c.resolution}</p>}
          </Card>
          <Card title={t("concern.log")}>
            {actions.length === 0 ? <p className="text-sm text-muted">{t("concern.log.none")}</p> : (
              <ol className="space-y-2 text-sm">{actions.map((a) => <li key={a.id}><Badge>{t(`concern.act.${a.kind}` as "concern.act.NOTE")}</Badge> <span className="text-muted">{displayDateTime(a.createdAt, school.timezone, ctx.locale)} · {a.by}</span><p>{a.note}</p></li>)}</ol>
            )}
          </Card>
        </div>
        {manage && open && (
          <aside className="space-y-5">
            <Card title={t("concern.addAction")}>
              <ActionForm action={concernActionAction} submitLabel={t("common.save")} className="space-y-3">{hid(c.id)}
                <Field name="kind" type="select" label={t("concern.act.kind")} options={(["NOTE", "MEETING", "PARENT_CONTACT", "SUPPORT_PLAN"] as const).map((k) => ({ value: k, label: t(`concern.act.${k}` as "concern.act.NOTE") }))} defaultValue="NOTE" />
                <Field name="note" type="textarea" rows={3} label={t("task.note")} required />
              </ActionForm>
            </Card>
            <Card title={t("task.col.assigned")}>
              <ActionForm action={assignConcernAction} submitLabel={t("task.assign")} className="space-y-3">{hid(c.id)}<Field name="userId" type="select" label={t("task.col.assigned")} options={staff.map((u) => ({ value: u.id, label: u.fullName }))} defaultValue={c.assignedToId ?? ""} placeholder={t("task.unassigned")} /></ActionForm>
            </Card>
            <Card title={t("concern.share")}>
              <p className="mb-2 text-sm text-muted">{t("concern.share.hint")}</p>
              {c.shareWithParent && <p className="mb-2 rounded-lg bg-tint px-3 py-2 text-sm">{c.parentMessage}</p>}
              <ActionForm action={shareConcernAction} submitLabel={t("concern.share")} className="space-y-3">{hid(c.id)}<Field name="message" type="textarea" rows={3} label={t("concern.share.message")} defaultValue={c.parentMessage ?? ""} required /></ActionForm>
            </Card>
            <Card title={t("concern.resolve")}>
              <ActionForm action={resolveConcernAction} submitLabel={t("concern.resolve")} className="space-y-3">{hid(c.id)}
                <Field name="outcome" type="select" label={t("common.status")} options={[{ value: "RESOLVED", label: t("concern.status.RESOLVED") }, { value: "DISMISSED", label: t("concern.status.DISMISSED") }]} defaultValue="RESOLVED" />
                <Field name="resolution" type="textarea" rows={3} label={t("concern.resolution")} required />
              </ActionForm>
            </Card>
          </aside>
        )}
      </div>
    </>
  );
}
