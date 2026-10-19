/**
 * Section Card
 * One section of a worksheet in step 2 of the guided Excel extraction: a
 * descriptive name, how many records it holds, a review status with advice
 * ("Ready", "Check before creating", or why it was left out), and a small
 * preview of the rows it will produce. The technical settings — which cells,
 * which rows hold the column names (a dropdown that previews the names each
 * choice gives), merged cells and formulas — stay inside a collapsed
 * "Adjust selection" panel, with the sheet itself for selecting cells
 * visually.
 */

import { useId, useState } from "react";
import { ChevronDown, CircleCheck, CircleMinus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";

import { columnLetter, formatRange, type CellRange } from "@/core/processing/excel/cell-range";
import { checkRange, MAX_HEADER_ROWS, suggestHeaderRows, type TableStats } from "@/core/processing/excel/table-detection";
import type { SheetModel } from "@/core/processing/excel/workbook-reader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetGrid } from "@/features/processing/components/sheet-grid";
import { recordCount, reviewStatus, type EvaluatedDraft, type ReviewKind, type TableDraft } from "@/features/processing/table-drafts";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<ReviewKind, { icon: typeof CircleCheck; className: string }> = {
  ready: { icon: CircleCheck, className: "bg-salin-primary-soft text-salin-primary-ink" },
  check: { icon: TriangleAlert, className: "bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
  skip: { icon: CircleMinus, className: "bg-salin-tile text-salin-muted" },
};

const PREVIEW_ROWS = 3;

interface SectionCardProps {
  name: string;
  sheet: SheetModel;
  draft: TableDraft;
  evaluated: EvaluatedDraft;
  /** Shown when this section is selected but can't be extracted. */
  problem: string | null;
  onChange: (patch: Partial<TableDraft>) => void;
  onRemove?: () => void;
}

export function SectionCard({ name, sheet, draft, evaluated, problem, onChange, onRemove }: SectionCardProps) {
  const id = useId();
  const [adjusting, setAdjusting] = useState(draft.origin === "manual" && draft.range === "");
  const status = reviewStatus(evaluated);
  const style = STATUS_STYLE[status.kind];
  const records = recordCount(evaluated);
  const columns = evaluated.ok ? evaluated.description.stats.columns : 0;

  return (
    <section aria-labelledby={`${id}-name`} className={cn("rounded-2xl p-4 ring-1 transition-colors", draft.include ? "bg-salin-surface ring-salin-primary/40" : "bg-salin-canvas ring-salin-border")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* Full width on phones so the status wraps below instead of squeezing the name. */}
        <label className="flex w-full min-w-0 cursor-pointer items-start gap-3 sm:w-auto sm:flex-1">
          <input
            type="checkbox"
            checked={draft.include}
            onChange={(e) => onChange({ include: e.target.checked })}
            aria-describedby={`${id}-meta`}
            className="mt-0.5 size-5 shrink-0 accent-salin-primary"
          />
          <span className="min-w-0">
            <span id={`${id}-name`} className="block font-semibold break-words text-salin-text">
              {name}
            </span>
            <span id={`${id}-meta`} className="mt-0.5 block text-sm text-salin-muted">
              {evaluated.ok ? `${records.toLocaleString()} record${records === 1 ? "" : "s"} · ${columns} column${columns === 1 ? "" : "s"}` : "No cells selected yet"}
            </span>
          </span>
        </label>
        <span className={cn("ml-8 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:ml-0", style.className)}>
          <style.icon className="size-3.5" /> {status.label}
        </span>
        {onRemove && (
          <button type="button" aria-label={`Remove ${name}`} onClick={onRemove} className="grid size-8 place-items-center rounded-lg text-salin-subtle hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-400/15">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {status.advice.length > 0 && (
        <ul className="mt-2 space-y-1 pl-8 text-sm text-salin-muted">
          {status.advice.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      )}
      {problem && draft.include && (
        <p role="alert" className="mt-2 pl-8 text-sm font-medium text-destructive">
          {problem}
        </p>
      )}

      {evaluated.ok && <RowsPreview rows={evaluated.extracted.rows} hasHeader={evaluated.extracted.headerRows !== 0} firstColumn={evaluated.range.s.c} />}

      <div className="mt-3 pl-8">
        <button
          type="button"
          aria-expanded={adjusting}
          aria-controls={`${id}-adjust`}
          onClick={() => setAdjusting(!adjusting)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-salin-primary hover:underline"
        >
          Adjust selection <ChevronDown className={cn("size-4 transition-transform", adjusting && "rotate-180")} />
        </button>
        {adjusting && (
          <div id={`${id}-adjust`} className="mt-3">
            <AdjustSelection sheet={sheet} draft={draft} evaluated={evaluated} onChange={onChange} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Cells, column-name rows, and the sheet for selecting visually. */
function AdjustSelection({ sheet, draft, evaluated, onChange }: Pick<SectionCardProps, "sheet" | "draft" | "evaluated" | "onChange">) {
  const [rangeInput, setRangeInput] = useState(draft.range);
  const range = evaluated.ok ? evaluated.range : null;

  const select = (next: CellRange) => {
    const text = formatRange(next);
    setRangeInput(text);
    onChange({ range: text, headerRows: suggestHeaderRows(sheet, next) });
  };
  const applyTyped = () => {
    const checked = checkRange(sheet, rangeInput);
    if (typeof checked === "string") onChange({ range: rangeInput });
    else select(checked);
  };
  const reset = () => {
    if (!draft.detected) return;
    setRangeInput(draft.detected.range);
    onChange({ range: draft.detected.range, headerRows: draft.detected.headerRows });
  };
  const changed = draft.detected && (draft.detected.range !== draft.range || draft.detected.headerRows !== draft.headerRows);
  const firstRow = (range?.s.r ?? 0) + 1;
  const labelId = useId();

  return (
    <div className="space-y-3 rounded-xl bg-salin-canvas p-3 ring-1 ring-salin-border">
      <p className="text-sm text-salin-muted">Drag across the cells that hold this section (on a phone, tap the first cell, then the last).</p>
      <SheetGrid sheet={sheet} maxRows={150} highlight={range ? { range, headerRows: draft.headerRows } : null} onSelect={select} className="max-h-72 bg-salin-surface" />

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-salin-muted">
          Cells
          <input
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value.toUpperCase())}
            onBlur={applyTyped}
            onKeyDown={(e) => e.key === "Enter" && applyTyped()}
            placeholder="A2:G11"
            aria-invalid={!evaluated.ok && draft.range !== "" ? true : undefined}
            className="h-9 w-32 rounded-lg border border-salin-border bg-salin-surface px-2.5 font-mono text-sm text-salin-text uppercase outline-none focus:border-salin-primary focus:ring-2 focus:ring-salin-primary/15 aria-invalid:border-destructive"
          />
        </label>
        <div className="grid w-full gap-1 sm:w-72">
          <span id={labelId} className="text-xs font-medium text-salin-muted">
            Column names
          </span>
          <Select value={String(draft.headerRows)} onValueChange={(value) => onChange({ headerRows: Number(value) })}>
            <SelectTrigger aria-labelledby={labelId} className="h-9 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)] sm:w-80">
              <SelectItem value="0" description={range ? `Columns are named ${letterNames(range)}` : "Columns are named by letter."}>
                No header row
              </SelectItem>
              {Array.from({ length: MAX_HEADER_ROWS }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)} description={range ? headerPreview(sheet, range, n) : undefined}>
                  {n === 1 ? `Row ${firstRow}` : `Rows ${firstRow}–${firstRow + n - 1} combined`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {changed && (
          <button type="button" onClick={reset} className="press inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile">
            <RotateCcw className="size-4" /> Reset
          </button>
        )}
      </div>
      {!evaluated.ok && draft.range !== "" && <p className="text-xs text-destructive">{evaluated.error}</p>}
      {evaluated.ok && <TechnicalNotes stats={evaluated.description.stats} />}
    </div>
  );
}

/** "Column A, Column B, Column C…" for a range with no header row. */
function letterNames(range: CellRange) {
  const count = range.e.c - range.s.c + 1;
  const names = Array.from({ length: Math.min(3, count) }, (_, i) => `${columnLetter(range.s.c + i)}`);
  return `Column ${names.join(", ")}${count > 3 ? "…" : ""}`;
}

/** The column names `rows` header rows would give: "Owner, Pet, Doses Rabies…". */
function headerPreview(sheet: SheetModel, range: CellRange, rows: number) {
  const names: string[] = [];
  for (let c = range.s.c; c <= range.e.c && names.length < 4; c++) {
    const parts = Array.from({ length: rows }, (_, i) => sheet.cells[range.s.r + i]?.[c]?.trim() ?? "").filter(Boolean);
    if (parts.length) names.push(parts.join(" "));
  }
  if (names.length === 0) return "These rows are empty.";
  const more = range.e.c - range.s.c + 1 > names.length;
  return `${names.slice(0, 3).join(", ")}${more || names.length > 3 ? "…" : ""}`;
}

function TechnicalNotes({ stats }: { stats: TableStats }) {
  const notes = [
    stats.mergedCells > 0 && `${stats.mergedCells} merged cell group${stats.mergedCells === 1 ? "" : "s"}: headings span their columns, and merged values repeat on each row.`,
    stats.formulaCells > 0 && `${stats.formulaCells} formula cell${stats.formulaCells === 1 ? "" : "s"} (ƒ): the results Excel last saved are used.`,
    stats.uncalculated > 0 && `${stats.uncalculated} formula${stats.uncalculated === 1 ? " has" : "s have"} no saved result and will be empty.`,
    stats.errors > 0 && `${stats.errors} cell${stats.errors === 1 ? " shows" : "s show"} a formula error (like #DIV/0!).`,
  ].filter((n): n is string => Boolean(n));
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-salin-muted">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

/** Column names and the first few records this section will produce. */
function RowsPreview({ rows, hasHeader, firstColumn }: { rows: string[][]; hasHeader: boolean; firstColumn: number }) {
  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const header = hasHeader ? rows[0] : Array.from({ length: width }, (_, i) => `Column ${columnLetter(firstColumn + i)}`);
  const data = (hasHeader ? rows.slice(1) : rows).filter((r) => r.some((v) => v.trim() !== ""));
  if (data.length === 0) return null;
  return (
    <div className="mt-3 pl-8">
      <div className="overflow-x-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent="">
        <table className="w-max min-w-full text-left text-[13px]" aria-label="Preview of records">
          <thead className="bg-salin-tile text-salin-muted">
            <tr>
              {header.map((name, i) => (
                <th key={i} scope="col" className="px-3 py-1.5 font-semibold whitespace-nowrap">
                  {name || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-salin-border">
            {data.slice(0, PREVIEW_ROWS).map((row, r) => (
              <tr key={r}>
                {header.map((_, i) => (
                  <td key={i} className="max-w-48 truncate px-3 py-1.5 text-salin-text">
                    {row[i] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > PREVIEW_ROWS && <p className="mt-1 text-xs text-salin-muted">+ {(data.length - PREVIEW_ROWS).toLocaleString()} more</p>}
    </div>
  );
}
