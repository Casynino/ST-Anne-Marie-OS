import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { makeT, type Locale } from "@/lib/i18n";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { centsOf } from "@/lib/finance/money";
import { feeSheetTable } from "@/lib/finance/fee-sheet";
import { formatDateOnly, parseDateOnly, todayInTimezone } from "@/lib/dates";
import { buildFeeSheetPdf, type FeeSheetDoc, type FeeSheetLabels } from "@/lib/pdf/fee-sheet";
import { getFeeSettings, listStructures } from "@/server/fees";
import { loadLogo } from "@/server/report-card-pdf";

export function feeSheetLabels(locale: Locale): FeeSheetLabels {
  const t = makeT(locale);
  return {
    title: t("fin.sheet.title"), item: t("fin.sheet.item"), total: t("fin.pdf.total"), yearTotal: t("fin.sheet.yearTotal"), amountsIn: t("fin.sheet.amountsIn", { currency: "{currency}" }),
    howToPay: t("fin.pdf.howToPay"), printedOn: t("fin.sheet.printedOn", { date: "{date}" }), signHead: t("rc.signHead"), stamp: t("rc.stamp"), noLines: t("fin.sheet.none"),
  };
}

/** The fee table of one structure, or of every active structure of the year. Needs `fees.read`; everything is read inside the caller's school. */
export async function feeSheetDocument(ctx: AuthContext, input: { yearId: string; structureId?: string | null }, locale: Locale): Promise<FeeSheetDoc> {
  requirePermission(ctx, "fees.read");
  const t = makeT(locale);
  const schoolId = ctx.schoolId;
  const year = await db.academicYear.findFirst({ where: { id: input.yearId, schoolId }, select: { id: true, name: true } });
  if (!year) throw notFound("Academic year");
  const [school, settings, terms, all, classes, levels] = await Promise.all([
    db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, motto: true, address: true, phone: true, email: true, currency: true, timezone: true } }),
    getFeeSettings(db, schoolId),
    db.term.findMany({ where: { schoolId, academicYearId: year.id }, orderBy: { sequence: "asc" }, select: { sequence: true, name: true } }),
    listStructures(ctx, { academicYearId: year.id }),
    db.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    db.academicLevel.findMany({ where: { schoolId }, select: { id: true, name: true } }),
  ]);
  const chosen = input.structureId ? all.filter((s) => s.id === input.structureId) : all.filter((s) => s.isActive);
  if (input.structureId && chosen.length === 0) throw notFound("Fee structure");
  const scope = (s: { classId: string | null; levelId: string | null }) => (s.classId ? classes.find((c) => c.id === s.classId)?.name : s.levelId ? levels.find((l) => l.id === s.levelId)?.name : null) ?? t("fin.fees.everyone");
  return {
    school: { name: school.name, motto: school.motto, address: school.address, phone: school.phone, email: school.email }, currency: school.currency, yearName: year.name,
    sections: chosen.map((s) => ({
      name: s.name, scope: scope(s),
      table: feeSheetTable(s.lines.map((l) => ({ feeItemId: l.feeItemId, name: (locale === "SW" && l.feeItem.nameSw) || l.feeItem.name, amountCents: centsOf(l.amount), termSequence: l.termSequence })), terms, (n) => t("fin.sheet.termN", { n: String(n) })),
    })),
    paymentInstructions: settings.paymentInstructions, printedOn: formatDateOnly(parseDateOnly(todayInTimezone(school.timezone)) as Date),
  };
}

export async function feeSheetPdf(ctx: AuthContext, input: { yearId: string; structureId?: string | null }, locale: Locale): Promise<Uint8Array> {
  const doc = await feeSheetDocument(ctx, input, locale);
  return buildFeeSheetPdf(doc, feeSheetLabels(locale), await loadLogo(ctx.schoolId));
}
