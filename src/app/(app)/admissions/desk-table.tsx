"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye } from "lucide-react";
import type { ActionState } from "@/lib/action";
import { Badge, EmptyState } from "@/components/ui";
import { ActionButtons, useQuickActions, type QuickLabels, type QuickLine, type QuickSlot } from "./quick-actions";

export type { QuickLabels };
export type DeskLine = QuickLine & {
  applicationNo: string; className: string | null; guardian: string | null; phone: string | null; submitted: string; online: boolean;
  state: string; stateLabel: string; stateTone: "neutral" | "ok" | "warn" | "bad" | "brand"; step: number; stepLabel: string;
  interviewLabel: string; percent: number; attention: string[];
};
export type DeskLabels = Record<"applicant" | "guardian" | "class" | "submitted" | "complete" | "interview" | "status" | "online" | "dismiss", string> & { quick: QuickLabels };

/**
 * The applications of the desk, one row each, with the buttons for the step the application is at. Each button asks in a pop-up first, and
 * afterwards the result says what was done or why it could not be.
 */
export function DeskTable({ rows, labels, quick, empty, slots, view }: {
  /** "interview": everyone listed has a confirmed interview date, so only the date, class and guardian are shown (no status, no completeness). */
  view: "review" | "interview"; empty: string; slots: QuickSlot[]; rows: DeskLine[]; labels: DeskLabels;
  quick: (prev: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const router = useRouter();
  const q = labels.quick;
  const { open, banner, popup } = useQuickActions({ labels: q, dismiss: labels.dismiss, quick, slots });

  return (
    <div className="space-y-3">
      {banner}

      {rows.length === 0 ? <EmptyState>{empty}</EmptyState> : (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              {(view === "interview" ? [labels.applicant, labels.interview, labels.class, labels.guardian, q.column] : [labels.applicant, labels.status, labels.complete, labels.interview, labels.class, labels.guardian, q.column]).map((h, i) => <th key={i} scope="col" className="px-1.5 py-3 font-medium">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,label,select")) router.push(`/admissions/${r.id}`); }}
                className="cursor-pointer hover:bg-canvas"
              >
                <td className="min-w-36 px-1.5 py-3">
                  <Link href={`/admissions/${r.id}`} className="font-semibold text-link hover:underline">{r.name}</Link>
                  <span className="block text-xs tabular-nums text-muted">{r.applicationNo}</span><span className="block text-xs text-muted">{r.submitted}{r.online ? ` · ${labels.online}` : ""}</span>
                </td>
                {view === "review" && (
                  <>
                <td className="px-1.5 py-3">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={r.stateTone}>{r.stateLabel}</Badge>
                    {r.attention.length > 0 && <span title={r.attention.join("\n")} className="inline-flex text-warn"><AlertTriangle className="size-4" aria-label={r.attention.join(", ")} /></span>}
                  </span>
                </td>
                <td className="px-1.5 py-3" title={r.missing.join(", ")}>
                  <span className="flex items-center gap-2"><span aria-hidden className="h-1.5 w-12 overflow-hidden rounded-sm bg-line"><span className="block h-full" style={{ width: `${r.percent}%`, background: r.percent === 100 ? "var(--color-ok)" : r.percent >= 60 ? "var(--color-warn)" : "var(--color-bad)" }} /></span><span className="tabular-nums">{r.percent}%</span></span>
                  {r.missing.length > 0 && <span className="block max-w-[11rem] truncate text-xs text-muted">{r.missing.join(", ")}</span>}
                </td>
                  </>
                )}
                <td className="px-1.5 py-3">
                  {view === "interview" ? (
                    <>
                      <span className="flex items-center gap-1.5 font-medium">
                        {r.interviewDetail ?? r.interviewLabel}
                        {r.attention.length > 0 && <span title={r.attention.join("\n")} className="inline-flex text-warn"><AlertTriangle className="size-4" aria-label={r.attention.join(", ")} /></span>}
                      </span>
                      {r.state !== "INTERVIEW_SCHEDULED" && <span className="mt-0.5 block text-xs text-muted">{r.stateLabel}</span>}
                    </>
                  ) : (
                    <><span className="block">{r.interviewLabel}</span>{r.interviewDetail && <span className="block whitespace-nowrap text-xs text-muted">{r.interviewDetail}</span>}</>
                  )}
                </td>
                <td className="whitespace-nowrap px-1.5 py-3">{r.className ?? "—"}</td>
                <td className="px-1.5 py-3"><span className="block">{r.guardian ?? "—"}</span><span className="block text-xs tabular-nums text-muted">{r.phone ?? ""}</span></td>
                <td className="whitespace-nowrap px-1.5 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Link href={`/admissions/${r.id}`} aria-label={`${q.view}: ${r.name}`} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-brand-500 hover:bg-tint"><Eye className="size-3.5 text-link" aria-hidden />{q.view}</Link>
                    <ActionButtons row={r} labels={q} open={open} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {popup}
    </div>
  );
}
