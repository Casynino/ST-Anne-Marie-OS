import Link from "next/link";
import type { Metadata } from "next";
import { AppError } from "@/lib/errors";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { previewBroadcast, resolveTemplate } from "@/server/communication";
import { listExamClasses } from "@/server/exams";
import { getSchoolBasics } from "@/server/settings";
import { db } from "@/lib/db";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { ActionForm, Field } from "@/components/form";
import { CommunicationNav } from "@/components/communication-nav";
import { broadcastInput } from "../_lib";
import { sendBroadcastAction } from "../actions";

export const metadata: Metadata = { title: "New message" };
type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function NewBroadcastPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  const sp = await searchParams;
  const kind = one(sp.kind) === "FEE_REMINDER" ? "FEE_REMINDER" : "ANNOUNCEMENT";
  if (!hasAny(ctx, [kind === "FEE_REMINDER" ? "comms.fee_reminder" : "comms.send"])) return <NoAccess t={t} />;
  const [classes, levels, school] = await Promise.all([listExamClasses(ctx), db.academicLevel.findMany({ where: { schoolId: ctx.schoolId }, orderBy: { sortOrder: "asc" } }), getSchoolBasics(ctx.schoolId)]);
  const reminderEn = kind === "FEE_REMINDER" ? await resolveTemplate(db, ctx.schoolId, "fees", "EN") : "";
  const reminderSw = kind === "FEE_REMINDER" ? await resolveTemplate(db, ctx.schoolId, "fees", "SW") : "";
  const v = (k: string, fallback = "") => one(sp[k]) || fallback;
  const audienceType = v("audienceType", kind === "FEE_REMINDER" ? "ARREARS" : "ALL");
  const classIds = Array.isArray(sp.classIds) ? sp.classIds : sp.classIds ? [sp.classIds] : [];
  const checked = (k: string) => (sp.preview ? one(sp[k]) === "on" : true);
  const formValues = { kind, title: v("title"), bodyEn: v("bodyEn", reminderEn), bodySw: v("bodySw", reminderSw), audienceType, classIds, streamId: v("streamId"), levelId: v("levelId"), classId: v("classId"), overdueOnly: sp.preview ? one(sp.overdueOnly) : "on", minOutstanding: v("minOutstanding"), sendSms: checked("sendSms") ? "on" : "", sendInApp: checked("sendInApp") ? "on" : "", sendAt: v("sendAt") };

  let preview: Awaited<ReturnType<typeof previewBroadcast>> | null = null;
  let problem: string | null = null;
  let fieldErrors: Record<string, string> = {};
  if (sp.preview) {
    try {
      preview = await previewBroadcast(ctx, broadcastInput(formValues as unknown as Record<string, string | string[] | undefined>, school.timezone));
    } catch (e) {
      if (e instanceof AppError) { problem = e.message; fieldErrors = e.fieldErrors ?? {}; } else throw e;
    }
  }
  const streams = classes.find((c) => c.id === (formValues.audienceType === "CLASS" ? classIds[0] : formValues.classId))?.streams ?? [];

  return (
    <>
      <PageHeader title={kind === "FEE_REMINDER" ? t("comm.newReminder") : t("comm.newNotice")} subtitle={kind === "FEE_REMINDER" ? t("comm.reminder.subtitle") : t("comm.notice.subtitle")} actions={<Link href="/communication" className="text-sm font-medium text-link hover:underline">{t("comm.title")}</Link>} />
      <CommunicationNav ctx={ctx} t={t} current="/communication" />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <form method="get" className="space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="preview" value="1" />
          <Field name="title" label={t("comm.f.title")} defaultValue={formValues.title} required hint={t("comm.f.titleHint")} />
          <Field name="bodyEn" type="textarea" rows={4} label={t("comm.f.bodyEn")} defaultValue={formValues.bodyEn} required hint={kind === "FEE_REMINDER" ? t("comm.f.varsFees") : t("comm.f.varsNotice")} />
          <Field name="bodySw" type="textarea" rows={4} label={t("comm.f.bodySw")} defaultValue={formValues.bodySw} optionalLabel={t("common.optional")} hint={t("comm.f.bodySwHint")} />
          {fieldErrors.bodyEn && <p className="text-sm text-bad">{fieldErrors.bodyEn}</p>}
          <fieldset className="space-y-3 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-medium">{t("comm.f.audience")}</legend>
            {kind === "ANNOUNCEMENT" ? (
              <>
                <Field name="audienceType" type="select" label={t("comm.f.who")} options={[{ value: "ALL", label: t("comm.aud.ALL") }, { value: "LEVEL", label: t("comm.aud.LEVEL") }, { value: "CLASS", label: t("comm.aud.CLASS") }]} defaultValue={audienceType} required />
                <Field name="levelId" type="select" label={t("grade.level")} options={levels.map((l) => ({ value: l.id, label: l.name }))} defaultValue={formValues.levelId} placeholder={t("common.select")} hint={t("comm.f.levelHint")} />
                <div><p className="mb-1 text-sm font-medium">{t("comm.f.classes")} <span className="font-normal text-muted">({t("comm.f.classesHint")})</span></p><div className="grid gap-1 sm:grid-cols-2">{classes.map((c) => <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 text-sm"><input type="checkbox" name="classIds" value={c.id} defaultChecked={classIds.includes(c.id)} className="size-5 accent-brand-700" />{c.name}</label>)}</div></div>
                {streams.length > 0 && <Field name="streamId" type="select" label={t("exam.stream")} options={streams.map((s) => ({ value: s.id, label: s.name }))} defaultValue={formValues.streamId} placeholder={t("res.allStreams")} />}
              </>
            ) : (
              <>
                <input type="hidden" name="audienceType" value="ARREARS" />
                <Field name="classId" type="select" label={t("exam.class")} options={classes.map((c) => ({ value: c.id, label: c.name }))} defaultValue={formValues.classId} placeholder={t("fin.invoices.allClasses")} />
                <Field name="overdueOnly" type="checkbox" label={t("comm.f.overdueOnly")} defaultValue={formValues.overdueOnly === "on"} />
                <Field name="minOutstanding" label={t("comm.f.minAmount")} defaultValue={formValues.minOutstanding} optionalLabel={t("common.optional")} hint={t("comm.f.minAmountHint")} />
              </>
            )}
          </fieldset>
          <fieldset className="space-y-1 rounded-xl border border-line p-3">
            <legend className="px-1 text-sm font-medium">{t("comm.f.channels")}</legend>
            <Field name="sendInApp" type="checkbox" label={t("comm.f.inApp")} defaultValue={formValues.sendInApp === "on"} />
            <Field name="sendSms" type="checkbox" label={t("comm.f.sms")} defaultValue={formValues.sendSms === "on"} />
          </fieldset>
          <Field name="sendAt" type="text" label={t("comm.f.sendAt")} defaultValue={formValues.sendAt} optionalLabel={t("comm.f.sendNow")} placeholder="2026-11-03T08:00" hint={t("comm.f.sendAtHint", { zone: school.timezone })} />
          <button className="min-h-11 rounded-lg bg-brand-700 px-5 text-base font-semibold text-white hover:bg-brand-800 btn-primary">{t("comm.f.preview")}</button>
        </form>

        <div className="space-y-4">
          {problem && <div role="alert" className="rounded-xl border border-bad/30 bg-red-50 px-4 py-3 text-sm text-bad">{problem}{Object.entries(fieldErrors).filter(([k]) => k !== "bodyEn").map(([k, m]) => <p key={k}>{m}</p>)}</div>}
          {preview && (
            <Card title={t("comm.preview.title")}>
              <ul className="space-y-1 text-sm">
                <li>{t("comm.preview.recipients", { count: preview.recipients })}</li>
                <li>{t("comm.preview.inApp", { count: preview.inAppReachable })}</li>
                <li>{formValues.sendSms ? (preview.smsConfigured ? t("comm.preview.sms", { count: preview.sms, parts: preview.smsParts }) : t("comm.preview.smsOff")) : t("comm.preview.noSms")}</li>
              </ul>
              {preview.recentReminderAt && <p role="note" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">{t("comm.preview.recent")}</p>}
              {preview.sample.length > 0 && <div className="mt-3"><p className="text-xs font-medium uppercase tracking-wide text-muted">{t("comm.preview.sample")}</p>{preview.sample.map((s, i) => <p key={i} className="mt-1 rounded-lg bg-canvas px-3 py-2 text-sm">{s}</p>)}</div>}
              <ActionForm action={sendBroadcastAction} submitLabel={formValues.sendAt ? t("comm.send.schedule") : t("comm.send.now", { count: preview.recipients })} confirm={t("comm.send.confirm", { count: preview.recipients })} className="mt-4 space-y-0">
                {Object.entries({ kind, title: formValues.title, bodyEn: formValues.bodyEn, bodySw: formValues.bodySw, audienceType: formValues.audienceType, levelId: formValues.levelId, streamId: formValues.streamId, classId: formValues.classId, overdueOnly: formValues.overdueOnly, minOutstanding: formValues.minOutstanding, sendSms: formValues.sendSms, sendInApp: formValues.sendInApp, sendAt: formValues.sendAt }).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                {formValues.classIds.map((id) => <input key={id} type="hidden" name="classIds" value={id} />)}
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
