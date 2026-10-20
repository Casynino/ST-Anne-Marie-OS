/*
 * Offline support for attendance only. Deliberately small:
 *  - /offline-attendance (a page with NO user data; everything it shows comes from IndexedDB on the device)
 *    is cached network-first, so it can open without a connection.
 *  - Hashed build assets under /_next/static/ are cached (they are immutable) so that page's code can run offline.
 *  - Nothing else is cached or intercepted: pages with personal data, API responses and server actions
 *    always go to the network. Class lists live in IndexedDB, and only when the teacher downloaded them.
 */
const VERSION = "v1";
const STATIC = `sam-static-${VERSION}`;
const PAGES = `sam-pages-${VERSION}`;
const OFFLINE_PAGE = "/offline-attendance";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if ((name.startsWith("sam-static-") && name !== STATIC) || (name.startsWith("sam-pages-") && name !== PAGES)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

async function warm() {
  const res = await fetch(OFFLINE_PAGE, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return;
  const pages = await caches.open(PAGES);
  await pages.put(OFFLINE_PAGE, res.clone());
  const html = await res.text();
  const urls = new Set(html.match(/\/_next\/static\/[^"'\\\s)]+\.(?:js|css)/g) || []);
  const statics = await caches.open(STATIC);
  await Promise.all(
    [...urls].map(async (url) => {
      if (await statics.match(url)) return;
      const r = await fetch(url);
      if (r.ok) await statics.put(url, r);
    }),
  );
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "warm") event.waitUntil(warm().catch(() => undefined));
  if (event.data && event.data.type === "clear") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname === OFFLINE_PAGE) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(OFFLINE_PAGE, res.clone());
          return res;
        } catch {
          return (await cache.match(OFFLINE_PAGE)) || new Response("Offline and not yet saved on this device.", { status: 503, headers: { "content-type": "text/plain" } });
        }
      })(),
    );
  }
});
