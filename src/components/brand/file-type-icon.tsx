import { cn } from "@/lib/utils";
import { FILE_KIND_META } from "@/components/brand/file-kinds";
import type { FileKind } from "@/features/workspace/types";

function Glyph({ kind, color }: { kind: FileKind; color: string }) {
  switch (kind) {
    case "csv":
    case "xlsx":
      return (
        <g stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round">
          <rect x="11" y="15" width="20" height="17" rx="2" />
          <path d="M11 20.7h20M11 26.3h20M17.7 15v17M24.3 15v17" />
        </g>
      );
    case "pdf":
      return (
        <g stroke={color} strokeWidth="2.4" strokeLinecap="round">
          <path d="M12 16h11M12 21h17M12 26h17M12 31h9" />
        </g>
      );
    case "png":
      return (
        <g fill={color}>
          {[0, 1, 2, 3].flatMap((r) =>
            [0, 1, 2, 3].map((c) =>
              (r + c) % 2 === 0 ? <rect key={`${r}-${c}`} x={12 + c * 4.5} y={14 + r * 4.5} width="4.5" height="4.5" /> : null,
            ),
          )}
        </g>
      );
    case "jpg":
    case "webp":
      return (
        <g stroke={color} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <rect x="11" y="15" width="20" height="16" rx="2.5" />
          <circle cx="17" cy="20.5" r="2" fill={color} stroke="none" />
          <path d="M12 29l6-5.5 4 3.5 3-2.5 5 4.5" />
        </g>
      );
  }
}

interface FileTypeIconProps {
  kind: FileKind;
  className?: string;
  /** Show the coloured extension tag (".CSV"). Off for small inline icons. */
  showLabel?: boolean;
}

/** Document glyph with a coloured extension tag — the badge style from the hero. */
export function FileTypeIcon({ kind, className, showLabel = true }: FileTypeIconProps) {
  const { color, label } = FILE_KIND_META[kind];
  return (
    <svg viewBox="0 0 50 56" className={cn("shrink-0", className)} aria-hidden="true">
      <path d="M8 2h22l12 12v36a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="#FFFFFF" />
      <path d="M8 2h22l12 12v36a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill={color} fillOpacity="0.14" stroke={color} strokeOpacity="0.28" strokeWidth="1.2" />
      <path d="M30 2v8a4 4 0 0 0 4 4h8z" fill={color} />
      <Glyph kind={kind} color={color} />
      {showLabel && (
        <g>
          <rect x="17" y="37" width="31" height="13" rx="3.5" fill={color} />
          <text x="32.5" y="46.2" textAnchor="middle" fontSize="7.4" fontWeight="700" fill="#FFFFFF" fontFamily="Inter, system-ui, sans-serif">
            {label}
          </text>
        </g>
      )}
    </svg>
  );
}
