/** A row of links that scroll to the sections of a long home page (one scrolling row on a phone, wrapping on a computer). */
export function JumpNav({ items, label }: { items: { id: string; label: string }[]; label: string }) {
  if (items.length < 3) return null;
  return (
    <nav aria-label={label} className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {items.map((c) => <a key={c.id} href={`#${c.id}`} className="inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-brand-500 hover:text-link">{c.label}</a>)}
    </nav>
  );
}
