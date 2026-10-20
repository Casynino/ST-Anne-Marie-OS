"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { ActionForm, useFormValues } from "@/components/form";
import { SubmitButton } from "@/components/submit-button";
import type { ActionState } from "@/lib/action";

type Band = { grade: string; min: number; max: number };
export type GridRow = { studentId: string; admissionNo: string; name: string; studentStatus: string; status: "" | "ABSENT" | "EXEMPT"; score: string };
type Labels = {
  student: string; score: string; mode: string; scoreMode: string; absent: string; exempt: string; grade: string; save: string; submit: string; confirmSubmit: string;
  entered: string; outOf: string; withdrawn: string; notEntered: string; readOnly: string;
};

function preview(score: string, max: number, bands: Band[]): { percent: number; grade: string | null } | null {
  const s = score.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (n > max) return null;
  const percent = Math.round((n / max) * 10000) / 100;
  const band = [...bands].sort((a, b) => b.min - a.min).find((b) => b.min <= percent);
  return { percent, grade: band?.grade ?? null };
}

function Rows({ rows, max, bands, editable, labels }: { rows: GridRow[]; max: number; bands: Band[]; editable: boolean; labels: Labels }) {
  const { errors } = useFormValues();
  const [state, setState] = useState(() => Object.fromEntries(rows.map((r) => [r.studentId, { score: r.score, status: r.status }])));
  const set = (id: string, patch: Partial<{ score: string; status: GridRow["status"] }>) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  const entered = rows.filter((r) => state[r.studentId]!.status !== "" || state[r.studentId]!.score.trim() !== "").length;

  return (
    <>
      <p className="text-sm text-muted" aria-live="polite">{labels.entered.replace("{done}", String(entered)).replace("{total}", String(rows.length))}</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="w-10 px-3 py-3 font-medium">#</th>
              <th scope="col" className="px-3 py-3 font-medium">{labels.student}</th>
              <th scope="col" className="w-32 px-3 py-3 font-medium">{labels.score} / {max}</th>
              <th scope="col" className="w-36 px-3 py-3 font-medium">{labels.mode}</th>
              <th scope="col" className="hidden w-24 px-3 py-3 font-medium sm:table-cell">{labels.grade}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, idx) => {
              const cur = state[r.studentId]!;
              const err = errors?.[`marks.${r.studentId}`];
              const p = cur.status === "" ? preview(cur.score, max, bands) : null;
              const invalid = Boolean(err) || (cur.status === "" && cur.score.trim() !== "" && !p);
              return (
                <tr key={r.studentId} className={invalid ? "bg-red-50/60" : undefined}>
                  <td className="px-3 py-2 align-top tabular-nums text-muted">{idx + 1}</td>
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted">{r.admissionNo}{r.studentStatus !== "ENROLLED" ? ` · ${labels.withdrawn}` : ""}</p>
                    {err && <p className="mt-1 flex items-start gap-1 text-xs text-bad"><AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{err}</p>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      name={`score:${r.studentId}`}
                      data-score-input
                      inputMode="decimal"
                      autoComplete="off"
                      value={cur.score}
                      disabled={!editable || cur.status !== ""}
                      onChange={(e) => set(r.studentId, { score: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-score-input]:not(:disabled)"));
                        all[all.indexOf(e.currentTarget) + 1]?.focus();
                      }}
                      aria-label={`${labels.score} — ${r.name}`}
                      aria-invalid={invalid || undefined}
                      className="block min-h-11 w-full rounded-lg border border-line bg-white px-3 py-2 text-base tabular-nums aria-[invalid=true]:border-bad disabled:bg-canvas"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <select
                      name={`status:${r.studentId}`}
                      value={cur.status}
                      disabled={!editable}
                      onChange={(e) => set(r.studentId, { status: e.target.value as GridRow["status"], ...(e.target.value ? { score: "" } : {}) })}
                      aria-label={`${labels.mode} — ${r.name}`}
                      className="block min-h-11 w-full rounded-lg border border-line bg-white px-2 py-2 text-base disabled:bg-canvas"
                    >
                      <option value="">{labels.scoreMode}</option>
                      <option value="ABSENT">{labels.absent}</option>
                      <option value="EXEMPT">{labels.exempt}</option>
                    </select>
                  </td>
                  <td className="hidden px-3 py-2 align-top sm:table-cell">
                    {p ? <span className="inline-flex items-baseline gap-1.5"><strong className="text-base">{p.grade ?? "—"}</strong><span className="text-xs text-muted tabular-nums">{p.percent}%</span></span> : <span className="text-muted">{cur.status === "" && !cur.score ? labels.notEntered : "—"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function MarkGrid({
  action, submissionId, version, rows, max, bands, editable, labels,
}: { action: (prev: ActionState, form: FormData) => Promise<ActionState>; submissionId: string; version: number; rows: GridRow[]; max: number; bands: Band[]; editable: boolean; labels: Labels }) {
  return (
    <ActionForm action={action} hideSubmit className="space-y-3">
      <input type="hidden" name="submissionId" value={submissionId} />
      <input type="hidden" name="expectedVersion" value={version} key={`v${version}`} />
      <Rows key={`rows${version}`} rows={rows} max={max} bands={bands} editable={editable} labels={labels} />
      {editable ? (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap gap-2 border-t border-line bg-white/95 px-1 py-3 backdrop-blur">
          <SubmitButton intent="save" variant="secondary">{labels.save}</SubmitButton>
          <SubmitButton intent="submit" confirm={labels.confirmSubmit}>{labels.submit}</SubmitButton>
        </div>
      ) : (
        <p className="text-sm text-muted">{labels.readOnly}</p>
      )}
    </ActionForm>
  );
}
