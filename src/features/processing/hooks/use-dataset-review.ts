/**
 * Dataset Review Hook
 * State for the review screen: loads a dataset and its rows, applies edits
 * (cells, rows, column name/type/required), validates every cell, and
 * autosaves shortly after each change — only the edited rows when nothing
 * structural changed. Pending changes are saved when the screen closes, and
 * the browser warns before leaving with unsaved edits.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { convertValue } from "@/core/processing/dataset-inference";
import { findCellIssues } from "@/core/processing/dataset-validator";
import { errorMessage } from "@/core/storage/errors";
import { validateName } from "@/core/storage/names";
import { getDatasetWithRows, saveDatasetEdits, setDatasetStatus } from "@/core/storage/repositories/dataset.repository";
import type { CellValue, ColumnType, Dataset, DatasetColumn, DatasetRow } from "@/types/processing";

const AUTOSAVE_MS = 600;

export type SaveState = { status: "saved" } | { status: "pending" } | { status: "saving" } | { status: "error"; message: string };

interface Draft {
  name: string;
  columns: DatasetColumn[];
  rows: DatasetRow[];
}

type LoadState = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };

export function useDatasetReview(datasetId: string) {
  // Which dataset the load result belongs to; anything else is still loading.
  const [loaded, setLoaded] = useState<{ id: string; state: LoadState } | null>(null);
  const load: LoadState = loaded?.id === datasetId ? loaded.state : { status: "loading" };
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", columns: [], rows: [] });
  const [save, setSave] = useState<SaveState>({ status: "saved" });

  // Mutable save bookkeeping (not rendered).
  const latest = useRef(draft);
  const version = useRef(0);
  const savedName = useRef("");
  const dirtyRows = useRef(new Set<string>());
  const structural = useRef(false);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const chain = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    getDatasetWithRows(datasetId)
      .then(({ dataset: record, rows }) => {
        if (!active) return;
        const next = { name: record.name, columns: record.columns, rows };
        latest.current = next;
        version.current = record.version;
        savedName.current = record.name;
        setDataset(record);
        setDraft(next);
        setSave({ status: "saved" });
        setLoaded({ id: datasetId, state: { status: "ready" } });
      })
      .catch(
        (error: unknown) =>
          active && setLoaded({ id: datasetId, state: { status: "error", message: errorMessage(error, "This dataset couldn't be opened.") } }),
      );
    return () => {
      active = false;
    };
  }, [datasetId]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return chain.current;
    chain.current = chain.current.then(async () => {
      if (!dirty.current) return;
      const snapshot = latest.current;
      const changedRowIds = structural.current ? undefined : [...dirtyRows.current];
      dirty.current = false;
      structural.current = false;
      dirtyRows.current.clear();
      setSave({ status: "saving" });
      try {
        // An invalid name isn't saved (the field shows why); everything else still is.
        const name = validateName(snapshot.name, []) ? savedName.current : snapshot.name;
        const saved = await saveDatasetEdits(datasetId, { ...snapshot, name, changedRowIds }, version.current);
        version.current = saved.version;
        savedName.current = saved.name;
        setDataset(saved);
        setSave(dirty.current ? { status: "pending" } : { status: "saved" });
      } catch (error) {
        console.error(error);
        dirty.current = true;
        structural.current = true; // be safe: rewrite everything on the next attempt
        setSave({ status: "error", message: errorMessage(error, "Changes couldn't be saved. Please try again.") });
      }
    });
    return chain.current;
  }, [datasetId]);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  /** Applies an edit to the draft and schedules an autosave. */
  const edit = useCallback((change: (draft: Draft) => Draft, rows: { changed?: string[]; structural?: boolean } = {}) => {
    const next = change(latest.current);
    latest.current = next;
    setDraft(next);
    dirty.current = true;
    if (rows.structural) structural.current = true;
    rows.changed?.forEach((id) => dirtyRows.current.add(id));
    setSave({ status: "pending" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flushRef.current(), AUTOSAVE_MS);
  }, []);

  // Save on close; warn before leaving the page with edits not yet written.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      void flushRef.current();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      void flushRef.current();
    };
  }, []);

  const issues = useMemo(() => findCellIssues(draft.columns, draft.rows), [draft.columns, draft.rows]);
  const nameError = draft.name.trim() === "" ? "Give this dataset a name." : validateName(draft.name, []);

  const actions = useMemo(
    () => ({
      rename: (name: string) => edit((d) => ({ ...d, name })),

      updateCell: (rowId: string, columnId: string, value: CellValue) =>
        edit((d) => ({ ...d, rows: d.rows.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [columnId]: value } } : r)) }), {
          changed: [rowId],
        }),

      addRow: () => {
        const id = crypto.randomUUID();
        edit((d) => ({ ...d, rows: [...d.rows, { id, datasetId, position: d.rows.length, values: {}, source: null }] }), { structural: true });
        return id;
      },

      removeRow: (rowId: string) => edit((d) => ({ ...d, rows: d.rows.filter((r) => r.id !== rowId) }), { structural: true }),

      addColumn: () => {
        const id = crypto.randomUUID();
        edit((d) => {
          const taken = new Set(d.columns.map((c) => c.name.toLowerCase()));
          let n = d.columns.length + 1;
          while (taken.has(`column ${n}`)) n++;
          const column: DatasetColumn = { id, name: `Column ${n}`, type: "text", required: false, sourceHeader: null };
          return { ...d, columns: [...d.columns, column] };
        });
        return id;
      },

      updateColumn: (columnId: string, changes: Partial<Pick<DatasetColumn, "name" | "required">>) =>
        edit((d) => ({ ...d, columns: d.columns.map((c) => (c.id === columnId ? { ...c, ...changes } : c)) })),

      /** Changes a column's type and converts its cells; ones that don't fit stay as typed and get flagged. */
      setColumnType: (columnId: string, type: ColumnType) =>
        edit(
          (d) => ({
            ...d,
            columns: d.columns.map((c) => (c.id === columnId ? { ...c, type } : c)),
            rows: d.rows.map((r) =>
              columnId in r.values ? { ...r, values: { ...r.values, [columnId]: convertValue(r.values[columnId], type) } } : r,
            ),
          }),
          { structural: true },
        ),

      removeColumn: (columnId: string) =>
        edit(
          (d) => ({
            ...d,
            columns: d.columns.filter((c) => c.id !== columnId),
            rows: d.rows.map((r) => {
              if (!(columnId in r.values)) return r;
              const values = { ...r.values };
              delete values[columnId];
              return { ...r, values };
            }),
          }),
          { structural: true },
        ),

      /** Saves pending edits, then records the review decision. */
      setReviewed: async (reviewed: boolean) => {
        await flushRef.current();
        const status = reviewed ? "reviewed" : "needs_review";
        await setDatasetStatus(datasetId, status);
        setDataset((current) => current && { ...current, status });
      },

      flush: () => flushRef.current(),
    }),
    [datasetId, edit],
  );

  return { datasetId, load, dataset, draft, save, issues, nameError, ...actions };
}

export type DatasetReview = ReturnType<typeof useDatasetReview>;
