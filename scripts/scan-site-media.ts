/**
 * Scans public/site for the school's own images and writes src/lib/site-media.json (committed).
 * Convention (drop files in; nothing else to configure):
 *   logo.(png|svg|webp)        header/footer logo          og.(jpg|png)       social sharing image (1200x630)
 *   hero.(jpg|webp)  hero-2.*  hero-3.*   home page picture composition
 *   about.(jpg|webp)           about picture
 *   gallery/NN-name.*          gallery (up to 24, sorted by file name)
 *   notices/name.*             the school's own notice posters (admissions etc.), usable as news pictures
 * Optional public/site/meta.json: { "gallery/01-x.jpg": { "alt": "...", "caption": "..." } } gives accessible
 * descriptions and captions. Pixel sizes are read from the files so pages reserve space (no layout shift).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageSize, sniffImage } from "../src/lib/images";

const ROOT = join(process.cwd(), "public", "site");
const OUT = join(process.cwd(), "src", "lib", "site-media.json");
const IMG = /\.(png|jpe?g|webp|svg)$/i;

type Entry = { path: string; width: number; height: number; alt?: string; caption?: string };
const meta: Record<string, { alt?: string; caption?: string }> = existsSync(join(ROOT, "meta.json")) ? JSON.parse(readFileSync(join(ROOT, "meta.json"), "utf8")) : {};

const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => IMG.test(f) && !f.startsWith(".")).sort() : []);

function describe(rel: string): Entry {
  const file = join(ROOT, rel);
  let width = 4, height = 3; // svg or unreadable: neutral ratio
  if (!/\.svg$/i.test(rel)) {
    const bytes = new Uint8Array(readFileSync(file));
    const kind = sniffImage(bytes);
    const size = kind ? imageSize(bytes, kind) : null;
    if (size) ({ width, height } = size);
  }
  const m = meta[rel] ?? {};
  return { path: `/site/${rel}`, width, height, ...(m.alt ? { alt: m.alt } : {}), ...(m.caption ? { caption: m.caption } : {}) };
}

const named = (base: string) => { const f = list(ROOT).find((x) => x.toLowerCase().startsWith(`${base}.`)); return f ? describe(f) : undefined; };

const media = {
  logo: named("logo"),
  og: named("og"),
  hero: ["hero", "hero-2", "hero-3"].map(named).filter(Boolean),
  about: named("about"),
  gallery: list(join(ROOT, "gallery")).slice(0, 24).map((f) => describe(`gallery/${f}`)),
  notices: list(join(ROOT, "notices")).map((f) => describe(`notices/${f}`)),
};

mkdirSync(join(process.cwd(), "src", "lib"), { recursive: true });
writeFileSync(OUT, JSON.stringify(media, null, 2) + "\n");
console.log(`site media: logo=${media.logo ? "yes" : "-"} og=${media.og ? "yes" : "-"} hero=${media.hero.length} about=${media.about ? "yes" : "-"} gallery=${media.gallery.length} notices=${media.notices.length}`);
