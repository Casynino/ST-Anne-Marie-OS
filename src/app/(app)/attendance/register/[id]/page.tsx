import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { AppError } from "@/lib/errors";
import { displayDateTime } from "@/lib/dates";
import { getRegisterDetail } from "@/server/attendance";
import { getSchoolBasics } from "@/server/settings";
import { ActionForm, Field } from "@/components/form";
import { Badge, Card, DataTable, EmptyState, NoAccess, PageHeader, Td } from "@/components/ui";
import { correctAttendanceAction } from "../../actions";

export const metadata: Metadata = { title: "Register" };
const TONE = { PRESENT: "ok", ABSENT: "bad", LATE: "warn", EXCUSED: "brand" } as const;
const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"])) return <NoAccess t={t} />;
  const { id } = await params;
  let reg: Awaited<ReturnType<typeof getRegisterDetail>>;
  try {
    reg = await getRegisterDetail(ctx, id);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState>{e.message}</EmptyState>;
    throw e;
  }
  const school = await getSchoolBasics(ctx.schoolId);
  const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
  for (const r of reg.records) counts[r.status]++;

  return (
    <>
      <PageHeader
        title={`${reg.className}${reg.streamName ? ` · ${reg.streamName}` : ""}`}
        subtitle={`${reg.date} · ${reg.sessionName} · ${reg.status === "FINALISED" ? t("att.finalised") : t("att.draft")}`}
        actions={<Link href={`/attendance?date=${reg.date}`} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">{t("common.back")}</Link>}
      />
      <p className="mb-4 text-sm text-muted">
        {t("att.summary", { present: counts.PRESENT, absent: counts.ABSENT, late: counts.LATE, excused: counts.EXCUSED })}
        {reg.finalisedBy && reg.finalisedAt ? ` · ${t("att.finalisedBy", { name: reg.finalisedBy, when: displayDateTime(reg.finalisedAt, school.timezone, ctx.locale) })}` : ` · ${t("att.startedBy", { name: reg.startedBy })}`}
      </p>
      <DataTable head={[t("common.name"), t("student.admissionNo"), t("common.status"), t("att.note"), ...(reg.canCorrect ? [t("att.correct")] : [])]}>
        {reg.records.map((r) => (
          <tr key={r.id}>
            <Td>{r.name}</Td>
            <Td className="whitespace-nowrap tabular-nums">{r.admissionNo}</Td>
            <Td><Badge tone={TONE[r.status]}>{t(`att.status.${r.status}`)}</Badge></Td>
            <Td>{r.note ?? ""}</Td>
            {reg.canCorrect && (
              <Td>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">{t("att.correct")}</summary>
                  <ActionForm action={correctAttendanceAction} submitLabel={t("att.correct")} className="mt-2 w-64 max-w-full space-y-2">
                    <input type="hidden" name="attendanceId" value={r.id} />
                    <Field name="status" type="select" label={t("att.correct.to")} required options={STATUSES.filter((s) => s !== r.status).map((s) => ({ value: s, label: t(`att.status.${s}`) }))} />
                    <Field name="reason" type="textarea" rows={2} label={t("att.correct.reason")} required hint={t("att.correct.hint")} />
                  </ActionForm>
                </details>
              </Td>
            )}
          </tr>
        ))}
      </DataTable>
      <div className="mt-5">
        <Card title={t("att.corrections")}>
          {reg.corrections.length === 0 ? (
            <p className="text-sm text-muted">{t("att.corrections.none")}</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {reg.corrections.map((c) => (
                <li key={c.id} className="py-2">
                  <p>{t("att.correct.by", { name: c.by, student: c.student, from: t(`att.status.${c.from}`), to: t(`att.status.${c.to}`) })}</p>
                  <p className="text-muted">{c.reason} · {displayDateTime(c.at, school.timezone, ctx.locale)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
