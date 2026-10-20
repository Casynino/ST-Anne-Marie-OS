import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listMyNotifications } from "@/server/notifications";
import { getSchoolBasics } from "@/server/settings";
import { EmptyState, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/form";
import { markAllReadAction, markReadAction } from "../actions";

export const metadata: Metadata = { title: "Inbox" };

export default async function FamilyInboxPage() {
  const ctx = await requireContext();
  const t = await getT();
  const [items, school] = await Promise.all([listMyNotifications(ctx), getSchoolBasics(ctx.schoolId)]);
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <>
      <PageHeader title={t("fam.inbox")} subtitle={t("fam.inbox.subtitle")} actions={unread > 0 ? <ActionForm action={markAllReadAction} submitLabel={t("fam.inbox.markAll")} inline className="space-y-0" /> : undefined} />
      {items.length === 0 ? <EmptyState>{t("fam.inbox.empty")}</EmptyState> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`rounded-xl border px-4 py-3 ${n.readAt ? "border-line bg-surface" : "border-brand-300 bg-tint"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className={n.readAt ? "font-medium" : "font-bold"}>{n.title}</p>
                <span className="text-xs text-muted">{displayDateTime(n.createdAt, school.timezone)}</span>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{n.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {n.link && <Link href={n.link} className="text-sm font-semibold text-link hover:underline">{t("common.view")}</Link>}
                {!n.readAt && <ActionForm action={markReadAction} submitLabel={t("fam.inbox.markRead")} inline className="space-y-0"><input type="hidden" name="id" value={n.id} /></ActionForm>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
