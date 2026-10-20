import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate, parseDateOnly } from "@/lib/dates";
import { listBehaviour } from "@/server/behaviour";
import { timetableOptions } from "@/server/timetable";
import { Badge, FilterBar, LinkButton, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { shareBehaviourAction, voidBehaviourAction } from "./actions";

export const metadata: Metadata = { title: "Behaviour" };
const TONE = { POSITIVE: "ok", CONCERN: "warn", INCIDENT: "bad" } as const;

export default async function BehaviourPage({ searchParams }: { searchParams: Promise<{ type?: string; classId?: string; from?: string; to?: string; voided?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["behaviour.record", "behaviour.read_all"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const [rows, opts] = await Promise.all([
    listBehaviour(ctx, { type: sp.type || undefined, classId: sp.classId || undefined, from: sp.from ? (parseDateOnly(sp.from) ?? undefined) : undefined, to: sp.to ? (parseDateOnly(sp.to) ?? undefined) : undefined, includeVoided: sp.voided === "1" }),
    hasAny(ctx, ["timetable.read"]) ? timetableOptions(ctx) : Promise.resolve({ classes: [], teachers: [] }),
  ]);
  const canRecord = hasAny(ctx, ["behaviour.record"]);
  return (
    <>
      <PageHeader title={t("learn.bh.title")} subtitle={t("learn.bh.subtitle")} actions={canRecord ? <LinkButton href="/behaviour/new">{t("learn.bh.new")}</LinkButton> : undefined} />
      <FilterBar t={t} resetHref="/behaviour">
        <Field name="type" type="select" label={t("learn.bh.type")} placeholder={t("learn.bh.allTypes")} options={(["POSITIVE", "CONCERN", "INCIDENT"] as const).map((x) => ({ value: x, label: t(`learn.bh.type.${x}`) }))} defaultValue={sp.type ?? ""} />
        {opts.classes.length > 0 && <Field name="classId" type="select" label={t("learn.class")} placeholder={t("learn.allClasses")} options={opts.classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={sp.classId ?? ""} />}
        <Field name="from" type="date" label={t("learn.bh.from")} defaultValue={sp.from ?? ""} />
        <Field name="to" type="date" label={t("learn.bh.to")} defaultValue={sp.to ?? ""} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="voided" value="1" defaultChecked={sp.voided === "1"} className="size-5 accent-brand-700" />{t("learn.bh.showVoided")}</label>
      </FilterBar>
      {rows.length === 0 ? <p className="rounded-2xl border border-line bg-surface px-4 py-10 text-center text-sm text-muted">{t("learn.bh.none")}</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className={`rounded-2xl border bg-surface p-4 shadow-[var(--shadow-card)] ${r.voided ? "border-line opacity-70" : "border-line"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[r.type]}>{t(`learn.bh.type.${r.type}`)}</Badge>
                <span className="font-semibold">{r.category}</span>
                <span className="text-sm text-muted">· <Link href={`/students/${r.studentId}`} className="font-medium text-link hover:underline">{r.studentName}</Link> ({r.admissionNo}) · {displayDate(r.occurredOn, ctx.locale)} · {r.recordedBy}</span>
                <span className="ml-auto flex gap-1.5">{r.shared && !r.voided && <Badge tone="brand">{t("learn.bh.shared")}</Badge>}{r.voided && <Badge tone="neutral">{t("learn.bh.voided")}</Badge>}</span>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm">{r.description}</p>
              {r.action && <p className="mt-1 text-sm text-muted"><strong>{t("learn.bh.action")}:</strong> {r.action}</p>}
              {r.voided && <p className="mt-1 text-sm text-muted"><strong>{t("learn.bh.voidReason")}:</strong> {r.voidReason}</p>}
              {!r.voided && canRecord && (r.mine || hasAny(ctx, ["behaviour.read_all"])) && (
                <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-line pt-3">
                  <ActionForm action={shareBehaviourAction} submitLabel={r.shared ? t("learn.bh.unshare") : t("learn.bh.share")} inline className="">
                    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="share" value={r.shared ? "0" : "1"} />
                  </ActionForm>
                  <details>
                    <summary className="inline-flex min-h-9 cursor-pointer items-center text-sm font-medium text-bad">{t("learn.bh.void")}</summary>
                    <ActionForm action={voidBehaviourAction} submitLabel={t("learn.bh.void")} tone="danger" className="mt-2 flex flex-wrap items-end gap-2" confirm={t("learn.bh.voidConfirm")}>
                      <input type="hidden" name="id" value={r.id} />
                      <Field name="reason" label={t("learn.bh.voidReason")} required className="min-w-64" />
                    </ActionForm>
                  </details>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
