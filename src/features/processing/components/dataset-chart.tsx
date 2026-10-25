/**
 * Dataset Chart
 * The live chart beside a dataset's grid: pick a number column and see its
 * total, one bar per row (the largest in green, values above the bars) and
 * the top row, average and row count. It recomputes from the draft, so it
 * follows every cell edit. Hidden when the dataset has no number column.
 */

import { useMemo, useState } from "react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { chartSummary, chartableColumns, compactNumber } from "@/core/processing/dataset-chart";
import { cn } from "@/lib/utils";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

export function DatasetChart({ columns, rows, className }: { columns: DatasetColumn[]; rows: DatasetRow[]; className?: string }) {
  const numeric = useMemo(() => chartableColumns(columns, rows), [columns, rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const valueColumn = numeric.find((column) => column.id === picked) ?? numeric[0];
  const labelColumn = columns.find((column) => column.type === "text" && !numeric.includes(column)) ?? null;
  const summary = useMemo(() => (valueColumn ? chartSummary(rows, valueColumn.id, labelColumn?.id ?? null) : null), [rows, valueColumn, labelColumn]);
  if (!valueColumn || !summary) return null;

  const max = Math.max(1, ...summary.points.map((point) => point.value));
  const share = summary.top && summary.total > 0 ? Math.round((summary.top.value / summary.total) * 100) : null;
  const stats: [string, string][] = [
    ["Top row", summary.top ? `${summary.top.label}${share !== null ? ` · ${share}%` : ""}` : "—"],
    ["Average per row", summary.average.toLocaleString("en-PH", { maximumFractionDigits: 1 })],
    ["Rows counted", summary.counted.toLocaleString()],
  ];

  return (
    <section aria-label="Chart" className={cn("rounded-2xl bg-salin-surface p-4 ring-1 ring-salin-border", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="pt-1.5 text-[13px] text-salin-muted">{valueColumn.name} total</p>
        {numeric.length > 1 && (
          <ChoiceMenu label="Chart column" heading="Chart" value={valueColumn.id} onChange={setPicked} options={numeric.map((column) => ({ value: column.id, label: column.name }))} />
        )}
      </div>
      <p className="mt-0.5 text-[32px] leading-tight font-bold tracking-[-0.03em] text-salin-text tabular-nums">{summary.total.toLocaleString("en-PH", { maximumFractionDigits: 2 })}</p>

      {summary.points.length > 0 ? (
        <ul aria-label={`${valueColumn.name} by row`} className="mt-5 flex h-48 items-end gap-2 border-b border-salin-border">
          {summary.points.map((point, index) => {
            const top = point === summary.top;
            return (
              <li key={index} aria-label={`${point.label}: ${point.value.toLocaleString()}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span aria-hidden="true" className={cn("font-mono text-[10.5px] font-semibold tabular-nums", top ? "text-salin-primary-ink" : "text-salin-muted")}>
                  {compactNumber(point.value)}
                </span>
                <span
                  aria-hidden="true"
                  style={{ height: `${(Math.max(0, point.value) / max) * 100}%` }}
                  className={cn("w-full max-w-9 rounded-t-md transition-[height] duration-500 ease-spring motion-reduce:transition-none", top ? "bg-linear-to-b from-salin-primary to-[#34c47f]" : "bg-salin-primary/25")}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-5 grid h-48 place-items-center rounded-xl bg-salin-tile text-sm text-salin-muted">No numbers in this column yet.</p>
      )}
      {summary.points.length > 0 && (
        <div aria-hidden="true" className="mt-1.5 flex gap-2">
          {summary.points.map((point, index) => (
            <span key={index} className={cn("min-w-0 flex-1 truncate text-center text-[11px]", point === summary.top ? "font-semibold text-salin-primary-ink" : "text-salin-muted")}>
              {point.label}
            </span>
          ))}
        </div>
      )}
      {summary.counted > summary.points.length && <p className="mt-1 text-[11px] text-salin-subtle">First {summary.points.length} of {summary.counted} rows shown.</p>}

      <dl className="mt-4 divide-y divide-salin-border border-t border-salin-border text-[13px]">
        {stats.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-salin-muted">{label}</dt>
            <dd className="min-w-0 truncate font-semibold text-salin-text tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
