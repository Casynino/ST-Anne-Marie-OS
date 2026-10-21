import Link from "next/link";
import type { Metadata } from "next";
import { requireContext, getT } from "@/lib/auth/next";
import { db } from "@/lib/db";
import { displayDate } from "@/lib/dates";
import { pinOverview } from "@/server/library-identity";
import { ActionForm } from "@/components/form";
import { Badge, Card, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import { LibraryNav } from "@/components/library/subnav";
import { setPinAction, setPinsAction } from "../actions";

export const metadata: Metadata = { title: "Student library PINs" };

/** Students' library PINs: set for a whole class at once or one student at a time. A PIN is shown only once and stored only as a hash. */
export default async function StudentPinsPage({ searchParams }: { searchParams: Promise<{ classId?: string }> }) {
  const [ctx, t, sp] = await Promise.all([requireContext(), getT(), searchParams]);
  if (!ctx.permissions.has("library.pin")) return <NoAccess t={t} />;
  const classes = await db.schoolClass.findMany({ where: { schoolId: ctx.schoolId, isActive: true }, orderBy: [{ level: { sortOrder: "asc" } }, { sortOrder: "asc" }], select: { id: true, name: true } });
  const classId = classes.find((c) => c.id === sp.classId)?.id;
  const rows = classId ? await pinOverview(ctx, classId) : [];
  const missing = rows.filter((r) => !r.hasPin).length;
  return (
    <>
      <PageHeader title={t("lib.nav.pins")} subtitle={t("lib.pin.sub")} />
      <LibraryNav ctx={ctx} t={t} current="/library-admin/students" />
      <ul className="mb-5 flex flex-wrap gap-2">{classes.map((c) => <li key={c.id}><Link href={`/library-admin/students?classId=${c.id}`} aria-current={c.id === classId ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${c.id === classId ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-surface"}`}>{c.name}</Link></li>)}</ul>
      {!classId ? <EmptyState>{t("lib.pin.choose")}</EmptyState> : rows.length === 0 ? <EmptyState>{t("lib.pin.noStudents")}</EmptyState> : (
        <div className="space-y-4">
          <Card title={t("lib.pin.bulk")}>
            <p className="mb-3 text-sm text-muted">{t("lib.pin.bulk.body", { n: String(missing) })}</p>
            <div className="flex flex-wrap gap-4">
              <ActionForm action={setPinsAction} submitLabel={t("lib.pin.missing", { n: String(missing) })} inline><input type="hidden" name="classId" value={classId} /><input type="hidden" name="mode" value="missing" /></ActionForm>
              <ActionForm action={setPinsAction} submitLabel={t("lib.pin.reset")} inline tone="danger" confirm={t("lib.pin.reset.confirm")}><input type="hidden" name="classId" value={classId} /><input type="hidden" name="mode" value="reset" /></ActionForm>
            </div>
          </Card>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-canvas text-left text-xs text-muted"><tr><th className="px-3 py-2">{t("common.name")}</th><th className="px-3 py-2">{t("lib.pin.schoolId")}</th><th className="px-3 py-2">PIN</th><th className="px-3 py-2" /></tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">{r.name}</td><td className="px-3 py-2 font-mono">{r.schoolId}</td>
                    <td className="px-3 py-2">{r.hasPin ? <Badge tone="ok">{t("lib.pin.set")}{r.setAt ? ` · ${displayDate(r.setAt, ctx.locale)}` : ""}</Badge> : <Badge tone="warn">{t("lib.pin.notSet")}</Badge>}</td>
                    <td className="px-3 py-2"><ActionForm action={setPinAction} submitLabel={r.hasPin ? t("lib.pin.new") : t("lib.pin.give")} inline><input type="hidden" name="studentId" value={r.id} /></ActionForm></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
