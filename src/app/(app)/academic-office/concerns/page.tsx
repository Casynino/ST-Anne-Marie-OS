import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { listConcerns } from "@/server/concerns";
import { Badge, DataTable, EmptyState, NoAccess, PageHeader, Td, segClass } from "@/components/ui";

export const metadata: Metadata = { title: "Academic concerns" };
const TONE = { OPEN: "warn", IN_PROGRESS: "brand", RESOLVED: "ok", DISMISSED: "neutral" } as const;

export default async function ConcernsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("concern.manage") && !ctx.permissions.has("concern.flag")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const status = sp.status === "closed" || sp.status === "all" ? sp.status : "open";
  const rows = await listConcerns(ctx, { status });
  const manage = ctx.permissions.has("concern.manage");
  return (
    <>
      <PageHeader title={t("concern.title")} subtitle={manage ? t("concern.sub") : t("concern.subMine")} />
      <ul className="mb-4 flex flex-wrap gap-2">
        {(["open", "closed", "all"] as const).map((s) => <li key={s}><Link href={`/academic-office/concerns?status=${s}`} aria-current={status === s ? "page" : undefined} className={segClass(status === s)}>{t(`concern.filter.${s}` as "concern.filter.open")}</Link></li>)}
      </ul>
      {rows.length === 0 ? <EmptyState>{t("concern.none")}</EmptyState> : (
        <DataTable head={[t("learn.student"), t("concern.category"), t("concern.summary"), t("concern.flaggedBy"), t("task.col.assigned"), t("common.status")]}>
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-canvas">
              <Td><Link href={`/academic-office/concerns/${c.id}`} className="font-medium text-link hover:underline">{c.studentName}</Link><span className="block text-xs text-muted">{c.admissionNo}{c.className ? ` · ${c.className}` : ""}</span></Td>
              <Td>{t(`concern.cat.${c.category}` as "concern.cat.OTHER")}</Td>
              <Td className="max-w-xs">{c.summary}</Td>
              <Td className="whitespace-nowrap">{c.flaggedBy}<span className="block text-xs text-muted">{displayDate(c.flaggedAt, ctx.locale)}</span></Td>
              <Td>{c.assignedTo ?? "—"}</Td>
              <Td><Badge tone={TONE[c.status as keyof typeof TONE]}>{t(`concern.status.${c.status}` as "concern.status.OPEN")}</Badge>{c.shareWithParent && <span className="ml-1"><Badge tone="brand">{t("concern.shared")}</Badge></span>}</Td>
            </tr>
          ))}
        </DataTable>
      )}
    </>
  );
}
