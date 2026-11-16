"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Photo = { src: string; width: number; height: number };

/**
 * The moving picture behind the sign-in screen: the school's own photographs, each drifting slowly (the `kb` zoom) and cross-fading into the
 * next every few seconds, with a faint scatter of dots floating over them. Nothing moves for visitors who ask for less motion.
 */
export function EntryBackdrop({ photos }: { photos: Photo[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (photos.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % photos.length), 7000);
    return () => window.clearInterval(id);
  }, [photos.length]);
  return (
    <div aria-hidden className="absolute inset-0 -z-20 overflow-hidden bg-[#050e0a]">
      {photos.map((p, k) => (
        <Image key={p.src} src={p.src} alt="" fill priority={k === 0} sizes="100vw" className={`kb object-cover transition-opacity duration-[1800ms] ease-in-out ${k === i ? "opacity-100" : "opacity-0"}`} />
      ))}
    </div>
  );
}
