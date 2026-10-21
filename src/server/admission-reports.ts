import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { requirePermission, type AuthContext } from "@/lib/auth/context";
import { admissionAccount } from "@/lib/admissions/rules";
import { formatDateOnly, parseDateOnly } from "@/lib/dates";
import { centsOf } from "@/lib/finance/money";
import type { Table } from "@/lib/export/table";

/*
 * Admissions reports. Everything is counted from the application, interview, offer and admission-payment records for the period asked for
 * (applications by the day they were received; interviews by their date; money by the day it was recorded). A period with no records
 * gives zeros, never made-up numbers.
 */

export type AdmissionReport = {
  from: string | null; to: string | null;
  funnel: { key: "received" | "interviewed" | "passed" | "offered" | "paid" | "enrolled"; value: number }[];
  bySource: { online: number; physical: number };
  byStatus: Record<string, number>;
  byClass: { className: string; received: number; enrolled: number }[];
  byMonth: { month: string; value: number }[];
  interviews: { scheduled: number; completed: number; cancelled: number; noShow: number; outcomes: Record<string, number> };
  conversion: { receivedToEnrolled: number | null; offeredToEnrolled: number | null; interviewedToPassed: number | null };
  fees: { verifiedCents: number; pendingCents: number; reversedCents: number; byMethod: { method: string; cents: number }[] };
  placement: { enrolled: number; byClass: { className: string; value: number }[]; awaiting: number };
  leavers: { transferred: number; withdrawn: number; graduated: number };
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
function range(f: { from?: string; to?: string }) {
  const from = f.from ? parseDateOnly(f.from) : null;
  const to = f.to ? parseDateOnly(f.to) : null;
  return { from, toExclusive: to ? new Date(to.getTime() + 86_400_000) : null };
}

export async function admissionReport(ctx: AuthContext, f: { from?: string; to?: string } = {}): Promise<AdmissionReport> {
  requirePermission(ctx, "admission.read");
  const schoolId = ctx.schoolId;
  const { from, toExclusive } = range(f);
  const created: Prisma.ApplicationWhereInput = { schoolId, ...(from || toExclusive ? { createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}) };
  const apps = await db.application.findMany({
    where: created,
    select: { id: true, status: true, source: true, classAppliedId: true, createdAt: true, studentId: true, interviews: { select: { status: true, outcome: true } }, offer: { select: { status: true, feeAmount: true, paymentWaivedAt: true } }, payments: { select: { status: true, amount: true } } },
  });
  const inRange = (col: string): Prisma.InterviewWhereInput => ({ schoolId, ...(from || toExclusive ? { [col]: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}) });
  const [classes, ivs, pays, history, year] = await Promise.all([
    db.schoolClass.findMany({ where: { schoolId }, select: { id: true, name: true } }),
    db.interview.groupBy({ by: ["status", "outcome"], where: inRange("scheduledAt"), _count: { _all: true } }),
    db.admissionPayment.findMany({ where: { schoolId, ...(from || toExclusive ? { recordedAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}) }, select: { status: true, amount: true, method: true } }),
    db.studentStatusHistory.groupBy({ by: ["toStatus"], where: { schoolId, toStatus: { in: ["TRANSFERRED", "WITHDRAWN", "GRADUATED"] }, ...(from || toExclusive ? { createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}) }, _count: { _all: true } }),
    db.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } }),
  ]);
  const className = (id: string | null) => classes.find((c) => c.id === id)?.name ?? "-";

  const received = apps.length;
  const interviewed = apps.filter((a) => a.interviews.some((i) => i.status === "COMPLETED")).length;
  const passed = apps.filter((a) => a.interviews.some((i) => i.outcome === "PASSED")).length;
  const offered = apps.filter((a) => a.offer && a.offer.status !== "PENDING_APPROVAL").length;
  const paid = apps.filter((a) => a.offer && admissionAccount(centsOf(a.offer.feeAmount), a.payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!a.offer.paymentWaivedAt).satisfied).length;
  const enrolled = apps.filter((a) => a.status === "ENROLLED").length;

  const byStatus: Record<string, number> = {};
  for (const a of apps) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const classMap = new Map<string, { received: number; enrolled: number }>();
  for (const a of apps) { const k = className(a.classAppliedId); const r = classMap.get(k) ?? { received: 0, enrolled: 0 }; r.received++; if (a.status === "ENROLLED") r.enrolled++; classMap.set(k, r); }
  const monthMap = new Map<string, number>();
  for (const a of apps) { const m = formatDateOnly(a.createdAt).split("/").reverse().slice(0, 2).join("-"); monthMap.set(m, (monthMap.get(m) ?? 0) + 1); }

  const count = (st: string) => ivs.filter((x) => x.status === st).reduce((n, x) => n + x._count._all, 0);
  const outcomes: Record<string, number> = {};
  for (const x of ivs) if (x.outcome) outcomes[x.outcome] = (outcomes[x.outcome] ?? 0) + x._count._all;

  const sum = (st: string) => pays.filter((p) => p.status === st).reduce((n, p) => n + centsOf(p.amount), 0);
  const methods = new Map<string, number>();
  for (const p of pays.filter((x) => x.status === "VERIFIED")) methods.set(p.method, (methods.get(p.method) ?? 0) + centsOf(p.amount));

  // Students who came through admissions in the period, by the class they now sit in
  const enrolledStudentIds = apps.flatMap((a) => (a.studentId ? [a.studentId] : []));
  const placed = enrolledStudentIds.length && year ? await db.studentEnrollment.groupBy({ by: ["classId"], where: { schoolId, academicYearId: year.id, status: "ACTIVE", studentId: { in: enrolledStudentIds } }, _count: { _all: true } }) : [];
  const placedTotal = placed.reduce((n, x) => n + x._count._all, 0);
  const lv = (s: string) => history.find((h) => h.toStatus === s)?._count._all ?? 0;

  return {
    from: f.from ?? null, to: f.to ?? null,
    funnel: [{ key: "received", value: received }, { key: "interviewed", value: interviewed }, { key: "passed", value: passed }, { key: "offered", value: offered }, { key: "paid", value: paid }, { key: "enrolled", value: enrolled }],
    bySource: { online: apps.filter((a) => a.source === "ONLINE").length, physical: apps.filter((a) => a.source === "STAFF").length },
    byStatus,
    byClass: [...classMap.entries()].map(([className, v]) => ({ className, ...v })).sort((a, b) => b.received - a.received),
    byMonth: [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, value })),
    interviews: { scheduled: count("SCHEDULED"), completed: count("COMPLETED"), cancelled: count("CANCELLED"), noShow: count("NO_SHOW"), outcomes },
    conversion: { receivedToEnrolled: pct(enrolled, received), offeredToEnrolled: pct(enrolled, offered), interviewedToPassed: pct(passed, interviewed) },
    fees: { verifiedCents: sum("VERIFIED"), pendingCents: sum("PENDING"), reversedCents: sum("REVERSED"), byMethod: [...methods.entries()].map(([method, cents]) => ({ method, cents })) },
    placement: { enrolled: enrolledStudentIds.length, byClass: placed.map((x) => ({ className: className(x.classId), value: x._count._all })).sort((a, b) => b.value - a.value), awaiting: enrolledStudentIds.length - placedTotal },
    leavers: { transferred: lv("TRANSFERRED"), withdrawn: lv("WITHDRAWN"), graduated: lv("GRADUATED") },
  };
}

/** Every application in the period as a table (for CSV, Excel and PDF). Same permission as the report. */
export async function admissionsTable(ctx: AuthContext, f: { from?: string; to?: string; status?: string }): Promise<Table> {
  requirePermission(ctx, "admission.read");
  const { from, toExclusive } = range(f);
  const rows = await db.application.findMany({
    where: { schoolId: ctx.schoolId, ...(f.status ? { status: f.status as never } : {}), ...(from || toExclusive ? { createdAt: { ...(from ? { gte: from } : {}), ...(toExclusive ? { lt: toExclusive } : {}) } } : {}) },
    orderBy: { createdAt: "asc" }, take: 5000,
    include: { offer: { select: { status: true, feeAmount: true, paymentWaivedAt: true } }, payments: { select: { status: true, amount: true } }, interviews: { orderBy: { scheduledAt: "desc" }, take: 1, select: { scheduledAt: true, status: true, outcome: true } } },
  });
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId }, select: { id: true, name: true } });
  return {
    title: "Admissions", subtitle: `${rows.length} applications`,
    columns: [
      { key: "no", label: "Application no", width: 16 }, { key: "name", label: "Applicant", width: 28 }, { key: "class", label: "Class applied", width: 14 }, { key: "source", label: "Channel", width: 10 }, { key: "received", label: "Received", width: 12 },
      { key: "status", label: "Status", width: 12 }, { key: "interview", label: "Last interview", width: 14 }, { key: "outcome", label: "Interview result", width: 18 }, { key: "fee", label: "Admission fee", kind: "money", width: 14 }, { key: "paid", label: "Verified paid", kind: "money", width: 14 },
    ],
    rows: rows.map((a) => {
      const acc = a.offer ? admissionAccount(centsOf(a.offer.feeAmount), a.payments.map((p) => ({ status: p.status, amountCents: centsOf(p.amount) })), !!a.offer.paymentWaivedAt) : null;
      const iv = a.interviews[0];
      return [a.applicationNo, `${a.firstName} ${a.lastName}`, classes.find((c) => c.id === a.classAppliedId)?.name ?? "", a.source === "ONLINE" ? "Online" : "Physical", formatDateOnly(a.createdAt), a.status, iv ? formatDateOnly(iv.scheduledAt) : "", iv?.outcome ?? iv?.status ?? "", acc ? acc.requiredCents / 100 : null, acc ? acc.verifiedCents / 100 : null];
    }),
  };
}
