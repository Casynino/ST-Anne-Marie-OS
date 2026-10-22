import type { Translate } from "@/lib/i18n";
import { displayDate } from "@/lib/dates";
import type { TimelineEntry } from "@/server/year-readiness";

/** One student's years at school, newest first, in plain words (no raw codes). */
export function Timeline({ entries, t, locale, limit }: { entries: TimelineEntry[]; t: Translate; locale: "EN" | "SW"; limit?: number }) {
  if (entries.length === 0) return <p className="text-sm text-muted">—</p>;
  return (
    <ol className="space-y-2 text-sm">
      {entries.slice(0, limit ?? entries.length).map((e, i) => {
        let title = "";
        let detail = "";
        if (e.kind === "ENROLMENT") {
          title = `${e.year}: ${e.className}${e.streamName ? ` · ${e.streamName}` : ""}`;
          detail = [t(`lc.tl.enrol.${e.status}` as "lc.tl.enrol.ACTIVE"), e.endedOn ? t("lc.tl.until", { date: displayDate(e.endedOn, locale) }) : null].filter(Boolean).join(" · ");
        } else if (e.kind === "STATUS") {
          title = t("lc.tl.status", { from: t(`student.status.${e.from}` as "student.status.ENROLLED"), to: t(`student.status.${e.to}` as "student.status.ENROLLED") });
          detail = e.reason;
        } else if (e.kind === "DECISION") {
          title = `${e.year}: ${t(`lc.outcome.${e.outcome}` as "lc.outcome.PROMOTED")}${e.toClass ? ` → ${e.toClass}` : ""}`;
          detail = [t(`lc.status.${e.status}` as "lc.status.DRAFT"), e.exception ? t("lc.tl.exception", { reason: e.exception }) : null].filter(Boolean).join(" · ");
        } else {
          title = `${e.year}: ${t(`lc.reg.${e.status}` as "lc.reg.PENDING")}${e.className ? ` · ${e.className}` : ""}`;
          detail = e.cancelReason ?? "";
        }
        return (
          <li key={i}>
            <p className="font-medium">{title}</p>
            <p className="text-xs text-muted">{displayDate(e.at, locale)}{detail ? ` · ${detail}` : ""}</p>
          </li>
        );
      })}
    </ol>
  );
}
