/** Gentle ticker of words (CSS only, pauses on hover, off for reduced motion). The list repeats so the loop is seamless. */
export function Marquee({ items, className = "" }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  const row = Array.from({ length: Math.max(4, Math.ceil(12 / items.length)) }, () => items).flat();
  const half = (
    <ul className="flex shrink-0 items-center gap-8 pr-8">
      {row.map((t, i) => (
        <li key={i} className="display flex items-center gap-8 whitespace-nowrap text-2xl sm:text-4xl">
          {t}
          <span aria-hidden className="size-2.5 rounded-full bg-sun" />
        </li>
      ))}
    </ul>
  );
  return (
    <div className={`marquee overflow-hidden ${className}`} aria-hidden>
      <div className="marquee-track">{half}{half}</div>
    </div>
  );
}
