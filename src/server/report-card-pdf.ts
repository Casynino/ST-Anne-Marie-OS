import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { makeT, type Locale } from "@/lib/i18n";
import { todayInTimezone } from "@/lib/dates";
import { buildReportCardsPdf, type PdfLabels, type PdfLogo } from "@/lib/pdf/report-card";
import type { ReportSnapshot } from "@/lib/results/report-types";
import { getBrandLogo } from "@/server/website";

export function pdfLabels(locale: Locale): PdfLabels {
  const t = makeT(locale);
  return {
    title: t("rc.title"), student: t("rc.student"), admissionNo: t("rc.admissionNo"), class: t("rc.class"), term: t("rc.term"), sex: t("rc.sex"), dob: t("rc.dob"), male: t("rc.sex.MALE"), female: t("rc.sex.FEMALE"),
    subject: t("rc.subject"), score: t("rc.score"), grade: t("rc.grade"), points: t("rc.points"), position: t("rc.position"), classAvg: t("rc.classAvg"), absent: t("rc.absentShort"), exempt: t("rc.exemptShort"),
    total: t("rc.total"), average: t("rc.average"), division: t("rc.division"), classPosition: t("rc.classPosition"), streamPosition: t("rc.streamPosition"), of: t("rc.of"),
    attendance: t("rc.attendance"), attDays: t("rc.attDays"), attPresent: t("rc.attPresent"), attAbsent: t("rc.attAbsent"), attLate: t("rc.attLate"), attExcused: t("rc.attExcused"), attRate: t("rc.attRate"), attNone: t("rc.attNone"),
    remarkClass: t("rc.remarkClass"), remarkHead: t("rc.remarkHead"), noRemark: t("rc.noRemark"), signClass: t("rc.signClass"), signHead: t("rc.signHead"), signParent: t("rc.signParent"), stamp: t("rc.stamp"), date: t("rc.date"),
    key: t("rc.key"), generated: t("rc.generated", { date: "{date}" }), incNote: t("rc.incNote"),
  };
}

/** PNG/JPEG school logo from the media library or the bundled site folder; null when there is none (WebP is not supported by PDF). */
export async function loadLogo(schoolId: string): Promise<PdfLogo | null> {
  try {
    const logo = await getBrandLogo(schoolId);
    if (!logo) return null;
    const m = /^\/media\/([0-9a-f-]{36})$/i.exec(logo.src);
    if (m) {
      const a = await db.mediaAsset.findFirst({ where: { id: m[1]!, schoolId }, select: { bytes: true, mimeType: true } });
      if (!a) return null;
      return a.mimeType === "image/png" ? { bytes: new Uint8Array(a.bytes), type: "png" } : a.mimeType === "image/jpeg" ? { bytes: new Uint8Array(a.bytes), type: "jpg" } : null;
    }
    if (/^\/site\/[\w./-]+$/.test(logo.src) && !logo.src.includes("..")) {
      const ext = path.extname(logo.src).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") return null;
      return { bytes: new Uint8Array(await readFile(path.join(process.cwd(), "public", logo.src))), type: ext === ".png" ? "png" : "jpg" };
    }
  } catch {
    // A missing logo must never stop report cards from printing.
  }
  return null;
}

export async function renderCardsPdf(schoolId: string, snaps: ReportSnapshot[], locale: Locale): Promise<Uint8Array> {
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { timezone: true } });
  return buildReportCardsPdf(snaps, pdfLabels(locale), { logo: await loadLogo(schoolId), generated: todayInTimezone(school.timezone) });
}
