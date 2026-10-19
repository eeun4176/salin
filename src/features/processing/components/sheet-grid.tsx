/**
 * Sheet Grid
 * Read-only spreadsheet view of a worksheet, like Excel: column letters, row
 * numbers, merged cells spanning their area, a small ƒ on formula cells
 * (hover to see the formula), and error or uncalculated results marked.
 * Can highlight a selection (header rows darker) and, when `onSelect` is
 * given, lets the user select a range visually: drag across cells with a
 * mouse or pen, or on touch screens tap the first cell and then the last (so
 * the grid still scrolls with a finger). Used by the guided Excel extraction
 * and the Excel file preview.
 */

import { useState, type PointerEvent } from "react";

import { cellKey, columnLetter, contains, type CellAddress, type CellRange } from "@/core/processing/excel/cell-range";
import type { SheetModel } from "@/core/processing/excel/workbook-reader";
import { cn } from "@/lib/utils";

interface SheetGridProps {
  sheet: SheetModel;
  maxRows?: number;
  maxColumns?: number;
  /** Cells to highlight, with their first `headerRows` rows shown as headings. */
  highlight?: { range: CellRange; headerRows: number } | null;
  /** Turns on visual range selection; called with the finished range. */
  onSelect?: (range: CellRange) => void;
  className?: string;
}

const between = (a: CellAddress, b: CellAddress): CellRange => ({
  s: { r: Math.min(a.r, b.r), c: Math.min(a.c, b.c) },
  e: { r: Math.max(a.r, b.r), c: Math.max(a.c, b.c) },
});

/** The cell under a pointer, from the data attributes on each <td>. */
function cellAt(x: number, y: number): CellAddress | null {
  const td = document.elementFromPoint(x, y)?.closest<HTMLElement>("td[data-r]");
  return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null;
}

export function SheetGrid({ sheet, maxRows = 200, maxColumns = 40, highlight, onSelect, className }: SheetGridProps) {
  // Mouse/pen drag in progress, or the first tap of a touch selection.
  const [drag, setDrag] = useState<{ start: CellAddress; end: CellAddress; touch: boolean } | null>(null);
  const used = sheet.used;
  if (!used) return <p className="p-6 text-center text-sm text-salin-muted">This sheet is empty.</p>;

  // Show from A1 so row numbers and letters match Excel; always include the highlighted cells.
  const lastRow = Math.min(Math.max(used.e.r, highlight?.range.e.r ?? 0), maxRows - 1);
  const lastColumn = Math.min(Math.max(used.e.c, highlight?.range.e.c ?? 0), maxColumns - 1);
  const rows = Array.from({ length: lastRow + 1 }, (_, r) => r);
  const columns = Array.from({ length: lastColumn + 1 }, (_, c) => c);

  const spans = new Map<string, { rowSpan: number; colSpan: number }>();
  const hidden = new Set<string>();
  for (const m of sheet.merges) {
    if (m.s.r > lastRow || m.s.c > lastColumn) continue;
    const e = { r: Math.min(m.e.r, lastRow), c: Math.min(m.e.c, lastColumn) };
    spans.set(cellKey(m.s.r, m.s.c), { rowSpan: e.r - m.s.r + 1, colSpan: e.c - m.s.c + 1 });
    for (let r = m.s.r; r <= e.r; r++) for (let c = m.s.c; c <= e.c; c++) if (r !== m.s.r || c !== m.s.c) hidden.add(cellKey(r, c));
  }

  const truncated = used.e.r > lastRow || used.e.c > lastColumn || sheet.truncated;
  const shown = drag ? { range: between(drag.start, drag.end), headerRows: 0 } : highlight;

  const onPointerDown = (event: PointerEvent<HTMLTableElement>) => {
    if (!onSelect || event.button !== 0) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) return;
    if (event.pointerType === "touch") {
      // Second tap finishes the range; the first one only marks where it starts.
      if (drag?.touch) {
        onSelect(between(drag.start, cell));
        setDrag(null);
      } else {
        setDrag({ start: cell, end: cell, touch: true });
      }
      return;
    }
    event.preventDefault(); // no text selection while dragging
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ start: cell, end: cell, touch: false });
  };
  const onPointerMove = (event: PointerEvent<HTMLTableElement>) => {
    if (!drag || drag.touch) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell && (cell.r !== drag.end.r || cell.c !== drag.end.c)) setDrag({ ...drag, end: cell });
  };
  const onPointerUp = () => {
    if (!drag || drag.touch) return;
    onSelect?.(between(drag.start, drag.end));
    setDrag(null);
  };

  return (
    <div className={cn("overflow-auto rounded-xl ring-1 ring-salin-border", className)} data-lenis-prevent="">
      <table
        className={cn("border-separate border-spacing-0 text-[12px] tabular-nums", onSelect && "cursor-cell select-none")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => drag && !drag.touch && setDrag(null)}
      >
        <thead className="sticky top-0 z-2">
          <tr>
            <th className="sticky left-0 z-3 min-w-10 border-r border-b border-salin-border bg-salin-tile" />
            {columns.map((c) => (
              <th key={c} scope="col" className="min-w-20 border-r border-b border-salin-border bg-salin-tile px-2 py-1 font-sans font-semibold text-salin-muted">
                {columnLetter(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" className="sticky left-0 z-1 border-r border-b border-salin-border bg-salin-tile px-2 text-right font-sans font-medium text-salin-subtle">
                {r + 1}
              </th>
              {columns.map((c) => {
                const key = cellKey(r, c);
                if (hidden.has(key)) return null;
                const value = sheet.cells[r]?.[c] ?? "";
                const formula = sheet.formulas.get(key);
                const selected = shown && contains(shown.range, { r, c });
                const heading = selected && r < shown.range.s.r + shown.headerRows;
                const isStart = drag?.touch && drag.start.r === r && drag.start.c === c;
                return (
                  <td
                    key={c}
                    {...spans.get(key)}
                    data-r={r}
                    data-c={c}
                    title={formula ? `=${formula}` : undefined}
                    aria-label={onSelect ? `Cell ${columnLetter(c)}${r + 1}${value ? `: ${value}` : ""}` : undefined}
                    aria-selected={onSelect ? Boolean(selected) : undefined}
                    className={cn(
                      "relative max-w-56 truncate border-r border-b border-salin-border px-2 py-1 whitespace-nowrap text-salin-text",
                      spans.has(key) && "text-center",
                      selected && "bg-salin-primary-soft/60",
                      heading && "bg-salin-primary-soft font-semibold",
                      sheet.errors.has(key) && "text-destructive",
                      onSelect && "hover:outline-2 hover:-outline-offset-2 hover:outline-salin-primary/60",
                      isStart && "outline-2 -outline-offset-2 outline-salin-primary",
                    )}
                  >
                    {sheet.uncalculated.has(key) ? <span className="text-salin-subtle italic">not calculated</span> : value}
                    {formula && (
                      <span aria-hidden="true" className="absolute top-0 right-0.5 font-sans text-[9px] text-salin-primary">
                        ƒ
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && <p className="sticky left-0 px-3 py-2 font-sans text-xs text-salin-muted">Showing the first {rows.length} rows and {columns.length} columns.</p>}
    </div>
  );
}
