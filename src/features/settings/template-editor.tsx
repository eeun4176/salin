/**
 * Template Editor
 * Edits a saved document template (or a copy of a built-in one): name and
 * description, its fields — label, other wordings (English or Filipino),
 * type, required, choices and a standard form to suggest ("M" → "Male") —
 * and, for table templates, each table's columns. Keys of existing fields
 * are kept so scans mapped with an earlier version still line up; every
 * save is a new version, validated before it's stored.
 */

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import { ChoiceMenu, type Choice } from "@/components/common/choice-menu";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { keyFromLabel, type DocumentTemplateDef, type TemplateField } from "@/core/ocr/templates/template-schema";
import { NORMALIZE_RULES, type NormalizeRule } from "@/core/processing/value-normalizers";
import { errorMessage } from "@/core/storage/errors";
import { saveTemplate } from "@/core/storage/repositories/ocr.repository";
import type { FieldType } from "@/types/ocr";

interface EditableField {
  key: string;
  label: string;
  aliases: string;
  type: FieldType;
  required: boolean;
  options: string;
  normalize: NormalizeRule | "none";
}

const TYPES: Choice<FieldType>[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / no" },
  { value: "choice", label: "Choice (checkboxes)" },
];
const RULES: Choice<NormalizeRule | "none">[] = [{ value: "none", label: "None" }, ...(Object.keys(NORMALIZE_RULES) as NormalizeRule[]).map((r) => ({ value: r, label: NORMALIZE_RULES[r].label, hint: NORMALIZE_RULES[r].example }))];

const list = (text: string) => [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];

function toEditable(field: Omit<TemplateField, "region"> & { region?: unknown }): EditableField {
  return { key: field.key, label: field.label, aliases: field.aliases.join(", "), type: field.type, required: field.required, options: (field.options ?? []).join(", "), normalize: field.normalize ?? "none" };
}

function fromEditable(field: EditableField, taken: Set<string>) {
  let key = field.key || keyFromLabel(field.label);
  while (!field.key && taken.has(key)) key = `${key}_2`;
  taken.add(key);
  return {
    key,
    label: field.label.trim(),
    aliases: list(field.aliases).slice(0, 30),
    type: field.type,
    required: field.required,
    ...(field.type === "choice" ? { options: list(field.options).slice(0, 20) } : {}),
    ...(field.normalize !== "none" ? { normalize: field.normalize } : {}),
  };
}

const input = "h-10 w-full rounded-xl border border-salin-border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15";
const small = "grid gap-1 text-xs font-medium text-salin-muted";

function FieldList({ title, fields, onChange }: { title: string; fields: EditableField[]; onChange: (fields: EditableField[]) => void }) {
  const update = (i: number, change: Partial<EditableField>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...change } : f)));
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold text-salin-text">{title}</legend>
      {fields.map((f, i) => (
        <div key={i} role="group" aria-label={`${title}: ${f.label || `field ${i + 1}`}`} className="grid gap-2 rounded-xl bg-salin-tile/60 p-3 sm:grid-cols-2">
          <label className={small}>
            Label
            <input value={f.label} onChange={(e) => update(i, { label: e.target.value })} required maxLength={120} className={input} />
          </label>
          <label className={small}>
            Other wordings (comma-separated, e.g. Filipino)
            <input value={f.aliases} onChange={(e) => update(i, { aliases: e.target.value })} placeholder="Pangalan ng May-ari, Owner" className={input} />
          </label>
          <label className={small}>
            Type
            <ChoiceMenu variant="field" label={`${f.label || "Field"} type`} value={f.type} options={TYPES} onChange={(type) => update(i, { type })} />
          </label>
          <label className={small}>
            Suggest a standard form
            <ChoiceMenu variant="field" label={`${f.label || "Field"} standard form`} value={f.normalize} options={RULES} onChange={(normalize) => update(i, { normalize })} />
          </label>
          {f.type === "choice" && (
            <label className={`${small} sm:col-span-2`}>
              Choices (comma-separated)
              <input value={f.options} onChange={(e) => update(i, { options: e.target.value })} placeholder="Dog, Cat, Other" required className={input} />
            </label>
          )}
          <div className="flex items-center justify-between gap-2 sm:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-salin-text">
              <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} className="size-4 accent-salin-primary" /> Required
            </label>
            <button type="button" onClick={() => onChange(fields.filter((_, j) => j !== i))} disabled={fields.length === 1} aria-label={`Remove ${f.label || "field"}`} className="grid size-9 place-items-center rounded-lg text-salin-muted hover:bg-red-50 hover:text-red-700 disabled:opacity-40 dark:hover:bg-red-400/15">
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...fields, { key: "", label: "", aliases: "", type: "text", required: false, options: "", normalize: "none" }])} className="press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
        <Plus className="size-4" /> Add {title === "Fields" ? "field" : "column"}
      </button>
    </fieldset>
  );
}

interface TemplateEditorProps {
  /** The template to edit; a built-in one is saved as a new copy. */
  template: DocumentTemplateDef;
  onClose: () => void;
  onSaved: (template: DocumentTemplateDef) => void;
}

export function TemplateEditor({ template, onClose, onSaved }: TemplateEditorProps) {
  const copy = template.builtIn;
  const [name, setName] = useState(copy ? `${template.name} (my copy)` : template.name);
  const [description, setDescription] = useState(template.description);
  const [fields, setFields] = useState(() => template.fields.map(toEditable));
  const [tables, setTables] = useState(() => template.tables.map((t) => t.columns.map(toEditable)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const taken = new Set(fields.map((f) => f.key).filter(Boolean));
      const saved = await saveTemplate({
        ...template,
        id: copy ? `custom-${crypto.randomUUID()}` : template.id,
        name: name.trim(),
        description: description.trim(),
        version: copy ? 1 : template.version + 1,
        builtIn: false,
        experimental: false,
        basedOn: copy ? template.id : template.basedOn,
        // Saved regions stay with fields that keep their key.
        fields: fields.map((f) => {
          const region = template.fields.find((x) => x.key === f.key)?.region;
          return { ...fromEditable(f, taken), ...(region ? { region } : {}) };
        }),
        tables: template.tables.map((t, i) => {
          const keys = new Set(tables[i].map((c) => c.key).filter(Boolean));
          return { ...t, columns: tables[i].map((c) => fromEditable(c, keys)) };
        }),
      });
      onSaved(saved);
    } catch (e) {
      setError(errorMessage(e, e instanceof Error ? e.message : "The template couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto" data-lenis-prevent="">
        <DialogTitle>{copy ? `Copy “${template.name}”` : `Edit “${template.name}”`}</DialogTitle>
        <DialogDescription>
          {copy ? "Built-in templates stay as they are; your copy can be changed." : `Saving makes version ${template.version + 1}. Scans already reviewed keep their results until you pick the template again.`}
        </DialogDescription>
        <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
          <label className={small}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} className={input} />
          </label>
          <label className={small}>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} rows={2} className="w-full rounded-xl border border-salin-border bg-salin-surface px-3 py-2 text-sm text-salin-text outline-none focus:border-salin-primary" />
          </label>
          {fields.length > 0 && <FieldList title="Fields" fields={fields} onChange={setFields} />}
          {template.tables.map((t, i) => (
            <FieldList key={t.key} title={`Columns of “${t.label}”`} fields={tables[i]} onChange={(next) => setTables(tables.map((c, j) => (j === i ? next : c)))} />
          ))}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
            <button type="submit" disabled={busy} className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50">
              {busy ? "Saving…" : copy ? "Save copy" : "Save"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
