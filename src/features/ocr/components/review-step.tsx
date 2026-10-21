/**
 * Review Step
 * Step 2 of reading a scan ("Check & save"): first, "What do you need?" —
 * name the columns (or tap labels found on the page, or a set used before)
 * and only those are kept, found by label, then by the on-device assistant
 * when it's set up. Then the page beside the extracted values. Selecting
 * a value highlights where it came from on the page; every value shows its
 * review state (Ready, Needs review, Unreadable, Missing), OCR confidence
 * and mapping confidence separately, and why it needs a look. Values can be
 * typed, checked, or re-assigned by tapping text on the page (a list fills
 * cell after cell); table records can be added, removed, or rebuilt by
 * drawing the table's area. Required values must be resolved before
 * saving, which creates the datasets and opens them. Suggestions (rules, the
 * handwriting reader, the on-device assistant) are listed with Use / Edit /
 * Dismiss and shown beside their values; the optional AI tools add more.
 * Corrections are saved as you go, and what OCR originally read is kept for
 * traceability.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, BookmarkPlus, Crop, Info, LoaderCircle, Save, TriangleAlert } from "lucide-react";

import { ColumnsBar, type ColumnSet } from "@/components/common/columns-bar";
import { primaryButton, secondaryButton, StepFooter } from "@/components/common/step-footer";
import { NameDialog } from "@/components/common/name-dialog";
import { phrases, tableFromRegion } from "@/core/ocr/layout/layout-analysis";
import { extractionToDatasets } from "@/core/ocr/review/to-dataset";
import { addRow, confirmValue, editValue, reassignValue, refKey, removeRow, reviewItems, splitCellId, stateCounts, unresolvedCritical, valueState, type ValueRef } from "@/core/ocr/review/review-state";
import { builtinTemplate } from "@/core/ocr/templates/builtin-templates";
import { recordsFromTable } from "@/core/ocr/templates/field-mapping";
import { REQUESTED_PREFIX, type RecordShape } from "@/core/ocr/templates/requested-columns";
import { errorMessage } from "@/core/storage/errors";
import { updateOcrDocument } from "@/core/storage/repositories/ocr.repository";
import { PageViewer, type Overlay, type OverlayTone, type PickableWord } from "@/features/ocr/components/page-viewer";
import { FieldRow, RecordTable, StateChip } from "@/features/ocr/components/review-parts";
import { findFields } from "@/features/ai/ai-actions";
import { AiTools, SuggestionCard, SuggestionsPanel } from "@/features/ai/components/review-assist";
import { useAiRun } from "@/features/ai/use-ai-run";
import { TemplateHint } from "@/features/ocr/components/template-hint";
import { acceptSuggestion, pendingSuggestions, refLabel, rejectSuggestion } from "@/core/ai/suggestions";
import { useObjectUrls } from "@/features/ocr/hooks/use-scan";
import { createScanDatasets, extractColumns, pageHints, recentColumnSets, saveTemplateFromScan, templateById } from "@/features/ocr/ocr-actions";
import { ensureProcessed } from "@/features/ocr/ocr-runner";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { useAiFeature } from "@/stores/ai-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";
import type { Box, Extraction, OcrDocument, OcrPage, ReviewState } from "@/types/ocr";

const TONE: Record<ReviewState, OverlayTone> = { ready: "ready", needs_review: "review", unreadable: "problem", missing: "problem" };
const SAVE_DELAY_MS = 400;

interface ReviewStepProps {
  doc: OcrDocument;
  pages: OcrPage[];
  onBack: () => void;
  onFixPages: () => void;
}

/** The columns of an extraction made from requested columns (to show them in the bar again). */
function askedColumns(extraction: Extraction): string[] {
  if (!extraction.templateId.startsWith(REQUESTED_PREFIX)) return [];
  return (extraction.forms[0]?.fields ?? extraction.tables[0]?.columns ?? []).map((c) => c.label);
}

export function ReviewStep({ doc, pages, onBack, onFixPages }: ReviewStepProps) {
  const [extraction, setExtraction] = useState<Extraction>(() => doc.extraction!);
  const [selected, setSelected] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [picking, setPicking] = useState<ValueRef | null>(null);
  const [drawing, setDrawing] = useState<number | null>(null);
  const [filling, setFilling] = useState<number | null>(null);
  const [cell, setCell] = useState<ValueRef | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const [naming, setNaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  // Save corrections shortly after each change (and right away when leaving).
  const pending = useRef<Extraction | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next) await updateOcrDocument(doc.id, { extraction: next }).catch((e: unknown) => toast(errorMessage(e, "Your corrections couldn't be saved.")));
  }, [doc.id]);
  useEffect(() => () => void flush(), [flush]);
  const change = (update: (current: Extraction) => Extraction) => {
    setExtraction((current) => {
      const next = update(current);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
      return next;
    });
  };

  // Pages restored from a backup have no prepared image yet: rebuild it (no re-reading).
  useEffect(() => {
    for (const page of pages) if (!page.processed && page.result) void ensureProcessed(page).catch(() => undefined);
  }, [pages]);

  const urls = useObjectUrls(pages.map((p) => ({ key: `${p.id}:${p.processedKey}`, blob: p.processed })));
  const page = pages[pageIndex];
  const items = useMemo(() => reviewItems(extraction), [extraction]);
  const counts = useMemo(() => stateCounts(extraction), [extraction]);
  const critical = useMemo(() => unresolvedCritical(extraction), [extraction]);
  const suggestions = useMemo(() => new Map(pendingSuggestions(extraction).map((s) => [refKey(s.ref), s])), [extraction]);
  const [templateChanged, setTemplateChanged] = useState(false);
  useEffect(() => {
    let active = true;
    void templateById(extraction.templateId).then((t) => active && setTemplateChanged(Boolean(t && extraction.templateVersion && t.version !== extraction.templateVersion)));
    return () => {
      active = false;
    };
  }, [extraction.templateId, extraction.templateVersion]);
  const inlineSuggestion = (key: string) => {
    const s = suggestions.get(key);
    return s ? (
      <SuggestionCard compact suggestion={s} label={refLabel(extraction, s.ref)} box={null} pageImage={null} onAccept={(edited) => change((x) => acceptSuggestion(x, s.id, edited))} onReject={() => change((x) => rejectSuggestion(x, s.id))} />
    ) : null;
  };

  const overlays: Overlay[] = items
    .filter((i) => i.value.box && i.value.page === pageIndex + 1)
    .map((i) => ({ id: refKey(i.ref), box: i.value.box as Box, tone: TONE[i.state] }));
  const words: PickableWord[] = useMemo(() => (page?.result ? phrases(page.result.lines) : []), [page]);

  const select = (ref: ValueRef) => {
    const key = refKey(ref);
    setSelected(key);
    if (ref.kind === "table") setCell(ref);
    const item = items.find((i) => refKey(i.ref) === key);
    if (item?.value.page) setPageIndex(item.value.page - 1);
  };

  /** The cell after this one in its table (next column, then the next record's first column). */
  const nextCell = (ref: ValueRef): ValueRef | null => {
    const set = extraction.tables[ref.group];
    const [rowId, key] = splitCellId(ref.id);
    const r = set.rows.findIndex((row) => row.id === rowId);
    const c = set.columns.findIndex((col) => col.key === key);
    const [row, col] = c + 1 < set.columns.length ? [set.rows[r], set.columns[c + 1]] : [set.rows[r + 1], set.columns[0]];
    return row && col ? { kind: "table", group: ref.group, id: `${row.id}:${col.key}` } : null;
  };
  const fillTarget = filling !== null && cell?.group === filling ? cell : null;

  const onPick = (word: PickableWord) => {
    const target = picking ?? fillTarget;
    if (!target) return;
    change((x) => reassignValue(x, target, { text: word.text, confidence: word.confidence, page: pageIndex + 1, box: word.box }));
    if (picking) {
      setSelected(refKey(picking));
      setPicking(null);
      return;
    }
    const next = nextCell(target);
    setCell(next);
    setSelected(next && refKey(next));
    if (!next) toast("That was the last cell. Add a row to fill in more.");
  };

  // "What do you need?": only the columns asked for; the assistant then looks for values that have no printed label.
  const assistant = useAiFeature("assistant");
  const ai = useAiRun(change);
  const hints = useMemo(() => pageHints(pages), [pages]);
  const [shape, setShape] = useState<RecordShape>(() => (askedColumns(extraction).length ? (extraction.forms.length ? "form" : "table") : hints.shape));
  const [recent, setRecent] = useState<ColumnSet[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [needsAssistant, setNeedsAssistant] = useState(false);
  useEffect(() => {
    let active = true;
    void recentColumnSets().then((sets) => active && setRecent(sets));
    return () => {
      active = false;
    };
  }, [extraction.templateId]);

  async function extract(labels: string[], as: RecordShape = shape) {
    setExtracting(true);
    await flush();
    const next = await extractColumns(doc, pages, labels, as);
    setExtracting(false);
    if (!next) return;
    // Same id: the review stays open with the new columns (and saves them).
    change((current) => ({ ...next, id: current.id }));
    setPicking(null);
    setFilling(null);
    setCell(null);
    setSelected(null);
    const empty = as === "form" && pages.some((p) => p.result) && next.forms.some((f) => f.fields.some((x) => !x.value.text.trim()));
    setNeedsAssistant(empty && !assistant.ready);
    if (empty && assistant.ready) void ai.run("Looking for the other values", (o) => findFields(next, pages, null, assistant.variant, o));
  }

  const drafts = useMemo(
    () => extractionToDatasets(extraction, doc.id, doc.name, pages.map((p, i) => ({ page: i + 1, fileId: p.fileId, pdfPage: p.pdfPage, width: p.width || 1, height: p.height || 1 }))).length,
    [extraction, doc.id, doc.name, pages],
  );

  const onDraw = async (box: Box) => {
    if (drawing === null || !page?.result) return;
    const group = drawing;
    setDrawing(null);
    const table = tableFromRegion(page.result.lines, box, page.width);
    if (!table) {
      toast("No text was found in that area. Drag around the whole table, headings included.");
      return;
    }
    const template = await templateById(extraction.templateId);
    const set = extraction.tables[group];
    const spec = template?.tables.find((t) => t.key === set.key) ?? null;
    const rows = recordsFromTable(set, spec, table, pageIndex + 1);
    change((x) => ({ ...x, tables: x.tables.map((s, g) => (g !== group ? s : { ...s, rows: [...s.rows.filter((r) => r.page !== pageIndex + 1), ...rows] })) }));
    toast(`Rebuilt ${rows.length} record${rows.length === 1 ? "" : "s"} from the area you drew on page ${pageIndex + 1}.`);
  };

  async function saveAsTemplate(name: string) {
    await flush();
    const saved = await saveTemplateFromScan({ ...doc, extraction }, pages, name);
    if (saved) {
      toast(`Saved the template “${saved.name}”. Pick it next time you scan this kind of form.`);
      setNaming(false);
    }
  }

  async function save() {
    if (critical.length) {
      setShowProblems(true);
      setAttentionOnly(true);
      select(critical[0].ref);
      document.querySelector(`[data-ref="${refKey(critical[0].ref)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setSaving(true);
    await flush();
    const ids = await createScanDatasets(doc.id);
    setSaving(false);
    if (ids.length === 1) navigate(datasetUrl(ids[0]));
    else if (ids.length > 1) {
      toast(`Created ${ids.length} datasets from “${doc.name}”.`);
      navigate("/datasets");
    }
  }
  const back = () => void flush().then(onBack);

  const pageImage = (n: number | null) => (n && pages[n - 1] ? { src: urls[n - 1], width: pages[n - 1].width, height: pages[n - 1].height } : null);
  const template = builtinTemplate(extraction.templateId);
  const visible = (state: ReviewState) => !attentionOnly || state !== "ready";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" aria-label="Summary">
          <StateChip state="ready" className="text-xs" />
          <span className="text-sm text-salin-muted">{counts.ready}</span>
          <StateChip state="needs_review" className="ml-2 text-xs" />
          <span className="text-sm text-salin-muted">{counts.needs_review}</span>
          <StateChip state="unreadable" className="ml-2 text-xs" />
          <span className="text-sm text-salin-muted">{counts.unreadable}</span>
          <StateChip state="missing" className="ml-2 text-xs" />
          <span className="text-sm text-salin-muted">{counts.missing}</span>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-salin-text">
          <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} className="size-4 accent-salin-primary" />
          Only show what needs a look
        </label>
      </div>

      <div className="mt-4 empty:hidden">
        <TemplateHint doc={doc} pages={pages} />
      </div>
      {extraction.unsupported && (
        <p role="alert" className="mt-4 flex gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-semibold">Not a supported layout.</span> {extraction.unsupported}
          </span>
        </p>
      )}
      {templateChanged && (
        <p className="mt-3 flex gap-2 text-sm text-salin-muted">
          <Info className="mt-0.5 size-4 shrink-0" /> This template was updated after these pages were matched. Go back to Read text and pick it again to use the new version — this review stays as it is until then.
        </p>
      )}
      {template?.experimental && (
        <p className="mt-3 flex gap-2 text-sm text-salin-muted">
          <Info className="mt-0.5 size-4 shrink-0" /> {template.name} support is experimental — check every value.
        </p>
      )}
      {extraction.warnings.length > 0 && (
        <details className="mt-3 text-sm text-salin-muted">
          <summary className="cursor-pointer font-medium text-salin-text">
            {extraction.warnings.length} note{extraction.warnings.length === 1 ? "" : "s"} from reading
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {extraction.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4 lg:self-start">
          {pages.length > 1 && (
            <div role="tablist" aria-label="Pages" className="no-scrollbar mb-2 flex gap-1 overflow-x-auto" data-lenis-prevent-horizontal="">
              {pages.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === pageIndex}
                  onClick={() => setPageIndex(i)}
                  className={cn("h-8 shrink-0 rounded-lg px-3 text-sm font-medium", i === pageIndex ? "bg-salin-primary text-white" : "bg-salin-tile text-salin-muted hover:text-salin-text")}
                >
                  Page {i + 1}
                </button>
              ))}
            </div>
          )}
          {page && (
            <PageViewer
              src={urls[pageIndex]}
              width={page.width || 1000}
              height={page.height || 1400}
              label={`Page ${pageIndex + 1} of ${pages.length}`}
              overlays={overlays}
              selectedId={selected}
              mode={picking || fillTarget ? "pick" : drawing !== null ? "draw" : "view"}
              words={words}
              onPick={onPick}
              onDraw={(box) => void onDraw(box)}
              onSelect={(id) => {
                setSelected(id);
                document.querySelector(`[data-ref="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
              className="h-[min(48vh,30rem)] lg:h-[calc(100vh-8rem)]"
            />
          )}
          {(picking || drawing !== null || filling !== null) && (
            <p className="mt-2 text-sm text-salin-muted" aria-live="polite">
              {picking ? "Tap the words on the page that belong to this field." : drawing !== null ? "Drag a box around the whole table, including its headings." : fillTarget ? `Tap the words for ${refLabel(extraction, fillTarget)}.` : "Pick a cell in the table, then tap its words on the page."}{" "}
              <button type="button" onClick={() => (setPicking(null), setDrawing(null), setFilling(null))} className="font-semibold text-salin-primary hover:underline">
                {filling !== null ? "Done" : "Cancel"}
              </button>
            </p>
          )}
          <button type="button" onClick={() => void flush().then(onFixPages)} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-salin-primary hover:underline">
            <Crop className="size-4" /> Fix pages (crop, rotate)
          </button>
        </div>

        <div className="min-w-0 space-y-5">
          <ColumnsBar
            key={extraction.templateId}
            title={`What do you need from ${pages.length === 1 ? "this page" : "these pages"}?`}
            description="Name the columns you want — only those are kept. Or leave this and keep everything that was found."
            initial={askedColumns(extraction)}
            found={hints.labels}
            recent={recent}
            shape={shape}
            onShape={setShape}
            busy={extracting || ai.busy}
            onSubmit={(labels, as) => void extract(labels, as)}
          >
            {ai.status}
            {needsAssistant && !ai.busy && (
              <p className="text-xs text-salin-muted">
                Values without a printed label stay empty — type them or tap them on the page. The on-device assistant can look for them:{" "}
                <Link to="/settings#ai-heading" className="font-semibold text-salin-primary hover:underline">
                  set it up in Settings
                </Link>
                .
              </p>
            )}
          </ColumnsBar>
          <AiTools extraction={extraction} pages={pages} generic={extraction.templateId === "generic"} onResult={change} />
          <SuggestionsPanel extraction={extraction} pageImage={pageImage} onChange={change} onSelect={(key) => setSelected(key)} />
          {extraction.forms.map((form, g) => {
            const fields = form.fields.filter((f) => visible(valueState(f.value, f)));
            return (
              <section key={g} aria-label={`Page ${form.page} fields`}>
                <h3 className="mb-2 text-sm font-semibold text-salin-text">
                  {extraction.forms.length > 1 ? `Form on page ${form.page}` : "Fields"}
                </h3>
                <div className="space-y-2">
                  {fields.length === 0 && <p className="text-sm text-salin-muted">Every field on this page looks fine.</p>}
                  {fields.map((field) => {
                    const ref: ValueRef = { kind: "form", group: g, id: field.key };
                    return (
                      <FieldRow
                        key={field.key}
                        refId={refKey(ref)}
                        spec={field}
                        value={field.value}
                        selected={selected === refKey(ref)}
                        picking={picking !== null && refKey(picking) === refKey(ref)}
                        pageImage={pageImage(field.value.page)}
                        suggestion={inlineSuggestion(refKey(ref))}
                        onSelect={() => select(ref)}
                        onChange={(text) => change((x) => editValue(x, ref, text))}
                        onConfirm={(confirmed) => change((x) => confirmValue(x, ref, confirmed))}
                        onPick={() => {
                          setDrawing(null);
                          setPicking(picking && refKey(picking) === refKey(ref) ? null : ref);
                          setPageIndex(form.page - 1);
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}

          {extraction.tables.map((set, g) => (
            <RecordTable
              key={set.key}
              set={set}
              group={g}
              selectedKey={selected}
              suggested={suggestions}
              attentionOnly={attentionOnly}
              drawing={drawing === g}
              filling={filling === g}
              onFill={() => {
                setPicking(null);
                setDrawing(null);
                setFilling(filling === g ? null : g);
                if (filling !== g && cell?.group !== g && set.rows[0]) {
                  const first: ValueRef = { kind: "table", group: g, id: `${set.rows[0].id}:${set.columns[0].key}` };
                  setCell(first);
                  setSelected(refKey(first));
                }
              }}
              onSelect={select}
              onChange={(ref, text) => change((x) => editValue(x, ref, text))}
              onConfirmRow={(rowId) => change((x) => set.columns.reduce((acc, c) => confirmValue(acc, { kind: "table", group: g, id: `${rowId}:${c.key}` }), x))}
              onRemoveRow={(rowId) => change((x) => removeRow(x, g, rowId))}
              onAddRow={() => change((x) => addRow(x, g, pageIndex + 1))}
              onRedraw={() => {
                setPicking(null);
                setFilling(null);
                setDrawing(drawing === g ? null : g);
              }}
            />
          ))}

          {extraction.summaries.length > 0 && (
            <section aria-label="Totals and details">
              <h3 className="mb-2 text-sm font-semibold text-salin-text">Details and totals</h3>
              <div className="space-y-2">
                {extraction.summaries
                  .filter((f) => visible(valueState(f.value, f)))
                  .map((field) => {
                    const ref: ValueRef = { kind: "summary", group: 0, id: field.key };
                    return (
                      <FieldRow
                        key={field.key}
                        refId={refKey(ref)}
                        spec={field}
                        value={field.value}
                        selected={selected === refKey(ref)}
                        picking={picking !== null && refKey(picking) === refKey(ref)}
                        pageImage={pageImage(field.value.page)}
                        suggestion={inlineSuggestion(refKey(ref))}
                        onSelect={() => select(ref)}
                        onChange={(text) => change((x) => editValue(x, ref, text))}
                        onConfirm={(confirmed) => change((x) => confirmValue(x, ref, confirmed))}
                        onPick={() => setPicking(picking && refKey(picking) === refKey(ref) ? null : ref)}
                      />
                    );
                  })}
              </div>
            </section>
          )}

          {(extraction.forms.length > 0 || extraction.templateId === "generic") && (
            <button type="button" onClick={() => setNaming(true)} className="press inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile">
              <BookmarkPlus className="size-4" /> Save as a template
            </button>
          )}
        </div>
      </div>

      <StepFooter
        message={
          critical.length > 0 ? (
            <span className={showProblems ? "font-medium text-destructive" : "text-salin-muted"}>
              {critical.length} required value{critical.length === 1 ? " needs" : "s need"} attention — fill {critical.length === 1 ? "it" : "them"} in or mark as checked.
            </span>
          ) : counts.needs_review + counts.unreadable > 0 ? (
            <span className="text-salin-muted">
              {counts.needs_review + counts.unreadable} optional value{counts.needs_review + counts.unreadable === 1 ? "" : "s"} still unchecked — you can fix them later in the dataset.
            </span>
          ) : (
            <span className="text-salin-muted">{drafts === 0 ? "Nothing to save yet — fill in what's on the page." : "Everything has been checked."}</span>
          )
        }
      >
        <button type="button" onClick={back} className={secondaryButton}>
          <ArrowLeft className="size-4" /> Back
        </button>
        <button type="button" onClick={() => void save()} disabled={saving || drafts === 0} className={primaryButton}>
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />} {drafts > 1 ? `Save ${drafts} datasets` : "Save dataset"}
        </button>
      </StepFooter>

      <NameDialog
        open={naming}
        onOpenChange={setNaming}
        title="Save as a template"
        description="Next time, pick this template and Salin looks for these fields in the same places."
        initialValue={`${doc.name} form`}
        confirmLabel="Save template"
        onSubmit={saveAsTemplate}
      />
    </div>
  );
}


