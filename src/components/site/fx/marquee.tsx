/** Endless ticker of words (CSS only). The list is repeated so the loop is seamless. */
export function Marquee({ items, className = "" }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  const row = [...items, ...items, ...items, ...items].slice(0, Math.max(items.length * 4, 12));
  const half = (
    <ul className="flex shrink-0 items-center gap-10 pr-10">
      {row.map((t, i) => (
        <li key={i} className="site-serif flex items-center gap-10 whitespace-nowrap text-3xl sm:text-5xl">
          {t}
          <span aria-hidden className="size-2 rounded-full bg-signal" />
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
