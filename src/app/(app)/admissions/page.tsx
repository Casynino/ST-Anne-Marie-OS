import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requireContext, getT } from "@/lib/auth/next";
import { displayDate, displayDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/finance/money";
import { getSchoolBasics } from "@/server/settings";
import { listApplications } from "@/server/admissions";
import { admissionOverview, STAGES } from "@/server/admission-queues";
import { AdmissionsNav } from "@/components/admissions/subnav";
import { Badge, DataTable, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Admissions" };
type Search = { q?: string; status?: string; stage?: string; source?: string; page?: string };
const TONE = { APPLIED: "neutral", INTERVIEW: "warn", ACCEPTED: "brand", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;
const PAY_TONE = { NOT_REQUIRED: "neutral", AWAITING_PAYMENT: "bad", VERIFICATION_PENDING: "warn", PARTIAL: "warn", PAID: "ok", WAIVED: "brand" } as const;
const STATUSES = ["APPLIED", "INTERVIEW", "ACCEPTED", "ENROLLED", "REJECTED", "WITHDRAWN"] as const;

export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!ctx.permissions.has("admission.read")) return <NoAccess t={t} />;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ items, total, pageSize, counts }, overview, school] = await Promise.all([listApplications(ctx, { q: sp.q, status: sp.status, stage: sp.stage, source: sp.source, page }), admissionOverview(ctx), getSchoolBasics(ctx.schoolId)]);
  const stageChips = (STAGES as readonly string[]).filter((s) => s !== "online" && s !== "physical" && s !== "incomplete" && s !== "passed" && s !== "not_passed");
  const chip = (href: string, active: boolean, label: string, n?: number) => (
    <li key={href}>
      <Link href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm ${active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface hover:bg-canvas"}`}>
        {label} {n !== undefined && <span className="tabular-nums opacity-80">{n}</span>}
      </Link>
    </li>
  );

  return (
    <>
      <PageHeader title={t("adm.title")} actions={ctx.permissions.has("admission.create") ? <LinkButton href="/admissions/new"><Plus className="size-4" aria-hidden /> {t("adm.new")}</LinkButton> : undefined} />
      <AdmissionsNav ctx={ctx} t={t} current="/admissions" />
      <ul className="mb-3 flex flex-wrap gap-2">
        {chip("/admissions", !sp.status && !sp.stage && !sp.source, t("adm.stage.all"), overview.received.total)}
        {STATUSES.map((s) => chip(`/admissions?status=${s}`, sp.status === s, t(`adm.status.${s}`), counts[s] ?? 0))}
      </ul>
      <ul className="mb-4 flex flex-wrap gap-2" aria-label={t("adm.q.title")}>
        {stageChips.map((s) => chip(`/admissions?stage=${s}`, sp.stage === s, t(`adm.stage.${s}` as "adm.stage.new"), overview.stages[s as keyof typeof overview.stages]))}
      </ul>
      <FilterBar t={t} resetHref="/admissions">
        <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("adm.search")} className="min-w-56 flex-1" />
        <Field name="status" label={t("common.status")} type="select" defaultValue={sp.status} placeholder={t("common.all")} options={STATUSES.map((s) => ({ value: s, label: t(`adm.status.${s}`) }))} />
        <Field name="source" label={t("adm.channel")} type="select" defaultValue={sp.source} placeholder={t("common.all")} options={[{ value: "ONLINE", label: t("adm.channel.ONLINE") }, { value: "STAFF", label: t("adm.channel.STAFF") }]} />
      </FilterBar>
      {items.length === 0 ? (
        <EmptyState>{t("adm.none")}</EmptyState>
      ) : (
        <DataTable head={[t("adm.applicant"), t("adm.applicationNo"), t("adm.classApplied"), t("adm.guardian"), t("adm.appliedOn"), t("adm.col.interview"), t("adm.col.payment"), t("common.status")]}>
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-canvas">
              <Td><Link href={`/admissions/${a.id}`} className="font-medium text-link hover:underline">{a.firstName} {a.lastName}</Link><span className="ml-2 align-middle"><Badge tone={a.source === "ONLINE" ? "brand" : "neutral"}>{t(`adm.channel.${a.source}` as "adm.channel.ONLINE")}</Badge></span>{a.reviewStatus === "RETURNED" && <span className="ml-1 align-middle"><Badge tone="bad">{t("adm.review.RETURNED")}</Badge></span>}</Td>
              <Td className="whitespace-nowrap tabular-nums">{a.applicationNo}</Td>
              <Td>{a.className ?? "—"}</Td>
              <Td>{a.primaryGuardian?.fullName ?? "—"}</Td>
              <Td className="whitespace-nowrap">{displayDate(a.createdAt, ctx.locale)}</Td>
              <Td className="whitespace-nowrap">{a.interviewAt ? displayDateTime(a.interviewAt, school.timezone, ctx.locale) : "—"}</Td>
              <Td className="whitespace-nowrap">{a.account ? <Badge tone={PAY_TONE[a.account.status]}>{t(`adm.pay.status.${a.account.status}` as "adm.pay.status.PAID")}{a.account.requiredCents > 0 ? ` · ${formatMoney(a.account.verifiedCents, school.currency)}` : ""}</Badge> : "—"}</Td>
              <Td><Badge tone={TONE[a.status]}>{t(`adm.status.${a.status}`)}</Badge></Td>
            </tr>
          ))}
        </DataTable>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} basePath="/admissions" params={{ q: sp.q, status: sp.status, stage: sp.stage, source: sp.source }} t={t} />
    </>
  );
}
