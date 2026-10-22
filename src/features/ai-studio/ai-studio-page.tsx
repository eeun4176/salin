/**
 * Ask Salin AI Page (/ai-studio)
 * Plain-language requests about a dataset ("how many customers per
 * city?", "ilan ang walang email?") answered by the on-device
 * assistant as a dataset command: the reply says what it understood, shows
 * summaries right away, and opens changes and filters in the dataset
 * editor, where they are previewed, confirmed and can be undone. Attached
 * photos, PDFs and spreadsheets go to Read text or Extract data. Without
 * the assistant, the page explains how to set it up and points to the
 * manual Transform tools. Everything runs on this device.
 * Laid out as a full-height workspace: a header bar (source, status, AI mode,
 * Sources, Export), the thread (replies appear word by word, with [1] [2]
 * citation chips), a Sources drawer on wide screens (a sheet on phones) and
 * the composer at the bottom.
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { BookOpenText, Bot, Download, FileSpreadsheet, Files, LoaderCircle, Paperclip, ScanText, SendHorizontal, Settings, ShieldCheck, Square, Table2, Wand2, X } from "lucide-react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { AI_MODES } from "@/core/ai/ai-models";
import { AiError } from "@/core/ai/ai-runtime";
import { describeCommand, displayValue, runCommand, type CommandOutcome, type DatasetCommand } from "@/core/processing/dataset-commands";
import { errorMessage } from "@/core/storage/errors";
import { importFiles } from "@/core/storage/repositories/file-repository";
import { getDatasetWithRows } from "@/core/storage/repositories/dataset.repository";
import { commandFromRequest } from "@/features/ai/ai-actions";
import { answerGroundedQuestion, routeQuestion, type GroundedAnswer } from "@/features/ai/grounded-answers";
import { listAskSources, loadAskSource, type AskSource } from "@/features/ai/document-sources";
import { downloadBlob } from "@/lib/download";
import { scanUrl, startScanFromIntake } from "@/features/ocr/ocr-actions";
import { useDatasets } from "@/features/processing/hooks/use-datasets";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { extractData } from "@/features/processing/processing-actions";
import { formatBytes } from "@/features/workspace/query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { useAiFeature, useAiStore, type AiModeSetting } from "@/stores/ai-store";
import { ACCEPT_ATTR, toIntakeFiles, useIntakeStore, type IntakeFile } from "@/stores/intake-store";
import { toast } from "@/stores/toast-store";

type Reply =
  | { kind: "text"; text: string; actions?: ("settings" | "transform")[]; datasetId?: string }
  | { kind: "files"; files: IntakeFile[]; request?: string }
  | { kind: "analysis"; datasetId?: string; datasetName: string; answer: GroundedAnswer }
  | { kind: "command"; datasetId: string; datasetName: string; title: string; command: DatasetCommand; outcome: CommandOutcome };

type ChatMessage = { id: string; role: "user"; text: string; attachments: IntakeFile[]; sourceId: string | null } | ({ id: string; role: "assistant" } & Reply);

const SUGGESTIONS = ["Give me an overview", "How many rows per city?", "Show the rows with no email", "Find duplicate names", "Ilan ang bawat kategorya?"];

const SCANNABLE = new Set(["png", "jpg", "webp", "pdf"]);

const MODE_OPTIONS: { value: AiModeSetting; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Picks the right mode for this device." },
  ...(["standard", "lite", "advanced"] as const).map((mode) => ({ value: mode, label: AI_MODES[mode].label, hint: AI_MODES[mode].description })),
];

type Analysis = Extract<ChatMessage, { kind: "analysis" }>;
/** A citation chip being pointed at: which reply, and which of its sources. */
type Cite = { messageId: string; index: number };

function downloadAnswer({ datasetName, answer }: Analysis) {
  const headers = answer.headers ?? [];
  const columns = headers.map((name, i) => ({ id: String(i), name, type: "text" as const, required: false, sourceHeader: null }));
  const rows = (answer.rows ?? []).map((values) => ({ values: Object.fromEntries(values.map((v, i) => [String(i), v])), source: null }));
  void import("@/core/processing/dataset-export").then(({ exportDataset }) => downloadBlob(exportDataset({ name: datasetName, content: { columns, rows } }, "csv"), `${datasetName}-answer.csv`)).catch(() => toast("The answer could not be exported. Please try again."));
}

/** A new reply, revealed word by word behind a blinking caret; screen readers get the whole text at once. */
function StreamedText({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const words = useMemo(() => text.split(/(?<=\s)/), [text]);
  const [shown, setShown] = useState(reduced ? words.length : 0);
  useEffect(() => {
    if (shown >= words.length) return;
    // Long answers take about the same time as short ones (~2.5 s at most).
    const timer = setTimeout(() => setShown((n) => Math.min(words.length, n + Math.max(1, Math.ceil(words.length / 90)))), 28);
    return () => clearTimeout(timer);
  }, [shown, words.length]);
  return (
    <p className="text-[15px] whitespace-pre-wrap text-salin-text">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.slice(0, shown).join("")}
        {shown < words.length && <span className="animate-caret ml-px font-light text-salin-primary">|</span>}
      </span>
    </p>
  );
}

/** The sources behind one reply: numbered cards with a file badge and a 3-line snippet. The pointed-at one lifts left with a green ring. */
function SourceList({ message, active }: { message: Analysis; active: number | null }) {
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    if (active !== null) refs.current[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  const citations = message.answer.citations;
  return (
    <>
      <ol className="space-y-2.5">
        {citations.slice(0, 100).map((source, i) => (
          <li
            key={source.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={cn(
              "rounded-2xl bg-salin-surface p-3 ring-1 ring-salin-border transition-[translate,box-shadow] duration-300 ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
              active === i && "-translate-x-[5px] shadow-[0_8px_20px_-12px_rgb(1_168_90/0.5)] ring-2 ring-salin-primary",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-salin-primary-soft text-[11px] font-semibold text-salin-primary-ink tabular-nums">{i + 1}</span>
              <span className="min-w-0 truncate rounded-md bg-salin-tile px-1.5 py-0.5 text-[11px] font-medium text-salin-muted" title={source.label}>
                {source.label}
              </span>
              {source.confidence !== null && <span className="ml-auto shrink-0 text-[11px] text-salin-subtle tabular-nums">OCR {Math.round(source.confidence)}%</span>}
            </div>
            <p className="mt-2 line-clamp-3 text-[13px] whitespace-pre-wrap text-salin-text">{source.text}</p>
          </li>
        ))}
      </ol>
      {citations.length > 100 && <p className="mt-3 text-xs text-salin-muted">Showing the first 100 source records. Calculations use all matching records.</p>}
    </>
  );
}

function AttachmentChip({ file, onRemove }: { file: IntakeFile; onRemove?: () => void }) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-2.5 rounded-xl bg-salin-surface py-1.5 pr-1.5 pl-1.5 ring-1 ring-salin-border">
      {file.previewUrl ? <img src={file.previewUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" /> : <FileTypeIcon kind={file.kind} showLabel={false} className="size-9" />}
      <div className="min-w-0 pr-1">
        <p className="max-w-[11rem] truncate text-[13px] font-semibold text-salin-text" title={file.name}>
          {file.name}
        </p>
        <p className="text-[11px] text-salin-muted">{formatBytes(file.size)}</p>
      </div>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${file.name}`} className="grid size-7 shrink-0 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

const action = "press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile";

function ResultTable({ outcome }: { outcome: Extract<CommandOutcome, { kind: "table" }> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-2xl bg-salin-surface ring-1 ring-salin-border" data-lenis-prevent-horizontal="">
      <table className="w-full min-w-[20rem] text-left text-[13px]">
        <caption className="sr-only">{outcome.title}</caption>
        <thead className="bg-salin-canvas text-salin-muted">
          <tr>
            {outcome.headers.map((h) => (
              <th key={h} scope="col" className="px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-salin-border">
          {outcome.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={cn("px-4 py-2 text-salin-text", typeof cell === "number" && "tabular-nums")}>
                  {displayValue(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AssistantMessage({ message, active, onCite }: { message: Extract<ChatMessage, { role: "assistant" }>; active: number | null; onCite: (cite: Cite | null, open?: boolean) => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function readText(files: IntakeFile[]) {
    setBusy(true);
    const id = await startScanFromIntake(files, null);
    setBusy(false);
    if (id) navigate(scanUrl(id));
  }

  async function extract(files: IntakeFile[]) {
    setBusy(true);
    try {
      const { files: saved } = await importFiles(files.map((f) => ({ blob: f.file, name: f.name, kind: f.kind, mimeType: f.file.type, dirPath: "", source: f.source })), null);
      await extractData(saved.map((f) => f.id), (datasetId) => navigate(datasetUrl(datasetId)));
    } catch (error) {
      toast(errorMessage(error, "The files couldn't be saved. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-salin-primary-soft text-salin-primary">
        <Bot className="size-5" />
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <p className="sr-only">Salin AI said:</p>
        {message.kind === "text" && (
          <>
            <StreamedText text={message.text} />
            <div className="mt-2 flex flex-wrap gap-2">
              {message.actions?.includes("transform") && message.datasetId && (
                <button type="button" onClick={() => navigate(datasetUrl(message.datasetId!))} className={action}>
                  <Wand2 className="size-4" /> Open the dataset's Transform tools
                </button>
              )}
              {message.actions?.includes("settings") && (
                <button type="button" onClick={() => navigate("/settings#ai-heading")} className={action}>
                  <Settings className="size-4" /> Set up on-device AI
                </button>
              )}
            </div>
          </>
        )}
        {message.kind === "files" && (
          <>
            <p className="text-[15px] text-salin-text">{message.request ? `I received your question: “${message.request}”. Review this file into a dataset first, then ask me again.` : `What should I do with ${message.files.length === 1 ? "this file" : `these ${message.files.length} files`}? They'll be saved to your workspace first, unchanged.`}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {message.files.some((f) => SCANNABLE.has(f.kind)) && (
                <button type="button" disabled={busy} onClick={() => void readText(message.files.filter((f) => SCANNABLE.has(f.kind)))} className={action}>
                  <ScanText className="size-4" /> Read text (photos, scanned PDFs)
                </button>
              )}
              {message.files.some((f) => f.kind !== "png" && f.kind !== "jpg" && f.kind !== "webp") && (
                <button type="button" disabled={busy} onClick={() => void extract(message.files.filter((f) => f.kind !== "png" && f.kind !== "jpg" && f.kind !== "webp"))} className={action}>
                  <FileSpreadsheet className="size-4" /> Extract tables (PDF, Excel, CSV)
                </button>
              )}
            </div>
          </>
        )}
        {message.kind === "analysis" && (
          <>
            <StreamedText text={message.answer.text} />
            {message.answer.citations.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5" onMouseLeave={() => onCite(null)}>
                <span className="text-xs text-salin-muted">Sources</span>
                {message.answer.citations.slice(0, 8).map((source, i) => (
                  <button
                    key={source.id}
                    type="button"
                    aria-label={`Source ${i + 1}: ${source.label}`}
                    title={source.label}
                    onMouseEnter={() => onCite({ messageId: message.id, index: i })}
                    onFocus={() => onCite({ messageId: message.id, index: i })}
                    onClick={() => onCite({ messageId: message.id, index: i }, true)}
                    className={cn(
                      "press h-6 min-w-6 rounded-md px-1.5 text-[11px] font-semibold tabular-nums ring-1 transition-colors",
                      active === i ? "bg-salin-primary text-white ring-salin-primary" : "bg-salin-primary-soft text-salin-primary-ink ring-salin-primary/20 hover:ring-salin-primary",
                    )}
                  >
                    [{i + 1}]
                  </button>
                ))}
                {message.answer.citations.length > 8 && (
                  <button type="button" onClick={() => onCite({ messageId: message.id, index: 8 }, true)} className="text-xs font-semibold text-salin-primary hover:underline">
                    +{message.answer.citations.length - 8} more
                  </button>
                )}
              </div>
            )}
            {message.answer.kind === "table" && (
              <ResultTable outcome={{ kind: "table", title: message.datasetName, headers: message.answer.headers ?? [], rows: message.answer.rows ?? [], message: message.answer.text }} />
            )}
            {message.answer.kind !== "unsupported" && message.answer.understood && <p className="mt-2 text-xs text-salin-muted">I read this as: {message.answer.understood}</p>}
            {message.answer.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-800 dark:text-amber-300">{warning}</p>)}
            {message.answer.export && message.answer.kind === "table" && <button type="button" className={cn(action, "mt-2")} onClick={() => downloadAnswer(message)}>Download displayed table (CSV)</button>}
            {message.datasetId && <button type="button" onClick={() => navigate(datasetUrl(message.datasetId!))} className={cn(action, "mt-2")}>
              <Table2 className="size-4" /> Open dataset
            </button>}
          </>
        )}
        {message.kind === "command" && (
          <>
            <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">I understood this for “{message.datasetName}” as:</p>
            <p className="mt-0.5 text-[15px] font-medium text-salin-text">{message.title}</p>
            <p className="mt-1 text-sm text-salin-muted">{message.outcome.message}</p>
            {message.outcome.kind === "table" && <ResultTable outcome={message.outcome} />}
            <div className="mt-3 flex flex-wrap gap-2">
              {message.outcome.kind !== "table" && (
                <button type="button" onClick={() => navigate(datasetUrl(message.datasetId), { state: { command: message.command } })} className={cn(action, "bg-salin-primary text-white ring-0 hover:bg-salin-primary-strong")}>
                  <Table2 className="size-4" /> {message.outcome.kind === "view" ? "Show these rows in the dataset" : "Review and apply in the dataset"}
                </button>
              )}
              <button type="button" onClick={() => navigate(datasetUrl(message.datasetId))} className={action}>
                Open dataset
              </button>
            </div>
            {message.outcome.kind === "change" && <p className="mt-2 text-xs text-salin-muted">Nothing has changed yet — you'll see a preview there, and can undo it.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: Extract<ChatMessage, { role: "user" }> }) {
  return (
    <div className="flex justify-end pl-10">
      <div className="min-w-0 rounded-2xl rounded-tr-md bg-salin-primary/10 px-4 py-3 ring-1 ring-salin-primary/15">
        <p className="sr-only">You said:</p>
        {message.text && <p className="text-[15px] whitespace-pre-wrap text-salin-text">{message.text}</p>}
        {message.attachments.length > 0 && (
          <div className="no-scrollbar -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" data-lenis-prevent-horizontal="">
            {message.attachments.map((f) => (
              <AttachmentChip key={f.id} file={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Thinking({ status, onStop }: { status: string; onStop: () => void }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center gap-3" role="status">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-salin-primary-soft text-salin-primary">
        <Bot className="size-5" />
      </span>
      <span className="flex items-center gap-2 text-sm text-salin-muted">
        <LoaderCircle className={cn("size-4", !reduced && "animate-spin")} /> {status}
        <button type="button" onClick={onStop} className="inline-flex items-center gap-1 font-semibold text-salin-primary hover:underline">
          <Square className="size-3.5" /> Stop
        </button>
      </span>
    </div>
  );
}

export function AiStudioPage() {
  const attachments = useIntakeStore((s) => s.attachments);
  const attach = useIntakeStore((s) => s.attach);
  const detach = useIntakeStore((s) => s.detach);
  const takeAttachments = useIntakeStore((s) => s.takeAttachments);
  const datasets = useDatasets();
  const assistant = useAiFeature("assistant");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [documents, setDocuments] = useState<AskSource[]>([]);
  const [cite, setCite] = useState<{ messageId: string; index: number | null } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const setting = useAiStore((s) => s.setting);
  const setSetting = useAiStore((s) => s.setSetting);
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  const list = datasets.status === "ready" ? datasets.datasets : [];
  const sourceOptions = [...list.map((d) => ({ value: d.id, label: d.name, hint: `${d.rowCount.toLocaleString()} rows · ${d.columns.length} columns` })), ...documents.map((d) => ({ value: d.id, label: d.name, hint: d.kind === "scan" ? "Scanned document" : "Imported document" }))];
  const datasetId = chosen && sourceOptions.some((d) => d.value === chosen) ? chosen : (sourceOptions[0]?.value ?? null);

  useEffect(() => {
    let active = true;
    void listAskSources().then((sources) => { if (active) setDocuments(sources); }).catch(() => toast("Document sources could not be loaded."));
    return () => { active = false; };
  }, [datasets.status, chosen]);

  useEffect(() => () => controller.current?.abort(), []);

  const analyses = messages.filter((m): m is Analysis => m.role === "assistant" && m.kind === "analysis");
  // The drawer follows the reply last pointed at, else the newest one with sources.
  const sourceMessage = analyses.find((m) => m.id === cite?.messageId) ?? [...analyses].reverse().find((m) => m.answer.citations.length > 0) ?? null;
  const latestTable = [...analyses].reverse().find((m) => m.answer.kind === "table") ?? null;
  const wide = () => window.matchMedia("(min-width: 64rem)").matches;

  function onCite(next: Cite | null, open = false) {
    setCite((current) => next ?? (current && { ...current, index: null }));
    if (!open) return;
    if (wide()) setDrawerOpen(true);
    else setSheetOpen(true);
  }

  const reply = (r: Reply) => setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", ...r }]);
  const canSend = !status && (draft.trim() !== "" || attachments.length > 0);

  function resize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  async function answerQuestion(text: string, previous: ChatMessage[], targetId = datasetId) {
    if (!targetId) return reply({ kind: "text", text: "Choose a document, scan, or dataset first, then ask a question about it." });
    const savedDatasetId = /^(file|scan):/.test(targetId) ? undefined : targetId;
    controller.current = new AbortController();
    setStatus("Starting the assistant");
    try {
      const current = await loadAskSource(targetId, controller.current.signal);
      const options = {
        signal: controller.current.signal,
        onProgress: (p: { stage: "loading" | "running"; fraction: number | null }) => setStatus(p.stage === "loading" ? `Loading the assistant${p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""}…` : "Thinking…"),
      };
      if (routeQuestion(text) === "command") {
        if (!savedDatasetId) return reply({ kind: "text", text: "Save this document as a dataset first to preview and confirm changes." });
        if (!assistant.ready) return reply({ kind: "text", text: `The on-device assistant isn't ready: ${assistant.reason}`, actions: ["settings"], datasetId: targetId });
        // Keep the existing transform workflow available for non-question requests.
        const command = await commandFromRequest(text, current.columns, current.rows, assistant.variant, options);
        if (command.ok) {
          reply({ kind: "command", datasetId: savedDatasetId, datasetName: current.name, title: describeCommand(command.command, current.columns), command: command.command, outcome: runCommand(command.command, { columns: current.columns, rows: current.rows }) });
          return;
        }
        return reply({ kind: "text", text: command.message, actions: ["transform"], datasetId: savedDatasetId });
      }
      const last = [...previous].reverse().find((m) => m.role === "user" && m.sourceId === targetId);
      const result = await answerGroundedQuestion(text, current, assistant.ready ? assistant.variant : null, options, last?.role === "user" ? last.text : undefined);
      if (controller.current.signal.aborted) return;
      reply({ kind: "analysis", datasetId: savedDatasetId, datasetName: current.name, answer: result });
    } catch (error) {
      if (!controller.current?.signal.aborted) reply({ kind: "text", text: error instanceof AiError ? error.message : errorMessage(error, "The assistant couldn't answer. Please rephrase the question or check the selected source."), actions: ["transform"], datasetId: savedDatasetId });
    } finally {
      setStatus(null);
      controller.current = null;
    }
  }

  async function answerWithFiles(files: IntakeFile[], text: string) {
    setStatus("Reading the attached file on this device…");
    try {
      const { files: saved } = await importFiles(files.map((f) => ({ blob: f.file, name: f.name, kind: f.kind, mimeType: f.file.type, dirPath: "", source: f.source })), null);
      const createdId = await extractData(saved.map((file) => file.id), setChosen);
      if (!createdId) {
        reply({ kind: "text", text: "I couldn't find a readable table in that file. For scanned pages or photos, use Read text, review the extraction, save it as a dataset, then ask about it." });
        return;
      }
      setChosen(createdId);
      if (text) await answerQuestion(text, [], createdId);
      else {
        const { dataset } = await getDatasetWithRows(createdId);
        reply({ kind: "text", text: `I read ${dataset.name} into a dataset on this device. It has ${dataset.rowCount.toLocaleString()} rows and ${dataset.columns.length} columns. What would you like to know?`, datasetId: createdId });
      }
    } catch (error) {
      reply({ kind: "text", text: errorMessage(error, "The file couldn't be read. Please try a CSV or Excel spreadsheet.") });
    } finally {
      setStatus(null);
      controller.current = null;
    }
  }

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const files = takeAttachments();
    const text = draft.trim();
    const previous = messages;
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text, attachments: files, sourceId: datasetId }]);
    setDraft("");
    requestAnimationFrame(resize);
    const dataFileKinds = new Set(["xlsx", "csv", "txt", "pdf"]);
    if (files.length && files.every((file) => dataFileKinds.has(file.kind))) void answerWithFiles(files, text);
    else if (files.length) reply({ kind: "files", files, request: text || undefined });
    else void answerQuestion(text, previous);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const { ok, rejected } = toIntakeFiles(Array.from(event.target.files ?? []), "import");
    event.target.value = "";
    if (ok.length) attach(ok);
    if (rejected.length) toast(`Skipped ${rejected.length} unsupported or oversized file(s).`);
  }

  const sources = sourceMessage ? (
    <SourceList message={sourceMessage} active={cite?.messageId === sourceMessage.id ? cite.index : null} />
  ) : (
    <p className="text-sm text-salin-muted">Each answer's sources show here: the rows, pages and lines it was read from.</p>
  );
  const sourceCount = sourceMessage?.answer.citations.length ?? 0;
  const headerButton = "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-salin-border-strong bg-salin-surface px-2.5 text-[13px] font-medium text-salin-text hover:bg-salin-tile disabled:opacity-50";

  return (
    <div className="flex h-[calc(100dvh-var(--mobile-nav-h)-env(safe-area-inset-bottom))] min-h-0 nav:h-dvh">
      <main id="main" className="flex min-w-0 flex-1 flex-col bg-salin-surface">
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-salin-border px-4 py-2.5 sm:px-5">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-salin-primary-soft text-salin-primary">
            <Bot className="size-5" />
          </span>
          <div className="min-w-0 flex-1 basis-44">
            <h1 className="sr-only">Ask Salin AI</h1>
            {sourceOptions.length ? (
              <ChoiceMenu variant="cell" label="Source" heading="Ask about" value={datasetId ?? ""} options={sourceOptions} onChange={setChosen} disabled={status !== null} className="-ml-1.5 h-7 w-auto max-w-full min-w-0 rounded-lg px-1.5 text-[15px] font-semibold" />
            ) : (
              <p className="text-[15px] font-semibold text-salin-text">{datasets.status === "loading" ? "Loading…" : "No documents or datasets yet"}</p>
            )}
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-salin-muted">
              {status ? (
                <LoaderCircle aria-hidden="true" className={cn("size-3.5 shrink-0 text-salin-primary", !reduced && "animate-spin")} />
              ) : (
                <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", assistant.ready ? "bg-salin-primary" : "bg-salin-subtle")} />
              )}
              <span className="truncate">{status ?? (assistant.ready ? "Assistant ready on this device" : "Local document search ready")}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ChoiceMenu label="AI mode" heading="AI mode" value={setting} options={MODE_OPTIONS} onChange={setSetting} disabled={status !== null} />
            <button
              type="button"
              onClick={() => (wide() ? setDrawerOpen((open) => !open) : setSheetOpen(true))}
              aria-label={`Sources (${sourceCount})`}
              title="Sources"
              className={cn(headerButton, drawerOpen && "lg:border-salin-primary lg:bg-salin-primary-soft lg:text-salin-primary-ink")}
            >
              <BookOpenText aria-hidden="true" className="size-4" />
              <span className="tabular-nums">{sourceCount}</span>
            </button>
            <button type="button" disabled={!latestTable} onClick={() => latestTable && downloadAnswer(latestTable)} title="Download the latest answer table (CSV)" className={headerButton}>
              <Download aria-hidden="true" className="size-4" />
              <span className="max-sm:sr-only">Export</span>
            </button>
          </div>
        </header>

        {/* column-reverse keeps the thread pinned to the newest message as it grows */}
        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto" data-lenis-prevent="">
          <div role="log" aria-live="polite" aria-label="Conversation" className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
            {messages.length === 0 && !status && (
              <div className="my-auto flex flex-col items-center py-6 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
                  <Bot className="size-7" />
                </span>
                <p className="mt-3 font-semibold text-salin-text">What should we do with your data?</p>
                <p className="mt-1 max-w-sm text-sm text-salin-muted">Choose a document, scan, or dataset and ask in English, Filipino, or Taglish. Answers include sources and calculations run on this device.</p>
                <section aria-labelledby="try-asking" className="mt-6 w-full">
                  <h2 id="try-asking" className="text-xs font-semibold tracking-wide text-salin-subtle uppercase">
                    Try asking
                  </h2>
                  <div className="mt-2.5 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setDraft(s);
                          requestAnimationFrame(() => (resize(), inputRef.current?.focus()));
                        }}
                        className="press rounded-xl bg-salin-tile px-3.5 py-2 text-left text-[13px] text-salin-text hover:bg-salin-tile-hover"
                      >
                        “{s}”
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? <UserMessage key={m.id} message={m} /> : <AssistantMessage key={m.id} message={m} active={cite?.messageId === m.id ? cite.index : null} onCite={onCite} />,
            )}
            {status && <Thinking status={status} onStop={() => controller.current?.abort()} />}
          </div>
        </div>

        {/* Composer; on phones it leaves room for the bottom bar's + button */}
        <div className="shrink-0 border-t border-salin-border px-3 pt-3 pb-9 sm:px-6 nav:pb-3">
          <form
            onSubmit={send}
            className="mx-auto max-w-3xl rounded-2xl bg-salin-surface p-1.5 shadow-[0_8px_28px_-14px_rgb(16_40_28/0.28)] ring-1 ring-salin-border transition-shadow focus-within:ring-2 focus-within:ring-salin-primary/50"
          >
            <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} />
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pt-1 pb-2">
                {attachments.map((f) => (
                  <AttachmentChip key={f.id} file={f} onRemove={() => detach(f.id)} />
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach files" className="grid size-11 shrink-0 place-items-center rounded-xl text-salin-muted hover:bg-salin-tile hover:text-salin-text">
                <Paperclip className="size-5" />
              </button>
              <div className="relative min-w-0 flex-1">
                <textarea
                  id="ask-input"
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    resize();
                  }}
                  onKeyDown={onKeyDown}
                  maxLength={500}
                  placeholder=" "
                  data-lenis-prevent=""
                  className="peer block max-h-42 min-h-11 w-full resize-none bg-transparent px-1 pt-[19px] pb-1.5 text-[15px] leading-5 text-salin-text outline-none"
                />
                {/* Rests in the field; lifts on focus or once there's text. */}
                <label
                  htmlFor="ask-input"
                  className={cn(
                    "pointer-events-none absolute top-3 left-1 origin-left truncate text-[15px] leading-5 text-salin-subtle",
                    "transition-[translate,scale,color] duration-[580ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
                    "peer-focus:-translate-y-[10px] peer-focus:scale-[0.74] peer-focus:text-salin-primary",
                    "peer-[:not(:placeholder-shown)]:-translate-y-[10px] peer-[:not(:placeholder-shown)]:scale-[0.74] peer-[:not(:placeholder-shown)]:text-salin-primary",
                  )}
                >
                  Ask Salin AI
                </label>
              </div>
              <button
                type="submit"
                disabled={!canSend}
                aria-label="Send"
                className="press grid size-11 shrink-0 place-items-center rounded-full bg-salin-primary text-white shadow-[0_6px_14px_-6px_rgb(1_168_90/0.7)] hover:bg-salin-primary-strong disabled:bg-salin-tile disabled:text-salin-subtle disabled:shadow-none"
              >
                <SendHorizontal className="size-5" />
              </button>
            </div>
          </form>
          <ul className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-1 text-[11.5px] whitespace-nowrap text-salin-muted">
            <li className="flex items-center gap-1.5 rounded-full bg-salin-primary-soft px-2 py-0.5 font-medium text-salin-primary-ink">
              <ShieldCheck className="size-3.5" /> Your data stays on your device
            </li>
            <li className="flex items-center gap-1.5">
              <Paperclip className="size-3.5" /> Attach PDF, JPG, PNG, XLSX, CSV
            </li>
            <li className="flex items-center gap-1.5 max-sm:hidden">
              <Files className="size-3.5" /> Changes open in the dataset with a preview and Undo
            </li>
          </ul>
        </div>
      </main>

      {drawerOpen && (
        <aside aria-label="Sources" className="hidden w-80 shrink-0 flex-col border-l border-salin-border bg-salin-canvas lg:flex">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-salin-border px-4">
            <BookOpenText aria-hidden="true" className="size-4 text-salin-primary" />
            <h2 className="flex-1 text-sm font-semibold text-salin-text">Sources</h2>
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close sources" className="grid size-8 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text">
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" data-lenis-prevent="">
            {sources}
          </div>
        </aside>
      )}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] rounded-t-3xl bg-salin-canvas p-4">
          <SheetTitle>Sources</SheetTitle>
          <SheetDescription className="sr-only">Where the answers were read from on this device.</SheetDescription>
          <div className="min-h-0 overflow-y-auto" data-lenis-prevent="">
            {sources}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
