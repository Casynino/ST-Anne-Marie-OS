import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { myChildren } from "@/server/portal";
import { myApplications } from "@/server/application-fee";
import { getSchoolBasics } from "@/server/settings";
import { listPublicNews } from "@/server/website";
import { DashHero, Hi } from "@/components/dash/hero";
import { Avatar, DashSection, EmptyLine, Panel, Pill } from "@/components/dash/parts";

export const metadata: Metadata = { title: "Family portal" };

export default async function FamilyHome() {
  const ctx = await requireContext();
  const t = await getT();
  const children = await myChildren(ctx);
  if (children.length === 1) redirect(`/family/${children[0]!.id}`);
  // A family that has only applied (no child enrolled yet) lands on its applications.
  if (children.length === 0 && (await myApplications(ctx)).length > 0) redirect("/family/applications");
  const [news, school] = await Promise.all([listPublicNews(ctx.schoolId, { limit: 3 }), getSchoolBasics(ctx.schoolId)]);
  const first = ctx.fullName.split(" ")[0] ?? ctx.fullName;
  return (
    <>
      <DashHero photoIndex={2} eyebrow={`${school.name} · ${t("fam.portal")}`.toUpperCase()} title={t("fam.welcome", { name: first })}>
        {children.length > 0 ? <><Hi>{children.length}</Hi> {t("fam.hero.children")}</> : t("fam.noChildren")}
      </DashHero>
      <DashSection id="children" title={t("fam.children.title")} subtitle={t("fam.home.subtitle")}>
        {children.length === 0 ? (
          <EmptyLine>{t("fam.noChildren")}</EmptyLine>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {children.map((c) => (
              <li key={c.id}>
                <Link href={`/family/${c.id}`} className="group flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]">
                  <Avatar name={c.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-semibold text-heading">{c.name}</span>
                    <span className="block text-sm text-muted">{c.className ? `${c.className}${c.streamName ? ` ${c.streamName}` : ""}` : t("fam.notPlaced")} · {c.admissionNo}</span>
                    {c.status !== "ENROLLED" && <span className="mt-1 inline-block"><Pill>{t(`student.status.${c.status}` as never)}</Pill></span>}
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DashSection>
      {news.items.length > 0 && (
        <DashSection id="notices" title={t("fam.notices")}>
          <Panel title={t("fam.notices")} right={<Link href="/news" className="text-sm font-semibold text-link hover:underline">{t("dash.table.viewAll")}</Link>}>
            <ul className="divide-y divide-line">
              {news.items.map((n) => (
                <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/news/${n.slug ?? n.id}`} className="font-semibold text-link hover:underline">{n.title}</Link>
                  <p className="text-xs text-muted">{displayDate(n.publishedAt, ctx.locale)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        </DashSection>
      )}
    </>
  );
}
