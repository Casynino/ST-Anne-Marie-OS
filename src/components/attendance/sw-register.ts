/** Registers the attendance service worker (production builds only) and asks it to cache the offline page. */
export function registerOfflineSupport() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
  void navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => reg.active?.postMessage({ type: "warm" }))
    .catch(() => undefined);
}

export function clearOfflinePageCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: "clear" })).catch(() => undefined);
}
