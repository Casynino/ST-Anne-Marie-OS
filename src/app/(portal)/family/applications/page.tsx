import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { myApplications } from "@/server/application-fee";
import { Badge, EmptyState, LinkButton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "My applications" };

export default async function MyApplicationsPage() {
  const ctx = await requireContext();
  const t = await getT();
  const apps = await myApplications(ctx);
  return (
    <>
      <PageHeader title={t("apf.title")} subtitle={t("apf.subtitle")} actions={<LinkButton href="/apply/form" variant="secondary">{t("apf.another")}</LinkButton>} />
      {apps.length === 0 ? (
        <EmptyState><p>{t("apf.none")}</p></EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {apps.map((a) => (
            <li key={a.id}>
              <Link href={`/family/applications/${a.id}`} className="group flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] hover:border-brand-500">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lg font-semibold text-heading">{a.childName}</span>
                  <span className="block text-sm text-muted">{[a.className, a.applicationNo, displayDate(a.createdAt, ctx.locale)].filter(Boolean).join(" · ")}</span>
                  <span className="mt-1 inline-block"><Badge tone={a.draftStatus === "SUBMITTED" ? "ok" : a.draftStatus === "AWAITING_PAYMENT" ? "warn" : "neutral"}>{t(`apf.status.${a.draftStatus}` as "apf.status.SUBMITTED")}</Badge></span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
