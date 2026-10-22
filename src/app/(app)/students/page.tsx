import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, GraduationCap, LayoutGrid, Plus, Repeat2, Search, Upload, UserRound, Users } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { listStudents } from "@/server/students";
import { classOverview, type ClassCard } from "@/server/student-classes";
import { listClasses } from "@/server/academics";
import { ageOn } from "@/lib/dates";
import { ExportMenu } from "@/components/export-menu";
import { CountTabs } from "@/components/lifecycle/parts";
import { Cell, DashTable, DonutStat, GradientTile, Panel, SERIES_COLORS } from "@/components/dash/parts";
import { Row } from "@/components/dash/rows";
import { Badge, DataTable, EmptyState, FilterBar, LinkButton, NoAccess, PageHeader, Pagination, Td } from "@/components/ui";
import { Field } from "@/components/form";

export const metadata: Metadata = { title: "Students" };
type Search = { q?: string; classId?: string; streamId?: string; status?: string; page?: string; view?: string };

const STATUS_TONE = { ENROLLED: "ok", TRANSFERRED: "warn", WITHDRAWN: "bad", GRADUATED: "brand" } as const;
const nameOf = (s: { firstName: string; middleName: string | null; lastName: string }) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");

/**
 * Students are arranged by class. The default view is one card per class (how many, how full, the streams, the class teacher); a card opens the
 * class roster, with a tab for each stream. A search or the "all students" view gives a plain A to Z list for finding one person quickly.
 */
export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["student.read", "student.read_assigned"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const flat = Boolean(sp.q || sp.status || sp.view === "all");
  const overview = await classOverview(ctx);
  const card = sp.classId && !flat ? overview.cards.find((c) => c.id === sp.classId) : undefined;
  if (sp.classId && !flat && !card) notFound();

  const exportParams = new URLSearchParams(Object.entries({ q: sp.q ?? "", classId: sp.classId ?? "", status: sp.status ?? "" }).filter(([, v]) => v));
  const header = (
    <PageHeader
      title={card ? card.name : t("student.title")}
      subtitle={card ? `${card.level} · ${card.count === 1 ? t("student.class.one") : t("student.class.count", { n: card.count })}${card.capacity ? ` · ${t("student.class.places", { n: card.count, cap: card.capacity })}` : ""}` : undefined}
      actions={
        <>
          {card && <Link href="/students" className="text-sm font-medium text-link hover:underline">{t("student.class.back")}</Link>}
          <ExportMenu base={`/api/export/students?${exportParams}`} t={t} />
          {!card && ctx.permissions.has("registration.read") && <LinkButton href="/students/returning" variant="secondary"><Repeat2 className="size-4" aria-hidden /> {t("lc.nav.returning")}</LinkButton>}
          {!card && ctx.permissions.has("student.import") && <LinkButton href="/students/import" variant="secondary"><Upload className="size-4" aria-hidden /> {t("imp.title")}</LinkButton>}
          {ctx.permissions.has("student.create") && <LinkButton href="/students/new"><Plus className="size-4" aria-hidden /> {t("student.new")}</LinkButton>}
        </>
      }
    />
  );

  // The view switch and the search box sit above every view.
  const viewBar = !card && (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <CountTabs items={[
        { href: "/students", label: t("student.view.classes"), active: !flat },
        { href: "/students?view=all", label: t("student.view.all"), active: flat },
      ]} />
      <form method="get" className="mb-4 flex items-center gap-2">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input name="q" defaultValue={sp.q ?? ""} placeholder={t("student.search")} aria-label={t("common.search")} className="min-h-11 w-72 max-w-full pl-9 pr-3 text-[15px]" />
        </label>
        <button className="btn-secondary min-h-11 px-4 text-sm">{t("common.search")}</button>
      </form>
    </div>
  );

  // ── One class: its roster, with a tab per stream
  if (card) {
    const { items, total } = await listStudents(ctx, { classId: card.id, streamId: sp.streamId, all: true });
    const streamName = new Map(card.streams.map((s) => [s.id, s.name]));
    return (
      <>
        {header}
        <p className="-mt-3 mb-4 text-sm text-muted">{card.teachers.length ? t("student.class.teacher", { name: card.teachers.join(", ") }) : t("student.class.noTeacher")}</p>
        {card.streams.length > 0 && (
          <CountTabs items={[
            { href: `/students?classId=${card.id}`, label: t("student.class.allStreams"), count: card.count, active: !sp.streamId },
            ...card.streams.map((s) => ({ href: `/students?classId=${card.id}&streamId=${s.id}`, label: s.name, count: s.count, active: sp.streamId === s.id })),
          ]} />
        )}
        {items.length === 0 ? <EmptyState>{t("student.class.empty")}</EmptyState> : (
          <DataTable head={[t("student.class.rollNo"), t("common.name"), t("student.admissionNo"), ...(card.streams.length && !sp.streamId ? [t("student.stream")] : []), t("student.gender"), t("student.age"), t("common.status")]}>
            {items.map((s, i) => (
              <tr key={s.id} className="hover:bg-canvas">
                <Td className="w-12 tabular-nums text-muted">{i + 1}</Td>
                <Td><Link href={`/students/${s.id}`} className="font-medium text-link hover:underline">{nameOf(s)}</Link></Td>
                <Td className="whitespace-nowrap tabular-nums">{s.admissionNo}</Td>
                {card.streams.length > 0 && !sp.streamId && <Td>{s.enrollments[0]?.streamId ? streamName.get(s.enrollments[0].streamId) ?? "—" : "—"}</Td>}
                <Td>{s.gender === "MALE" ? t("student.male") : t("student.female")}</Td>
                <Td>{ageOn(s.dateOfBirth)}</Td>
                <Td><Badge tone={STATUS_TONE[s.status]}>{t(`student.status.${s.status}`)}</Badge></Td>
              </tr>
            ))}
          </DataTable>
        )}
        <p className="mt-3 text-sm text-muted">{total === 1 ? t("student.class.one") : t("student.class.count", { n: total })}</p>
      </>
    );
  }

  // ── The plain A to Z list (search results, status filters, "all students")
  if (flat) {
    const page = Math.max(1, Number(sp.page) || 1);
    const [{ items, total, pageSize }, classes] = await Promise.all([
      listStudents(ctx, { q: sp.q, classId: sp.classId, status: sp.status, page }),
      ctx.permissions.has("academic.read") ? listClasses(ctx) : Promise.resolve([]),
    ]);
    return (
      <>
        {header}
        {viewBar}
        <FilterBar t={t} resetHref="/students?view=all">
          <input type="hidden" name="view" value="all" />
          <Field name="q" label={t("common.search")} defaultValue={sp.q} placeholder={t("student.search")} className="min-w-56 flex-1" />
          <Field name="classId" label={t("student.class")} type="select" defaultValue={sp.classId} placeholder={t("common.all")} options={classes.map((c) => ({ value: c.id, label: c.name }))} />
          <Field name="status" label={t("common.status")} type="select" defaultValue={sp.status} placeholder={t("common.all")} options={(["ENROLLED", "TRANSFERRED", "WITHDRAWN", "GRADUATED"] as const).map((s) => ({ value: s, label: t(`student.status.${s}`) }))} />
        </FilterBar>
        {items.length === 0 ? <EmptyState>{t("common.noResults")}</EmptyState> : (
          <DataTable head={[t("common.name"), t("student.admissionNo"), t("student.class"), t("student.gender"), t("student.age"), t("common.status")]}>
            {items.map((s) => {
              const enr = s.enrollments[0];
              return (
                <tr key={s.id} className="hover:bg-canvas">
                  <Td><Link href={`/students/${s.id}`} className="font-medium text-link hover:underline">{nameOf(s)}</Link></Td>
                  <Td className="whitespace-nowrap tabular-nums">{s.admissionNo}</Td>
                  <Td>{enr ? <Link href={`/students?classId=${enr.classId}`} className="hover:text-link hover:underline">{enr.class.name}{enr.stream ? ` – ${enr.stream.name}` : ""}</Link> : <span className="text-muted">{t("student.notPlaced")}</span>}</Td>
                  <Td>{s.gender === "MALE" ? t("student.male") : t("student.female")}</Td>
                  <Td>{ageOn(s.dateOfBirth)}</Td>
                  <Td><Badge tone={STATUS_TONE[s.status]}>{t(`student.status.${s.status}`)}</Badge></Td>
                </tr>
              );
            })}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} basePath="/students" params={{ q: sp.q, classId: sp.classId, status: sp.status, view: "all" }} t={t} />
      </>
    );
  }

  // ── Default: one card per class, grouped by level
  const levels = [...new Set(overview.cards.map((c) => c.level))];
  const formerTotal = overview.former.TRANSFERRED + overview.former.WITHDRAWN + overview.former.GRADUATED;
  const girls = overview.cards.reduce((n, c) => n + c.girls, 0), boys = overview.cards.reduce((n, c) => n + c.boys, 0);
  return (
    <>
      {header}
      {viewBar}
      {!overview.year ? <EmptyState>{t("student.class.noYear")}</EmptyState> : (
        <>
          <ul className="mb-5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
            <li><GradientTile icon={GraduationCap} tone="orange" label={t("student.fig.enrolled")} value={overview.enrolled} caption={t("reg.tile.girls", { g: girls, b: boys })} /></li>
            <li><GradientTile icon={LayoutGrid} tone="violet" label={t("student.fig.classes")} value={overview.cards.length} caption={levels.join(" · ")} /></li>
            <li><GradientTile icon={Users} tone={overview.noClass > 0 ? "rose" : "green"} label={t("student.fig.noClass")} value={overview.noClass} href={overview.noClass > 0 && ctx.permissions.has("student.enroll") ? "/admissions/placement" : undefined} /></li>
          </ul>
          {overview.noClass > 0 && ctx.permissions.has("student.enroll") && (
            <Link href="/admissions/placement" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
              <UserRound className="size-5 text-warn" aria-hidden />
              <span className="min-w-0 flex-1"><strong className="block font-semibold text-ink">{t("student.class.noClassTitle")} · {overview.noClass}</strong><span className="text-muted">{t("student.class.noClassHint")}</span></span>
              <span className="inline-flex items-center gap-1 font-medium text-link">{t("student.noClass.go")}<ArrowRight className="size-4" aria-hidden /></span>
            </Link>
          )}
          <Row>
            <Panel className="flex-[3_1_40rem]" title={t("student.view.classes")} subtitle={t("student.class.count", { n: overview.enrolled })}>
              <DashTable min="40rem" head={[{ label: t("student.class") }, { label: t("student.fig.enrolled") }, { label: t("student.gender") }, { label: t("student.class.teacherCol") }, { label: "" }]}>
                {levels.flatMap((level) => {
                  const cards = overview.cards.filter((c) => c.level === level);
                  return [
                    <tr key={`h-${level}`} className="bg-canvas/50"><td colSpan={5} className="px-5 py-1.5 text-xs font-semibold uppercase tracking-[.12em] text-muted">{level} <span className="ml-1 font-normal normal-case tracking-normal">· {cards.reduce((n, c) => n + c.count, 0)}</span></td></tr>,
                    ...cards.map((c) => <ClassRow key={c.id} c={c} t={t} />),
                  ];
                })}
              </DashTable>
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-[#8b80ff]" />{t("student.female")}</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm bg-[#14a3b8]" />{t("student.male")}</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-0.5 rounded-sm bg-ink/70" />{t("class.capacity")}</span>
              </p>
            </Panel>
            <div className="flex flex-[1_1_19rem] flex-col gap-4">
              <Panel title={t("student.byLevel")}>
                <DonutStat label={t("student.byLevel")} center={overview.enrolled} caption={t("student.fig.enrolled")} segments={levels.map((l, i) => ({ label: l, value: overview.cards.filter((c) => c.level === l).reduce((n, c) => n + c.count, 0), color: SERIES_COLORS[i % SERIES_COLORS.length]! }))} />
              </Panel>
              <Panel title={t("dash.gender.title")}>
                <DonutStat label={t("dash.gender.title")} center={girls + boys} caption={t("student.fig.enrolled")} segments={[{ label: t("student.female"), value: girls, color: "#8b80ff", text: `${girls} · ${girls + boys > 0 ? Math.round((girls / (girls + boys)) * 100) : 0}%` }, { label: t("student.male"), value: boys, color: "#14a3b8", text: `${boys} · ${girls + boys > 0 ? Math.round((boys / (girls + boys)) * 100) : 0}%` }]} />
              </Panel>
            </div>
          </Row>
          {formerTotal > 0 && (
            <p className="text-sm text-muted">
              {t("student.class.former")}:{" "}
              {(["GRADUATED", "TRANSFERRED", "WITHDRAWN"] as const).filter((s) => overview.former[s] > 0).map((s, i) => (
                <span key={s}>{i > 0 && " · "}<Link href={`/students?view=all&status=${s}`} className="hover:text-link hover:underline">{t(`student.status.${s}`)} {overview.former[s]}</Link></span>
              ))}
            </p>
          )}
        </>
      )}
    </>
  );
}

function ClassRow({ c, t }: { c: ClassCard; t: Awaited<ReturnType<typeof getT>> }) {
  const left = c.capacity === null ? null : c.capacity - c.count;
  const total = c.girls + c.boys;
  const scale = Math.max(c.capacity ?? 0, c.count, 1);
  return (
    <tr className={`hover:bg-canvas/60 ${c.count === 0 ? "text-muted" : ""}`}>
      <Cell className="py-2.5"><Link href={`/students?classId=${c.id}`} className="font-medium text-ink hover:text-link hover:underline">{c.name}</Link>{c.streams.length > 0 && <span className="ml-2 text-xs text-muted">{c.streams.map((s) => `${s.name} ${s.count}`).join(" · ")}</span>}</Cell>
      <Cell className="py-2.5">
        <span className="flex items-center gap-3">
          <span className="w-16 shrink-0 tabular-nums"><span className="text-base font-semibold text-ink">{c.count}</span>{c.capacity !== null && <span className="text-xs text-muted">/{c.capacity}</span>}</span>
          <span className="relative block h-2 w-full min-w-24 max-w-52 rounded-sm bg-line" role="img" aria-label={`${t("student.class.girls", { n: c.girls })}, ${t("student.class.boys", { n: c.boys })}`}>
            {total > 0 && <span className="absolute inset-y-0 left-0 flex overflow-hidden rounded-sm" style={{ width: `${(c.count / scale) * 100}%` }}><span className="h-full bg-[#8b80ff]" style={{ width: `${(c.girls / total) * 100}%` }} /><span className="h-full bg-[#14a3b8]" style={{ width: `${(c.boys / total) * 100}%` }} /></span>}
            {c.capacity !== null && <span aria-hidden className="absolute -top-0.5 h-3 w-0.5 rounded-sm bg-ink/70" style={{ left: `calc(${(c.capacity / scale) * 100}% - 1px)` }} />}
          </span>
          {left !== null && <span className={`w-14 shrink-0 text-xs font-medium ${left <= 0 ? "text-bad" : left <= 2 ? "text-warn" : "text-ok"}`}>{left <= 0 ? t("reg.room.full") : t("reg.room.left", { n: left })}</span>}
        </span>
      </Cell>
      <Cell className="whitespace-nowrap py-2.5 text-sm tabular-nums">{c.girls} <span className="text-muted">/</span> {c.boys}</Cell>
      <Cell className="max-w-56 truncate py-2.5 text-sm">{c.teachers.length ? c.teachers.join(", ") : <span className="text-muted">{t("student.class.noTeacher")}</span>}</Cell>
      <Cell right className="py-2.5"><Link href={`/students?classId=${c.id}`} aria-label={c.name} className="inline-flex text-link"><ArrowRight className="size-4" aria-hidden /></Link></Cell>
    </tr>
  );
}
