/**
 * Excel Extraction Page (/files/:fileId/tables)
 * A guided, preview-first way to get data out of a workbook, in three steps:
 *   1. Choose sheets — every worksheet, with the sections found on it.
 *   2. Pick sections — one sheet at a time: each section's name, record
 *      count, a small preview and a review status; cells and header rows are
 *      tucked into "Adjust selection" for when detection needs help.
 *   3. Create — how many datasets will be made and their names, combined or
 *      one per section.
 * Selections are checked before moving on. The workbook itself is only read;
 * it's never changed.
 */

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowRight, FileSpreadsheet, LoaderCircle, Plus, TriangleAlert } from "lucide-react";

import { primaryButton, secondaryButton, StepFooter } from "@/components/common/step-footer";
import { Stepper, type StepInfo } from "@/components/common/stepper";
import { PageFrame } from "@/components/layout/page-frame";
import { sheetWarnings } from "@/core/processing/excel/sheet-warnings";
import type { SheetModel, WorkbookModel } from "@/core/processing/excel/workbook-reader";
import { validateName } from "@/core/storage/names";
import { SectionCard } from "@/features/processing/components/section-card";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { useWorkbook } from "@/features/processing/hooks/use-workbook";
import { extractTables } from "@/features/processing/processing-actions";
import {
  datasetGroups,
  evaluateDraft,
  initialDrafts,
  initialSheets,
  manualDraft,
  recordCount,
  sameColumns,
  sectionName,
  selectionProblem,
  type CombineMode,
  type EvaluatedDraft,
  type TableDraft,
} from "@/features/processing/table-drafts";
import { cn } from "@/lib/utils";
import { toast } from "@/stores/toast-store";
import type { WorkspaceFile } from "@/types/domain";

type Step = 1 | 2 | 3;
const STEPS: StepInfo[] = [
  { label: "Choose sheets", description: "Pick the worksheets to read." },
  { label: "Pick sections", description: "Tick the tables you want." },
  { label: "Create datasets", description: "Name them and save." },
];


/* ------------------------------------------------------------------
   Step 1 — Choose sheets
------------------------------------------------------------------- */

function SheetsStep({
  workbook,
  sheets,
  sectionsBySheet,
  onToggle,
}: {
  workbook: WorkbookModel;
  sheets: Set<string>;
  sectionsBySheet: Map<string, { name: string; include: boolean }[]>;
  onToggle: (name: string) => void;
}) {
  const warnings = [
    ...(workbook.externalLinks ? ["This workbook links to other workbooks. Linked values are the ones last saved in this file."] : []),
    ...workbook.sheets.flatMap(sheetWarnings),
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-salin-muted">Which sheets hold the data you want? Sheets with data are already selected.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {workbook.sheets.map((sheet) => {
          const sections = sectionsBySheet.get(sheet.name) ?? [];
          const usable = sections.filter((s) => s.include);
          const unavailable = sheet.isChartSheet || !sheet.used;
          const summary = sheet.isChartSheet
            ? "Chart sheet — nothing to extract"
            : !sheet.used
              ? "Empty sheet"
              : usable.length
                ? `${usable.length} section${usable.length === 1 ? "" : "s"} found: ${usable.map((s) => s.name).join(" · ")}`
                : "No clear tables found — you can still pick cells yourself";
          const checked = sheets.has(sheet.name);
          return (
            <label
              key={sheet.name}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-2xl p-4 ring-1",
                checked ? "bg-salin-primary-soft/50 ring-salin-primary/40" : "bg-salin-surface ring-salin-border hover:bg-salin-tile",
                unavailable && "cursor-not-allowed opacity-60",
              )}
            >
              <input type="checkbox" checked={checked} disabled={unavailable} onChange={() => onToggle(sheet.name)} className="mt-0.5 size-5 shrink-0 accent-salin-primary" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-salin-text">
                  {sheet.name}
                  {sheet.visibility !== "visible" && <span className="rounded-md bg-salin-tile px-1.5 py-0.5 text-[11px] font-semibold text-salin-muted">Hidden</span>}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-salin-muted">{summary}</span>
              </span>
            </label>
          );
        })}
      </div>
      {warnings.length > 0 && (
        <details className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold">
            <TriangleAlert className="size-4" /> Some content won't be extracted ({warnings.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Step 2 — Pick sections (one sheet at a time)
------------------------------------------------------------------- */

interface Section {
  draft: TableDraft;
  sheet: SheetModel;
  evaluated: EvaluatedDraft;
  name: string;
}

function SectionsStep({
  sheetNames,
  active,
  onActive,
  sections,
  problems,
  onChange,
  onAdd,
  onRemove,
}: {
  sheetNames: string[];
  active: string;
  onActive: (name: string) => void;
  sections: Section[];
  problems: Map<string, string>;
  onChange: (key: string, patch: Partial<TableDraft>) => void;
  onAdd: (sheet: string) => void;
  onRemove: (key: string) => void;
}) {
  const onSheet = sections.filter((s) => s.draft.sheet === active);
  return (
    <div className="space-y-4">
      {sheetNames.length > 1 && (
        <div role="tablist" aria-label="Sheets" className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-salin-tile p-1">
          {sheetNames.map((name) => {
            const count = sections.filter((s) => s.draft.sheet === name && s.draft.include).length;
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={name === active}
                onClick={() => onActive(name)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap",
                  name === active ? "bg-salin-surface text-salin-primary shadow-sm" : "text-salin-muted hover:text-salin-text",
                )}
              >
                {name}
                <span className="rounded-full bg-salin-primary-soft px-1.5 text-xs font-semibold text-salin-primary-ink">{count}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-sm text-salin-muted">
        Tick the sections of <strong className="text-salin-text">{active}</strong> you want. Titles, notes and empty areas are left out for you.
      </p>
      {onSheet.length === 0 && <p className="rounded-xl bg-salin-canvas p-4 text-sm text-salin-muted">No sections were found on this sheet. Add one by selecting its cells.</p>}
      {onSheet.map(({ draft, sheet, evaluated, name }) => (
        <SectionCard
          key={draft.key}
          name={name}
          sheet={sheet}
          draft={draft}
          evaluated={evaluated}
          problem={problems.get(draft.key) ?? null}
          onChange={(patch) => onChange(draft.key, patch)}
          onRemove={draft.origin === "manual" ? () => onRemove(draft.key) : undefined}
        />
      ))}
      <button type="button" onClick={() => onAdd(active)} className="press inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold text-salin-primary ring-1 ring-salin-border hover:bg-salin-primary-soft">
        <Plus className="size-4" /> Add a section by selecting cells
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------
   Step 3 — Create datasets
------------------------------------------------------------------- */

function CreateStep({
  chosen,
  mode,
  recommended,
  onMode,
  groups,
  names,
  onName,
}: {
  chosen: Section[];
  mode: CombineMode;
  recommended: CombineMode;
  onMode: (mode: CombineMode) => void;
  groups: { key: string; name: string; sections: Section[] }[];
  names: Record<string, string>;
  onName: (key: string, name: string) => void;
}) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-salin-text">
        {groups.length === 1 ? "1 dataset will be created" : `${groups.length} datasets will be created`}
      </h2>

      {chosen.length > 1 && (
        <div role="radiogroup" aria-label="How to save the sections" className="grid gap-2 sm:grid-cols-2">
          {(["combine", "separate"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => onMode(value)}
              className={cn("rounded-2xl p-4 text-left ring-1", mode === value ? "bg-salin-primary-soft/50 ring-salin-primary" : "bg-salin-surface ring-salin-border hover:bg-salin-tile")}
            >
              <span className="flex items-center gap-2 font-semibold text-salin-text">
                {value === "combine" ? "Combine into one dataset" : "One dataset per section"}
                {value === recommended && <span className="rounded-md bg-salin-primary px-1.5 py-0.5 text-[11px] font-semibold text-white">Suggested</span>}
              </span>
              <span className="mt-1 block text-sm text-salin-muted">
                {value === "combine" ? "All rows go into one table. Best when the sections have the same columns." : "Each section becomes its own table. Best when the columns differ."}
              </span>
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-3">
        {groups.map((group) => {
          const value = names[group.key] ?? group.name;
          const error = validateName(value, []);
          const total = group.sections.reduce((sum, s) => sum + recordCount(s.evaluated), 0);
          return (
            <li key={group.key} className="rounded-2xl p-4 ring-1 ring-salin-border">
              <label className="grid gap-1 text-xs font-medium text-salin-muted">
                Dataset name
                <input
                  value={value}
                  maxLength={255}
                  onChange={(e) => onName(group.key, e.target.value)}
                  aria-invalid={error ? true : undefined}
                  className="h-10 rounded-lg border border-salin-border bg-salin-surface px-3 text-base font-semibold text-salin-text outline-none focus:border-salin-primary focus:ring-2 focus:ring-salin-primary/15 aria-invalid:border-destructive"
                />
              </label>
              {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
              <p className="mt-2 text-sm text-salin-muted">
                {total.toLocaleString()} record{total === 1 ? "" : "s"} from {group.sections.map((s) => `${s.draft.sheet} · ${s.name}`).join(", ")}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-salin-muted">Your Excel file stays exactly as it is. You can review and edit each dataset next.</p>
    </div>
  );
}

/* ------------------------------------------------------------------
   Page
------------------------------------------------------------------- */

function GuidedExtraction({ file, workbook }: { file: WorkspaceFile; workbook: WorkbookModel }) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [drafts, setDrafts] = useState(() => initialDrafts(workbook));
  const [sheets, setSheets] = useState(() => initialSheets(workbook, drafts));
  const [active, setActive] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [mode, setMode] = useState<CombineMode | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const sheetByName = useMemo(() => new Map(workbook.sheets.map((s) => [s.name, s])), [workbook]);
  const sheetNames = workbook.sheets.filter((s) => sheets.has(s.name)).map((s) => s.name);
  const activeSheet = active && sheets.has(active) ? active : sheetNames[0];

  const sections: Section[] = useMemo(() => {
    const used = new Map<string, number>();
    return drafts.map((draft) => {
      const sheet = sheetByName.get(draft.sheet)!;
      const evaluated = evaluateDraft(sheet, draft);
      let name = sectionName(draft, evaluated);
      // Two sections on a sheet with the same columns get numbered.
      const seen = `${draft.sheet}\n${name}`.toLowerCase();
      const n = (used.get(seen) ?? 0) + 1;
      used.set(seen, n);
      if (n > 1) name = `${name} (${n})`;
      return { draft, sheet, evaluated, name };
    });
  }, [drafts, sheetByName]);

  const sectionsBySheet = useMemo(() => {
    const map = new Map<string, { name: string; include: boolean }[]>();
    for (const s of sections) map.set(s.draft.sheet, [...(map.get(s.draft.sheet) ?? []), { name: s.name, include: s.draft.include }]);
    return map;
  }, [sections]);

  const chosen = sections.filter((s) => sheets.has(s.draft.sheet) && s.draft.include);
  const problems = new Map(chosen.flatMap((s) => {
    const problem = selectionProblem(s.draft, s.evaluated);
    return problem ? [[s.draft.key, problem] as const] : [];
  }));
  const recommended: CombineMode = sameColumns(chosen.map((s) => s.evaluated)) ? "combine" : "separate";
  const combine = mode ?? recommended;
  const label = (d: TableDraft) => sections.find((s) => s.draft.key === d.key)?.name ?? d.sheet;
  const groups = datasetGroups(file.name, chosen.map((s) => s.draft), combine, label).map((group, i) => ({
    ...group,
    key: combine === "combine" || chosen.length === 1 ? "combined" : chosen[i].draft.key,
    sections: combine === "combine" || chosen.length === 1 ? chosen : [chosen[i]],
  }));
  const nameErrors = groups.some((g) => validateName(names[g.key] ?? g.name, []) !== null);

  const update = (key: string, patch: Partial<TableDraft>) => setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const toggleSheet = (name: string) =>
    setSheets((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const continueFromSections = () => {
    const index = sheetNames.indexOf(activeSheet);
    if (index < sheetNames.length - 1) {
      setActive(sheetNames[index + 1]);
      window.scrollTo({ top: 0 });
      return;
    }
    if (chosen.length === 0 || problems.size > 0) {
      setShowProblems(true);
      const first = chosen.find((s) => problems.has(s.draft.key));
      if (first) setActive(first.draft.sheet);
      return;
    }
    setStep(3);
  };

  async function create() {
    setBusy(true);
    const toCreate = groups.map((g) => ({ name: (names[g.key] ?? g.name).trim(), tables: g.tables }));
    await extractTables(file.id, toCreate, (ids) => {
      if (ids.length === 1) navigate(datasetUrl(ids[0]));
      else {
        toast(`Created ${ids.length} datasets from “${file.name}”.`);
        navigate("/datasets");
      }
    });
    setBusy(false);
  }

  const isLastSheet = sheetNames.indexOf(activeSheet) === sheetNames.length - 1;

  return (
    <div>
      <div className="flex min-w-0 items-center justify-center gap-2.5">
        <FileSpreadsheet aria-hidden="true" className="size-6 shrink-0 text-salin-primary" />
        <h2 className="truncate text-lg font-semibold text-salin-text">{file.name}</h2>
      </div>
      <Stepper steps={STEPS} current={step} className="mt-5" />

      <div className="mt-8 border-t border-salin-border pt-6">
        {step === 1 && <SheetsStep workbook={workbook} sheets={sheets} sectionsBySheet={sectionsBySheet} onToggle={toggleSheet} />}
        {step === 2 && (
          <SectionsStep
            sheetNames={sheetNames}
            active={activeSheet}
            onActive={setActive}
            sections={sections.filter((s) => sheets.has(s.draft.sheet))}
            problems={showProblems ? problems : new Map()}
            onChange={update}
            onAdd={(sheet) => setDrafts((all) => [...all, manualDraft(sheet)])}
            onRemove={(key) => setDrafts((all) => all.filter((d) => d.key !== key))}
          />
        )}
        {step === 3 && (
          <CreateStep
            chosen={chosen}
            mode={combine}
            recommended={recommended}
            onMode={setMode}
            groups={groups}
            names={names}
            onName={(key, name) => setNames((all) => ({ ...all, [key]: name }))}
          />
        )}
      </div>

      {step === 1 && (
        <StepFooter message={sheets.size === 0 && <span className="text-salin-muted">Choose at least one sheet.</span>}>
          <Link to="/" className={secondaryButton}>
            Cancel
          </Link>
          <button type="button" disabled={sheets.size === 0} onClick={() => setStep(2)} className={primaryButton}>
            Next: pick sections <ArrowRight className="size-4" />
          </button>
        </StepFooter>
      )}
      {step === 2 && (
        <StepFooter
          message={
            showProblems && (chosen.length === 0 || problems.size > 0) ? (
              <span role="alert" className="text-destructive">
                {chosen.length === 0 ? "Select at least one section to continue." : `Fix ${problems.size === 1 ? "the highlighted section" : `${problems.size} highlighted sections`} or untick ${problems.size === 1 ? "it" : "them"} to continue.`}
              </span>
            ) : (
              <span className="text-salin-muted">
                <strong className="text-salin-text">{chosen.length}</strong> section{chosen.length === 1 ? "" : "s"} selected
                {sheetNames.length > 1 ? ` across ${new Set(chosen.map((s) => s.draft.sheet)).size} of ${sheetNames.length} sheets` : ""}
              </span>
            )
          }
        >
          <button type="button" onClick={() => setStep(1)} className={secondaryButton}>
            <ArrowLeft className="size-4" /> Back
          </button>
          <button type="button" onClick={continueFromSections} className={primaryButton}>
            {isLastSheet ? "Continue" : "Next sheet"} <ArrowRight className="size-4" />
          </button>
        </StepFooter>
      )}
      {step === 3 && (
        <StepFooter>
          <button type="button" onClick={() => setStep(2)} className={secondaryButton}>
            <ArrowLeft className="size-4" /> Back
          </button>
          <button type="button" disabled={busy || nameErrors} onClick={() => void create()} className={primaryButton}>
            {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />}
            {groups.length === 1 ? "Create dataset" : `Create ${groups.length} datasets`}
          </button>
        </StepFooter>
      )}
    </div>
  );
}

export function ChooseTablesPage() {
  const { fileId = "" } = useParams();
  const state = useWorkbook(fileId);

  return (
    <PageFrame title="Extract from Excel" description="Three quick steps: choose sheets, pick the sections you want, then create your datasets.">
      {state.status === "loading" ? (
        <p role="status" className="flex items-center justify-center gap-2 py-14 text-sm text-salin-muted">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Reading workbook…
        </p>
      ) : state.status === "error" ? (
        <div role="alert" className="py-12 text-center">
          <p className="font-semibold text-salin-text">Can't open this workbook</p>
          <p className="mt-1 text-sm text-salin-muted">{state.message}</p>
          <Link to="/" className="mt-4 inline-block text-sm font-semibold text-salin-primary hover:underline">
            Back to workspace
          </Link>
        </div>
      ) : (
        <GuidedExtraction key={state.file.id} file={state.file} workbook={state.workbook} />
      )}
    </PageFrame>
  );
}
