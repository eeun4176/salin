/**
 * Read Text Page (/scans/:documentId)
 * The OCR workflow for one scan, in two stages (no step counter — one line
 * under the name says what to do now):
 *   1. Read — every page is read on the device by itself (page edges found,
 *      a fitting template picked); options are tucked away.
 *   2. Check & save — say which columns you need, check each value against
 *      the page (fix, tap words on the page, or confirm), and save.
 * "Fix pages" (crop, rotate, clean up, add or reorder pages) is there when
 * a photo needs it. Everything is saved as you go, so a scan can be left
 * and resumed (it's listed under Datasets → Scans). The original files are
 * never changed.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowRight, Crop, LoaderCircle, Pencil, ScanText, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { NameDialog } from "@/components/common/name-dialog";
import { primaryButton, secondaryButton, StepFooter } from "@/components/common/step-footer";
import { PageFrame } from "@/components/layout/page-frame";
import { validateName } from "@/core/storage/names";
import { deleteOcrDocument, updateOcrDocument } from "@/core/storage/repositories/ocr.repository";
import { PrepareStep } from "@/features/ocr/components/prepare-step";
import { ReadStep } from "@/features/ocr/components/read-step";
import { ReviewStep } from "@/features/ocr/components/review-step";
import { SaveStep } from "@/features/ocr/components/save-step";
import { useScan } from "@/features/ocr/hooks/use-scan";
import { renameScan } from "@/features/ocr/ocr-actions";
import { useOcrStore } from "@/stores/ocr-store";
import { toast } from "@/stores/toast-store";
import type { OcrStage } from "@/types/ocr";

const HINT: Record<number, string> = {
  1: "e-Vet reads the pages on this device, then you check what it found.",
  2: "Check each value against the page, then save it as a dataset.",
};

const STEP_OF: Record<OcrStage, number> = { prepare: 1, read: 1, review: 2, done: 2 };

export function ScanWorkflowPage() {
  const { documentId = "" } = useParams();
  const scan = useScan(documentId);
  const [step, setStep] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [fixingPages, setFixingPages] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = useOcrStore((s) => s.refresh);
  const navigate = useNavigate();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const frame = { title: "Read text", back: { to: "/datasets", label: "Datasets" } };

  if (scan.status !== "ready") {
    return (
      <PageFrame {...frame}>
        {scan.status === "loading" ? (
          <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-salin-muted">
            <LoaderCircle className="size-5 animate-spin" /> Opening scan…
          </p>
        ) : (
          <div role="alert" className="py-14 text-center">
            <p className="font-semibold text-salin-text">This scan no longer exists</p>
            <p className="mt-1 text-sm text-salin-muted">It may have been deleted. Your original files are still in the workspace.</p>
            <Link to="/" className="mt-4 inline-block text-sm font-semibold text-salin-primary hover:underline">
              Back to workspace
            </Link>
          </div>
        )}
      </PageFrame>
    );
  }

  const { doc, pages } = scan;
  const current = step ?? STEP_OF[doc.stage];
  const go = (n: number) => {
    setStep(n);
    setFixingPages(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toReview = () => {
    void updateOcrDocument(doc.id, { stage: "review" }).catch(() => undefined);
    go(2);
  };
  const fixPages = () => {
    setFixingPages(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <PageFrame {...frame} description="Turn photos and scanned PDFs into data — read on this device, checked by you.">
      <div className="flex min-w-0 items-center justify-center gap-2">
        <ScanText aria-hidden="true" className="size-6 shrink-0 text-salin-primary" />
        <h2 className="truncate text-lg font-semibold text-salin-text">{doc.name}</h2>
        <button type="button" aria-label="Rename scan" onClick={() => setRenaming(true)} className="grid size-8 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text">
          <Pencil className="size-4" />
        </button>
        <button type="button" aria-label="Delete scan" onClick={() => setDeleting(true)} className="grid size-8 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-400/15">
          <Trash2 className="size-4" />
        </button>
      </div>
      <p className="mt-1 text-center text-sm text-salin-muted">{fixingPages ? "Crop, rotate or reorder pages, then read them again." : HINT[current]}</p>

      <div className="mt-5 border-t border-salin-border pt-6">
        {fixingPages ? (
          <>
            <PrepareStep doc={doc} pages={pages} selected={selectedPage} onSelect={setSelectedPage} />
            <StepFooter message={<span className="text-salin-muted">{pages.length} page{pages.length === 1 ? "" : "s"} · edits are saved automatically — read again to use them</span>}>
              <button type="button" onClick={() => go(1)} className={primaryButton}>
                Done <ArrowRight className="size-4" />
              </button>
            </StepFooter>
          </>
        ) : current === 1 ? (
          <>
            <ReadStep doc={doc} pages={pages} onDone={toReview} />
            <StepFooter>
              <button type="button" onClick={fixPages} className={secondaryButton}>
                <Crop className="size-4" /> Fix pages
              </button>
              {/* Until something is read, the step's own Read button is the way forward. */}
              {doc.extraction && (
                <button type="button" onClick={toReview} className={primaryButton}>
                  Next: check & save <ArrowRight className="size-4" />
                </button>
              )}
            </StepFooter>
          </>
        ) : doc.stage === "done" && doc.datasetIds.length ? (
          <SaveStep
            doc={doc}
            onBack={() => {
              // Reviewing a saved scan again: saving makes new datasets; the old ones stay.
              void updateOcrDocument(doc.id, { stage: "review" }).catch(() => undefined);
              go(2);
            }}
          />
        ) : doc.extraction ? (
          // A freshly mapped extraction (not just an edit) starts the review over.
          <ReviewStep key={doc.extraction.id ?? doc.id} doc={doc} pages={pages} onBack={() => go(1)} onFixPages={fixPages} />
        ) : (
          <p className="py-10 text-center text-sm text-salin-muted">Read the pages first (step 1), or choose to type the values yourself.</p>
        )}
      </div>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename scan"
        initialValue={doc.name}
        confirmLabel="Rename"
        validate={(name) => validateName(name, [])}
        onSubmit={async (name) => {
          await renameScan(doc.id, name);
          setRenaming(false);
        }}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the scan “${doc.name}”?`}
        description="Its page edits and review are deleted. The original photos or PDFs and any datasets made from it stay."
        confirmLabel="Delete scan"
        destructive
        onConfirm={async () => {
          await deleteOcrDocument(doc.id);
          toast("Scan deleted. Your original files are still in the workspace.");
          navigate("/datasets");
        }}
      />
    </PageFrame>
  );
}
