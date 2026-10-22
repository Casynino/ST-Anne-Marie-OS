import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Check, X } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { yearReadiness } from "@/server/year-readiness";
import { Card, EmptyState, NoAccess, PageHeader, segClass } from "@/components/ui";

export const metadata: Metadata = { title: "New year checklist" };

/** Is the new academic year ready? One list worked out from the records, with a link to where each thing is fixed. Nothing here is stored. */
export default async function ReadinessPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  const can = (p: Parameters<typeof ctx.permissions.has>[0]) => ctx.permissions.has(p);
  if (!can("progression.read") && !can("registration.read") && !can("school.settings.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const r = await yearReadiness(ctx, sp.year);
  if (!r.year) return <><PageHeader title={t("lc.ready.title")} /><EmptyState>{t("lc.noNextYear")}</EmptyState></>;

  return (
    <>
      <PageHeader title={t("lc.ready.title")} subtitle={t("lc.ready.sub", { year: r.year.name, prev: r.previous?.name ?? "—" })} actions={<Link href="/academic-setup" className="text-sm font-medium text-link hover:underline">{t("nav.academics")}</Link>} />
      <p role="status" className={`mb-4 text-sm font-medium ${r.ready ? "text-ok" : "text-warn"}`}>{r.ready ? t("lc.ready.yes") : t("lc.ready.no")}</p>
      {r.years.length > 1 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {r.years.map((y) => <li key={y.id}><Link href={`/academic-setup/readiness?year=${y.id}`} aria-current={y.id === r.year!.id ? "page" : undefined} className={segClass(y.id === r.year!.id)}>{y.name}</Link></li>)}
        </ul>
      )}
      <Card>
        <ul className="divide-y divide-line">
          {r.checks.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              {c.ok ? <Check className="size-4 shrink-0 text-ok" aria-hidden /> : c.warn ? <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden /> : <X className="size-4 shrink-0 text-bad" aria-hidden />}
              <span className="min-w-0 flex-1">{t(`lc.ready.${c.key}` as "lc.ready.terms")}</span>
              <span className="tabular-nums text-muted">{c.text ?? (c.n !== undefined ? (c.of !== undefined ? `${c.n} / ${c.of}` : c.n) : "")}</span>
              {c.href && !c.ok && <Link href={c.href} className="font-medium text-link hover:underline">{t("lc.ready.fix")}</Link>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
