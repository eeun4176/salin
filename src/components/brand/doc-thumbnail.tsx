import { ImageIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FileKind } from "@/features/workspace/types";

const ROWS = 12;

/** Mini rendering of a structured form — the thumbnail style from the mockups. */
function TablePreview({ withTitle }: { withTitle: boolean }) {
  const top = withTitle ? 14 : 6;
  const rowH = 7;
  const bottom = top + 6 + ROWS * rowH;
  return (
    <svg viewBox={`0 0 100 ${bottom + 6}`} className="h-full w-full" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      {withTitle && (
        <g fill="#C9D1CC">
          <rect x="6" y="4" width="34" height="3" rx="1.5" />
          <rect x="6" y="8.5" width="20" height="2" rx="1" fill="#E1E6E3" />
        </g>
      )}
      <rect x="6" y={top} width="88" height={bottom - top} fill="none" stroke="#B8C1BC" strokeWidth="0.5" />
      <rect x="6" y={top} width="88" height="6" fill="#F3F6F4" stroke="#B8C1BC" strokeWidth="0.5" />
      <g fontSize="2.3" fill="#7A827E" fontFamily="Inter, system-ui, sans-serif" fontWeight="600">
        <text x="14" y={top + 4}>NAME</text>
        <text x="40" y={top + 4}>STUDENT ID NUMBER</text>
        <text x="74" y={top + 4}>REMARKS</text>
      </g>
      <g stroke="#C9D1CC" strokeWidth="0.4">
        <path d={`M36 ${top}V${bottom}M68 ${top}V${bottom}`} />
        {Array.from({ length: ROWS }, (_, i) => (
          <path key={i} d={`M6 ${top + 6 + (i + 1) * rowH}H94`} />
        ))}
      </g>
    </svg>
  );
}

export function DocThumbnail({ kind, className }: { kind?: FileKind; className?: string }) {
  const isImage = kind === "png" || kind === "jpg" || kind === "webp";
  return (
    <div className={cn("overflow-hidden rounded-lg bg-white ring-1 ring-black/[0.04]", className)}>
      {isImage ? (
        <div className="grid h-full place-items-center bg-[linear-gradient(160deg,#EEF5F1,#DDEBE3)] text-salin-primary/60">
          <ImageIcon className="size-8" strokeWidth={1.5} />
        </div>
      ) : (
        <TablePreview withTitle={kind === "pdf"} />
      )}
    </div>
  );
}
