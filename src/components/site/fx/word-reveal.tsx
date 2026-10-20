import { Fragment } from "react";

/** Headline whose words rise out of a mask one after another. Pure CSS, so it animates from first paint. */
export function WordReveal({ text, className, startDelay = 150 }: { text: string; className?: string; startDelay?: number }) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      {words.map((w, i) => (
        <Fragment key={`${w}-${i}`}>
          <span className="word" aria-hidden>
            <span style={{ animationDelay: `${startDelay + i * 80}ms` }}>{w}</span>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}
