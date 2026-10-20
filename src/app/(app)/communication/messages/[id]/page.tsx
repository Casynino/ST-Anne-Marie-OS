import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { getStaffThread } from "@/server/messaging";
import { getSchoolBasics } from "@/server/settings";
import { Badge, Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { CommunicationNav } from "@/components/communication-nav";
import { MessageList } from "@/components/message-thread";
import { assignThreadAction, dismissFlagAction, flagMessageAction, hideMessageAction, replyStaffAction, setThreadStatusAction, unhideMessageAction } from "../../actions";

export const metadata: Metadata = { title: "Conversation" };

export default async function StaffThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (ctx.userType !== "STAFF" || !hasAny(ctx, ["messages.read", "messages.moderate"])) return <NoAccess t={t} />;
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getStaffThread>>;
  try { d = await getStaffThread(ctx, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  const school = await getSchoolBasics(ctx.schoolId);
  const th = d.thread;
  return (
    <>
      <PageHeader title={th.subject} subtitle={`${d.guardianName} · ${th.studentName}`} actions={<><Link href="/communication/messages" className="text-sm font-medium text-brand-800 hover:underline">{t("msg.title")}</Link>{th.status === "CLOSED" && <Badge>{t("msg.closed")}</Badge>}</>} />
      <CommunicationNav ctx={ctx} t={t} current="/communication/messages" />
      <p className="mb-4 text-xs text-muted">{t("msg.reviewNotice")}</p>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <MessageList
            messages={d.messages} t={t} timezone={school.timezone}
            actions={(m) => (
              <details className="mt-2 text-xs">
                <summary className="min-h-9 cursor-pointer opacity-80">{t("msg.actions")}</summary>
                <div className="mt-2 space-y-2 rounded-lg bg-white p-2 text-ink">
                  {!m.mine && !m.hidden && (
                    <ActionForm action={flagMessageAction} submitLabel={t("msg.flag")} inline className="space-y-1"><input type="hidden" name="messageId" value={m.id} /><Field name="reason" label={t("marks.reason")} required /></ActionForm>
                  )}
                  {d.canModerate && !m.hidden && (
                    <ActionForm action={hideMessageAction} submitLabel={t("msg.hide")} inline tone="danger" className="space-y-1"><input type="hidden" name="messageId" value={m.id} /><Field name="reason" label={t("marks.reason")} required /></ActionForm>
                  )}
                  {d.canModerate && m.hidden && <ActionForm action={unhideMessageAction} submitLabel={t("msg.unhide")} inline className="space-y-0"><input type="hidden" name="messageId" value={m.id} /></ActionForm>}
                  {d.canModerate && m.flagged && <ActionForm action={dismissFlagAction} submitLabel={t("msg.dismissFlag")} inline className="space-y-0"><input type="hidden" name="messageId" value={m.id} /></ActionForm>}
                </div>
              </details>
            )}
          />
          {d.canReply ? (
            <ActionForm action={replyStaffAction} submitLabel={t("msg.send")} className="space-y-2">
              <input type="hidden" name="threadId" value={th.id} />
              <Field name="body" type="textarea" rows={3} label={t("msg.reply")} required />
            </ActionForm>
          ) : <p className="text-sm text-muted">{th.status === "CLOSED" ? t("msg.closedNote") : t("msg.cannotReply")}</p>}
        </div>
        <div className="space-y-4">
          {(d.participant || d.canModerate) && (
            <Card title={t("msg.manage")}>
              <ActionForm action={setThreadStatusAction} submitLabel={th.status === "OPEN" ? t("msg.close") : t("msg.reopen")} tone="neutral" className="space-y-0"><input type="hidden" name="threadId" value={th.id} /><input type="hidden" name="status" value={th.status === "OPEN" ? "CLOSED" : "OPEN"} /></ActionForm>
            </Card>
          )}
          {d.canModerate && (
            <Card title={t("msg.assign")}>
              <ActionForm action={assignThreadAction} submitLabel={t("msg.assignButton")} className="space-y-2">
                <input type="hidden" name="threadId" value={th.id} />
                <Field name="staffUserId" type="select" label={t("msg.assignTo")} options={d.assignable.map((u) => ({ value: u.id, label: u.fullName }))} placeholder={t("msg.office")} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
