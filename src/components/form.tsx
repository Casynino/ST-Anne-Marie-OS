"use client";

import { createContext, useActionState, useContext, useId, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import type { ActionState } from "@/lib/action";

type FormCtx = { errors?: Record<string, string>; values?: Record<string, string>; code?: string };
const Ctx = createContext<FormCtx>({});

export const inputClass =
  "block w-full min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-muted/70 focus:border-brand-500 disabled:bg-canvas aria-[invalid=true]:border-bad";

export function ActionForm({
  action,
  children,
  submitLabel,
  className = "space-y-4",
  hideSubmit,
  inline,
  tone = "primary",
  confirm,
  successTitle,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel?: string;
  className?: string;
  hideSubmit?: boolean;
  /** Compact single-button form (e.g. "Make current"). */
  inline?: boolean;
  tone?: "primary" | "danger" | "neutral";
  confirm?: string;
  /** When set, a successful submit replaces the form with this title + the server message (used by public forms). */
  successTitle?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;
  const done = state && state.ok ? state : null;
  const tempPassword = done?.data?.temporaryPassword;

  if (successTitle && done) {
    return (
      <div role="status" className="rounded-2xl border border-ok/30 bg-green-50 p-6">
        <p className="flex items-center gap-2 text-lg font-semibold text-ok"><CheckCircle2 className="size-5" aria-hidden />{successTitle}</p>
        {done.message && <p className="mt-2 text-ink/80">{done.message}</p>}
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ errors: failed?.fieldErrors, values: failed?.values, code: failed?.code }}>
      <form
        action={formAction}
        className={className}
        onSubmit={(e) => {
          if (confirm && !window.confirm(confirm)) e.preventDefault();
        }}
      >
        {failed && (
          <div role="alert" className="flex gap-2 rounded-lg border border-bad/30 bg-red-50 px-3 py-2 text-sm text-bad">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{failed.error}</span>
          </div>
        )}
        {done?.message && (
          <div role="status" className="flex gap-2 rounded-lg border border-ok/30 bg-green-50 px-3 py-2 text-sm text-ok">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{done.message}</span>
          </div>
        )}
        {tempPassword && (
          <div className="rounded-lg border border-tint-2 bg-tint p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-link">
              <KeyRound className="size-4" aria-hidden /> {done?.data?.temporaryPasswordLabel ?? "Temporary password"}
            </div>
            <code className="mt-2 block select-all break-all rounded bg-surface px-3 py-2 text-base font-semibold tracking-wide text-ink">{tempPassword}</code>
            <p className="mt-2 text-muted">{done?.data?.temporaryPasswordNote}</p>
          </div>
        )}
        {children}
        {!hideSubmit && (
          <button
            type="submit"
            disabled={pending}
            className={
              inline
                ? `inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium disabled:opacity-60 ${
                    tone === "danger" ? "border-bad/40 text-bad hover:bg-red-50" : "border-line text-ink hover:bg-canvas"
                  }`
                : `inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-base font-semibold text-white disabled:opacity-60 ${
                    tone === "danger" ? "bg-bad hover:bg-red-800" : "bg-brand-700 hover:bg-brand-800"
                  }`
            }
          >
            {pending ? "…" : submitLabel}
          </button>
        )}
      </form>
    </Ctx.Provider>
  );
}

type Option = { value: string; label: string };

export function Field({
  name,
  label,
  type = "text",
  required,
  hint,
  defaultValue,
  options,
  placeholder,
  rows = 3,
  autoComplete,
  optionalLabel,
  min,
  max,
  className,
}: {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "date" | "datetime-local" | "time" | "password" | "number" | "textarea" | "select" | "checkbox";
  required?: boolean;
  hint?: string;
  defaultValue?: string | number | boolean | null;
  options?: Option[];
  placeholder?: string;
  rows?: number;
  autoComplete?: string;
  optionalLabel?: string;
  min?: number;
  max?: number;
  className?: string;
}) {
  const { errors, values } = useContext(Ctx);
  const id = useId();
  const error = errors?.[name];
  const posted = values?.[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const common = { id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, required };

  if (type === "checkbox") {
    const checked = values ? posted === "on" : Boolean(defaultValue);
    return (
      <div className={className}>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
          <input type="checkbox" name={name} id={id} defaultChecked={checked} key={`${name}-${checked}`} className="size-5 rounded border-line accent-brand-700" aria-describedby={describedBy} />
          <span>{label}{required ? <span aria-hidden className="ml-0.5 text-bad"> *</span> : null}</span>
        </label>
        {error && (
          <p id={`${id}-err`} className="text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    );
  }

  const value = posted ?? (defaultValue === null || defaultValue === undefined ? "" : String(defaultValue));
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required ? <span aria-hidden className="ml-0.5 text-bad"> *</span> : null}
        {!required && optionalLabel ? <span className="ml-1 font-normal text-muted">({optionalLabel})</span> : null}
      </label>
      {type === "textarea" ? (
        <textarea {...common} rows={rows} defaultValue={value} placeholder={placeholder} className={inputClass} />
      ) : type === "select" ? (
        <select {...common} defaultValue={value} className={inputClass}>
          <option value="">{placeholder ?? "—"}</option>
          {options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input {...common} type={type} defaultValue={type === "password" ? undefined : value} placeholder={placeholder} autoComplete={autoComplete} min={min} max={max} inputMode={type === "tel" ? "tel" : undefined} className={inputClass} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="mt-1 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** Simple multi-checkbox group (used for roles and permissions). */
export function CheckGroup({ name, options, selected, disabled }: { name: string; options: { value: string; label: string; hint?: string; disabled?: boolean }[]; selected: string[]; disabled?: boolean }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className={`flex min-h-11 items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2 ${o.disabled || disabled ? "opacity-60" : "cursor-pointer hover:bg-canvas"}`}>
          <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} disabled={o.disabled || disabled} className="mt-1 size-5 accent-brand-700" />
          <span className="text-sm leading-snug">
            <span className="font-medium">{o.label}</span>
            {o.hint ? <span className="block text-muted">{o.hint}</span> : null}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Renders children only after the server answered with a CONFLICT (e.g. "possible duplicate – confirm to continue"). */
export function IfConflict({ children }: { children: ReactNode }) {
  const { code } = useContext(Ctx);
  return code === "CONFLICT" ? <>{children}</> : null;
}

/** Read what the user last submitted (used by composite client fields). */
export function useFormValues() {
  return useContext(Ctx);
}
