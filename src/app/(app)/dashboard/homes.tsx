import type { adminHome } from "@/server/admin-home";
import type { AttentionRow } from "@/components/dash/attention-tabs";
import { KpiSection, type DashEnv } from "./sections";
import { AbsentPanel, ActivityPanel, AdmissionsPanel, ArrearsPanel, AttendanceDailyPanel, AttendanceTrendPanel, EnrollmentPanel, FillPanel, GenderPanel, CalendarPanel, ClassCollectionPanel, ClassesPanel, CollectionsPanel, DeskRow, FeesPanel, H, InvoicesPanel, LearningPanel, MethodsPanel, N, PaymentsPanel, PeoplePanel, ResultsPanel, Row, SetupBanner, T, TodayPanel, W } from "./home";
import { AttentionBlock } from "./attention";

/*
 * The bodies of the staff home pages (everything under the greeting and the action chips). The order is the same everywhere: what needs
 * attention, every desk at a glance, the headline numbers, then the pictures and tables that explain them. One figure, one place.
 */

export function AdminBody({ env, setup, rows }: { env: DashEnv; setup: Awaited<ReturnType<typeof adminHome>> | null; rows: AttentionRow[] }) {
  return (
    <>
      <SetupBanner env={env} setup={setup} />
      <AttentionBlock t={env.t} rows={rows} />
      <DeskRow env={env} />
      <KpiSection env={env} bare />
      <Row><AttendanceDailyPanel env={env} className={H} /><AbsentPanel env={env} className={H} /></Row>
      <Row><AttendanceTrendPanel env={env} className={H} /><FeesPanel env={env} className={H} /></Row>
      <Row><EnrollmentPanel env={env} className={W} /><GenderPanel env={env} className={N} /></Row>
      <Row><FillPanel env={env} className={W} /><TodayPanel env={env} className={N} /></Row>
      <Row><ClassesPanel env={env} className="flex-[1_1_100%]" /></Row>
      <Row><AdmissionsPanel env={env} className={N} /><ResultsPanel env={env} className={T} /><LearningPanel env={env} className={T} /><PeoplePanel env={env} className={T} /></Row>
      <Row><ArrearsPanel env={env} className={H} /><PaymentsPanel env={env} className={H} /></Row>
      <Row><MethodsPanel env={env} className={N} /><ClassCollectionPanel env={env} className={W} /></Row>
      <Row><ActivityPanel env={env} className={H} /><CalendarPanel env={env} className={H} /></Row>
    </>
  );
}

export function AccountantBody({ env }: { env: DashEnv }) {
  return (
    <>
      <Row><CollectionsPanel env={env} className={W} /><MethodsPanel env={env} className={N} /></Row>
      <Row><ArrearsPanel env={env} className={H} /><PaymentsPanel env={env} className={H} /></Row>
      <Row><ClassCollectionPanel env={env} className={W} /><InvoicesPanel env={env} className={N} /></Row>
      <Row><CalendarPanel env={env} className={H} /></Row>
    </>
  );
}

export function HeadBody({ env, teachers }: { env: DashEnv; teachers: React.ReactNode }) {
  return (
    <>
      {teachers}
      <Row><AttendanceDailyPanel env={env} className={H} /><AbsentPanel env={env} className={H} /></Row>
      <Row><AttendanceTrendPanel env={env} className={H} /><ResultsPanel env={env} className={H} /></Row>
      <Row><EnrollmentPanel env={env} className={W} /><GenderPanel env={env} className={N} /></Row>
      <Row><FillPanel env={env} className={W} /><TodayPanel env={env} className={N} /></Row>
      <Row><ClassesPanel env={env} className="flex-[1_1_100%]" /></Row>
      <Row><ArrearsPanel env={env} className={H} /><PaymentsPanel env={env} className={H} /></Row>
      <Row><LearningPanel env={env} className={H} /><CalendarPanel env={env} className={H} /></Row>
    </>
  );
}
