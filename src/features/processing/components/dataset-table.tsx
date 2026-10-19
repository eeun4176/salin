/**
 * Dataset Table
 * The editable grid on the review screen, spreadsheet-style: click a cell to
 * edit it (saved when you leave the cell or press Enter), column menus in the
 * header, a row number that shows where the row came from, and per-row
 * "view source" and delete buttons (rows read from a scan open the page with
 * their region highlighted). Cells that need attention are tinted with the
 * reason in their tooltip; values corrected after OCR say what OCR read.
 * Long tables render 100 rows at a time.
 */

import { memo, useState, type KeyboardEvent } from "react";
import { FileSearch, Plus, X } from "lucide-react";

import { ColumnMenu } from "@/features/processing/components/column-menu";
import type { DatasetReview } from "@/features/processing/hooks/use-dataset-review";
import { convertValue } from "@/core/processing/dataset-inference";
import type { CellIssue } from "@/core/processing/dataset-validator";
import { cn } from "@/lib/utils";
import type { CellValue, DatasetColumn, DatasetRow, SourceReference } from "@/types/processing";

const PAGE_SIZE = 100;

function display(value: CellValue | undefined) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function describeSource(source: SourceReference, fileName: string | undefined) {
  if (source.ocr) return `${fileName ?? "Deleted document"} · scanned page ${source.ocr.page}`;
  // Excel rows carry their cells ("B5:F5"); other sources a row or line number.
  const at = source.range ? `cells ${source.range}` : source.row ? `row ${source.row}` : null;
  const where = [source.sheet, source.page ? `page ${source.page}` : null, at].filter(Boolean).join(", ");
  return `${fileName ?? "Deleted document"}${where ? ` · ${where}` : ""}`;
}

interface CellProps {
  column: DatasetColumn;
  value: CellValue | undefined;
  label: string;
  issue: string | undefined;
  /** Extra tooltip, e.g. what OCR read before the value was corrected. */
  hint?: string;
  onCommit: (value: CellValue) => void;
}

/** Edits as plain text and converts to the column's type when the edit is committed. */
function Cell({ column, value, label, issue, hint, onCommit }: CellProps) {
  const shown = display(value);
  const title = [issue, hint].filter(Boolean).join(" · ") || undefined;
  const className = cn(
    "h-10 w-full min-w-36 bg-transparent px-2.5 text-sm text-salin-text outline-none placeholder:text-salin-subtle focus:bg-salin-surface focus:ring-2 focus:ring-salin-primary focus:ring-inset",
    issue && "bg-amber-50 dark:bg-amber-400/15",
  );

  if (column.type === "boolean") {
    return (
      <select
        aria-label={label}
        aria-invalid={issue ? true : undefined}
        title={title}
        value={value === true ? "yes" : value === false ? "no" : ""}
        onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value === "yes")}
        className={className}
      >
        <option value="">—</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }

  const commit = (text: string) => {
    if (text === shown) return;
    onCommit(convertValue(text.trim() === "" ? null : text, column.type));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      e.currentTarget.value = shown;
      e.currentTarget.blur();
    }
  };

  return (
    <input
      // Remount when the stored value changes elsewhere (type change, undo…).
      key={shown}
      aria-label={label}
      aria-invalid={issue ? true : undefined}
      title={title}
      defaultValue={shown}
      inputMode={column.type === "number" ? "decimal" : undefined}
      placeholder={column.type === "date" ? "YYYY-MM-DD" : undefined}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={onKeyDown}
      className={className}
    />
  );
}

interface RowProps {
  row: DatasetRow;
  index: number;
  columns: DatasetColumn[];
  issues: Map<string, string> | undefined;
  sourceLabel: string | null;
  onUpdateCell: DatasetReview["updateCell"];
  onRemoveRow: DatasetReview["removeRow"];
  onViewSource: (source: SourceReference) => void;
}

function sameIssues(a: Map<string, string> | undefined, b: Map<string, string> | undefined) {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** Re-renders only when this row, its issues or the columns change, so typing in one row stays fast on big tables. */
const Row = memo(function Row({ row, index, columns, issues, sourceLabel, onUpdateCell, onRemoveRow, onViewSource }: RowProps) {
  return (
    <tr className="group">
      <th scope="row" title={sourceLabel ?? "Added during review"} className="sticky left-0 z-1 w-12 border-b border-salin-border bg-salin-canvas px-2 text-right text-xs font-medium text-salin-subtle tabular-nums">
        {index + 1}
      </th>
      {columns.map((column) => (
        <td key={column.id} className="border-b border-l border-salin-border p-0">
          <Cell
            column={column}
            value={row.values[column.id]}
            label={`${column.name}, row ${index + 1}`}
            issue={issues?.get(column.id)}
            hint={row.source?.ocr?.original[column.id] !== undefined ? `Corrected — OCR read “${row.source.ocr.original[column.id]}”` : undefined}
            onCommit={(value) => onUpdateCell(row.id, column.id, value)}
          />
        </td>
      ))}
      <td className="border-b border-l border-salin-border px-1">
        <div className="flex items-center justify-end gap-0.5 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
          {row.source && (
            <button
              type="button"
              aria-label={`View source of row ${index + 1}: ${sourceLabel}`}
              title={sourceLabel ?? undefined}
              onClick={() => onViewSource(row.source!)}
              className="grid size-8 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text"
            >
              <FileSearch className="size-4" />
            </button>
          )}
          <button
            type="button"
            aria-label={`Delete row ${index + 1}`}
            onClick={() => onRemoveRow(row.id)}
            className="grid size-8 place-items-center rounded-lg text-salin-subtle hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-400/15 dark:hover:text-red-300"
          >
            <X className="size-4" />
          </button>
        </div>
      </td>
    </tr>
  );
},
(prev, next) =>
  prev.row === next.row &&
  prev.index === next.index &&
  prev.columns === next.columns &&
  prev.sourceLabel === next.sourceLabel &&
  prev.onViewSource === next.onViewSource &&
  sameIssues(prev.issues, next.issues));

interface DatasetTableProps {
  review: DatasetReview;
  /** Show only rows with at least one issue. */
  issuesOnly: boolean;
  sourceNames: Map<string, string>;
  onViewSource: (source: SourceReference) => void;
}

export function DatasetTable({ review, issuesOnly, sourceNames, onViewSource }: DatasetTableProps) {
  const { columns, rows } = review.draft;
  const [limit, setLimit] = useState(PAGE_SIZE);

  const issuesByRow = new Map<number, Map<string, string>>();
  review.issues.forEach((issue: CellIssue) => {
    const forRow = issuesByRow.get(issue.row) ?? new Map<string, string>();
    forRow.set(issue.columnId, issue.message);
    issuesByRow.set(issue.row, forRow);
  });
  const indexed = rows.map((row, index) => ({ row, index }));
  const matching = issuesOnly ? indexed.filter(({ index }) => issuesByRow.has(index)) : indexed;
  const visible = matching.slice(0, limit);

  const addRow = () => {
    review.addRow();
    // Show the new row even when it lands past the current page.
    setLimit((current) => Math.max(current, rows.length + 1));
  };

  return (
    <div>
      <div className="max-h-[70vh] overflow-auto rounded-2xl ring-1 ring-salin-border" data-lenis-prevent="">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-2 bg-salin-tile">
            <tr>
              <th scope="col" className="sticky left-0 z-3 w-12 border-b border-salin-border bg-salin-tile">
                <span className="sr-only">Row</span>
              </th>
              {columns.map((column) => (
                <th key={column.id} scope="col" className="min-w-36 border-b border-l border-salin-border p-1 font-normal">
                  <ColumnMenu
                    column={column}
                    columns={columns}
                    onRename={(name) => review.updateColumn(column.id, { name })}
                    onTypeChange={(type) => review.setColumnType(column.id, type)}
                    onRequiredChange={(required) => review.updateColumn(column.id, { required })}
                    onDelete={() => review.removeColumn(column.id)}
                  />
                </th>
              ))}
              <th scope="col" className="w-20 border-b border-l border-salin-border p-1">
                <button
                  type="button"
                  onClick={review.addColumn}
                  aria-label="Add column"
                  title="Add column"
                  className="mx-auto grid size-8 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile-hover hover:text-salin-text"
                >
                  <Plus className="size-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ row, index }) => (
              <Row
                key={row.id}
                row={row}
                index={index}
                columns={columns}
                issues={issuesByRow.get(index)}
                sourceLabel={row.source ? describeSource(row.source, sourceNames.get(row.source.fileId)) : null}
                onUpdateCell={review.updateCell}
                onRemoveRow={review.removeRow}
                onViewSource={onViewSource}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-10 text-center text-sm text-salin-muted">
                  {issuesOnly ? "No rows need attention." : "No rows yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={addRow} className="press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
          <Plus className="size-4" /> Add row
        </button>
        {matching.length > visible.length && (
          <button type="button" onClick={() => setLimit((n) => n + PAGE_SIZE)} className="text-sm font-semibold text-salin-primary hover:underline">
            Show {Math.min(PAGE_SIZE, matching.length - visible.length)} more
          </button>
        )}
        <span className="ml-auto text-xs text-salin-muted">
          {matching.length > visible.length ? `Showing ${visible.length.toLocaleString()} of ${matching.length.toLocaleString()} rows` : `${matching.length.toLocaleString()} rows`}
        </span>
      </div>
    </div>
  );
}
