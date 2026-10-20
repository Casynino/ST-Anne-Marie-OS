/**
 * Scans public/site for the school's own images and writes src/lib/site-media.json.
 * Convention (just drop files in, nothing else to configure):
 *   public/site/logo.(png|svg|webp)     header logo
 *   public/site/hero.(jpg|webp|png)     home page hero picture
 *   public/site/about.(jpg|webp|png)    about picture
 *   public/site/gallery/*               gallery, sorted by file name ("01-classroom.jpg" => caption "Classroom")
 * Admin-entered paths in Website settings take priority over these files.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "public", "site");
const OUT = join(process.cwd(), "src", "lib", "site-media.json");
const IMG = /\.(png|jpe?g|webp|avif|svg)$/i;

const list = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => IMG.test(f) && !f.startsWith(".")).sort() : []);
const named = (base: string) => list(ROOT).find((f) => f.toLowerCase().startsWith(`${base}.`));

function captionOf(file: string): string | undefined {
  const name = file.replace(/\.[^.]+$/, "").replace(/^\d+[-_. ]*/, "").replace(/[-_]+/g, " ").trim();
  if (!name || /^(img|dsc|photo|image|pic|screenshot|whatsapp)?\s*\d*$/i.test(name) || name.length > 80) return undefined;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const media = {
  logo: named("logo") ? `/site/${named("logo")}` : undefined,
  hero: named("hero") ? `/site/${named("hero")}` : undefined,
  about: named("about") ? `/site/${named("about")}` : undefined,
  gallery: list(join(ROOT, "gallery")).slice(0, 8).map((f) => ({ path: `/site/gallery/${f}`, ...(captionOf(f) ? { caption: captionOf(f) } : {}) })),
};

mkdirSync(join(process.cwd(), "src", "lib"), { recursive: true });
const next = JSON.stringify(media, null, 2) + "\n";
writeFileSync(OUT, next);
console.log(`site media: logo=${media.logo ?? "-"} hero=${media.hero ?? "-"} about=${media.about ?? "-"} gallery=${media.gallery.length}`);
