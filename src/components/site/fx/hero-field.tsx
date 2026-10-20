"use client";

import { useEffect, useRef } from "react";

/**
 * A quiet constellation of drifting points that lean toward the cursor. It switches itself off for reduced motion,
 * data-saver, low-core phones and when scrolled out of view, so it never costs a slow device anything.
 */
export function HeroField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || nav.connection?.saveData || (nav.hardwareConcurrency ?? 4) <= 2 || (nav.deviceMemory ?? 4) <= 1) return;

    type P = { x: number; y: number; vx: number; vy: number; r: number; hot: boolean };
    let w = 0, h = 0, raf = 0, visible = true, points: P[] = [];
    const mouse = { x: -999, y: -999 };
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(w < 640 ? 26 : 64, Math.round((w * h) / 17000));
      points = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28, r: 0.8 + Math.random() * 1.6, hot: Math.random() < 0.08 }));
    };

    const link = w < 640 ? 90 : 125;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of points) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 < 22000) { p.vx += dx * 0.000012; p.vy += dy * 0.000012; }
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.999; p.vy *= 0.999;
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
      }
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        for (let j = i + 1; j < points.length; j++) {
          const b = points[j]!;
          const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
          if (d < link) { ctx.strokeStyle = `rgba(76,201,240,${(1 - d / link) * 0.32})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
        ctx.fillStyle = a.hot ? "rgba(255,178,62,.95)" : "rgba(190,230,255,.75)";
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
      }
    };

    const onMove = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const onLeave = () => { mouse.x = mouse.y = -999; };
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; }, { threshold: 0 });
    io.observe(canvas);
    resize();
    window.addEventListener("resize", resize);
    canvas.parentElement?.addEventListener("pointermove", onMove);
    canvas.parentElement?.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf); io.disconnect();
      window.removeEventListener("resize", resize);
      canvas.parentElement?.removeEventListener("pointermove", onMove);
      canvas.parentElement?.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`absolute inset-0 size-full ${className}`} />;
}
