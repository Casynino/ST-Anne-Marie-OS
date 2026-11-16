# System guide (PDF)

`St-Anne-Marie-Schools-System-Guide.pdf` is the book for the owner, the project manager and every department. Prepared by Emmanuel Paul Marcel.

- Text and design: `parts/*.html` + `parts/style.css` (edit these).
- Screenshots: taken from the LOCAL demo school (`npm run dev`, made-up names only) by `tools/shots.mjs`; they are not committed (`guide/shots/`).
- Build: install `puppeteer-core` in a scratch folder, set the paths at the top of `tools/shots.mjs` and `tools/build.mjs`, run `node shots.mjs` then `node build.mjs`. The PDF is written next to this file (not committed).
- Never put passwords in the guide: logins are given to each department privately.
