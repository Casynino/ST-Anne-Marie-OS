import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowRight, Plus, Search, UserRound } from "lucide-react";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { listStudents } from "@/server/students";
import { classOverview, type ClassCard } from "@/server/student-classes";
import { listClasses } from "@/server/academics";
import { ageOn } from "@/lib/dates";
import { ExportMenu } from "@/components/export-menu";
import { CountTabs, Figures } from "@/components/lifecycle/parts";
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
          {!card && ctx.permissions.has("registration.read") && <LinkButton href="/students/returning" variant="secondary">{t("lc.nav.returning")}</LinkButton>}
          {!card && ctx.permissions.has("student.import") && <LinkButton href="/students/import" variant="secondary">{t("imp.title")}</LinkButton>}
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
  return (
    <>
      {header}
      {viewBar}
      {!overview.year ? <EmptyState>{t("student.class.noYear")}</EmptyState> : (
        <>
          <Figures items={[
            { label: t("student.fig.enrolled"), value: overview.enrolled },
            { label: t("student.fig.classes"), value: overview.cards.length },
            { label: t("student.fig.noClass"), value: overview.noClass, tone: overview.noClass ? "warn" : "ok" },
          ]} />
          {overview.noClass > 0 && ctx.permissions.has("student.enroll") && (
            <Link href="/admissions/placement" className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
              <UserRound className="size-5 text-warn" aria-hidden />
              <span className="min-w-0 flex-1"><strong className="block font-semibold text-ink">{t("student.class.noClassTitle")} · {overview.noClass}</strong><span className="text-muted">{t("student.class.noClassHint")}</span></span>
              <span className="inline-flex items-center gap-1 font-medium text-link">{t("student.noClass.go")}<ArrowRight className="size-4" aria-hidden /></span>
            </Link>
          )}
          {levels.map((level) => {
            const cards = overview.cards.filter((c) => c.level === level);
            return (
              <section key={level} className="mb-8">
                <h2 className="mb-3 flex items-baseline gap-3 text-[13px] font-semibold uppercase tracking-[.14em] text-ink">
                  {level}<span className="text-xs font-normal normal-case tracking-normal text-muted">{cards.reduce((n, c) => n + c.count, 0)}</span>
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {cards.map((c) => <li key={c.id}><ClassCardView c={c} t={t} /></li>)}
                </ul>
              </section>
            );
          })}
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

function ClassCardView({ c, t }: { c: ClassCard; t: Awaited<ReturnType<typeof getT>> }) {
  const pct = c.capacity ? Math.min(100, Math.round((c.count / c.capacity) * 100)) : null;
  const tone = pct === null ? "bg-brand-500" : pct >= 100 ? "bg-bad" : pct >= 85 ? "bg-warn" : "bg-brand-500";
  return (
    <Link href={`/students?classId=${c.id}`} className={`group flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-link/50 hover:shadow-[var(--shadow-lift)] ${c.count === 0 ? "opacity-75" : ""}`}>
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{c.name}</span>
          <span className="mt-0.5 block text-xs text-muted">{c.streams.length ? c.streams.map((s) => `${s.name} ${s.count}`).join(" · ") : c.level}</span>
        </span>
        <span className="text-right">
          <span className="block text-[1.75rem] font-semibold leading-8 tabular-nums text-ink">{c.count}</span>
          {c.capacity && <span className="block text-xs tabular-nums text-muted">/ {c.capacity}</span>}
        </span>
      </span>
      {pct !== null && <span className="block h-1.5 overflow-hidden rounded-sm bg-line" role="img" aria-label={t("student.class.places", { n: c.count, cap: c.capacity ?? 0 })}><span className={`block h-full rounded-sm ${tone}`} style={{ width: `${pct}%` }} /></span>}
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span>{t("student.class.girls", { n: c.girls })}</span><span>{t("student.class.boys", { n: c.boys })}</span>
      </span>
      <span className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
        <span className={`min-w-0 truncate ${c.teachers.length ? "text-ink" : "text-muted"}`}>{c.teachers.length ? t("student.class.teacher", { name: c.teachers.join(", ") }) : t("student.class.noTeacher")}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-link"><ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
      </span>
    </Link>
  );
}
