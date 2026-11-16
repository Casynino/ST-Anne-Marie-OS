"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AttentionRow } from "./attention-tabs";

const DOT = { bad: "bg-bad", warn: "bg-warn", info: "bg-[#8b80ff]" } as const;
const SHOWN = 4;

/**
 * The alerts the way the ZELab home does it, with no heading at all: one slim line per item (a coloured dot, what it is, the number if there is one, a
 * chevron), nothing more. The sentence about what to do sits after the title on wide screens and is dropped on a phone. The first few
 * show; the rest open with one press.
 */
export function AttentionList({ rows, heading, moreLabel, lessLabel }: { rows: AttentionRow[]; heading: string; moreLabel: string; lessLabel: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <section aria-label={heading} className="mt-3">
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {shown.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-canvas/60">
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[r.tone ?? "warn"]}`} />
              <span className="min-w-0 flex-1 truncate"><span className="font-medium text-ink">{r.text}</span>{r.detail && <span className="hidden text-muted xl:inline"> · {r.detail}</span>}</span>
              {r.count !== undefined && <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">{r.count}</span>}
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
        {rows.length > SHOWN && <li><button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="flex min-h-10 w-full items-center justify-center px-4 text-xs font-medium text-link hover:bg-canvas/60">{all ? lessLabel : moreLabel.replace("{n}", String(rows.length - SHOWN))}</button></li>}
      </ul>
    </section>
  );
}
