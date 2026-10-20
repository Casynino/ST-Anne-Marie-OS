import Image from "next/image";
import type { SiteImage } from "@/server/website";

/** next/image wrapper for the school's pictures: reserved space (no layout shift), responsive sizes, lazy by default. */
export function Photo({ image, sizes, priority, className = "", fit = "cover", position }: { image: SiteImage; sizes: string; priority?: boolean; className?: string; fit?: "cover" | "contain"; position?: string }) {
  return (
    <Image
      src={image.src}
      alt={image.alt}
      width={image.width}
      height={image.height}
      sizes={sizes}
      priority={priority}
      loading={priority ? undefined : "lazy"}
      className={`size-full ${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
      style={position ? { objectPosition: position } : undefined}
    />
  );
}
