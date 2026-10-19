/**
 * Page Viewer
 * Shows a scanned page with the regions values came from drawn on top:
 * the selected value's region is highlighted and scrolled into view, others
 * are tinted by review state. Zoom in/out/fit, pan by scrolling. Two
 * interactive modes: "pick" makes every recognised word clickable (to
 * assign it to a field), and "draw" lets the user drag a rectangle (to mark
 * where a table really is). Works with mouse, pen and touch.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Box } from "@/types/ocr";

export type OverlayTone = "ready" | "review" | "problem" | "neutral";

export interface Overlay {
  id: string;
  box: Box;
  tone: OverlayTone;
}

export interface PickableWord {
  text: string;
  box: Box;
  confidence: number;
}

interface PageViewerProps {
  src: string | null;
  width: number;
  height: number;
  /** Accessible description of the page ("Page 2 of 3"). */
  label: string;
  overlays?: Overlay[];
  selectedId?: string | null;
  /** A region to highlight that isn't one of the overlays (e.g. a dataset row's source). */
  highlight?: Box | null;
  mode?: "view" | "pick" | "draw";
  words?: PickableWord[];
  onPick?: (word: PickableWord) => void;
  onDraw?: (box: Box) => void;
  onSelect?: (id: string) => void;
  className?: string;
}

const TONE: Record<OverlayTone, string> = {
  ready: "fill-salin-primary/10 stroke-salin-primary/60",
  review: "fill-amber-400/15 stroke-amber-500/80",
  problem: "fill-red-500/12 stroke-red-500/80",
  neutral: "fill-transparent stroke-salin-subtle/50",
};

const ZOOMS = [1, 1.5, 2, 3, 4];

export function PageViewer({ src, width, height, label, overlays = [], selectedId, highlight, mode = "view", words = [], onPick, onDraw, onSelect, className }: PageViewerProps) {
  const [zoom, setZoom] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const selected = overlays.find((o) => o.id === selectedId)?.box ?? highlight ?? null;
  const stroke = Math.max(2, width / 400);

  // Bring the selected region into view (and zoom in a little on small screens).
  useEffect(() => {
    if (!selected) return;
    const target = svgRef.current?.querySelector<SVGRectElement>("[data-selected='true']");
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [selected, zoom]);

  const toImage = (event: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
  };

  const drawing = mode === "draw";
  const box = drag ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) } : null;

  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-2xl bg-salin-tile ring-1 ring-salin-border", className)}>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto overscroll-contain" data-lenis-prevent="">
        <div className="relative mx-auto" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
          {src ? (
            <img src={src} alt={label} draggable={false} className="block w-full bg-white select-none" style={{ aspectRatio: `${width} / ${height}` }} />
          ) : (
            <div className="grid w-full place-items-center bg-white text-sm text-salin-muted" style={{ aspectRatio: `${width || 3} / ${height || 4}` }}>
              Preparing page…
            </div>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width || 1} ${height || 1}`}
            className={cn("absolute inset-0 size-full", drawing && "cursor-crosshair touch-none")}
            onPointerDown={(e) => {
              if (!drawing) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = toImage(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => {
              if (!drag) return;
              const p = toImage(e);
              setDrag({ ...drag, x1: p.x, y1: p.y });
            }}
            onPointerUp={() => {
              if (drag && box && box.width > width * 0.03 && box.height > height * 0.01) onDraw?.(box);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            {overlays.map((o) => (
              <rect
                key={o.id}
                x={o.box.x}
                y={o.box.y}
                width={o.box.width}
                height={o.box.height}
                rx={stroke * 2}
                strokeWidth={o.id === selectedId ? stroke * 1.8 : stroke * 0.7}
                data-selected={o.id === selectedId ? "true" : undefined}
                className={cn(TONE[o.tone], o.id === selectedId && "fill-sky-400/20 stroke-sky-500", onSelect && mode === "view" && "cursor-pointer")}
                onClick={() => mode === "view" && onSelect?.(o.id)}
              />
            ))}
            {highlight && !overlays.some((o) => o.id === selectedId) && (
              <rect x={highlight.x} y={highlight.y} width={highlight.width} height={highlight.height} rx={stroke * 2} strokeWidth={stroke * 1.8} data-selected="true" className="fill-sky-400/20 stroke-sky-500" />
            )}
            {mode === "pick" &&
              words.map((w, i) => (
                <rect
                  key={i}
                  x={w.box.x - stroke}
                  y={w.box.y - stroke}
                  width={w.box.width + stroke * 2}
                  height={w.box.height + stroke * 2}
                  rx={stroke}
                  strokeWidth={stroke * 0.8}
                  role="button"
                  tabIndex={0}
                  aria-label={`Use “${w.text}”`}
                  className="cursor-pointer fill-violet-400/10 stroke-violet-500/70 outline-none hover:fill-violet-400/30 focus-visible:fill-violet-400/40"
                  onClick={() => onPick?.(w)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick?.(w))}
                />
              ))}
            {box && <rect x={box.x} y={box.y} width={box.width} height={box.height} strokeWidth={stroke} strokeDasharray={`${stroke * 3} ${stroke * 2}`} className="fill-sky-400/15 stroke-sky-600" />}
          </svg>
        </div>
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1 rounded-xl bg-salin-surface/95 p-1 shadow-sm ring-1 ring-salin-border backdrop-blur">
        <button type="button" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))} className="grid size-8 place-items-center rounded-lg text-salin-text hover:bg-salin-tile disabled:opacity-40">
          <Minus className="size-4" />
        </button>
        <button type="button" aria-label="Fit page" disabled={zoom === 0} onClick={() => setZoom(0)} className="grid size-8 place-items-center rounded-lg text-salin-text hover:bg-salin-tile disabled:opacity-40">
          <Maximize className="size-4" />
        </button>
        <button type="button" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} className="grid size-8 place-items-center rounded-lg text-salin-text hover:bg-salin-tile disabled:opacity-40">
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
