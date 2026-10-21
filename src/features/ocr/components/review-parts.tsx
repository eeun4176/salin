/**
 * Review Parts
 * The pieces of the Review step: a state chip (Ready, Needs review,
 * Unreadable, Missing), a close-up of the page region a value came from
 * (for checking and for typing unclear or handwritten values), one field
 * row (value editor, separate OCR and mapping confidence, flags, Confirm
 * and Pick-from-page), and the editable table of repeated records.
 */

import { useId, type ReactNode } from "react";
import { Check, CircleAlert, CircleCheck, CircleHelp, CircleX, Crosshair, Plus, SquareDashedMousePointer, Trash2 } from "lucide-react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { describeFlags, refKey, STATE_LABEL, valueState, type ValueRef } from "@/core/ocr/review/review-state";

/** Menu value for "not filled in" (menu items can't use an empty value). */
const NONE = "__none__";
import { cn } from "@/lib/utils";
import type { Box, ExtractedValue, FieldSpec, RecordSet, ReviewState } from "@/types/ocr";

const CHIP: Record<ReviewState, { icon: typeof Check; className: string }> = {
  ready: { icon: CircleCheck, className: "bg-salin-primary-soft text-salin-primary-ink" },
  needs_review: { icon: CircleAlert, className: "bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
  unreadable: { icon: CircleHelp, className: "bg-red-50 text-red-800 dark:bg-red-400/15 dark:text-red-300" },
  missing: { icon: CircleX, className: "bg-red-50 text-red-800 dark:bg-red-400/15 dark:text-red-300" },
};

export function StateChip({ state, className }: { state: ReviewState; className?: string }) {
  const { icon: Icon, className: tone } = CHIP[state];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tone, className)}>
      <Icon className="size-3" /> {STATE_LABEL[state]}
    </span>
  );
}

/** The part of the page a value came from, enlarged. */
export function RegionCrop({ src, page, box, maxWidth = 280 }: { src: string | null; page: { width: number; height: number }; box: Box; maxWidth?: number }) {
  if (!src || !page.width) return null;
  // A little margin around the region, then scale so it fills the close-up.
  const pad = Math.max(6, box.height * 0.4);
  const region = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 };
  const scale = Math.min(3, maxWidth / region.width);
  return (
    <div
      role="img"
      aria-label="Close-up of this value on the page"
      className="max-w-full rounded-lg bg-white bg-no-repeat ring-1 ring-salin-border"
      style={{
        width: region.width * scale,
        height: region.height * scale,
        backgroundImage: `url(${src})`,
        backgroundSize: `${page.width * scale}px ${page.height * scale}px`,
        backgroundPosition: `-${region.x * scale}px -${region.y * scale}px`,
      }}
    />
  );
}

function ValueEditor({ id, spec, value, onChange, onFocus, label, invalid }: { id: string; spec: FieldSpec; value: ExtractedValue; onChange: (text: string) => void; onFocus: () => void; label: string; invalid: boolean }) {
  const base = "h-10 w-full rounded-xl border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:ring-3 focus:ring-salin-primary/15";
  const tone = invalid ? "border-amber-400 focus:border-amber-500 dark:border-amber-400/60" : "border-salin-border focus:border-salin-primary";
  if (spec.type === "choice" || spec.type === "boolean") {
    const options = spec.type === "boolean" ? ["Yes", "No"] : (spec.options ?? []);
    const known = options.includes(value.text) || value.text === "";
    const choices = [
      { value: NONE, label: "— Not filled in —" },
      ...(known ? [] : [{ value: value.text, label: `${value.text} (as read)` }]),
      ...options.map((o) => ({ value: o, label: o })),
    ];
    return (
      <ChoiceMenu id={id} variant="field" label={label} heading={label} invalid={invalid} value={value.text || NONE} options={choices} onFocus={onFocus} onChange={(v) => onChange(v === NONE ? "" : v)} />
    );
  }
  return (
    <input
      id={id}
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value.text}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      inputMode={spec.type === "number" ? "decimal" : undefined}
      placeholder={spec.type === "date" ? "MM/DD/YYYY" : value.ocrText === null ? "Not found — type it from the page" : ""}
      className={cn(base, tone)}
    />
  );
}

const percent = (v: number | null, scale = 1) => (v === null ? null : `${Math.round(v * scale)}%`);

interface FieldRowProps {
  refId: string;
  spec: FieldSpec;
  value: ExtractedValue;
  selected: boolean;
  picking: boolean;
  pageImage: { src: string | null; width: number; height: number } | null;
  /** A pending suggestion for this value, shown under it. */
  suggestion?: ReactNode;
  onSelect: () => void;
  onChange: (text: string) => void;
  onConfirm: (confirmed: boolean) => void;
  onPick: () => void;
}

export function FieldRow({ refId, spec, value, selected, picking, pageImage, suggestion, onSelect, onChange, onConfirm, onPick }: FieldRowProps) {
  const id = useId();
  const state = valueState(value, spec);
  const flags = describeFlags(value);
  const hard = state === "unreadable" || value.flags.includes("possibly-handwritten");
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      data-ref={refId}
      onClick={onSelect}
      className={cn("rounded-2xl p-3 ring-1 transition-colors", selected ? "bg-sky-50/70 ring-sky-400 dark:bg-sky-400/10" : "ring-salin-border")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label id={`${id}-label`} htmlFor={`${id}-input`} className="text-sm font-medium text-salin-text">
          {spec.label}
          {spec.required && (
            <span className="text-destructive" aria-label="required">
              {" "}
              *
            </span>
          )}
        </label>
        <StateChip state={state} />
      </div>
      <div className="mt-2">
        <ValueEditor id={`${id}-input`} spec={spec} value={value} onChange={onChange} onFocus={onSelect} label={spec.label} invalid={state !== "ready"} />
      </div>
      {suggestion && <div className="mt-2">{suggestion}</div>}
      {hard && value.box && pageImage && (
        <div className="mt-2">
          <p className="mb-1 text-xs text-salin-muted">Type what you see here:</p>
          <RegionCrop src={pageImage.src} page={pageImage} box={value.box} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-salin-muted">
        {value.ocrText !== null ? (
          <>
            <span title="How sure the text recognition was about the characters">Read {percent(value.ocrConfidence) ?? "—"}</span>
            {value.mappingConfidence !== null && <span title="How sure Salin is that this text belongs to this field">Match {percent(value.mappingConfidence, 100)}</span>}
            {value.page && <span>Page {value.page}</span>}
          </>
        ) : (
          <span>Not found on the page</span>
        )}
        {value.edited && value.ocrText !== null && <span>OCR read: “{value.ocrText || "(blank)"}”</span>}
        {value.suggestedBy && <span>From an accepted {value.suggestedBy === "ai" ? "assistant" : value.suggestedBy} suggestion</span>}
      </div>
      {(flags.length > 0 || value.note) && state !== "ready" && (
        <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
          {value.note && <li>{value.note}</li>}
        </ul>
      )}
      {value.note && state === "ready" && <p className="mt-1.5 text-xs text-salin-muted">{value.note}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {/* Nothing to check on an optional field that simply isn't on the page. */}
        {!value.edited && (value.ocrText !== null || spec.required) && (
          <button
            type="button"
            aria-pressed={value.confirmed}
            onClick={(e) => {
              e.stopPropagation();
              onConfirm(!value.confirmed);
            }}
            className={cn(
              "press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1",
              value.confirmed ? "bg-salin-primary-soft text-salin-primary-ink ring-salin-primary/40" : "text-salin-text ring-salin-border hover:bg-salin-tile",
            )}
          >
            <Check className="size-3.5" /> {value.confirmed ? "Checked" : "Looks right"}
          </button>
        )}
        <button
          type="button"
          aria-pressed={picking}
          onClick={(e) => {
            e.stopPropagation();
            onPick();
          }}
          className={cn("press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1", picking ? "bg-violet-50 text-violet-800 ring-violet-400 dark:bg-violet-400/15 dark:text-violet-200" : "text-salin-text ring-salin-border hover:bg-salin-tile")}
        >
          <Crosshair className="size-3.5" /> {picking ? "Tap the text on the page…" : "Pick from page"}
        </button>
      </div>
    </div>
  );
}

const CELL_TONE: Record<ReviewState, string> = {
  ready: "border-salin-border",
  needs_review: "border-amber-400 bg-amber-50/60 dark:bg-amber-400/10",
  unreadable: "border-red-400 bg-red-50/60 dark:bg-red-400/10",
  missing: "border-red-400 bg-red-50/60 dark:bg-red-400/10",
};

interface RecordTableProps {
  set: RecordSet;
  group: number;
  selectedKey: string | null;
  /** Pending suggestions by value key (cells with one get a dashed outline). */
  suggested?: Map<string, { after: string }>;
  attentionOnly: boolean;
  onSelect: (ref: ValueRef) => void;
  onChange: (ref: ValueRef, text: string) => void;
  onConfirmRow: (rowId: string) => void;
  onRemoveRow: (rowId: string) => void;
  onAddRow: () => void;
  onRedraw: () => void;
  drawing: boolean;
  /** Tapping words on the page fills the selected cell, then moves to the next one. */
  onFill: () => void;
  filling: boolean;
}

export function RecordTable({ set, group, selectedKey, suggested, attentionOnly, onSelect, onChange, onConfirmRow, onRemoveRow, onAddRow, onRedraw, drawing, onFill, filling }: RecordTableProps) {
  const rows = attentionOnly ? set.rows.filter((row) => set.columns.some((c) => row.cells[c.key] && valueState(row.cells[c.key], c) !== "ready")) : set.rows;
  return (
    <section aria-label={`${set.label} table`} className="rounded-2xl ring-1 ring-salin-border">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <h4 className="text-sm font-semibold text-salin-text">
          {set.label} <span className="font-normal text-salin-muted">· {set.rows.length} record{set.rows.length === 1 ? "" : "s"}</span>
        </h4>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={filling} onClick={onFill} className={cn(tableButton, filling && "bg-sky-50 ring-sky-400 dark:bg-sky-400/15")}>
            <Crosshair className="size-3.5" /> {filling ? "Tapping words on the page…" : "Tap words on page"}
          </button>
          <button type="button" aria-pressed={drawing} onClick={onRedraw} className={cn(tableButton, drawing && "bg-sky-50 ring-sky-400 dark:bg-sky-400/15")}>
            <SquareDashedMousePointer className="size-3.5" /> {drawing ? "Drag around the table on the page…" : "Redraw table area"}
          </button>
          <button type="button" onClick={onAddRow} className={tableButton}>
            <Plus className="size-3.5" /> Add row
          </button>
        </div>
      </div>
      <div className="mt-2 overflow-x-auto pb-2" data-lenis-prevent-horizontal="">
        <table className="w-max min-w-full border-separate border-spacing-x-1 border-spacing-y-1 px-2 text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-8 px-1 text-left text-xs font-medium text-salin-muted">
                #
              </th>
              {set.columns.map((c) => (
                <th key={c.key} scope="col" className="min-w-28 px-1 text-left text-xs font-semibold text-salin-muted">
                  {c.label}
                  {c.required && <span className="text-destructive"> *</span>}
                </th>
              ))}
              <th scope="col" colSpan={2}>
                <span className="sr-only">Row actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={set.columns.length + 3} className="px-2 py-4 text-center text-xs text-salin-muted">
                  {attentionOnly ? "Every record here looks fine." : "No records — use Add row, then type or tap the words on the page; or Redraw table area."}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const n = set.rows.indexOf(row) + 1;
              return (
                <tr key={row.id}>
                  <td className="px-1 text-xs text-salin-muted">{n}</td>
                  {set.columns.map((c) => {
                    const value = row.cells[c.key];
                    if (!value) return <td key={c.key} />;
                    const ref: ValueRef = { kind: "table", group, id: `${row.id}:${c.key}` };
                    const state = valueState(value, c);
                    const flags = describeFlags(value);
                    const proposal = suggested?.get(refKey(ref));
                    return (
                      <td key={c.key}>
                        <input
                          aria-label={`${c.label}, record ${n}`}
                          aria-invalid={state !== "ready" || undefined}
                          title={[STATE_LABEL[state], ...flags, value.note, proposal && `Suggestion: “${proposal.after}” — see Suggestions`].filter(Boolean).join(" · ")}
                          data-ref={refKey(ref)}
                          value={value.text}
                          onFocus={() => onSelect(ref)}
                          onChange={(e) => onChange(ref, e.target.value)}
                          className={cn(
                            "h-9 w-full min-w-28 rounded-lg border bg-salin-surface px-2 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-2 focus:ring-salin-primary/15",
                            CELL_TONE[state],
                            proposal && "border-dashed border-violet-400",
                            selectedKey === refKey(ref) && "ring-2 ring-sky-400",
                          )}
                        />
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap">
                    <button type="button" aria-label={`Mark record ${n} as checked`} title="Looks right" onClick={() => onConfirmRow(row.id)} className="grid size-8 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-primary">
                      <Check className="size-4" />
                    </button>
                  </td>
                  <td>
                    <button type="button" aria-label={`Remove record ${n}`} onClick={() => onRemoveRow(row.id)} className="grid size-8 place-items-center rounded-lg text-salin-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-400/15">
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const tableButton = "press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile";
