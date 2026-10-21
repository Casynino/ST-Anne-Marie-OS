# School images

Drop the school's own, approved images here. They appear on the public website automatically
(restart `npm run dev`, or run `npm run site:media`). Uploading through **Website → Images** in the staff area
works too and needs no file copying (that is the way to do it on the live site).

| File | Where it shows |
|---|---|
| `logo.png` / `logo.svg` | Header, footer, structured data |
| `og.jpg` | Social sharing picture (1200×630) |
| `hero.jpg`, `hero-2.jpg`, `hero-3.jpg` | Home page picture composition (if absent, the first gallery photos are used) |
| `about.jpg` | About section picture (if absent, a gallery photo is used) |
| `gallery/NN-name.jpg` | Photo gallery, up to 24, sorted by file name |
| `meta.json` | Alt text and captions: `{ "gallery/01-x.jpg": { "alt": "…", "caption": "…" } }` |

## Current set (from the school's public Instagram posts, @st.annemarieacademy)
Previews of about 640 px wide were available without signing in, so they are fine for cards and the gallery but **too small for a full-width hero**.
Please ask the school for the **original, high-resolution files** (at least 1600 px wide) and replace these.

Still needed from the school: the **logo file** (the emblem appears only in small poster images), **campus/building exterior photos**,
**classroom and laboratory photos**, **sports and arts photos**, and written confirmation that these photographs of students
may be published (parental consent).
Several of the current photos show students on a visit to a university hall; captions deliberately make no claims about where or why.

## Added 2026-10-21 (photos sent by the school)
Campus exterior, classes, events and trips. Black borders were cropped, pictures were reduced to a web size (no camera or location data is kept) and each has alt text in `meta.json`.
Used for the home page picture stage (`hero*.jpg`), the about picture (`about.jpg`) and gallery photos 07 to 16.
Left out on purpose: two photos with another school's name on the signboard ("Brilliant Secondary School"), a football photo with a betting sponsor on the shirts and an Instagram overlay, and exact duplicates. The school still has to confirm that the photographs of students may be published (parental consent).
