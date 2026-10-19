/**
 * Excel Preview
 * What the file preview shows for an .xlsx workbook: a tab per worksheet
 * (hidden and chart sheets marked) and the selected sheet as a spreadsheet
 * grid — merged cells, formulas marked ƒ — limited to the first rows so big
 * workbooks open quickly.
 */

import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { SheetGrid } from "@/features/processing/components/sheet-grid";
import { useWorkbook } from "@/features/processing/hooks/use-workbook";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = 300;

export function ExcelPreview({ fileId }: { fileId: string }) {
  const state = useWorkbook(fileId, PREVIEW_ROWS);
  const [active, setActive] = useState(0);

  if (state.status === "loading") {
    return (
      <div className="grid h-full place-items-center text-sm text-salin-muted">
        <span className="flex items-center gap-2">
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> Opening workbook…
        </span>
      </div>
    );
  }
  if (state.status === "error") return <p className="grid h-full place-items-center px-6 text-center text-sm text-salin-muted">{state.message}</p>;

  const { sheets } = state.workbook;
  const sheet = sheets[Math.min(active, sheets.length - 1)];
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Worksheets" className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-salin-border px-2 pt-2">
        {sheets.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            aria-selected={s === sheet}
            onClick={() => setActive(i)}
            className={cn(
              "shrink-0 rounded-t-lg border border-b-0 px-3 py-1.5 text-[13px] font-medium whitespace-nowrap",
              s === sheet ? "border-salin-border bg-salin-surface text-salin-primary" : "border-transparent text-salin-muted hover:text-salin-text",
            )}
          >
            {s.name}
            {s.visibility !== "visible" && <span className="text-xs text-salin-subtle"> (hidden)</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={sheet.name} className="min-h-0 flex-1 p-2">
        {sheet.isChartSheet ? (
          <p className="grid h-full place-items-center text-sm text-salin-muted">This is a chart sheet. Charts can't be shown here.</p>
        ) : (
          <SheetGrid sheet={sheet} maxRows={PREVIEW_ROWS} maxColumns={60} className="h-full" />
        )}
      </div>
    </div>
  );
}
