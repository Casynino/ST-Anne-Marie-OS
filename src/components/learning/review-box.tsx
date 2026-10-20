import { ActionForm, Field } from "@/components/form";
import { Card } from "@/components/ui";
import type { ActionState } from "@/lib/action";

export type ReviewLabels = { title: string; send: string; decision: string; approve: string; return: string; note: string; noteHint: string };

/** Approve or return a submitted plan. Returning needs a note, and the server enforces that. */
export function ReviewBox({ id, action, labels }: { id: string; action: (p: ActionState, f: FormData) => Promise<ActionState>; labels: ReviewLabels }) {
  return (
    <Card title={labels.title}>
      <ActionForm action={action} submitLabel={labels.send}>
        <input type="hidden" name="id" value={id} />
        <Field name="decision" type="select" label={labels.decision} required options={[{ value: "APPROVE", label: labels.approve }, { value: "RETURN", label: labels.return }]} />
        <Field name="note" type="textarea" label={labels.note} optionalLabel={labels.noteHint} />
      </ActionForm>
    </Card>
  );
}
