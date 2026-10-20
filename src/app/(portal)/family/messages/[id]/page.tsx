import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { requireContext, getT } from "@/lib/auth/next";
import { getMyThread } from "@/server/messaging";
import { getSchoolBasics } from "@/server/settings";
import { Badge, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { MessageList } from "@/components/message-thread";
import { flagFamilyMessageAction, replyMessageAction } from "../../actions";

export const metadata: Metadata = { title: "Conversation" };

export default async function FamilyThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let d: Awaited<ReturnType<typeof getMyThread>>;
  try { d = await getMyThread(ctx, id); } catch (e) { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound(); throw e; }
  const school = await getSchoolBasics(ctx.schoolId);
  const th = d.thread;
  return (
    <>
      <Link href="/family/messages" className="mb-3 inline-flex min-h-11 items-center text-sm font-medium text-brand-800 hover:underline">{t("msg.title")}</Link>
      <PageHeader title={th.subject} subtitle={`${th.withName} · ${th.studentName}`} actions={th.status === "CLOSED" ? <Badge>{t("msg.closed")}</Badge> : undefined} />
      <div className="space-y-4">
        <MessageList messages={d.messages} t={t} timezone={school.timezone} actions={(m) => !m.mine && !m.hidden ? (
          <details className="mt-2 text-xs"><summary className="min-h-9 cursor-pointer opacity-80">{t("msg.report")}</summary>
            <ActionForm action={flagFamilyMessageAction} submitLabel={t("msg.flag")} inline className="mt-2 space-y-1"><input type="hidden" name="messageId" value={m.id} /><Field name="reason" label={t("marks.reason")} required /></ActionForm>
          </details>
        ) : null} />
        {th.status === "OPEN" ? (
          <ActionForm action={replyMessageAction} submitLabel={t("msg.send")} className="space-y-2">
            <input type="hidden" name="threadId" value={th.id} />
            <Field name="body" type="textarea" rows={3} label={t("msg.reply")} required hint={t("fam.messages.privacy")} />
          </ActionForm>
        ) : <p className="text-sm text-muted">{t("fam.messages.closedNote")}</p>}
      </div>
    </>
  );
}
