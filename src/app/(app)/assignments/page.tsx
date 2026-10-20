import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDateTime } from "@/lib/dates";
import { listAssignments } from "@/server/assignments";
import { schoolTimezone } from "@/server/learning-access";
import { timetableOptions } from "@/server/timetable";
import { Badge, DataTable, FilterBar, LinkButton, NoAccess, PageHeader, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Assignments" };
const TONE = { DRAFT: "neutral", OPEN: "ok", CLOSED: "warn" } as const;

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ classId?: string; state?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["assignments.manage", "assignments.oversee"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [rows, tz, opts] = await Promise.all([listAssignments(ctx, { classId: sp.classId || undefined, state: sp.state || undefined }), schoolTimezone(ctx.schoolId), hasAny(ctx, ["timetable.read"]) ? timetableOptions(ctx) : Promise.resolve({ classes: [], teachers: [] })]);
  const canSet = hasAny(ctx, ["assignments.manage"]);
  return (
    <>
      <PageHeader title={t("learn.asg.title")} subtitle={t("learn.asg.subtitle")} actions={canSet ? <LinkButton href="/assignments/new">{t("learn.asg.new")}</LinkButton> : undefined} />
      <FilterBar t={t} resetHref="/assignments">
        {opts.classes.length > 0 && <Field name="classId" type="select" label={t("learn.class")} placeholder={t("learn.allClasses")} options={opts.classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={sp.classId ?? ""} />}
        <Field name="state" type="select" label={t("common.status")} placeholder={t("learn.allStatuses")} options={(["DRAFT", "OPEN", "CLOSED"] as const).map((s) => ({ value: s, label: t(`learn.asg.state.${s}`) }))} defaultValue={sp.state ?? ""} />
      </FilterBar>
      <DataTable head={[t("learn.title"), t("learn.class"), t("learn.subject"), t("learn.asg.due"), t("common.status"), t("learn.asg.handedIn"), t("learn.asg.marked"), ""]} empty={rows.length ? undefined : <p className="px-4 py-10 text-center text-sm text-muted">{t("learn.asg.none")}</p>}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/assignments/${r.id}`} className="font-medium text-link hover:underline">{r.title}</Link></Td>
            <Td>{r.className}{r.streamName ? ` ${r.streamName}` : ""}</Td>
            <Td>{r.subjectName}</Td>
            <Td className="whitespace-nowrap">{displayDateTime(r.dueAt, tz, ctx.locale)}</Td>
            <Td><div className="flex flex-wrap gap-1"><Badge tone={TONE[r.state]}>{t(`learn.asg.state.${r.state}`)}</Badge>{r.overdue && <Badge tone="bad">{t("learn.asg.overdue")}</Badge>}</div></Td>
            <Td className="tabular-nums">{r.state === "DRAFT" ? "—" : `${r.handedIn} / ${r.roster}`}</Td>
            <Td className="tabular-nums">{r.state === "DRAFT" ? "—" : `${r.marked} / ${r.handedIn}`}</Td>
            <Td className="text-right"><Link href={`/assignments/${r.id}`} className="text-sm font-medium text-link hover:underline">{t("common.view")}</Link></Td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
