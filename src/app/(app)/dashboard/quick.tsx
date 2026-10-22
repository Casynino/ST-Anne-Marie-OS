import type { Translate } from "@/lib/i18n";
import type { Quick } from "@/components/dash/quick-links";
import type { DashEnv } from "./sections";

/*
 * Easy access: the places each kind of person uses most, as tiles with a number when something is waiting there. A tile appears only when
 * the person holds a permission for that page (the page itself still checks on the server).
 */

export type QuickKind = "registrar" | "accountant" | "head" | "admin" | "teacher" | "academic" | "staff";
type Item = Quick & { perm?: string[] };

export function quickItems(kind: QuickKind, t: Translate, can: (p: string) => boolean, attention: { key: string; count: number }[]): Quick[] {
  const n = (key: string) => attention.find((a) => a.key === key)?.count ?? null;
  const students: Item = { href: "/students", label: t("nav.students"), icon: "students", perm: ["student.read", "student.read_assigned"] };
  const attendance: Item = { href: "/attendance", label: t("nav.attendance"), icon: "attendance", perm: ["attendance.read", "attendance.read_assigned", "attendance.take", "attendance.take_any"] };
  const calendar: Item = { href: "/school-calendar", label: t("nav.calendar"), icon: "calendar" };
  const messages: Item = { href: "/communication/messages", label: t("nav.communication"), icon: "communication", perm: ["comms.read", "messages.read", "messages.moderate"], count: n("messagesWaiting") };
  const library: Item = { href: "/library-admin", label: t("nav.library"), icon: "library", perm: ["library.read", "library.upload", "library.manage", "library.review", "library.publish", "library.pin"] };
  const sets: Record<QuickKind, Item[]> = {
    registrar: [
      { href: "/students/new", label: t("dash.registerStudent"), icon: "students", perm: ["student.create"] },
      { href: "/admissions/new", label: t("dash.newApplication"), icon: "admissions", perm: ["admission.create"] },
      { href: "/admissions", label: t("nav.admissions"), icon: "admissions", perm: ["admission.read"], count: n("newApplications") },
      { href: "/students/returning", label: t("lc.nav.returning"), icon: "students", perm: ["registration.read"] },
      students,
      { href: "/students/import", label: t("acts.importStudents"), icon: "students", perm: ["student.import"] },
      { href: "/guardians", label: t("nav.guardians"), icon: "guardians", perm: ["guardian.read"] },
      { href: "/enquiries", label: t("nav.enquiries"), icon: "enquiries", perm: ["enquiry.read"], count: n("newEnquiries") },
      attendance, calendar,
    ],
    accountant: [
      { href: "/finance/payments/new", label: t("acts.recordPayment"), icon: "finance", perm: ["payment.record"] },
      { href: "/finance/invoices", label: t("acts.invoices"), icon: "finance", perm: ["fees.read", "finance.reports"] },
      { href: "/finance/fees", label: t("acts.fees"), icon: "finance", perm: ["fees.read"] },
      { href: "/finance/annual", label: t("lc.nav.annualFees"), icon: "finance", perm: ["registration.read"] },
      { href: "/finance/expenses", label: t("acts.expenses"), icon: "finance", perm: ["expense.read"], count: n("expensesPending") },
      { href: "/finance/reconciliation", label: t("acts.reconcile"), icon: "finance", perm: ["finance.reconcile"], count: n("unmatchedPayments") },
      { href: "/finance/reports", label: t("dash.money.report"), icon: "results", perm: ["finance.reports"] },
      { href: "/finance", label: t("nav.finance"), icon: "finance", perm: ["fees.read", "finance.reports"] },
      students, calendar,
    ],
    head: [
      { href: "/marks", label: t("acts.approveMarks"), icon: "marks", perm: ["results.approve"], count: n("resultsToApprove") },
      { href: "/planning", label: t("acts.reviewPlans"), icon: "planning", perm: ["plans.review"] },
      attendance,
      { href: "/report-cards", label: t("nav.reportCards"), icon: "reportcards", perm: ["reportcard.read", "reportcard.generate"] },
      { href: "/academic-office", label: t("nav.academicOffice"), icon: "academicOffice", perm: ["academic.office"] },
      { href: "/academic-office/progression", label: t("lc.prog.title"), icon: "students", perm: ["progression.read"], count: n("headProgression") },
      { href: "/results", label: t("nav.results"), icon: "results", perm: ["results.read", "results.read_assigned"] },
      messages, students, calendar,
    ],
    admin: [
      { href: "/users", label: t("nav.users"), icon: "users", perm: ["user.read"] },
      { href: "/roles", label: t("nav.roles"), icon: "roles", perm: ["role.read"] },
      { href: "/settings", label: t("nav.settings"), icon: "settings", perm: ["school.settings.read"] },
      { href: "/website", label: t("nav.website"), icon: "website", perm: ["website.manage"] },
      { href: "/settings/system", label: t("acts.system"), icon: "dashboard", perm: ["backup.read"] },
      { href: "/audit", label: t("nav.audit"), icon: "audit", perm: ["audit.read"] },
      { href: "/academic-setup", label: t("nav.academics"), icon: "academics", perm: ["academic.read"] },
      library, students,
      { href: "/finance", label: t("nav.finance"), icon: "finance", perm: ["fees.read", "finance.reports"] },
      { href: "/admissions", label: t("nav.admissions"), icon: "admissions", perm: ["admission.read"], count: n("newApplications") },
      calendar,
    ],
    teacher: [
      { href: "/attendance", label: t("dash.takeAttendance"), icon: "attendance", perm: ["attendance.take", "attendance.take_any"] },
      { href: "/marks", label: t("nav.marks"), icon: "marks", perm: ["marks.enter", "marks.enter_any"] },
      { href: "/assignments", label: t("nav.assignments"), icon: "assignments", perm: ["assignments.manage", "assignments.oversee"] },
      { href: "/planning", label: t("nav.planning"), icon: "planning", perm: ["plans.write", "plans.review"] },
      { href: "/timetable", label: t("nav.timetable"), icon: "timetable", perm: ["timetable.read"] },
      library, students, messages,
      { href: "/behaviour", label: t("nav.behaviour"), icon: "behaviour", perm: ["behaviour.record", "behaviour.read_all"] },
    ],
    academic: [
      { href: "/academic-office/progression", label: t("lc.prog.title"), icon: "students", perm: ["progression.read"], count: n("progressionTodo") },
      { href: "/admissions/placement", label: t("adm.nav.placement"), icon: "students", perm: ["admission.read", "student.read"] },
      { href: "/academic-office/transfers", label: t("ac.transfers"), icon: "students", perm: ["transfer.request", "transfer.approve"] },
      { href: "/academic-office/concerns", label: t("ac.concerns"), icon: "behaviour", perm: ["concern.manage"] },
      { href: "/marks", label: t("nav.marks"), icon: "marks", perm: ["marks.enter", "marks.enter_any", "results.approve", "results.lock"] },
      { href: "/exams", label: t("nav.exams"), icon: "exams", perm: ["exam.read"] },
      { href: "/report-cards", label: t("nav.reportCards"), icon: "reportcards", perm: ["reportcard.read", "reportcard.generate"] },
      { href: "/timetable", label: t("nav.timetable"), icon: "timetable", perm: ["timetable.read"] },
      { href: "/academic-setup", label: t("nav.academics"), icon: "academics", perm: ["academic.read"] },
      { href: "/tasks", label: t("nav.tasks"), icon: "tasks" },
      library, calendar,
    ],
    staff: [students, attendance, messages, calendar],
  };
  return sets[kind].filter((i) => !i.perm || i.perm.some(can)).map(({ perm: _perm, ...q }) => q);
}

/** The links of the jump bar: only sections the person's data will actually draw. */
export function jumpItems(env: DashEnv, ids: string[], extra: Record<string, string | false | null | undefined> = {}): { id: string; label: string }[] {
  const { t, d, o, adm } = env;
  const has: Record<string, [boolean, string]> = {
    queues: [adm.queues.length > 0, t("adm.q.title")],
    quick: [true, t("dash.quick.title")],
    school: [d.kpis.length > 0, t("dash.sec.school")],
    attention: [d.attention.length > 0, t("dash.attention.title")],
    pulse: [!!d.attendanceTrend && d.attendanceTrend.length >= 2, t("dash.pulse.title")],
    classes: [!!d.attendanceByClass && d.attendanceByClass.length > 0, t("dash.sec.classes")],
    students: [!!(o.byGender || o.attDaily || o.absent), t("dash.sec.students")],
    fees: [!!d.finance, t("dash.sec.fees")],
    results: [!!d.exams, t("dash.sec.results")],
    admissions: [!!(d.pipeline || d.recentApplications), t("dash.sec.admissions")],
    learning: [!!(o.homework || o.behaviour), t("dash.sec.learning")],
    calendar: [!!(o.events || o.staffRoles), t("dash.sec.calendar")],
  };
  return ids.flatMap((id) => {
    if (id in extra) { const label = extra[id]; return label ? [{ id, label }] : []; }
    const h = has[id];
    return h && h[0] ? [{ id, label: h[1] }] : [];
  });
}
