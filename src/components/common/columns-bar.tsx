/**
 * Columns Bar
 * "What do you need?" — the user names the columns to keep, by typing
 * ("Name, Address, Birthday") or by tapping labels already found, or picks
 * a set used before with one tap. Optionally asks whether each page is one
 * record or a list. Used on the scan review and on the dataset page; the
 * caller decides what extracting means.
 */

import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Check, History, ListChecks, Sparkles } from "lucide-react";

import { primaryButton } from "@/components/common/step-footer";
import { parseColumnList, type RecordShape } from "@/core/ocr/templates/requested-columns";
import { cn } from "@/lib/utils";

export interface ColumnSet {
  labels: string[];
  shape: RecordShape;
}

interface ColumnsBarProps {
  title: string;
  description: string;
  /** Columns shown in the box at first. */
  initial: string[];
  /** Labels to tap (each adds or removes itself). */
  found: string[];
  /** Sets used before: one tap extracts them. */
  recent?: ColumnSet[];
  /** One record per page, or a list on each page (scans only). */
  shape?: RecordShape;
  onShape?: (shape: RecordShape) => void;
  busy: boolean;
  onSubmit: (labels: string[], shape?: RecordShape) => void;
  /** Status or hints shown under the bar. */
  children?: ReactNode;
}

const chip = "press inline-flex h-8 max-w-full items-center gap-1 truncate rounded-full px-3 text-xs font-semibold ring-1";

export function ColumnsBar({ title, description, initial, found, recent = [], shape, onShape, busy, onSubmit, children }: ColumnsBarProps) {
  const headingId = useId();
  const [text, setText] = useState(initial.join(", "));
  const [error, setError] = useState<string | null>(null);
  const chosen = parseColumnList(text);
  const has = (label: string) => chosen.some((c) => c.toLowerCase() === label.toLowerCase());

  const toggle = (label: string) => {
    setError(null);
    setText((has(label) ? chosen.filter((c) => c.toLowerCase() !== label.toLowerCase()) : [...chosen, label]).join(", "));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen.length === 0) {
      setError("Name at least one column, e.g. Name, Address.");
      return;
    }
    onSubmit(chosen, shape);
  }

  return (
    <section aria-labelledby={headingId} className="rounded-2xl bg-salin-primary-soft/40 p-4 ring-1 ring-salin-border">
      <h3 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-salin-text">
        <Sparkles aria-hidden="true" className="size-4 text-salin-primary" /> {title}
      </h3>
      <p className="mt-1 text-xs text-salin-muted">{description}</p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(e) => (setText(e.target.value), setError(null))}
          aria-label="Columns you need"
          aria-invalid={Boolean(error) || undefined}
          placeholder="e.g. Name, Address, Birthday"
          maxLength={1000}
          className="h-11 min-w-0 flex-1 rounded-xl border border-salin-border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15 aria-invalid:border-destructive"
        />
        <button type="submit" disabled={busy} className={primaryButton}>
          <ListChecks className="size-4" /> Extract
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {shape && onShape && (
        <div role="radiogroup" aria-label="How records are laid out" className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["form", "One record per page"],
              ["table", "A list on each page"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1", shape === value ? "bg-salin-surface ring-salin-primary" : "ring-salin-border")}>
              <input type="radio" name={`${headingId}-shape`} value={value} checked={shape === value} onChange={() => onShape(value)} className="size-4 accent-salin-primary" />
              {label}
            </label>
          ))}
        </div>
      )}
      {found.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-salin-muted">Found here — tap to add or remove</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {found.map((label) => (
              <button key={label} type="button" aria-pressed={has(label)} onClick={() => toggle(label)} className={cn(chip, has(label) ? "bg-salin-primary text-white ring-salin-primary" : "bg-salin-surface text-salin-text ring-salin-border hover:bg-salin-tile")}>
                {has(label) && <Check aria-hidden="true" className="size-3.5 shrink-0" />}
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-salin-muted">Used before</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {recent.map((set) => (
              <button
                key={`${set.shape}:${set.labels.join("|")}`}
                type="button"
                disabled={busy}
                onClick={() => {
                  setText(set.labels.join(", "));
                  onShape?.(set.shape);
                  onSubmit(set.labels, set.shape);
                }}
                className={cn(chip, "bg-salin-surface text-salin-text ring-salin-border hover:bg-salin-tile")}
              >
                <History aria-hidden="true" className="size-3.5 shrink-0 text-salin-muted" /> {set.labels.join(", ")}
              </button>
            ))}
          </div>
        </div>
      )}
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}
