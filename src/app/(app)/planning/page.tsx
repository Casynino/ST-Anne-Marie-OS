import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT, hasAny } from "@/lib/auth/next";
import { displayDate } from "@/lib/dates";
import { listLessonPlans, listSchemes } from "@/server/lesson-plans";
import { Badge, DataTable, EmptyState, LinkButton, NoAccess, PageHeader, Td, segClass } from "@/components/ui";
import { STATUS_TONE } from "@/lib/learning/labels";

export const metadata: Metadata = { title: "Planning" };

export default async function PlanningPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  const t = await getT();
  if (!hasAny(ctx, ["plans.write", "plans.review"])) return <NoAccess t={t} />;
  const sp = await searchParams;
  const writer = hasAny(ctx, ["plans.write"]);
  const reviewer = hasAny(ctx, ["plans.review"]);
  const tab = sp.tab === "review" && reviewer ? "review" : sp.tab === "lessons" && writer ? "lessons" : writer ? "schemes" : "review";
  const [schemes, lessons] = await Promise.all([
    listSchemes(ctx, { box: tab === "review" ? "review" : "mine" }),
    listLessonPlans(ctx, { box: tab === "review" ? "review" : "mine" }),
  ]);
  const tabs = [writer && { id: "schemes", label: t("learn.schemes") }, writer && { id: "lessons", label: t("learn.lessons") }, reviewer && { id: "review", label: t("learn.plan.toReview") }].filter(Boolean) as { id: string; label: string }[];

  return (
    <>
      <PageHeader title={t("learn.plan.title")} subtitle={t("learn.plan.subtitle")} actions={writer ? <div className="flex gap-2"><LinkButton href="/planning/schemes/new" variant="secondary">{t("learn.scheme.new")}</LinkButton><LinkButton href="/planning/lessons/new">{t("learn.lesson.new")}</LinkButton></div> : undefined} />
      <nav aria-label={t("learn.plan.title")} className="mb-4 flex flex-wrap gap-2">
        {tabs.map((x) => <Link key={x.id} href={`/planning?tab=${x.id}`} aria-current={tab === x.id ? "page" : undefined} className={segClass(tab === x.id)}>{x.label}</Link>)}
      </nav>

      {(tab === "schemes" || tab === "review") && (
        <section aria-labelledby="schemes-h" className="mb-8">
          {tab === "review" && <h2 id="schemes-h" className="mb-2 text-lg font-semibold">{t("learn.schemes")}</h2>}
          <DataTable head={[t("learn.title"), t("learn.class"), t("learn.subject"), ...(tab === "review" ? [t("learn.teacher")] : []), t("learn.weeks"), t("common.status"), ""]} empty={schemes.length ? undefined : <p className="px-4 py-10 text-center text-sm text-muted">{t("learn.scheme.none")}</p>}>
            {schemes.map((s) => (
              <tr key={s.id}>
                <Td><Link href={`/planning/schemes/${s.id}`} className="font-medium text-link hover:underline">{s.title}</Link></Td>
                <Td>{s.className}</Td><Td>{s.subjectName}</Td>
                {tab === "review" && <Td>{s.teacherName}</Td>}
                <Td className="tabular-nums">{s._count.weeks}</Td>
                <Td><Badge tone={STATUS_TONE[s.status]}>{t(`learn.status.${s.status}`)}</Badge></Td>
                <Td className="text-right"><Link href={`/planning/schemes/${s.id}`} className="text-sm font-medium text-link hover:underline">{t("common.view")}</Link></Td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}
      {(tab === "lessons" || tab === "review") && (
        <section aria-labelledby="lessons-h">
          {tab === "review" && <h2 id="lessons-h" className="mb-2 text-lg font-semibold">{t("learn.lessons")}</h2>}
          <DataTable head={[t("learn.date"), t("learn.topic"), t("learn.class"), t("learn.subject"), ...(tab === "review" ? [t("learn.teacher")] : []), t("common.status"), ""]} empty={lessons.length ? undefined : <p className="px-4 py-10 text-center text-sm text-muted">{t("learn.lesson.none")}</p>}>
            {lessons.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{displayDate(p.lessonDate, ctx.locale)}</Td>
                <Td><Link href={`/planning/lessons/${p.id}`} className="font-medium text-link hover:underline">{p.topic}</Link></Td>
                <Td>{p.className}</Td><Td>{p.subjectName}</Td>
                {tab === "review" && <Td>{p.teacherName}</Td>}
                <Td><Badge tone={STATUS_TONE[p.status]}>{t(`learn.status.${p.status}`)}</Badge></Td>
                <Td className="text-right"><Link href={`/planning/lessons/${p.id}`} className="text-sm font-medium text-link hover:underline">{t("common.view")}</Link></Td>
              </tr>
            ))}
          </DataTable>
        </section>
      )}
      {tab === "review" && schemes.length === 0 && lessons.length === 0 && <EmptyState>{t("learn.plan.nothingToReview")}</EmptyState>}
    </>
  );
}
