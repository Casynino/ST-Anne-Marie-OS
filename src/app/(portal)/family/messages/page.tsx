import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listMyThreads } from "@/server/messaging";
import { getSchoolBasics } from "@/server/settings";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Messages" };

export default async function FamilyMessagesPage() {
  const ctx = await requireContext();
  const t = await getT();
  const [rows, school] = await Promise.all([listMyThreads(ctx), getSchoolBasics(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("msg.title")} subtitle={t("fam.messages.subtitle")} actions={<Link href="/family/messages/new" className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">{t("fam.messages.new")}</Link>} />
      {rows.length === 0 ? <EmptyState>{t("fam.messages.empty")}</EmptyState> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}><Link href={`/family/messages/${r.id}`} className="flex min-h-16 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 hover:border-brand-400">
              <span className="min-w-0"><span className={`block truncate ${r.unread ? "font-bold" : "font-medium"}`}>{r.subject}</span><span className="block text-sm text-muted">{r.withName} · {r.studentName}</span></span>
              <span className="flex items-center gap-2 text-xs text-muted">{r.status === "CLOSED" && <Badge>{t("msg.closed")}</Badge>}{r.unread && <Badge tone="brand">{t("msg.new.badge")}</Badge>}{displayDateTime(r.lastMessageAt, school.timezone)}</span>
            </Link></li>
          ))}
        </ul>
      )}
    </>
  );
}
