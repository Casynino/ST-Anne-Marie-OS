import Image from "next/image";
import type { SiteImage } from "@/server/website";

/**
 * Two rows of the school's own photographs sliding in opposite directions (CSS only; pauses on hover; still for reduced motion).
 * Decorative: the same pictures are in the gallery with captions, so the strip is hidden from screen readers.
 */
export function PhotoStrip({ images, className = "" }: { images: SiteImage[]; className?: string }) {
  if (images.length < 3) return null;
  const shift = Math.floor(images.length / 2);
  const rows = [images, [...images.slice(shift), ...images.slice(0, shift)].reverse()];
  return (
    <div aria-hidden className={`space-y-4 overflow-hidden ${className}`}>
      {rows.map((row, r) => {
        const list = row;
        const half = (k: string) => (
          <ul key={k} className="flex shrink-0 gap-4 pr-4">
            {list.map((g, i) => (
              <li key={i} className={`frame size-full shrink-0 overflow-hidden rounded-3xl shadow-[var(--shadow-card)] ${r === 0 ? "h-44 w-64 sm:h-56 sm:w-80" : "h-44 w-72 sm:h-56 sm:w-96"}`}>
                <Image src={g.src} alt="" width={g.width} height={g.height} sizes="(min-width: 640px) 384px, 288px" loading="lazy" className="size-full object-cover" />
              </li>
            ))}
          </ul>
        );
        return (
          <div key={r} className={`marquee ${r === 1 ? "marquee-rev" : ""}`}>
            <div className="marquee-track" style={r === 0 ? { animationDuration: "64s" } : undefined}>{half("a")}{half("b")}</div>
          </div>
        );
      })}
    </div>
  );
}
