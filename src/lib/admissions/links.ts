import type { WorkflowState } from "@/lib/admissions/rules";

/**
 * The screen that fits where an applicant stands, so opening a record from a list shows that stage and never the earlier application page:
 * the interview workspace while the interview and its examinations are going on, the admission and payment view once accepted, and the
 * application itself only while it is under review (or finished). The application is always reachable by its own "Application details" link.
 */
export function stageHref(r: { id: string; state: WorkflowState; interviewId?: string | null }): string {
  switch (r.state) {
    case "INTERVIEW_SCHEDULED": case "AWAITING_DECISION": return `/admissions/interviews/${r.interviewId ?? r.id}`;
    case "ACCEPTED": return `/admissions/accepted/${r.id}`;
    default: return `/admissions/${r.id}`;
  }
}
