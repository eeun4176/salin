/**
 * Review Assist
 * The suggestion side of the Review step. A Suggestions list shows every
 * pending suggestion — from rules, the handwriting reader or the on-device
 * assistant — as before → after with the reason, a close-up of the page
 * region, and Use / Edit / Dismiss; suggestions not found on the page are
 * marked and need an extra confirmation. The AI tools bar runs the optional
 * models (Read handwriting, Check with assistant, Find fields) with
 * progress and Cancel, or explains how to turn them on. Nothing is applied
 * without the reviewer's choice.
 */

import { useState } from "react";
import { Link } from "react-router";
import { Bot, Check, PenLine, Search, Sparkles, X } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { NameDialog } from "@/components/common/name-dialog";
import { acceptSuggestion, pendingSuggestions, refLabel, rejectSuggestion } from "@/core/ai/suggestions";
import { reviewItems, refKey } from "@/core/ocr/review/review-state";
import { findFields, handwritingTargets, readHandwriting, suggestCorrections, suggestMappings } from "@/features/ai/ai-actions";
import { RegionCrop } from "@/features/ocr/components/review-parts";
import { useAiRun } from "@/features/ai/use-ai-run";
import { useAiFeature, useAiMode } from "@/stores/ai-store";
import { cn } from "@/lib/utils";
import type { Box, Extraction, OcrPage, Suggestion, SuggestionSource } from "@/types/ocr";

const SOURCE_LABEL: Record<SuggestionSource, string> = {
  rule: "Rule",
  handwriting: "Handwriting",
  ai: "Assistant",
};

const SOURCE_TONE: Record<SuggestionSource, string> = {
  rule: "bg-salin-tile text-salin-text",
  handwriting: "bg-sky-50 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200",
  ai: "bg-violet-50 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200",
};

export function SourceBadge({ source }: { source: SuggestionSource }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", SOURCE_TONE[source])}>{SOURCE_LABEL[source]}</span>;
}

const small = "press inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ring-1";

type PageImage = { src: string | null; width: number; height: number } | null;

interface SuggestionCardProps {
  suggestion: Suggestion;
  label: string;
  /** The value's region on the page (for the close-up). */
  box: Box | null;
  pageImage: PageImage;
  compact?: boolean;
  onSelect?: () => void;
  onAccept: (edited?: string) => void;
  onReject: () => void;
}

export function SuggestionCard({ suggestion: s, label, box, pageImage, compact, onSelect, onAccept, onReject }: SuggestionCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const use = () => (s.grounded ? onAccept() : setConfirming(true));
  return (
    <div
      role="group"
      aria-label={`Suggestion for ${label}`}
      onClick={onSelect}
      className={cn("rounded-xl p-3 ring-1", s.grounded ? "ring-salin-border" : "bg-red-50/50 ring-red-300 dark:bg-red-400/5 dark:ring-red-400/40", compact && "p-2.5")}
    >
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-salin-text">{label}</span>
          <SourceBadge source={s.source} />
        </div>
      )}
      <p className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm", !compact && "mt-1.5")}>
        {compact && <Sparkles aria-hidden="true" className="size-3.5 shrink-0 self-center text-violet-600" />}
        {s.before.trim() ? (
          <span className="text-salin-muted line-through decoration-salin-subtle" aria-label={`Now: ${s.before}`}>
            {s.before}
          </span>
        ) : (
          <span className="text-salin-muted">(empty)</span>
        )}
        <span aria-hidden="true" className="text-salin-subtle">
          →
        </span>
        <span className="font-semibold text-salin-text" aria-label={`Suggested: ${s.after}`}>
          {s.after}
        </span>
        {compact && <SourceBadge source={s.source} />}
      </p>
      {!s.grounded && <p className="mt-1 text-xs font-semibold text-red-700 dark:text-red-300">Not found on page</p>}
      <p className="mt-1 text-xs text-salin-muted">{s.reason}</p>
      {!compact && box && pageImage && (
        <div className="mt-2">
          <RegionCrop src={pageImage.src} page={pageImage} box={box} maxWidth={260} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            use();
          }}
          className={cn(small, "bg-salin-primary-soft text-salin-primary-ink ring-salin-primary/40 hover:bg-salin-primary-soft/70")}
        >
          <Check className="size-3.5" /> Use
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className={cn(small, "text-salin-text ring-salin-border hover:bg-salin-tile")}
        >
          <PenLine className="size-3.5" /> Edit
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onReject();
          }}
          className={cn(small, "text-salin-text ring-salin-border hover:bg-salin-tile")}
        >
          <X className="size-3.5" /> Dismiss
        </button>
      </div>
      <NameDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit the value for ${label}`}
        description={s.before.trim() ? `Text recognition read “${s.before}”. Type what's on the page.` : "Type what's on the page."}
        initialValue={s.after}
        confirmLabel="Use this value"
        validate={() => null}
        onSubmit={(text) => {
          setEditing(false);
          onAccept(text.trim());
        }}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Use a value that isn't on the page?"
        description={`“${s.after}” wasn't found in the text read from the page. Only use it if you can see it on the paper — it will be saved as a suggestion you approved, with what was read kept beside it.`}
        confirmLabel="Use it anyway"
        onConfirm={() => onAccept()}
      />
    </div>
  );
}

interface SuggestionsPanelProps {
  extraction: Extraction;
  pageImage: (page: number | null) => PageImage;
  onChange: (update: (current: Extraction) => Extraction) => void;
  onSelect: (key: string) => void;
}

/** Every pending suggestion, with bulk acceptance of rule-based standard forms. */
export function SuggestionsPanel({ extraction, pageImage, onChange, onSelect }: SuggestionsPanelProps) {
  const pending = pendingSuggestions(extraction);
  if (pending.length === 0) return null;
  const values = new Map(reviewItems(extraction).map((i) => [refKey(i.ref), i.value]));
  const rules = pending.filter((s) => s.source === "rule" && s.grounded && s.kind !== "move");
  return (
    <section aria-labelledby="suggestions-heading" className="rounded-2xl bg-violet-50/40 p-3 ring-1 ring-violet-200 dark:bg-violet-400/5 dark:ring-violet-400/25">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="suggestions-heading" className="flex items-center gap-1.5 text-sm font-semibold text-salin-text">
          <Sparkles aria-hidden="true" className="size-4 text-violet-600" /> Suggestions <span className="font-normal text-salin-muted">({pending.length})</span>
        </h3>
        {rules.length > 1 && (
          <button
            type="button"
            onClick={() => onChange((x) => rules.reduce((acc, s) => acceptSuggestion(acc, s.id), x))}
            className={cn(small, "text-salin-text ring-salin-border hover:bg-salin-tile")}
          >
            <Check className="size-3.5" /> Use all {rules.length} rule suggestions
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-salin-muted">Nothing changes until you choose Use. What was read stays on record either way. Suggestions also show beside each field.</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-semibold text-salin-primary">Review all {pending.length} with close-ups</summary>
        <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1" data-lenis-prevent="">
          {pending.map((s) => {
            const value = values.get(refKey(s.ref));
            const page = s.page ?? value?.page ?? null;
            return (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                label={refLabel(extraction, s.ref)}
                box={s.box ?? value?.box ?? null}
                pageImage={pageImage(page)}
                onSelect={() => onSelect(refKey(s.ref))}
                onAccept={(edited) => onChange((x) => acceptSuggestion(x, s.id, edited))}
                onReject={() => onChange((x) => rejectSuggestion(x, s.id))}
              />
            );
          })}
        </div>
      </details>
    </section>
  );
}

const toolButton =
  "press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

interface AiToolsProps {
  extraction: Extraction;
  pages: OcrPage[];
  generic: boolean;
  onResult: (apply: (current: Extraction) => Extraction) => void;
}

/** Runs the optional on-device models over the scan; results arrive as suggestions. */
export function AiTools({ extraction, pages, generic, onResult }: AiToolsProps) {
  const { mode } = useAiMode();
  const handwriting = useAiFeature("handwriting");
  const assistant = useAiFeature("assistant");
  const { busy, run, status } = useAiRun(onResult);
  const targets = handwritingTargets(extraction).length;

  if (mode === "standard") {
    return (
      <p className="flex items-start gap-2 rounded-xl bg-salin-tile px-3 py-2 text-xs text-salin-muted">
        <Bot aria-hidden="true" className="mt-px size-4 shrink-0" />
        <span>
          Handwritten values? Optional on-device AI can read them and suggest fixes.{" "}
          <Link to="/settings#ai-heading" className="font-semibold text-salin-primary hover:underline">
            Set it up in Settings
          </Link>
        </span>
      </p>
    );
  }

  return (
    <div aria-label="AI tools" role="group" className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !handwriting.ready || targets === 0}
          title={handwriting.reason ?? (targets === 0 ? "No hard-to-read or empty boxes left to read." : undefined)}
          onClick={() => void run("Reading handwriting", (o) => readHandwriting(extraction, pages, o))}
          className={toolButton}
        >
          <PenLine className="size-4" /> Read handwriting
          {targets ? ` (${targets})` : ""}
        </button>
        {mode === "advanced" && (
          <>
            <button
              type="button"
              disabled={busy || !assistant.ready}
              title={assistant.reason ?? undefined}
              onClick={() =>
                void run("Checking with the assistant", async (o) => {
                  const fixes = await suggestCorrections(extraction, assistant.variant, o);
                  const mapped = generic ? null : await suggestMappings(extraction, pages, assistant.variant, o);
                  return {
                    apply: (x) => (mapped ? mapped.apply(fixes.apply(x)) : fixes.apply(x)),
                    offered: fixes.offered + (mapped?.offered ?? 0),
                  };
                })
              }
              className={toolButton}
            >
              <Bot className="size-4" /> Check with assistant
            </button>
            {/* Generic scans ask for their columns in the "What do you need?" bar instead. */}
            {!generic && (
              <button
                type="button"
                disabled={busy || !assistant.ready || extraction.forms.length === 0}
                title={assistant.reason ?? (extraction.forms.length === 0 ? "Finding fields works on form pages." : undefined)}
                onClick={() => void run("Finding missing fields", (o) => findFields(extraction, pages, null, assistant.variant, o))}
                className={toolButton}
              >
                <Search className="size-4" /> Find missing fields
              </button>
            )}
          </>
        )}
      </div>
      {status ||
        ((!handwriting.ready || (mode === "advanced" && !assistant.ready)) && (
          <p className="text-xs text-salin-muted">
            {(!handwriting.ready ? handwriting.reason : assistant.reason) ?? ""}{" "}
            <Link to="/settings#ai-heading" className="font-semibold text-salin-primary hover:underline">
              Open Settings
            </Link>
          </p>
        ))}
    </div>
  );
}
