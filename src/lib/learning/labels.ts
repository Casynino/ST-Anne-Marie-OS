import type { Translate } from "@/lib/i18n";

export const dayLabels = (t: Translate): Record<number, string> => ({ 1: t("learn.day.1"), 2: t("learn.day.2"), 3: t("learn.day.3"), 4: t("learn.day.4"), 5: t("learn.day.5"), 6: t("learn.day.6"), 7: t("learn.day.7") });

export const STATUS_TONE = { DRAFT: "neutral", SUBMITTED: "warn", APPROVED: "ok", RETURNED: "bad" } as const;
