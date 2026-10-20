/**
 * Ask Salin AI Page (/ai-studio)
 * Plain-language requests about a dataset ("show unvaccinated dogs in
 * Muzon", "ilan ang aso bawat barangay?") answered by the on-device
 * assistant as a dataset command: the reply says what it understood, shows
 * summaries right away, and opens changes and filters in the dataset
 * editor, where they are previewed, confirmed and can be undone. Attached
 * photos, PDFs and spreadsheets go to Read text or Extract data. Without
 * the assistant, the page explains how to set it up and points to the
 * manual Transform tools. Everything runs on this device.
 */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { Bot, FileSpreadsheet, Files, LoaderCircle, Paperclip, ScanText, SendHorizontal, Settings, ShieldCheck, Square, Table2, User, Wand2, X } from "lucide-react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { PageFrame } from "@/components/layout/page-frame";
import { AiError } from "@/core/ai/ai-runtime";
import { describeCommand, displayValue, runCommand, type CommandOutcome, type DatasetCommand } from "@/core/processing/dataset-commands";
import { errorMessage } from "@/core/storage/errors";
import { importFiles } from "@/core/storage/repositories/file-repository";
import { getDatasetWithRows } from "@/core/storage/repositories/dataset.repository";
import { commandFromRequest } from "@/features/ai/ai-actions";
import { scanUrl, startScanFromIntake } from "@/features/ocr/ocr-actions";
import { useDatasets } from "@/features/processing/hooks/use-datasets";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import { extractData } from "@/features/processing/processing-actions";
import { formatBytes } from "@/features/workspace/query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { scrollToY } from "@/lib/lenis";
import { cn } from "@/lib/utils";
import { useAiFeature } from "@/stores/ai-store";
import { ACCEPT_ATTR, toIntakeFiles, useIntakeStore, type IntakeFile } from "@/stores/intake-store";
import { toast } from "@/stores/toast-store";

type Reply =
  | { kind: "text"; text: string; actions?: ("settings" | "transform")[]; datasetId?: string }
  | { kind: "files"; files: IntakeFile[] }
  | { kind: "command"; datasetId: string; datasetName: string; title: string; command: DatasetCommand; outcome: CommandOutcome };

type ChatMessage = { id: string; role: "user"; text: string; attachments: IntakeFile[] } | ({ id: string; role: "assistant" } & Reply);

const SUGGESTIONS = ["Show unvaccinated dogs in Muzon", "How many pets per barangay?", "Standardize the sex column", "Find duplicate owners", "Ilan ang aso at pusa?"];

const SCANNABLE = new Set(["png", "jpg", "webp", "pdf"]);

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

function AssistantMessage({ message }: { message: Extract<ChatMessage, { role: "assistant" }> }) {
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
            <p className="text-[15px] text-salin-text">{message.text}</p>
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
            <p className="text-[15px] text-salin-text">What should I do with {message.files.length === 1 ? "this file" : `these ${message.files.length} files`}? They'll be saved to your workspace first, unchanged.</p>
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
    <div className="flex gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-salin-primary text-white">
        <User className="size-[18px]" />
      </span>
      <div className="min-w-0 rounded-2xl rounded-tl-md bg-salin-tile px-4 py-3">
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);

  const list = datasets.status === "ready" ? datasets.datasets : [];
  const datasetId = chosen && list.some((d) => d.id === chosen) ? chosen : (list[0]?.id ?? null);

  useEffect(() => {
    if (messages.length || status) scrollToY(document.documentElement.scrollHeight);
  }, [messages, status]);
  useEffect(() => () => controller.current?.abort(), []);

  const reply = (r: Reply) => setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", ...r }]);
  const canSend = !status && (draft.trim() !== "" || attachments.length > 0);

  function resize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  async function answer(text: string) {
    const dataset = list.find((d) => d.id === datasetId);
    if (!dataset) return reply({ kind: "text", text: "There are no datasets yet. Extract a table from a file or read a scan first, then ask about it here." });
    if (!assistant.ready) {
      return reply({ kind: "text", text: `The on-device assistant isn't ready: ${assistant.reason} You can do the same with the Transform tools in the dataset — filter, sort, count by group, standardize values and more.`, actions: ["transform", "settings"], datasetId: dataset.id });
    }
    controller.current = new AbortController();
    setStatus("Starting the assistant…");
    try {
      const { rows } = await getDatasetWithRows(dataset.id);
      const result = await commandFromRequest(text, dataset.columns, rows, assistant.variant, {
        signal: controller.current.signal,
        onProgress: (p) => setStatus(p.stage === "loading" ? `Loading the assistant${p.fraction !== null ? ` ${Math.round(p.fraction * 100)}%` : ""}…` : "Thinking…"),
      });
      if (!result.ok) return reply({ kind: "text", text: result.message, actions: ["transform"], datasetId: dataset.id });
      reply({ kind: "command", datasetId: dataset.id, datasetName: dataset.name, title: describeCommand(result.command, dataset.columns), command: result.command, outcome: runCommand(result.command, { columns: dataset.columns, rows }) });
    } catch (error) {
      if (!controller.current?.signal.aborted) reply({ kind: "text", text: error instanceof AiError ? error.message : "The assistant couldn't answer. Try again, or use the Transform tools.", actions: ["transform"], datasetId: dataset.id });
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
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text, attachments: files }]);
    setDraft("");
    requestAnimationFrame(resize);
    if (files.length) reply({ kind: "files", files });
    else void answer(text);
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

  return (
    <PageFrame title="Ask Salin AI" description="Ask about your datasets in plain words — on this device, checked by you." className="flex min-h-[70vh] flex-col">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 flex-1 basis-60 gap-1 text-xs font-medium text-salin-muted">
          Dataset
          {list.length ? (
            <ChoiceMenu variant="field" label="Dataset" heading="Ask about" value={datasetId ?? ""} options={list.map((d) => ({ value: d.id, label: d.name, hint: `${d.rowCount.toLocaleString()} rows · ${d.columns.length} columns` }))} onChange={setChosen} />
          ) : (
            <span className="text-sm font-normal text-salin-muted">{datasets.status === "loading" ? "Loading…" : "No datasets yet."}</span>
          )}
        </label>
        <p className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold", assistant.ready ? "bg-salin-primary-soft text-salin-primary-ink" : "bg-salin-tile text-salin-muted")}>
          <Bot className="size-3.5" /> {assistant.ready ? "Assistant ready (on this device)" : "Assistant not set up"}
        </p>
      </div>

      <section aria-labelledby="try-asking" className="mt-5">
        <h2 id="try-asking" className="text-base font-semibold text-salin-text">Try asking</h2>
        <div className="no-scrollbar -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" data-lenis-prevent-horizontal="">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setDraft(s);
                requestAnimationFrame(() => (resize(), inputRef.current?.focus()));
              }}
              className="press shrink-0 rounded-xl bg-salin-tile px-3.5 py-2 text-left text-[13px] whitespace-nowrap text-salin-text hover:bg-salin-tile-hover sm:whitespace-normal"
            >
              “{s}”
            </button>
          ))}
        </div>
      </section>

      <div role="log" aria-live="polite" aria-label="Conversation" className="mt-6 flex flex-1 flex-col gap-6">
        {messages.length === 0 && !status && (
          <div className="my-auto flex flex-col items-center py-8 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
              <Bot className="size-7" />
            </span>
            <p className="mt-3 font-semibold text-salin-text">What should we do with your data?</p>
            <p className="mt-1 max-w-sm text-sm text-salin-muted">Pick a dataset and ask — or attach photos, PDFs or spreadsheets to turn them into data. Nothing changes without your OK.</p>
          </div>
        )}
        {messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} message={m} /> : <AssistantMessage key={m.id} message={m} />))}
        {status && <Thinking status={status} onStop={() => controller.current?.abort()} />}
      </div>

      {/* Composer — sticks above the mobile tab bar while the thread scrolls */}
      <div className="sticky bottom-[calc(var(--mobile-nav-h)+env(safe-area-inset-bottom)+40px)] z-20 mt-6 -mx-1 bg-salin-surface/90 px-1 pt-2 pb-1 backdrop-blur md:bottom-4">
        <form onSubmit={send} className="rounded-2xl bg-salin-surface p-2 shadow-[0_8px_28px_-14px_rgb(16_40_28/0.28)] ring-1 ring-salin-border focus-within:ring-2 focus-within:ring-salin-primary/50">
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
            <label htmlFor="ask-input" className="sr-only">
              Ask Salin AI
            </label>
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
              placeholder="Ask about this dataset…"
              data-lenis-prevent=""
              className="max-h-42 min-h-11 flex-1 resize-none bg-transparent px-1 py-[11px] text-[15px] text-salin-text outline-none placeholder:text-salin-subtle"
            />
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
        <ul className="no-scrollbar mt-2 flex gap-4 overflow-x-auto px-1 text-[11.5px] whitespace-nowrap text-salin-muted sm:justify-center">
          <li className="flex items-center gap-1.5">
            <Paperclip className="size-3.5" /> Attach PDF, JPG, PNG, XLSX, CSV
          </li>
          <li className="flex items-center gap-1.5">
            <Files className="size-3.5" /> Changes open in the dataset with a preview and Undo
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Runs on this device
          </li>
        </ul>
      </div>
    </PageFrame>
  );
}
