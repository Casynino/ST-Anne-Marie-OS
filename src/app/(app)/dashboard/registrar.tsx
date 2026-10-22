import Link from "next/link";
import { ArrowRight, CalendarClock, Inbox, UserPlus, Users, DoorOpen } from "lucide-react";
import { displayDate, displayDateTime } from "@/lib/dates";
import { BarLineChart } from "@/components/dash/charts-client";
import { Cell, DashTable, DonutStat, EmptyLine, ColorBars, GradientTile, Panel, PersonCell, Pill } from "@/components/dash/parts";
import { MonthCard } from "@/components/dash/month-card";
import type { RegistrarHome } from "@/server/registrar-home";
import type { DashEnv } from "./sections";
import { N, Row, T, W } from "./home";
import { AttendanceTrendPanel } from "./home";

/*
 * The registrar's home. One strip of small tiles for the headline numbers, then each panel answers a different question: what is waiting
 * (the queue), how many applications come in (the bars), where they stand (the ring), when the next interviews are (the table), which
 * classes they ask for, and where there is room to register someone. A figure is shown once.
 */

const STATUS_COLOR: Record<string, string> = { APPLIED: "#14a3b8", INTERVIEW: "#8b80ff", ACCEPTED: "#f3b94c", ENROLLED: "#2fd08f", REJECTED: "#ff8574", WITHDRAWN: "#4b5a52" };
const STATUS_TONE = { APPLIED: "brand", INTERVIEW: "brand", ACCEPTED: "warn", ENROLLED: "ok", REJECTED: "bad", WITHDRAWN: "neutral" } as const;
const TEXT = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-[#a9a0ff]", brand: "text-link" } as const;

function Strip({ env, reg }: { env: DashEnv; reg: RegistrarHome | null }) {
  const { t, d, o, adm } = env;
  const enrolled = d.kpis.find((k) => k.key === "enrolled");
  const enquiries = d.kpis.find((k) => k.key === "enquiries");
  const series = o.applications?.slice(-14).map((p) => p.count) ?? [];
  const received = adm.overview?.received.total ?? null;
  const open = d.pipeline ? d.pipeline.filter((p) => p.label === "APPLIED" || p.label === "INTERVIEW" || p.label === "ACCEPTED").reduce((n, p) => n + p.value, 0) : null;
  const left = o.fill ? o.fill.reduce((n, c) => n + Math.max(0, c.capacity - c.count), 0) : null;
  const today = adm.overview?.interviews.today ?? 0;
  return (
    <ul className="mt-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]" aria-label={t("dash.kpis")}>
      {enrolled && <li><GradientTile icon={Users} tone="orange" label={t("dash.kpi.enrolled")} value={Number(enrolled.value).toLocaleString()} caption={d.gender ? t("reg.tile.girls", { g: d.gender.FEMALE ?? 0, b: d.gender.MALE ?? 0 }) : undefined} href={enrolled.href} /></li>}
      {received !== null && <li><GradientTile icon={UserPlus} tone="violet" label={t("reg.tile.received")} value={received} caption={open !== null ? t("reg.tile.received.cap", { n: open }) : undefined} spark={series.some((n) => n > 0) ? series : undefined} href="/admissions" /></li>}
      {reg && <li><GradientTile icon={CalendarClock} tone="teal" label={t("reg.tile.interviews")} value={reg.interviews.total} caption={reg.interviews.total === 0 ? t("reg.tile.interviews.none") : t("reg.tile.interviews.cap", { n: today })} href="/admissions/interviews" /></li>}
      {left !== null && <li><GradientTile icon={DoorOpen} tone={left === 0 ? "rose" : "indigo"} label={t("reg.tile.places")} value={left} caption={t("reg.tile.places.cap")} href="/admissions/registration" /></li>}
      {enquiries && <li><GradientTile icon={Inbox} tone={Number(enquiries.value) > 0 ? "rose" : "green"} label={t("dash.kpi.enquiries")} value={String(enquiries.value)} caption={t("reg.tile.enquiries.cap")} href={enquiries.href} /></li>}
    </ul>
  );
}

function Received({ env, className }: { env: DashEnv; className: string }) {
  const { t, fmtDay, o } = env;
  const pts = o.applications;
  if (!pts || pts.length < 2) return null;
  const total = pts.reduce((n, p) => n + p.count, 0);
  const avg = pts.map((_, i) => { const w = pts.slice(Math.max(0, i - 6), i + 1); return Math.round((w.reduce((a, b) => a + b.count, 0) / w.length) * 10) / 10; });
  return (
    <Panel className={className} title={t("reg.rec.title")} subtitle={`${t("reg.rec.sub")} · ${total}`} right={<Link href="/admissions" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      {total === 0 ? <EmptyLine>{t("dash.chart.pipeline.empty")}</EmptyLine> : <BarLineChart height={210} kind="count" label={t("reg.rec.title")} summary={t("reg.rec.sub")} barLabel={t("reg.tile.received")} lineLabel={t("dash.fees.avg7")} points={pts.map((p, i) => ({ key: p.date, label: fmtDay(p.date), bar: p.count, line: avg[i]! }))} />}
    </Panel>
  );
}

function Standing({ env, className }: { env: DashEnv; className: string }) {
  const { t, d } = env;
  const items = (d.pipeline ?? []).filter((p) => p.value > 0);
  const total = items.reduce((n, p) => n + p.value, 0);
  if (total === 0) return null;
  return (
    <Panel className={className} title={t("reg.status.title")} subtitle={t("dash.chart.pipeline.sub", { total })}>
      <DonutStat label={t("reg.status.title")} center={total} caption={t("reg.status.center")} segments={items.map((p) => ({ label: t(`adm.status.${p.label}` as "adm.status.APPLIED"), value: p.value, color: STATUS_COLOR[p.label] ?? "#4b5a52" }))} />
    </Panel>
  );
}

function Interviews({ env, reg, className }: { env: DashEnv; reg: RegistrarHome | null; className: string }) {
  const { t, school, locale } = env;
  if (!reg) return null;
  return (
    <Panel className={className} title={t("reg.iv.title")} subtitle={t("reg.iv.sub")} right={<Link href="/admissions/interviews" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      {reg.interviews.rows.length === 0 ? <EmptyLine>{t("reg.iv.none")}</EmptyLine> : (
        <DashTable min="28rem" head={[{ label: t("adm.applicant") }, { label: t("learn.class") }, { label: t("reg.iv.when") }, { label: t("reg.iv.where") }]}>
          {reg.interviews.rows.map((r) => (
            <tr key={r.id}>
              <Cell className="font-medium text-ink"><Link href={`/admissions/interviews/${r.applicationId}`} className="hover:text-link hover:underline">{r.name}</Link></Cell>
              <Cell>{r.className ?? "—"}</Cell>
              <Cell className="whitespace-nowrap">{displayDateTime(r.at, school.timezone, locale)}</Cell>
              <Cell className="text-muted">{r.location ?? "—"}</Cell>
            </tr>
          ))}
        </DashTable>
      )}
    </Panel>
  );
}

function ByClass({ env, reg, className }: { env: DashEnv; reg: RegistrarHome | null; className: string }) {
  const { t } = env;
  if (!reg || reg.byClass.length === 0) return null;
  return <Panel className={className} title={t("reg.byclass.title")} subtitle={t("reg.byclass.sub")}><ColorBars label={t("reg.byclass.title")} labelWidth="5.5rem" items={reg.byClass.map((c) => ({ label: c.name, value: c.count }))} /></Panel>;
}

/** Every class with students, once: girls and boys as one bar, and how many places are left where the school has set a limit. */
function Room({ env, className }: { env: DashEnv; className: string }) {
  const { t, o } = env;
  const rows = (o.byGender ?? []).filter((c) => c.female + c.male > 0);
  if (rows.length === 0) return null;
  const cap = new Map((o.fill ?? []).map((f) => [f.name, f.capacity]));
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.female + r.male, cap.get(r.name) ?? 0)));
  return (
    <Panel className={className} title={t("reg.room.title")} subtitle={t("reg.room.sub")} right={<Link href="/students" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      <ul className="space-y-3">
        {rows.map((r) => {
          const total = r.female + r.male;
          const limit = cap.get(r.name) ?? null;
          const left = limit === null ? null : limit - total;
          return (
            <li key={r.classId}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <Link href={`/students?classId=${r.classId}`} className="truncate font-medium text-ink hover:text-link hover:underline">{r.name}</Link>
                <span className="shrink-0 tabular-nums"><span className="font-semibold text-ink">{total}</span>{limit !== null && <span className="text-muted">/{limit}</span>}{left !== null && <span className={`ml-2 text-xs ${left <= 0 ? "font-medium text-bad" : left <= 2 ? "text-warn" : "text-ok"}`}>{left <= 0 ? t("reg.room.full") : t("reg.room.left", { n: left })}</span>}</span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-sm bg-line" role="img" aria-label={`${r.name}: ${total}${limit !== null ? `/${limit}` : ""}`}>
                <div className="absolute inset-y-0 left-0 flex overflow-hidden rounded-sm" style={{ width: `${(total / scale) * 100}%` }}>
                  <span className="h-full bg-[#8b80ff]" style={{ width: `${(r.female / total) * 100}%` }} title={`${t("reg.girls")}: ${r.female}`} />
                  <span className="h-full bg-[#14a3b8]" style={{ width: `${(r.male / total) * 100}%` }} title={`${t("reg.boys")}: ${r.male}`} />
                </div>
                {limit !== null && <span aria-hidden className="absolute -top-0.5 h-3 w-0.5 rounded-sm bg-ink/70" style={{ left: `calc(${(limit / scale) * 100}% - 1px)` }} />}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-[#8b80ff]" />{t("reg.girls")}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-[#14a3b8]" />{t("reg.boys")}</span>
        {(o.fill?.length ?? 0) > 0 && <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-0.5 rounded-sm bg-ink/70" />{t("reg.room.title")}</span>}
      </p>
    </Panel>
  );
}

function Latest({ env, className }: { env: DashEnv; className: string }) {
  const { t, d, locale } = env;
  const rows = d.recentApplications;
  if (!rows || rows.length === 0) return null;
  return (
    <Panel className={className} title={t("reg.recent.title")} right={<Link href="/admissions" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      <ul className="divide-y divide-line">
        {rows.slice(0, 6).map((a) => (
          <li key={a.id}><Link href={`/admissions/${a.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-90"><PersonCell name={`${a.firstName} ${a.lastName}`} sub={`${a.className ?? "—"} · ${displayDate(a.createdAt, locale)}`} /><Pill tone={STATUS_TONE[a.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`adm.status.${a.status}` as "adm.status.APPLIED")}</Pill></Link></li>
        ))}
      </ul>
    </Panel>
  );
}

/** The newest students given a Student ID: a short list, not a table (name, number and class, and the day). */
export function Students({ env, reg, className }: { env: DashEnv; reg: RegistrarHome | null; className: string }) {
  const { t, locale } = env;
  if (!reg || reg.recentStudents.length === 0) return null;
  return (
    <Panel className={className} title={t("reg.recentStudents")} subtitle={t("reg.recentStudents.sub")} right={<Link href="/students" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      <ul className="divide-y divide-line">
        {reg.recentStudents.map((s) => (
          <li key={s.id}>
            <Link href={`/students/${s.id}`} className="flex items-center justify-between gap-3 py-2 hover:opacity-90">
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{s.name}</span><span className="block truncate text-xs text-muted"><span className="tabular-nums">{s.admissionNo}</span> · {s.className ?? <span className="text-warn">{t("reg.noClass")}</span>}</span></span>
              <span className="shrink-0 text-xs text-muted">{displayDate(s.at, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The open applications that have waited longest, so none is forgotten: the days waiting turn yellow after a week and red after two. */
export function Waiting({ env, reg, className }: { env: DashEnv; reg: RegistrarHome | null; className: string }) {
  const { t } = env;
  if (!reg || reg.waiting.length === 0) return null;
  const now = Date.now();
  return (
    <Panel className={className} title={t("reg.waiting")} subtitle={t("reg.waiting.sub")} right={<Link href="/admissions" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      <DashTable min="26rem" head={[{ label: t("adm.applicant") }, { label: t("learn.class") }, { label: t("reg.waiting"), right: true }]}>
        {reg.waiting.map((a) => {
          const days = Math.max(0, Math.floor((now - a.since.getTime()) / 86_400_000));
          return (
            <tr key={a.id}>
              <Cell className="py-2"><Link href={`/admissions/${a.id}`} className="font-medium text-ink hover:text-link hover:underline">{a.name}</Link><span className="block text-xs tabular-nums text-muted">{a.applicationNo}</span></Cell>
              <Cell className="py-2">{a.className ?? "—"}</Cell>
              <Cell right className={`py-2 font-semibold ${days > 14 ? "text-bad" : days > 7 ? "text-warn" : "text-ink"}`}>{days === 0 ? t("reg.waiting.today") : days === 1 ? t("reg.waiting.day1") : t("reg.waiting.days", { n: days })}</Cell>
            </tr>
          );
        })}
      </DashTable>
    </Panel>
  );
}

/** Where the returning students are for the coming year, one bar per step (steps with nobody are left out). */
export function ReturningPanel({ env, reg, className }: { env: DashEnv; reg: RegistrarHome | null; className: string }) {
  const { t } = env;
  const r = reg?.returning;
  if (!r || r.total === 0) return null;
  const ORDER = ["NEEDS_PLACEMENT", "NEEDS_REGISTRATION", "READY_TO_ACTIVATE", "NEEDS_FEE", "WAITING_YEAR_OPEN", "ACTIVE"] as const;
  return (
    <Panel className={className} title={t("reg.returning")} subtitle={t("reg.returning.sub", { year: r.yearName })} right={<Link href="/students/returning" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      <ColorBars label={t("reg.returning")} labelWidth="9rem" max={r.total} items={ORDER.filter((k) => (r.byStage[k] ?? 0) > 0).map((k) => ({ label: t(`lc.stage.${k}` as "lc.stage.ACTIVE"), value: r.byStage[k] ?? 0 }))} />
    </Panel>
  );
}

/** The newest questions from the website that nobody has answered. */
export function EnquiriesPanel({ env, reg, className }: { env: DashEnv; reg: RegistrarHome | null; className: string }) {
  const { t, locale } = env;
  const e = reg?.enquiries;
  if (!e) return null;
  return (
    <Panel className={className} title={t("reg.enq")} subtitle={t("reg.enq.sub")} right={<Link href="/enquiries" className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline">{t("dash.table.viewAll")}<ArrowRight className="size-4" aria-hidden /></Link>}>
      {e.rows.length === 0 ? <EmptyLine>{t("reg.enq.none")}</EmptyLine> : (
        <ul className="divide-y divide-line">
          {e.rows.map((x) => (
            <li key={x.id}><Link href="/enquiries" className="block py-2 hover:opacity-90"><span className="flex items-baseline justify-between gap-3"><span className="truncate text-sm font-medium text-ink">{x.name}{x.topic && <span className="font-normal text-muted"> · {x.topic}</span>}</span><span className="shrink-0 text-xs text-muted">{displayDate(x.at, locale)}</span></span><span className="block truncate text-xs text-muted">{x.message}</span></Link></li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Sources({ env, className }: { env: DashEnv; className: string }) {
  const { t, adm } = env;
  const r = adm.overview?.received;
  if (!r || r.total === 0) return null;
  return (
    <Panel className={className} title={t("reg.source.title")}>
      <DonutStat label={t("reg.source.title")} center={r.total} caption={t("reg.status.center")} segments={[{ label: t("reg.source.online"), value: r.online, color: "#14a3b8" }, { label: t("reg.source.office"), value: r.physical, color: "#f3b94c" }]} />
    </Panel>
  );
}

export function RegistrarBody({ env, reg }: { env: DashEnv; reg: RegistrarHome | null }) {
  const events = (env.o.events ?? []).flatMap((e) => (e.to ? [e.from, e.to] : [e.from]));
  const interviews = (reg?.interviews.rows ?? []).map((r) => r.at.toISOString().slice(0, 10));
  return (
    <>
      <Strip env={env} reg={reg} />
      <Row><Received env={env} className={W} /><Standing env={env} className={T} /><MonthCard className="flex-[1_1_19rem]" label={env.t("dash.events.title")} today={env.d.today} locale={env.locale} events={events} marked={interviews} eventsLabel={env.t("dash.events.title")} markedLabel={env.t("reg.iv.title")} /></Row>
      <Row><Interviews env={env} reg={reg} className={W} /><ByClass env={env} reg={reg} className={T} /><Sources env={env} className={T} /></Row>
      <Row><Waiting env={env} reg={reg} className={W} /><Students env={env} reg={reg} className={N} /></Row>
      <Row><Room env={env} className={W} /><ReturningPanel env={env} reg={reg} className={N} /></Row>
      <Row><Latest env={env} className={N} /><EnquiriesPanel env={env} reg={reg} className={N} /><AttendanceTrendPanel env={env} className={W} /></Row>
    </>
  );
}
