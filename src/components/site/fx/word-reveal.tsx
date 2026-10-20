/** Headline whose words rise out of a mask one after another. Pure CSS (runs from first paint, no JS) and off for reduced motion. */
export function WordReveal({ text, className = "", offset = 0 }: { text: string; className?: string; offset?: number }) {
  return (
    <span className={className}>
      {text.split(/\s+/).filter(Boolean).map((w, i, all) => (
        <span key={i}>
          <span className="hw"><span style={{ "--i": i + offset } as React.CSSProperties}>{w}</span></span>
          {i < all.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}
