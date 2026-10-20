/**
 * Transform Dialog
 * The manual way to transform a dataset — and the alternative when the
 * on-device assistant isn't available: pick an action (filter, sort,
 * rename, change type, count/total by group, standardize values, set
 * values where…, find duplicates, delete rows where…) and fill in its
 * details with the same dropdowns used across the app. It builds the same
 * command the assistant would, which is then validated and previewed
 * before anything changes.
 */

import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";

import { ChoiceMenu, type Choice } from "@/components/common/choice-menu";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { COMPARISONS, OP_TEXT, OPERATORS, type CommandAction, type Operator } from "@/core/processing/dataset-commands";
import { NORMALIZE_RULES, rulesFor, type NormalizeRule } from "@/core/processing/value-normalizers";
import { cn } from "@/lib/utils";
import type { ColumnType, DatasetColumn } from "@/types/processing";

const ACTIONS: Choice<CommandAction>[] = [
  { value: "filter", label: "Filter rows", hint: "Show only the rows that match" },
  { value: "sort", label: "Sort rows" },
  { value: "summarize", label: "Count or total by group", hint: "e.g. pets per barangay" },
  { value: "find_duplicates", label: "Find duplicates" },
  { value: "normalize", label: "Standardize values", hint: "e.g. M / lalaki → Male" },
  { value: "rename_column", label: "Rename a column" },
  { value: "change_type", label: "Change a column's type" },
  { value: "set_value", label: "Set a value where…", hint: "Changes every matching row" },
  { value: "delete_rows", label: "Delete rows where…" },
];

const TYPES: Choice<ColumnType>[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / no" },
];

interface Condition {
  column: string;
  op: Operator;
  value: string;
}

const input = "h-10 w-full rounded-xl border border-salin-border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15";
const fieldLabel = "grid gap-1 text-xs font-medium text-salin-muted";

function operatorsFor(type: ColumnType | undefined): Choice<Operator>[] {
  return OPERATORS.filter((op) => !COMPARISONS.has(op) || type === "number" || type === "date").map((op) => ({ value: op, label: OP_TEXT[op] }));
}

function Conditions({ columns, conditions, onChange }: { columns: DatasetColumn[]; conditions: Condition[]; onChange: (next: Condition[]) => void }) {
  const columnChoices = columns.map((c) => ({ value: c.id, label: c.name }));
  const update = (i: number, change: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...change } : c)));
  return (
    <div className="space-y-2">
      {conditions.map((cond, i) => {
        const type = columns.find((c) => c.id === cond.column)?.type;
        const needsValue = cond.op !== "is_empty" && cond.op !== "not_empty";
        return (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl bg-salin-tile/60 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <ChoiceMenu variant="field" label={`Condition ${i + 1} column`} heading="Column" value={cond.column} options={columnChoices} onChange={(column) => update(i, { column, op: COMPARISONS.has(cond.op) && !["number", "date"].includes(columns.find((c) => c.id === column)?.type ?? "") ? "equals" : cond.op })} />
            <button type="button" aria-label={`Remove condition ${i + 1}`} onClick={() => onChange(conditions.filter((_, j) => j !== i))} disabled={conditions.length === 1} className="grid size-10 place-items-center rounded-xl text-salin-muted hover:bg-salin-surface disabled:opacity-40 sm:order-last">
              <X className="size-4" />
            </button>
            <ChoiceMenu variant="field" label={`Condition ${i + 1} test`} heading="Test" value={cond.op} options={operatorsFor(type)} onChange={(op) => update(i, { op })} className="col-span-2 sm:col-span-1" />
            {needsValue ? (
              type === "boolean" ? (
                <ChoiceMenu variant="field" label={`Condition ${i + 1} value`} value={cond.value || "true"} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} onChange={(value) => update(i, { value })} className="col-span-2 sm:col-span-1" />
              ) : (
                <input aria-label={`Condition ${i + 1} value`} value={cond.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={type === "date" ? "YYYY-MM-DD" : type === "number" ? "0" : "Value"} inputMode={type === "number" ? "decimal" : undefined} className={cn(input, "col-span-2 sm:col-span-1")} />
              )
            ) : (
              <span className="hidden sm:block" />
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => onChange([...conditions, { column: columns[0]?.id ?? "", op: "equals", value: "" }])} className="press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
        <Plus className="size-4" /> Add condition
      </button>
    </div>
  );
}

interface TransformDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: DatasetColumn[];
  /** Receives the command; the caller validates and previews it. */
  onPreview: (command: unknown) => void;
}

export function TransformDialog({ open, onOpenChange, columns, onPreview }: TransformDialogProps) {
  const first = columns[0]?.id ?? "";
  const [action, setAction] = useState<CommandAction>("filter");
  const [column, setColumn] = useState(first);
  const [conditions, setConditions] = useState<Condition[]>([{ column: first, op: "equals", value: "" }]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [text, setText] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [aggregate, setAggregate] = useState<"count" | "sum" | "average" | "min" | "max">("count");
  const [groupBy, setGroupBy] = useState("none");
  const [rule, setRule] = useState<NormalizeRule>("trim");
  const [picked, setPicked] = useState<string[]>([]);

  const columnChoices = columns.map((c) => ({ value: c.id, label: c.name }));
  const current = columns.find((c) => c.id === column) ?? columns[0];
  const ruleChoices = rulesFor(current?.type ?? "text").map((r) => ({ value: r, label: NORMALIZE_RULES[r].label, hint: NORMALIZE_RULES[r].example }));
  const where = () => conditions.map((c) => ({ column: c.column, op: c.op, value: c.op === "is_empty" || c.op === "not_empty" ? null : columns.find((x) => x.id === c.column)?.type === "boolean" ? (c.value || "true") === "true" : c.value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const commands: Record<CommandAction, () => unknown> = {
      filter: () => ({ action, where: where(), match }),
      sort: () => ({ action, by: [{ column, direction }] }),
      rename_column: () => ({ action, column, to: text }),
      change_type: () => ({ action, column, to: type }),
      summarize: () => ({ action, group_by: groupBy === "none" ? [] : [groupBy], aggregate, ...(aggregate === "count" ? {} : { column }) }),
      normalize: () => ({ action, column, rule: ruleChoices.some((r) => r.value === rule) ? rule : ruleChoices[0]?.value }),
      set_value: () => ({ action, column, value: current?.type === "boolean" ? (text || "true") === "true" : text, where: where() }),
      find_duplicates: () => ({ action, columns: picked }),
      delete_rows: () => ({ action, where: where() }),
    };
    onPreview(commands[action]());
  }

  const columnPicker = (labelText: string) => (
    <label className={fieldLabel}>
      {labelText}
      <ChoiceMenu variant="field" label={labelText} heading="Column" value={column} options={columnChoices} onChange={setColumn} />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto" data-lenis-prevent="">
          <DialogTitle>Transform data</DialogTitle>
          <DialogDescription>Pick what to do. You'll see a preview before anything changes, and you can undo it.</DialogDescription>
          <form onSubmit={submit} className="mt-4 space-y-4">
            <label className={fieldLabel}>
              Action
              <ChoiceMenu variant="field" label="Action" heading="Action" value={action} options={ACTIONS} onChange={setAction} />
            </label>

            {(action === "filter" || action === "set_value" || action === "delete_rows") && (
              <fieldset className="space-y-2">
                {action === "set_value" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {columnPicker("Column to set")}
                    <label className={fieldLabel}>
                      New value
                      {current?.type === "boolean" ? (
                        <ChoiceMenu variant="field" label="New value" value={text || "true"} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} onChange={setText} />
                      ) : (
                        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave empty to clear" className={input} />
                      )}
                    </label>
                  </div>
                )}
                <legend className="mb-2 text-xs font-medium text-salin-muted">{action === "filter" ? "Rows where" : action === "set_value" ? "…in rows where" : "Delete rows where"}</legend>
                <Conditions columns={columns} conditions={conditions} onChange={setConditions} />
                {action === "filter" && conditions.length > 1 && (
                  <label className={cn(fieldLabel, "max-w-xs")}>
                    Match
                    <ChoiceMenu variant="field" label="Match" value={match} options={[{ value: "all", label: "All conditions" }, { value: "any", label: "Any condition" }]} onChange={setMatch} />
                  </label>
                )}
              </fieldset>
            )}

            {action === "sort" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {columnPicker("Sort by")}
                <label className={fieldLabel}>
                  Order
                  <ChoiceMenu variant="field" label="Order" value={direction} options={[{ value: "asc", label: "A → Z, smallest, oldest first" }, { value: "desc", label: "Z → A, largest, newest first" }]} onChange={setDirection} />
                </label>
              </div>
            )}

            {action === "rename_column" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {columnPicker("Column")}
                <label className={fieldLabel}>
                  New name
                  <input value={text} onChange={(e) => setText(e.target.value)} required maxLength={120} className={input} />
                </label>
              </div>
            )}

            {action === "change_type" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {columnPicker("Column")}
                <label className={fieldLabel}>
                  New type
                  <ChoiceMenu variant="field" label="New type" value={type} options={TYPES} onChange={setType} />
                </label>
              </div>
            )}

            {action === "summarize" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={fieldLabel}>
                  Group by
                  <ChoiceMenu variant="field" label="Group by" value={groupBy} options={[{ value: "none", label: "No grouping (overview)" }, ...columnChoices]} onChange={setGroupBy} />
                </label>
                <label className={fieldLabel}>
                  Show
                  <ChoiceMenu
                    variant="field"
                    label="Show"
                    value={aggregate}
                    options={[
                      { value: "count", label: "Count of rows" },
                      { value: "sum", label: "Total of a column" },
                      { value: "average", label: "Average of a column" },
                      { value: "min", label: "Lowest value" },
                      { value: "max", label: "Highest value" },
                    ]}
                    onChange={setAggregate}
                  />
                </label>
                {aggregate !== "count" && columnPicker("Of column")}
              </div>
            )}

            {action === "normalize" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {columnPicker("Column")}
                <label className={fieldLabel}>
                  Rule
                  {ruleChoices.length ? (
                    <ChoiceMenu variant="field" label="Rule" heading="Rule" value={ruleChoices.some((r) => r.value === rule) ? rule : ruleChoices[0].value} options={ruleChoices} onChange={setRule} />
                  ) : (
                    <span className="py-2 text-sm text-salin-muted">Number columns have nothing to standardize.</span>
                  )}
                </label>
              </div>
            )}

            {action === "find_duplicates" && (
              <fieldset>
                <legend className="text-xs font-medium text-salin-muted">Rows count as duplicates when these match (none ticked = every column)</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {columns.map((c) => (
                    <label key={c.id} className={cn("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm ring-1", picked.includes(c.id) ? "bg-salin-primary-soft ring-salin-primary" : "ring-salin-border")}>
                      <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} className="size-4 accent-salin-primary" />
                      {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
              <button type="submit" className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong">
                Preview
              </button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
