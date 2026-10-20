"use server";

import { run, str, type ActionState } from "@/lib/action";
import { makeT } from "@/lib/i18n";
import * as rc from "@/server/report-cards";
import { processPendingEvents } from "@/server/notifications";

const target = (i: Record<string, string | string[] | undefined>) => ({ termId: str(i.termId), classId: str(i.classId), streamId: str(i.streamId) || undefined });

export async function generateCardsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await rc.generateReportCards(ctx, target(i));
    const t = makeT(ctx.locale);
    return { message: t("rc.generated.done", { generated: r.generated, regenerated: r.regenerated, unchanged: r.unchanged, skipped: r.skippedPublished.length, none: r.noResults.length }) };
  });
}

export async function publishCardsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const r = await rc.publishReportCards(ctx, target(i));
    if (r.notified) await processPendingEvents({ schoolId: ctx.schoolId, limit: 200 }).catch(() => undefined); // best effort: the cron route retries
    const t = makeT(ctx.locale);
    return { message: t("rc.published.done", { published: r.published, stale: r.stale.length, notCleared: r.notCleared.length }) };
  });
}

export async function withdrawCardAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await rc.withdrawReportCard(ctx, str(i.id), { reason: str(i.reason) });
    return { message: makeT(ctx.locale)("rc.withdrawn.done") };
  });
}

export async function saveRemarksAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    const ids = Object.keys(i).filter((k) => k.startsWith("class:")).map((k) => k.slice(6));
    const entries = ids.map((studentId) => ({ studentId, classRemark: str(i[`class:${studentId}`]), headRemark: str(i[`head:${studentId}`]) }));
    const r = await rc.saveRemarks(ctx, { ...target(i), entries });
    return { message: makeT(ctx.locale)("rc.remarks.saved", { count: r.saved }) };
  });
}

export async function updateCardSettingsAction(_: ActionState, form: FormData) {
  return run(form, async (ctx, i) => {
    await rc.updateReportCardSettings(ctx, i);
    return { message: makeT(ctx.locale)("common.saved") };
  });
}

