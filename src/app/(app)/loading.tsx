/** Shown while a staff page loads: layout-shaped placeholders instead of a blank screen. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse space-y-5">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-56 rounded-lg bg-line" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-28 rounded-2xl bg-line/70" />)}</div>
      <div className="grid gap-5 lg:grid-cols-2"><div className="h-64 rounded-2xl bg-line/70" /><div className="h-64 rounded-2xl bg-line/70" /></div>
    </div>
  );
}
