/** A slow ticker of short phrases (the school's own words). Pure CSS; pauses on hover; the second copy is hidden from assistive technology. */
export function Marquee({ items, className = "" }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  const row = (hidden?: boolean) => (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center">
      {items.map((t, i) => (
        <li key={`${t}-${i}`} className="flex items-center whitespace-nowrap">
          <span className="display px-8 text-4xl text-heading sm:text-6xl">{t}</span>
          <span aria-hidden className="size-2 rounded-full bg-sun" />
        </li>
      ))}
    </ul>
  );
  return <div className={`marquee overflow-hidden ${className}`}><div className="marquee-track">{row()}{row(true)}</div></div>;
}
