import Link from "next/link";
import { FileText, Image as ImageIcon, Lock, Presentation, Sheet } from "lucide-react";
import type { Translate } from "@/lib/i18n";
import { humanSize, type LibraryKind } from "@/lib/library/files";
import type { ResourceCard } from "@/server/library";
import { ActionForm, Field, PasswordField } from "@/components/form";
import { verifyLibraryAction } from "@/app/(site)/library/actions";

const KIND_ICON: Record<LibraryKind, typeof FileText> = { PDF: FileText, DOCUMENT: FileText, SLIDES: Presentation, SHEET: Sheet, IMAGE: ImageIcon };
const KIND_LABEL: Record<LibraryKind, string> = { PDF: "PDF", DOCUMENT: "Word", SLIDES: "PowerPoint", SHEET: "Excel", IMAGE: "Image" };

export function KindBadge({ kind }: { kind: LibraryKind }) {
  const Icon = KIND_ICON[kind];
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Icon className="size-4" aria-hidden />{KIND_LABEL[kind]}</span>;
}

/** One resource in a list: cover or file-type tile, title, where it belongs, and whether it opens straight away. */
export function ResourceTile({ r, t }: { r: ResourceCard; t: Translate }) {
  const Icon = KIND_ICON[r.kind];
  const open = r.access.ok;
  return (
    <li className="flex">
      <Link href={`/library/r/${r.id}`} className="group flex w-full flex-col border border-line bg-surface transition-shadow hover:shadow-[var(--shadow-lift)]">
        <span className="relative block aspect-[4/3] overflow-hidden bg-tint">
          {r.coverUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={r.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
            : <span className="grid size-full place-items-center text-brand-700"><Icon className="size-14" aria-hidden /></span>}
          <span className={`absolute left-0 top-0 px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${open ? "bg-brand-700 text-white" : "bg-sun text-[#10200f]"}`}>{open ? t("lib.card.open") : <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />{t("lib.card.verify")}</span>}</span>
        </span>
        <span className="flex flex-1 flex-col gap-1.5 p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-link">{r.category.name}</span>
          <span className="display text-lg leading-snug text-heading group-hover:underline">{r.title}</span>
          {(r.classes.length > 0 || r.subjects.length > 0) && <span className="text-sm text-muted">{[...r.classes.slice(0, 2), ...r.subjects.slice(0, 2)].join(" · ")}</span>}
          <span className="mt-auto flex items-center gap-3 pt-2 text-xs text-muted"><KindBadge kind={r.kind} />{r.hasFile && <span>{humanSize(r.sizeBytes)}</span>}</span>
        </span>
      </Link>
    </li>
  );
}

/** Asks for the school ID and PIN (or, for staff, password). Short on purpose: two boxes and one button, large enough for a phone. */
export function VerifyForm({ t, next, idOnlyHint }: { t: Translate; next: string; idOnlyHint?: boolean }) {
  return (
    <ActionForm action={verifyLibraryAction} submitLabel={t("lib.verify.button")} className="space-y-4" buttonClassName="min-h-12 w-full">
      <input type="hidden" name="next" value={next} />
      <Field name="schoolId" label={t("lib.verify.id")} autoComplete="username" required hint={t("lib.verify.id.hint")} />
      <PasswordField name="secret" label={t("lib.verify.secret")} autoComplete="current-password" required={!idOnlyHint} showLabel={t("auth.password.show")} hideLabel={t("auth.password.hide")} />
      <p className="text-sm text-muted">{t("lib.verify.help")}</p>
    </ActionForm>
  );
}
