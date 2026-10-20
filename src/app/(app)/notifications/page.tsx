import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listMyNotifications } from "@/server/notifications";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm } from "@/components/form";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { markNotificationReadAction } from "../attendance/actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireContext();
  const t = await getT();
  const [items, school] = await Promise.all([listMyNotifications(ctx), getSchoolBasics(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("notif.title")} />
      {items.length === 0 ? (
        <EmptyState>{t("notif.empty")}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{n.title} {!n.readAt && <Badge tone="brand">•</Badge>}</p>
                <span className="text-xs text-muted">{displayDateTime(n.createdAt, school.timezone, ctx.locale)}</span>
              </div>
              <p className="mt-1 text-sm">{n.body}</p>
              {!n.readAt && (
                <ActionForm action={markNotificationReadAction} inline submitLabel={t("notif.markRead")} className="mt-2">
                  <input type="hidden" name="id" value={n.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
