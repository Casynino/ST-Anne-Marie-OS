export type Pt = { x: number; y: number };

const f = (v: number) => Math.round(v * 10) / 10;

/** A smooth line through the points that never dips below or above them (monotone cubic), so a flat week stays flat and a zero stays on the axis. */
export function smoothPath(p: Pt[]): string {
  const n = p.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1]!.x - p[i]!.x;
    m[i] = (p[i + 1]!.y - p[i]!.y) / (dx[i] || 1);
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  t[n - 1] = m[n - 2]!;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]!; t[i + 1] = k * b * m[i]!; }
  }
  let d = `M${f(p[0]!.x)} ${f(p[0]!.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${f(p[i]!.x + h)} ${f(p[i]!.y + t[i]! * h)} ${f(p[i + 1]!.x - h)} ${f(p[i + 1]!.y - t[i + 1]! * h)} ${f(p[i + 1]!.x)} ${f(p[i + 1]!.y)}`;
  }
  return d;
}

/** A round upper limit for an axis. */
export function niceTop(n: number): number {
  if (n <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const x = n / p;
  return (x <= 1.5 ? 1.5 : x <= 2 ? 2 : x <= 3 ? 3 : x <= 4 ? 4 : x <= 5 ? 5 : x <= 8 ? 8 : 10) * p;
}
