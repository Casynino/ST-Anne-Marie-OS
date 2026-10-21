/** Plain text links to the sections of a long home page (one scrolling row on a phone, wrapping on a computer). */
export function JumpNav({ items, label }: { items: { id: string; label: string }[]; label: string }) {
  if (items.length < 3) return null;
  return (
    <nav aria-label={label} className="mt-3 flex gap-x-5 gap-y-1 overflow-x-auto whitespace-nowrap text-sm text-muted sm:flex-wrap sm:overflow-visible">
      {items.map((c) => <a key={c.id} href={`#${c.id}`} className="inline-flex min-h-8 shrink-0 items-center hover:text-link hover:underline">{c.label}</a>)}
    </nav>
  );
}
