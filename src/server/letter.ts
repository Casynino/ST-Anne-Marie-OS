import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { buildLetterPdf, type LetterDoc, type LetterLabels } from "@/lib/pdf/letter";
import { loadLogo } from "@/server/report-card-pdf";

export function letterLabels(locale: Locale): LetterLabels {
  const t = makeT(locale);
  return { ref: t("letter.ref"), date: t("letter.date"), to: t("letter.to"), re: t("letter.re"), closing: t("letter.closing"), signature: t("rcp.signature"), stamp: t("rc.stamp") };
}

/**
 * A message to parents (a broadcast) as a formal letter. Needs `comms.read`; the broadcast must belong to the caller's school. The text is the
 * school's own wording in the chosen language (the Kiswahili text when there is one, otherwise the English text). The reference is derived from
 * the broadcast, so the same letter always carries the same reference.
 */
export async function letterDocument(ctx: AuthContext, broadcastId: string, locale: Locale): Promise<LetterDoc> {
  requirePermission(ctx, "comms.read");
  const t = makeT(locale);
  const b = await db.broadcast.findFirst({ where: { id: broadcastId, schoolId: ctx.schoolId } });
  if (!b) throw notFound("Message");
  const [school, author, staff] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: ctx.schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, timezone: true } }),
    db.user.findFirst({ where: { id: b.createdById, schoolId: ctx.schoolId }, select: { fullName: true } }),
    db.staff.findFirst({ where: { userId: b.createdById, schoolId: ctx.schoolId }, select: { jobTitle: true } }),
  ]);
  const a = b.audience as { type?: string; classIds?: string[]; levelId?: string };
  let to = t("letter.toParents");
  if (a.type === "CLASS" && a.classIds?.length) {
    const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, id: { in: a.classIds } }, orderBy: { sortOrder: "asc" }, select: { name: true } });
    if (classes.length) to = t("letter.toClasses", { classes: classes.map((c) => c.name).join(", ") });
  } else if (a.type === "LEVEL" && a.levelId) {
    const level = await db.academicLevel.findFirst({ where: { id: a.levelId, schoolId: ctx.schoolId }, select: { name: true } });
    if (level) to = t("letter.toClasses", { classes: level.name });
  }
  const date = new Intl.DateTimeFormat(locale === "SW" ? "sw-TZ" : "en-GB", { timeZone: school.timezone, day: "numeric", month: "long", year: "numeric" }).format(b.sendAt);
  const year = new Intl.DateTimeFormat("en-GB", { timeZone: school.timezone, year: "numeric" }).format(b.sendAt);
  return {
    school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email },
    reference: `LTR/${year}/${b.id.replace(/-/g, "").slice(-6).toUpperCase()}`, date, to, subject: b.title, body: (locale === "SW" && b.bodySw) || b.bodyEn,
    signer: { name: author?.fullName ?? "", title: staff?.jobTitle ?? null },
  };
}

export async function letterPdf(ctx: AuthContext, broadcastId: string, locale: Locale): Promise<Uint8Array> {
  return buildLetterPdf(await letterDocument(ctx, broadcastId, locale), letterLabels(locale), await loadLogo(ctx.schoolId));
}
