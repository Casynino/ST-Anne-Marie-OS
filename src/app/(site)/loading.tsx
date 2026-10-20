export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="mx-auto max-w-6xl animate-pulse px-4 py-20 sm:px-6">
      <span className="sr-only">Loading…</span>
      <div className="h-5 w-32 rounded bg-cream-deep" />
      <div className="mt-6 h-16 max-w-xl rounded-xl bg-cream-deep" />
      <div className="mt-4 h-5 max-w-md rounded bg-cream-deep" />
      <div className="mt-10 grid gap-5 sm:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="h-40 rounded-3xl bg-cream-deep" />)}</div>
    </div>
  );
}
