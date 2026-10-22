"use client";

/** One tick that ticks every row box of the same name in its form. */
export function SelectAll({ name, label }: { name: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-4 accent-brand-700"
      onChange={(e) => {
        const form = e.currentTarget.form;
        if (!form) return;
        form.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((b) => { b.checked = e.currentTarget.checked; });
      }}
    />
  );
}
