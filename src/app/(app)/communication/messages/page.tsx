import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { countStaffAttention, listStaffThreads } from "@/server/messaging";
import { getSchoolBasics } from "@/server/settings";
import { Badge, EmptyState, NoAccess, PageHeader, segClass } from "@/components/ui";
import { CommunicationNav } from "@/components/communication-nav";

export const metadata: Metadata = { title: "Messages" };

export default async function StaffMessagesPage({ searchParams }: { searchParams: Promise<{ box?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (ctx.userType !== "STAFF" || !hasAny(ctx, ["messages.read", "messages.moderate"])) return <NoAccess t={t} />;
  const moderator = hasAny(ctx, ["messages.moderate"]);
  const sp = await searchParams;
  const boxes = (moderator ? ["mine", "office", "flagged", "all"] : ["mine"]) as ("mine" | "office" | "flagged" | "all")[];
  const box = boxes.find((b) => b === sp.box) ?? "mine";
  const [rows, attention, school] = await Promise.all([listStaffThreads(ctx, { box }), countStaffAttention(ctx), getSchoolBasics(ctx.schoolId)]);
  return (
    <>
      <PageHeader title={t("msg.title")} subtitle={t("msg.staff.subtitle")} actions={hasAny(ctx, ["messages.send"]) && <Link href="/communication/messages/new" className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800 btn-primary">{t("msg.new")}</Link>} />
      <CommunicationNav ctx={ctx} t={t} current="/communication/messages" attention={attention} />
      {boxes.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("msg.title")}>
          {boxes.map((b) => <Link key={b} href={`/communication/messages?box=${b}`} aria-current={box === b ? "page" : undefined} className={segClass(box === b)}>{t(`msg.box.${b}` as never)}</Link>)}
        </nav>
      )}
      {rows.length === 0 ? <EmptyState>{t("msg.empty")}</EmptyState> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/communication/messages/${r.id}`} className="flex min-h-16 flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-3 hover:border-brand-400">
                <span className="min-w-0"><span className={`block truncate ${r.unread ? "font-bold" : "font-medium"}`}>{r.subject}</span><span className="block text-sm text-muted">{r.withName} · {r.studentName}</span></span>
                <span className="flex items-center gap-2 text-xs text-muted">{r.flagged && <Badge tone="bad">{t("msg.flaggedBadge")}</Badge>}{r.office && <Badge>{t("msg.office")}</Badge>}{r.status === "CLOSED" && <Badge>{t("msg.closed")}</Badge>}{r.unread && <Badge tone="brand">{t("msg.new.badge")}</Badge>}{displayDateTime(r.lastMessageAt, school.timezone)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
