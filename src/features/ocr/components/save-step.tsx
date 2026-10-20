/**
 * Save Step
 * Step 4 of reading a scan: a preview of every dataset that will be created
 * (forms, each record table, and totals; differently laid-out pages are
 * kept apart) — its first rows, column types, how many cells need a look —
 * with editable dataset names and names for unnamed columns (suggested from
 * the values, or by the on-device assistant). Then creating them in the
 * dataset editor. Unchecked optional values are carried over as they are,
 * to fix later; every row keeps its source page and region. Once saved,
 * links straight to the new datasets.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, Bot, Calendar, CircleCheck, Hash, LoaderCircle, Table2, ToggleLeft, Type } from "lucide-react";

import { primaryButton, secondaryButton, StepFooter } from "@/components/common/step-footer";
import { AiError } from "@/core/ai/ai-runtime";
import { extractionToDatasets, type DatasetDraft } from "@/core/ocr/review/to-dataset";
import { stateCounts } from "@/core/ocr/review/review-state";
import { PLACEHOLDER_NAME, suggestColumnName } from "@/core/processing/column-naming";
import { displayValue } from "@/core/processing/dataset-commands";
import { findCellIssues, MAX_COLUMN_NAME_LENGTH } from "@/core/processing/dataset-validator";
import { validateName } from "@/core/storage/names";
import { suggestColumnNames } from "@/features/ai/ai-actions";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { createScanDatasets } from "@/features/ocr/ocr-actions";
import { useAiFeature } from "@/stores/ai-store";
import { toast } from "@/stores/toast-store";
import type { OcrDocument, OcrPage } from "@/types/ocr";
import type { ColumnType } from "@/types/processing";

const TYPE_ICON: Record<ColumnType, typeof Type> = { text: Type, number: Hash, date: Calendar, boolean: ToggleLeft };
const TYPE_LABEL: Record<ColumnType, string> = { text: "Text", number: "Number", date: "Date", boolean: "Yes / no" };
const PREVIEW_ROWS = 5;

type ColumnNames = Record<number, Record<number, string>>;

function DraftPreview({ draft, index, names, suggestions, onRename }: { draft: DatasetDraft; index: number; names: Record<number, string>; suggestions: Record<number, string>; onRename: (column: number, name: string) => void }) {
  const { columns, rows } = draft.content;
  const issues = findCellIssues(columns, rows).length;
  return (
    <div>
      <p className="mt-2 text-sm text-salin-muted">
        {rows.length.toLocaleString()} record{rows.length === 1 ? "" : "s"} · {columns.length} column{columns.length === 1 ? "" : "s"}
        {issues > 0 && (
          <span className="text-amber-800 dark:text-amber-300">
            {" "}
            · {issues} cell{issues === 1 ? " needs" : "s need"} a look (empty required values or values that don't fit their column) — you can fix {issues === 1 ? "it" : "them"} in the dataset
          </span>
        )}
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent-horizontal="">
        <table aria-label={`Preview of dataset ${index + 1}`} className="w-max min-w-full text-left text-sm">
          <thead className="bg-salin-tile align-top text-xs text-salin-muted">
            <tr>
              {columns.map((column, c) => {
                const Icon = TYPE_ICON[column.type];
                const placeholder = PLACEHOLDER_NAME.test(column.name);
                const suggestion = suggestions[c];
                return (
                  <th key={column.id} scope="col" className="min-w-32 px-3 py-2 font-semibold">
                    <span className="flex items-center gap-1.5" title={TYPE_LABEL[column.type]}>
                      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-salin-subtle" />
                      {placeholder ? (
                        <input
                          aria-label={`Name for ${column.name}`}
                          value={names[c] ?? ""}
                          placeholder={column.name}
                          maxLength={MAX_COLUMN_NAME_LENGTH}
                          onChange={(e) => onRename(c, e.target.value)}
                          className="h-8 w-32 rounded-lg border border-salin-border bg-salin-surface px-2 text-xs font-normal text-salin-text outline-none focus:border-salin-primary"
                        />
                      ) : (
                        <span className="text-salin-text">{column.name}</span>
                      )}
                    </span>
                    {placeholder && suggestion && !names[c] && (
                      <button type="button" onClick={() => onRename(c, suggestion)} className="mt-1 text-[11px] font-semibold text-salin-primary hover:underline">
                        Suggested: {suggestion} — use
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-salin-border">
            {rows.slice(0, PREVIEW_ROWS).map((row, r) => (
              <tr key={r}>
                {columns.map((column) => (
                  <td key={column.id} className="max-w-56 truncate px-3 py-2 text-salin-text">
                    {displayValue(row.values[column.id] ?? null) || <span className="text-salin-subtle">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > PREVIEW_ROWS && <p className="border-t border-salin-border px-3 py-2 text-xs text-salin-muted">…and {(rows.length - PREVIEW_ROWS).toLocaleString()} more.</p>}
      </div>
    </div>
  );
}

export function SaveStep({ doc, pages, onBack }: { doc: OcrDocument; pages: OcrPage[]; onBack: () => void }) {
  const navigate = useNavigate();
  const assistant = useAiFeature("assistant");
  const [names, setNames] = useState<Record<number, string>>({});
  const [columnNames, setColumnNames] = useState<ColumnNames>({});
  const [aiNames, setAiNames] = useState<ColumnNames>({});
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);

  const drafts = useMemo(
    () =>
      doc.extraction
        ? extractionToDatasets(
            doc.extraction,
            doc.id,
            doc.name,
            pages.map((p, i) => ({ page: i + 1, fileId: p.fileId, pdfPage: p.pdfPage, width: p.width || 1, height: p.height || 1 })),
          )
        : [],
    [doc, pages],
  );
  // Rule-based names for unnamed columns (the assistant's, when asked for, take precedence).
  const suggestions = useMemo(
    () =>
      drafts.map((draft, d) =>
        Object.fromEntries(
          draft.content.columns.flatMap((column, c) => {
            if (!PLACEHOLDER_NAME.test(column.name)) return [];
            const name = aiNames[d]?.[c] ?? suggestColumnName(draft.content.rows.map((r) => displayValue(r.values[column.id] ?? null)));
            return name ? [[c, name]] : [];
          }),
        ),
      ),
    [drafts, aiNames],
  );
  const unnamed = drafts.some((d) => d.content.columns.some((c) => PLACEHOLDER_NAME.test(c.name)));
  const counts = doc.extraction ? stateCounts(doc.extraction) : null;
  const unchecked = counts ? counts.needs_review + counts.unreadable : 0;
  const nameOf = (i: number) => names[i] ?? drafts[i].name;
  const errors = drafts.map((_, i) => validateName(nameOf(i), []));
  const duplicate = new Set(drafts.map((_, i) => nameOf(i).trim().toLowerCase())).size !== drafts.length;
  const columnClash = drafts.findIndex((draft, d) => {
    const final = draft.content.columns.map((c, i) => (columnNames[d]?.[i]?.trim() || c.name).toLowerCase());
    return new Set(final).size !== final.length;
  });

  async function askForNames() {
    setNaming(true);
    try {
      const next: ColumnNames = {};
      for (const [d, draft] of drafts.entries()) {
        const columns = draft.content.columns.flatMap((column, c) => (PLACEHOLDER_NAME.test(column.name) ? [{ index: c + 1, samples: draft.content.rows.map((r) => displayValue(r.values[column.id] ?? null)).filter(Boolean).slice(0, 5) }] : []));
        const found = await suggestColumnNames(columns, assistant.variant);
        next[d] = Object.fromEntries([...found].map(([index, name]) => [index - 1, name]));
      }
      setAiNames(next);
      toast("Suggested names are shown under each unnamed column. Use the ones that fit.");
    } catch (error) {
      toast(error instanceof AiError ? error.message : "The assistant couldn't suggest names. Type them yourself.");
    } finally {
      setNaming(false);
    }
  }

  async function create() {
    setTried(true);
    if (errors.some(Boolean) || duplicate || columnClash >= 0 || drafts.length === 0) return;
    setBusy(true);
    const ids = await createScanDatasets(
      doc.id,
      Object.fromEntries(drafts.map((_, i) => [i, nameOf(i).trim()])),
      columnNames,
    );
    setBusy(false);
    if (ids.length === 1) navigate(datasetUrl(ids[0]));
    else if (ids.length > 1) {
      toast(`Created ${ids.length} datasets from “${doc.name}”.`);
      navigate("/datasets");
    }
  }

  if (doc.stage === "done" && doc.datasetIds.length) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
          <CircleCheck className="size-7" />
        </span>
        <h3 className="mt-4 text-lg font-semibold text-salin-text">Saved as {doc.datasetIds.length === 1 ? "a dataset" : `${doc.datasetIds.length} datasets`}</h3>
        <p className="mt-1 max-w-md text-sm text-salin-muted">Open it to edit, check against the page, and export. You can come back here to review the scan again and save a new version.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {doc.datasetIds.map((id, i) => (
            <Link key={id} to={datasetUrl(id)} className={primaryButton}>
              <Table2 className="size-4" /> Open dataset{doc.datasetIds.length > 1 ? ` ${i + 1}` : ""}
            </Link>
          ))}
          <button type="button" onClick={onBack} className={secondaryButton}>
            Review again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-salin-text">
        {drafts.length === 0 ? "Nothing to save yet" : `${drafts.length} dataset${drafts.length === 1 ? "" : "s"} will be created`}
      </h3>
      <p className="mt-1 text-sm text-salin-muted">
        {drafts.length === 0
          ? "No values were read or typed. Go back to review and fill in what's on the page."
          : "Check the preview below. The datasets open in the editor, where you can check each row against the page and export to CSV, Excel or JSON."}
      </p>
      {unnamed && assistant.ready && (
        <button type="button" onClick={() => void askForNames()} disabled={naming} className="press mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50">
          {naming ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />} Suggest column names
        </button>
      )}
      <ul className="mt-4 space-y-3">
        {drafts.map((draft, i) => (
          <li key={i} className="rounded-2xl p-4 ring-1 ring-salin-border">
            <label className="grid gap-1 text-xs font-medium text-salin-muted">
              Dataset name
              <input
                value={nameOf(i)}
                onChange={(e) => setNames({ ...names, [i]: e.target.value })}
                aria-invalid={(tried && Boolean(errors[i])) || undefined}
                className="h-10 rounded-xl border border-salin-border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15 aria-invalid:border-destructive"
              />
            </label>
            {tried && errors[i] && <p className="mt-1 text-xs text-destructive">{errors[i]}</p>}
            <DraftPreview draft={draft} index={i} names={columnNames[i] ?? {}} suggestions={suggestions[i] ?? {}} onRename={(c, name) => setColumnNames({ ...columnNames, [i]: { ...columnNames[i], [c]: name } })} />
            {tried && columnClash === i && <p className="mt-1 text-xs text-destructive">Two columns would have the same name. Give each column a different name.</p>}
          </li>
        ))}
      </ul>
      {tried && duplicate && <p className="mt-2 text-sm text-destructive">Give each dataset a different name.</p>}
      {unchecked > 0 && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          {unchecked} optional value{unchecked === 1 ? " wasn't" : "s weren't"} checked. They're saved as read — the dataset will be marked “Needs review”.
        </p>
      )}
      <p className="mt-3 text-xs text-salin-muted">The original photos and PDFs stay unchanged in your workspace.</p>

      <StepFooter>
        <button type="button" onClick={onBack} className={secondaryButton}>
          <ArrowLeft className="size-4" /> Back
        </button>
        <button type="button" onClick={() => void create()} disabled={busy || drafts.length === 0} className={primaryButton}>
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          {drafts.length > 1 ? `Create ${drafts.length} datasets` : "Create dataset"}
        </button>
      </StepFooter>
    </div>
  );
}
