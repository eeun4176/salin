/**
 * Command Preview
 * Shows what a dataset command will do before anything changes, whether it
 * came from the Transform tools or the on-device assistant: the command in
 * plain words, how many rows and columns are affected with before → after
 * samples, a clear warning for deletions and bulk edits, result tables for
 * summaries (which can be saved as a new dataset) and duplicate groups
 * (whose extra copies can be removed — only when the user chooses). Apply
 * hands the result to the editor, where it can be undone.
 */

import { useState } from "react";
import { Bot, TriangleAlert } from "lucide-react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { displayValue, removeRows, type CommandOutcome, type CommandTarget } from "@/core/processing/dataset-commands";
import { cn } from "@/lib/utils";

interface CommandPreviewProps {
  /** The command in plain words. */
  title: string | null;
  outcome: CommandOutcome | null;
  target: CommandTarget;
  /** The request was turned into this command by the assistant. */
  fromAssistant?: boolean;
  onClose: () => void;
  /** Applies a change or shows a filtered view. */
  onApply: (outcome: Extract<CommandOutcome, { kind: "change" | "view" }>, title: string) => void;
  onSaveTable?: (outcome: Extract<CommandOutcome, { kind: "table" }>) => Promise<void>;
}

const button = "press h-10 rounded-xl px-4 text-sm font-semibold disabled:opacity-50";

function Samples({ outcome }: { outcome: Extract<CommandOutcome, { kind: "change" }> }) {
  if (outcome.samples.length === 0) return null;
  const removing = outcome.samples.every((s) => !("after" in s) || s.after === undefined);
  return (
    <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent-horizontal="">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Examples of the change</caption>
        <thead className="bg-salin-tile text-xs text-salin-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              Row
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {removing ? "Row to delete" : "Column"}
            </th>
            {!removing && (
              <>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Now
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  After
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-salin-border">
          {outcome.samples.map((s, i) => (
            <tr key={i}>
              <td className="px-3 py-2 text-salin-muted tabular-nums">{s.row}</td>
              {removing ? (
                <td className="px-3 py-2 text-salin-text">{displayValue(s.before) || "(empty)"}</td>
              ) : (
                <>
                  <td className="px-3 py-2 text-salin-muted">{s.column}</td>
                  <td className="px-3 py-2 text-salin-muted line-through decoration-salin-subtle">{displayValue(s.before) || "(empty)"}</td>
                  <td className="px-3 py-2 font-medium text-salin-text">{displayValue(s.after ?? null) || "(empty)"}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {outcome.affectedRows > outcome.samples.length && <p className="border-t border-salin-border px-3 py-2 text-xs text-salin-muted">…and {(outcome.affectedRows - outcome.samples.length).toLocaleString()} more.</p>}
    </div>
  );
}

export function CommandPreview({ title, outcome: initial, target, fromAssistant, onClose, onApply, onSaveTable }: CommandPreviewProps) {
  // Duplicates can turn into a "remove extra copies" change inside the same dialog.
  const [override, setOverride] = useState<{ base: CommandOutcome | null; outcome: CommandOutcome } | null>(null);
  const outcome = override && override.base === initial ? override.outcome : initial;
  const [saving, setSaving] = useState(false);
  const open = outcome !== null && title !== null;

  const apply = () => {
    if (outcome?.kind === "change" || outcome?.kind === "view") onApply(outcome, title ?? "");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {open && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto" data-lenis-prevent="">
          <DialogTitle>{outcome.kind === "table" ? outcome.title : "Preview"}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-salin-muted">
              {fromAssistant && (
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                  <Bot className="size-3.5" /> The assistant understood your request as:
                </p>
              )}
              <p className="font-medium text-salin-text">{title}</p>
              <p className="mt-1">{outcome.message}</p>
            </div>
          </DialogDescription>

          {outcome.kind === "change" && (
            <>
              {outcome.destructive && outcome.affectedRows > 0 && (
                <p role="alert" className="mt-3 flex gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {outcome.samples.every((s) => s.after === undefined) ? "These rows will be removed from the dataset." : "This changes many values at once."} You can undo it right after.
                </p>
              )}
              <Samples outcome={outcome} />
            </>
          )}

          {outcome.kind === "table" && (
            <div className="mt-3 max-h-80 overflow-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent="">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-salin-tile text-xs text-salin-muted">
                  <tr>
                    {outcome.headers.map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-salin-border">
                  {outcome.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className={cn("px-3 py-2 text-salin-text", typeof cell === "number" && "tabular-nums")}>
                          {displayValue(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {outcome.kind === "duplicates" && outcome.groups.length > 0 && (
            <ul className="mt-3 max-h-72 divide-y divide-salin-border overflow-y-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent="">
              {outcome.groups.map((g) => (
                <li key={g.key + g.rows[0]} className="px-3 py-2 text-sm">
                  <span className="font-medium text-salin-text">{g.key}</span>
                  <span className="block text-xs text-salin-muted">Rows {g.rows.join(", ")}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <DialogClose className={cn(button, "font-medium text-salin-muted hover:bg-salin-tile")}>{outcome.kind === "table" || (outcome.kind === "duplicates" && outcome.groups.length === 0) ? "Close" : "Cancel"}</DialogClose>
            {outcome.kind === "duplicates" && outcome.groups.length > 0 && (
              <>
                <button type="button" onClick={() => (onApply({ kind: "view", rowIds: outcome.groups.flatMap((g) => g.rowIds), message: outcome.message }, "Duplicate rows"), onClose())} className={cn(button, "text-salin-text ring-1 ring-salin-border hover:bg-salin-tile")}>
                  Show these rows
                </button>
                <button
                  type="button"
                  onClick={() => setOverride({ base: initial, outcome: removeRows(target, new Set(outcome.groups.flatMap((g) => g.rowIds.slice(1)))) })}
                  className={cn(button, "text-salin-text ring-1 ring-salin-border hover:bg-salin-tile")}
                >
                  Remove extra copies…
                </button>
              </>
            )}
            {outcome.kind === "table" && onSaveTable && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  void onSaveTable(outcome).finally(() => setSaving(false));
                }}
                className={cn(button, "bg-salin-primary text-white hover:bg-salin-primary-strong")}
              >
                {saving ? "Saving…" : "Save as a new dataset"}
              </button>
            )}
            {outcome.kind === "view" && (
              <button type="button" autoFocus onClick={apply} disabled={outcome.rowIds.length === 0} className={cn(button, "bg-salin-primary text-white hover:bg-salin-primary-strong")}>
                Show {outcome.rowIds.length.toLocaleString()} row{outcome.rowIds.length === 1 ? "" : "s"}
              </button>
            )}
            {outcome.kind === "change" && (
              <button
                type="button"
                autoFocus
                onClick={apply}
                disabled={outcome.affectedRows === 0 && outcome.affectedColumns.length === 0}
                className={cn(button, "text-white", outcome.destructive && outcome.affectedRows > 0 ? "bg-destructive hover:bg-destructive/90" : "bg-salin-primary hover:bg-salin-primary-strong")}
              >
                {outcome.samples.length > 0 && outcome.samples.every((s) => s.after === undefined) ? `Delete ${outcome.affectedRows.toLocaleString()} row${outcome.affectedRows === 1 ? "" : "s"}` : "Apply"}
              </button>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
