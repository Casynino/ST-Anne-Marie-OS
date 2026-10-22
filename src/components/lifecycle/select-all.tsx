"use client";

/** One tick that ticks every row box of the same name in its form (also boxes placed elsewhere with the `form` attribute). */
export function SelectAll({ name, label, formId }: { name: string; label: string; /** The id of the form the row boxes belong to, when this box is not inside it. */ formId?: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 accent-brand-700"
      onChange={(e) => {
        const form = formId ? (document.getElementById(formId) as HTMLFormElement | null) : e.currentTarget.form;
        if (!form) return;
        // `form.elements` also holds boxes that belong to the form through the `form` attribute.
        for (const el of Array.from(form.elements)) if (el instanceof HTMLInputElement && el.type === "checkbox" && el.name === name) el.checked = e.currentTarget.checked;
      }}
    />
  );
}
