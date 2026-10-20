/**
 * Template Hint
 * After pages are read, suggests the template that fits them best ("This
 * looks like a Pet registration form — 9 of 13 fields found") with a button
 * to use it. Switching maps the pages again; if the reviewer already made
 * corrections, they're asked to confirm first. Found by matching printed
 * labels and table headings — no language model needed.
 */

import { useEffect, useState } from "react";
import { Lightbulb } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { reviewItems } from "@/core/ocr/review/review-state";
import type { TemplateMatch } from "@/core/ocr/templates/template-suggest";
import { switchTemplate, templateSuggestion } from "@/features/ocr/ocr-actions";
import type { OcrDocument, OcrPage } from "@/types/ocr";

export function TemplateHint({ doc, pages }: { doc: OcrDocument; pages: OcrPage[] }) {
  const [match, setMatch] = useState<TemplateMatch | null>(null);
  const [confirming, setConfirming] = useState(false);
  const readCount = pages.filter((p) => p.result).length;

  useEffect(() => {
    let active = true;
    void templateSuggestion(doc, pages).then((m) => active && setMatch(m), () => undefined);
    return () => {
      active = false;
    };
    // Re-check when pages are read or the template changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, doc.templateId, readCount]);

  if (!match) return null;
  const corrected = doc.extraction ? reviewItems(doc.extraction).some((i) => i.value.edited || i.value.confirmed) : false;
  const use = () => (corrected ? setConfirming(true) : void switchTemplate(doc, pages, match.template.id));
  return (
    <div role="note" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:bg-sky-400/10 dark:text-sky-200">
      <Lightbulb aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        This looks like a <span className="font-semibold">{match.template.name}</span> — {match.found} of {match.total} {match.template.kind === "form" ? "fields" : "columns"} found.
      </span>
      <button type="button" onClick={use} className="press h-8 rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white hover:bg-sky-800">
        Use this template
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Use the ${match.template.name.toLowerCase()} template?`}
        description="The pages will be matched to it again. Values you corrected or checked in Review will be replaced."
        confirmLabel="Use template"
        onConfirm={() => switchTemplate(doc, pages, match.template.id)}
      />
    </div>
  );
}
