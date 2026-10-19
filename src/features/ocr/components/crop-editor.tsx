/**
 * Crop Editor
 * The page photo (already turned the right way) with four draggable corner
 * handles: drag them onto the paper's corners and the page is cropped and
 * flattened (perspective correction) when it's prepared. Outside the page
 * is dimmed. Handles work with mouse, pen and touch, and with the keyboard
 * (focus a corner, then use the arrow keys).
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import type { Point, Quad } from "@/types/ocr";

const FULL: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];

interface CropEditorProps {
  src: string;
  width: number;
  height: number;
  crop: Quad | null;
  /** Called while dragging (live) — `done` is true when the drag ends, to save. */
  onChange: (crop: Quad, done: boolean) => void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function CropEditor({ src, width, height, crop, onChange }: CropEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const quad = crop ?? FULL;
  const radius = Math.max(width, height) * 0.022;

  const toPoint = (event: ReactPointerEvent): Point => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  };

  const move = (index: number, point: Point, done: boolean) => {
    const next = quad.map((p, i) => (i === index ? point : p)) as Quad;
    onChange(next, done);
  };

  const onKey = (index: number) => (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const p = quad[index];
    move(index, { x: clamp01(p.x + delta[0]), y: clamp01(p.y + delta[1]) }, true);
  };

  const pts = quad.map((p) => `${p.x * width},${p.y * height}`).join(" ");

  return (
    <div className="relative mx-auto w-full" style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={src} alt="Page photo" draggable={false} className="absolute inset-0 size-full bg-white select-none" />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="absolute inset-0 size-full touch-none overflow-visible"
        onPointerMove={(e) => dragging !== null && move(dragging, toPoint(e), false)}
        onPointerUp={(e) => {
          if (dragging === null) return;
          move(dragging, toPoint(e), true);
          setDragging(null);
        }}
        onPointerCancel={() => setDragging(null)}
      >
        <path d={`M0,0H${width}V${height}H0Z M${pts.replaceAll(" ", " L")}Z`} fillRule="evenodd" className="fill-black/45" />
        <polygon points={pts} className="fill-none stroke-salin-primary" strokeWidth={radius * 0.22} />
        {quad.map((p, i) => (
          <circle
            key={i}
            cx={p.x * width}
            cy={p.y * height}
            r={radius}
            role="slider"
            tabIndex={0}
            aria-label={`Page corner, ${CORNER_NAMES[i]}`}
            aria-valuetext={`${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
            className="cursor-grab fill-white stroke-salin-primary outline-none focus-visible:stroke-sky-500 active:cursor-grabbing"
            strokeWidth={radius * 0.35}
            onPointerDown={(e) => {
              e.stopPropagation();
              svgRef.current?.setPointerCapture(e.pointerId);
              setDragging(i);
            }}
            onKeyDown={onKey(i)}
          />
        ))}
      </svg>
    </div>
  );
}
