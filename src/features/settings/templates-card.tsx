/**
 * Document Templates Settings
 * Settings → Document templates: the built-in veterinary templates (copy
 * one to adapt it) and the user's saved templates — edit (each save is a
 * new version), or delete. Templates work without any AI model, stay on
 * this device, and are included in backups. Deleting one doesn't change
 * scans or datasets made with it.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, FileCog, Pencil, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { BUILTIN_TEMPLATES } from "@/core/ocr/templates/builtin-templates";
import type { DocumentTemplateDef } from "@/core/ocr/templates/template-schema";
import { deleteTemplate, listSavedTemplates } from "@/core/storage/repositories/ocr.repository";
import { SectionCard } from "@/features/settings/section-card";
import { TemplateEditor } from "@/features/settings/template-editor";
import { toast } from "@/stores/toast-store";

const small = "press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile";

function describe(t: DocumentTemplateDef) {
  const fields = t.fields.length + t.summaries.length;
  const columns = t.tables.reduce((n, x) => n + x.columns.length, 0);
  return [fields && `${fields} field${fields === 1 ? "" : "s"}`, columns && `${columns} table column${columns === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}

export function TemplatesCard() {
  const [saved, setSaved] = useState<DocumentTemplateDef[]>([]);
  const [editing, setEditing] = useState<DocumentTemplateDef | null>(null);
  const [deleting, setDeleting] = useState<DocumentTemplateDef | null>(null);

  const reload = useCallback(() => listSavedTemplates().then(setSaved, () => setSaved([])), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const row = (t: DocumentTemplateDef) => (
    <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-semibold text-salin-text">
          {t.name}{" "}
          <span className="ml-1 rounded-full bg-salin-tile px-2 py-0.5 text-[11px] font-semibold text-salin-muted">{t.builtIn ? "Built-in" : `Version ${t.version}`}</span>
        </p>
        <p className="text-xs text-salin-muted">
          {t.kind === "form" ? "Form" : "Table"} · {describe(t)}
          {t.experimental ? " · experimental" : ""}
        </p>
      </div>
      <div className="flex gap-2">
        {t.builtIn ? (
          <button type="button" onClick={() => setEditing(t)} aria-label={`Copy and edit ${t.name}`} className={small}>
            <Copy className="size-4" /> Copy &amp; edit
          </button>
        ) : (
          <>
            <button type="button" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`} className={small}>
              <Pencil className="size-4" /> Edit
            </button>
            <button type="button" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`} className={`${small} text-destructive hover:bg-destructive/10`}>
              <Trash2 className="size-4" />
            </button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <SectionCard icon={FileCog} title="Document templates" id="templates-heading">
      <p className="text-sm text-salin-muted">
        Templates tell Read text which fields and table columns to look for — including Filipino wordings and standard forms to suggest. They work without AI, stay on this device, and are part of your backups. Save one from a reviewed scan, or copy a built-in one here.
      </p>
      <h3 className="mt-4 text-sm font-semibold text-salin-text">Your templates</h3>
      {saved.length === 0 ? (
        <p className="mt-1 text-sm text-salin-muted">None yet.</p>
      ) : (
        <ul aria-label="Your templates" className="divide-y divide-salin-border">
          {saved.map(row)}
        </ul>
      )}
      <h3 className="mt-4 text-sm font-semibold text-salin-text">Built-in</h3>
      <ul aria-label="Built-in templates" className="divide-y divide-salin-border">
        {BUILTIN_TEMPLATES.map(row)}
      </ul>

      {editing && (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => {
            setEditing(null);
            void reload();
            toast(`Saved “${t.name}” (version ${t.version}).`);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the template “${deleting?.name}”?`}
        description="Scans and datasets made with it stay as they are. Scans read with it again will use “Any document” instead."
        confirmLabel="Delete template"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await deleteTemplate(deleting.id);
          await reload();
          toast("Template deleted.");
        }}
      />
    </SectionCard>
  );
}
