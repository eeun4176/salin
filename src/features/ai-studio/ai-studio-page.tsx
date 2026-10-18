/**
 * Ask Salin AI Page (/ai-studio)
 * Chat-style screen: suggested prompts, attachments from Scan/Import or the
 * paperclip, sample replies with result tables and CSV export.
 */

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import {
  Bot,
  Copy,
  Download,
  FileSpreadsheet,
  Files,
  Info,
  Mic,
  Paperclip,
  SendHorizontal,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  User,
  X,
} from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { FileTypeIcon } from "@/components/brand/file-type-icon";
import { downloadTableCsv, draftReply, tableAsText, type AssistantReply, type ExtractedTable } from "@/features/ai-studio/mock-assistant";
import { formatBytes } from "@/features/workspace/query";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { scrollToY } from "@/lib/lenis";
import { ACCEPT_ATTR, toIntakeFiles, useIntakeStore, type IntakeFile } from "@/stores/intake-store";
import { toast } from "@/stores/toast-store";
import { cn } from "@/lib/utils";

type ChatMessage =
  | { id: string; role: "user"; text: string; attachments: IntakeFile[] }
  | ({ id: string; role: "assistant" } & AssistantReply);

/** Simulated "thinking" time for the placeholder assistant. */
const replyDelay = () => 900 + Math.random() * 600;

const SUGGESTIONS = [
  "Extract the names, dates, and amounts from this file.",
  "Convert this document to a table.",
  "Summarize this report.",
  "Organize these files by type.",
];

function AttachmentChip({ file, onRemove }: { file: IntakeFile; onRemove?: () => void }) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-2.5 rounded-xl bg-white py-1.5 pr-1.5 pl-1.5 ring-1 ring-salin-border">
      {file.previewUrl ? (
        <img src={file.previewUrl} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <FileTypeIcon kind={file.kind} showLabel={false} className="size-9" />
      )}
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

function ResultTable({ table }: { table: ExtractedTable }) {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-white ring-1 ring-salin-border">
      <div className="flex items-center justify-between gap-3 border-b border-salin-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-salin-text">
          <FileSpreadsheet className="size-[18px] text-salin-primary" /> {table.title}
        </p>
        <button
          type="button"
          onClick={() => downloadTableCsv(table)}
          className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile"
        >
          <Download className="size-4" /> <span className="hidden sm:inline">Export to Excel</span>
          <span className="sm:hidden">Export</span>
        </button>
      </div>
      <div className="overflow-x-auto" data-lenis-prevent-horizontal="">
        <table className="w-full min-w-[26rem] text-left text-[13px]">
          <thead className="bg-salin-canvas text-salin-muted">
            <tr>
              {table.columns.map((c) => (
                <th key={c} scope="col" className="px-4 py-2 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-salin-border">
            {table.rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i} className={cn("px-4 py-2 text-salin-text", i === row.length - 1 && "tabular-nums")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {table.total && (
              <tr className="bg-salin-canvas font-semibold">
                {table.total.map((cell, i) => (
                  <td key={i} className="px-4 py-2 text-salin-text tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Extract<ChatMessage, { role: "assistant" }> }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);

  async function copy() {
    const parts = [message.text, message.table && tableAsText(message.table), ...(message.bullets ?? [])].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      toast("Copied to clipboard.");
    } catch {
      toast("Couldn't copy — your browser blocked clipboard access.");
    }
  }

  const iconBtn = "grid size-8 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text aria-pressed:text-salin-primary";

  return (
    <div className="flex gap-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-salin-primary-soft text-salin-primary">
        <Bot className="size-5" />
      </span>
      <div className="min-w-0 flex-1 pt-1.5">
        <p className="sr-only">Salin AI said:</p>
        <p className="text-[15px] text-salin-text">{message.text}</p>
        {message.table && <ResultTable table={message.table} />}
        {message.bullets && (
          <ul className="mt-2 space-y-1.5 text-sm text-salin-text">
            {message.bullets.map((b) => (
              <li key={b} className="flex gap-2">
                <span aria-hidden="true" className="mt-[7px] size-1.5 shrink-0 rounded-full bg-salin-primary" />
                {b}
              </li>
            ))}
          </ul>
        )}
        {message.footnote && <p className="mt-3 text-[13px] text-salin-muted">{message.footnote}</p>}
        <div className="mt-2 flex justify-end gap-0.5">
          <button type="button" aria-label="Good response" aria-pressed={rating === "up"} onClick={() => setRating((r) => (r === "up" ? null : "up"))} className={iconBtn}>
            <ThumbsUp className="size-4" />
          </button>
          <button type="button" aria-label="Bad response" aria-pressed={rating === "down"} onClick={() => setRating((r) => (r === "down" ? null : "down"))} className={iconBtn}>
            <ThumbsDown className="size-4" />
          </button>
          <button type="button" aria-label="Copy response" onClick={copy} className={iconBtn}>
            <Copy className="size-4" />
          </button>
        </div>
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
        <p className="text-[15px] whitespace-pre-wrap text-salin-text">{message.text}</p>
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

function TypingIndicator() {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center gap-3" role="status" aria-label="Salin AI is responding">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-salin-primary-soft text-salin-primary">
        <Bot className="size-5" />
      </span>
      <span className="flex gap-1 rounded-full bg-salin-tile px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("size-1.5 rounded-full bg-salin-muted", !reduced && "animate-typing")} style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
    </div>
  );
}

export function AiStudioPage() {
  const attachments = useIntakeStore((s) => s.attachments);
  const attach = useIntakeStore((s) => s.attach);
  const detach = useIntakeStore((s) => s.detach);
  const takeAttachments = useIntakeStore((s) => s.takeAttachments);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
    if (messages.length) scrollToY(document.documentElement.scrollHeight);
  }, [messages]);

  useEffect(() => {
    if (thinking) scrollToY(document.documentElement.scrollHeight);
  }, [thinking]);

  // Clean up pending replies and sent previews when leaving the page.
  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      messagesRef.current.forEach((m) => m.role === "user" && m.attachments.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl)));
    },
    [],
  );

  const canSend = !thinking && (draft.trim() !== "" || attachments.length > 0);

  function resize() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }

  function send(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend) return;
    const files = takeAttachments();
    const text = draft.trim() || "Extract the data from this file.";
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text, attachments: files }]);
    setDraft("");
    requestAnimationFrame(resize);
    setThinking(true);
    const timer = window.setTimeout(() => {
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: "assistant", ...draftReply(text, files) }]);
      setThinking(false);
    }, replyDelay());
    timers.current.push(timer);
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

  function applySuggestion(text: string) {
    setDraft(text);
    requestAnimationFrame(() => {
      resize();
      inputRef.current?.focus();
    });
  }

  return (
    <PageFrame
      title="Ask Salin AI"
      description="Ask about scanned pages or imported files — extract fields, build tables, organize."
      className="flex min-h-[70vh] flex-col"
    >
      <div className="flex items-start gap-2.5 rounded-2xl bg-salin-primary-soft/70 px-4 py-3 text-[13px] text-[#0B5A33]">
        <Info className="mt-px size-4 shrink-0" />
        <p>
          <span className="font-semibold">Phase 1 preview.</span> Replies use sample data so you can try the flow. On-device extraction arrives in Phase 4, and
          nothing you attach leaves this device.
        </p>
      </div>

      <section aria-labelledby="try-asking" className="mt-5">
        <h2 id="try-asking" className="text-base font-semibold text-salin-text">Try asking</h2>
        <div className="no-scrollbar -mx-4 mt-2.5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" data-lenis-prevent-horizontal="">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => applySuggestion(s)}
              className="press shrink-0 rounded-xl bg-salin-tile px-3.5 py-2 text-left text-[13px] whitespace-nowrap text-salin-text hover:bg-salin-tile-hover sm:whitespace-normal"
            >
              “{s}”
            </button>
          ))}
        </div>
      </section>

      <div role="log" aria-live="polite" aria-label="Conversation" className="mt-6 flex flex-1 flex-col gap-6">
        {messages.length === 0 && !thinking && (
          <div className="my-auto flex flex-col items-center py-8 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-salin-primary-soft text-salin-primary">
              <Bot className="size-7" />
            </span>
            <p className="mt-3 font-semibold text-salin-text">What should we do with your documents?</p>
            <p className="mt-1 max-w-sm text-sm text-salin-muted">Attach a scan, PDF or spreadsheet, then ask in plain language.</p>
          </div>
        )}
        {messages.map((m) => (m.role === "user" ? <UserMessage key={m.id} message={m} /> : <AssistantMessage key={m.id} message={m} />))}
        {thinking && <TypingIndicator />}
      </div>

      {/* Composer — sticks above the mobile tab bar while the thread scrolls */}
      <div className="sticky bottom-[calc(var(--mobile-nav-h)+env(safe-area-inset-bottom)+40px)] z-20 mt-6 -mx-1 bg-white/90 px-1 pt-2 pb-1 backdrop-blur md:bottom-4">
        <form onSubmit={send} className="rounded-2xl bg-white p-2 shadow-[0_8px_28px_-14px_rgb(16_40_28/0.28)] ring-1 ring-salin-border focus-within:ring-2 focus-within:ring-salin-primary/50">
          <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onPick} />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1 pt-1 pb-2">
              {attachments.map((f) => (
                <AttachmentChip key={f.id} file={f} onRemove={() => detach(f.id)} />
              ))}
            </div>
          )}

          <div className="flex items-end gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Attach files"
              className="grid size-11 shrink-0 place-items-center rounded-xl text-salin-muted hover:bg-salin-tile hover:text-salin-text"
            >
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
              placeholder="Ask SALIN AI anything..."
              data-lenis-prevent=""
              className="max-h-42 min-h-11 flex-1 resize-none bg-transparent px-1 py-[11px] text-[15px] text-salin-text outline-none placeholder:text-salin-subtle"
            />
            <button
              type="button"
              disabled
              aria-label="Voice input (coming in a later phase)"
              title="Voice input comes in a later phase"
              className="hidden size-11 shrink-0 place-items-center rounded-full bg-salin-tile text-salin-muted disabled:opacity-60 sm:grid"
            >
              <Mic className="size-5" />
            </button>
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              className="press grid size-11 shrink-0 place-items-center rounded-full bg-salin-primary text-white shadow-[0_6px_14px_-6px_rgb(1_168_90/0.7)] hover:bg-[#019A53] disabled:bg-salin-tile disabled:text-salin-subtle disabled:shadow-none"
            >
              <SendHorizontal className="size-5" />
            </button>
          </div>
        </form>

        <ul className="no-scrollbar mt-2 flex gap-4 overflow-x-auto px-1 text-[11.5px] whitespace-nowrap text-salin-muted sm:justify-center">
          <li className="flex items-center gap-1.5">
            <Paperclip className="size-3.5" /> Upload files (PDF, JPG, PNG, XLSX, CSV)
          </li>
          <li className="flex items-center gap-1.5">
            <Files className="size-3.5" /> Supports multiple files
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" /> Your data stays on your device
          </li>
        </ul>
      </div>
    </PageFrame>
  );
}
