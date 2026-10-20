export const SUBMISSION_TONE = { DRAFT: "neutral", SUBMITTED: "warn", APPROVED: "brand", LOCKED: "ok", RETURNED: "bad" } as const;
export type SubmissionStatusKey = keyof typeof SUBMISSION_TONE;
