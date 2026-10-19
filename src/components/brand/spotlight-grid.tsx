/**
 * Spotlight Dot Grid
 * The hero/page-band backdrop: a gray dot grid with a green spotlight that
 * follows the pointer (and drifts on its own when idle), fading out toward the
 * bottom.
 */

import { useEffect, useRef, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

const IDLE_MS = 2500;
const LERP = 0.14;
const RADIUS = 120;

const baseLayer: CSSProperties = {
  // A step darker than the border token, which nearly vanished on the canvas (themeable: --color-salin-dot).
  backgroundImage: "radial-gradient(circle at center, var(--color-salin-dot) 1.5px, transparent 2px)",
  backgroundSize: "16px 16px",
};

const spotMask = `radial-gradient(${RADIUS}px circle at var(--x) var(--y), #000 0%, rgb(0 0 0 / 0.65) 45%, transparent 100%)`;

const topLayer: CSSProperties = {
  backgroundImage: "radial-gradient(circle at center, #01A85A 2.1px, transparent 2.7px)",
  backgroundSize: "16px 16px",
  WebkitMaskImage: spotMask,
  maskImage: spotMask,
};

// Fades the whole grid (dots + glow) out toward the bottom edge.
const bottomFade = "linear-gradient(to bottom, #000 0%, #000 45%, rgb(0 0 0 / 0.35) 75%, transparent 100%)";

const rootStyle = {
  "--x": "50%",
  "--y": "50%",
  WebkitMaskImage: bottomFade,
  maskImage: bottomFade,
} as CSSProperties;

const glowLayer: CSSProperties = {
  background: `radial-gradient(${RADIUS * 2.2}px circle at var(--x) var(--y), rgb(1 168 90 / 0.13), rgb(1 168 90 / 0.04) 45%, transparent 72%)`,
};

/**
 * Dotted-grid backdrop with a soft green spotlight. The spotlight trails the
 * pointer (rAF + frame-rate independent lerp) and drifts along a slow
 * Lissajous curve once the pointer has been idle for 2.5s. Pointer events are
 * read from the parent element, so content layered above stays interactive.
 */
export function SpotlightGrid({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;

    if (reduced) {
      el.style.setProperty("--x", "50%");
      el.style.setProperty("--y", "50%");
      return;
    }

    let width = el.clientWidth;
    let height = el.clientHeight;
    let x = width / 2;
    let y = height / 2;
    let targetX = x;
    let targetY = y;
    // Treat page load as activity so the light rests at center before drifting.
    let lastMove = performance.now();
    let lastFrame = 0;
    let frame = 0;
    let inView = true;
    const start = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = lastFrame ? Math.min(now - lastFrame, 64) : 16.67;
      lastFrame = now;

      if (now - lastMove > IDLE_MS) {
        const t = (now - start) / 1000;
        targetX = width / 2 + width * 0.34 * Math.sin(t * 0.21 + Math.PI / 2);
        targetY = height / 2 + height * 0.3 * Math.sin(t * 0.14);
      }

      const k = 1 - Math.pow(1 - LERP, dt / 16.67);
      x += (targetX - x) * k;
      y += (targetY - y) * k;
      el.style.setProperty("--x", `${x.toFixed(1)}px`);
      el.style.setProperty("--y", `${y.toFixed(1)}px`);
    };

    const run = () => {
      if (frame || !inView || document.hidden) return;
      lastFrame = 0;
      frame = requestAnimationFrame(tick);
    };
    const halt = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      targetX = event.clientX - rect.left;
      targetY = event.clientY - rect.top;
      lastMove = performance.now();
    };
    const onVisibility = () => (document.hidden ? halt() : run());

    const resize = new ResizeObserver(() => {
      width = el.clientWidth;
      height = el.clientHeight;
    });
    const visibility = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) run();
      else halt();
    });

    resize.observe(el);
    visibility.observe(el);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    run();

    return () => {
      halt();
      resize.disconnect();
      visibility.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      style={rootStyle}
    >
      <div className="absolute inset-0" style={baseLayer} />
      <div className="absolute inset-0" style={glowLayer} />
      <div className="absolute inset-0" style={topLayer} />
    </div>
  );
}
