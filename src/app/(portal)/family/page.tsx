import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { myChildren } from "@/server/portal";
import { listPublicNews } from "@/server/website";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Family portal" };

export default async function FamilyHome() {
  const ctx = await requireContext();
  const t = await getT();
  const children = await myChildren(ctx);
  if (children.length === 1) redirect(`/family/${children[0]!.id}`);
  const news = await listPublicNews(ctx.schoolId, { limit: 3 });
  return (
    <>
      <PageHeader title={t("fam.welcome", { name: ctx.fullName.split(" ")[0] ?? ctx.fullName })} subtitle={t("fam.home.subtitle")} />
      {children.length === 0 ? (
        <EmptyState>{t("fam.noChildren")}</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {children.map((c) => (
            <li key={c.id}>
              <Link href={`/family/${c.id}`} className="flex min-h-20 items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-brand-400">
                <span className="min-w-0"><span className="block truncate text-base font-semibold">{c.name}</span><span className="block text-sm text-muted">{c.className ? `${c.className}${c.streamName ? ` ${c.streamName}` : ""}` : t("fam.notPlaced")} · {c.admissionNo}</span>{c.status !== "ENROLLED" && <Badge>{t(`student.status.${c.status}` as never)}</Badge>}</span>
                <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {news.items.length > 0 && (
        <Card title={t("fam.notices")} className="mt-6">
          <ul className="divide-y divide-line">
            {news.items.map((n) => (
              <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                <Link href={`/news/${n.slug ?? n.id}`} className="font-medium text-link hover:underline">{n.title}</Link>
                <p className="text-xs text-muted">{displayDate(n.publishedAt, ctx.locale)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
