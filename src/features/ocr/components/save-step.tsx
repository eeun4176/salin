/**
 * Save Step
 * Shown for a scan that has been saved: links straight to its datasets,
 * and "Review again" to check the scan once more and save a new version
 * (the datasets already made stay as they are). Saving itself happens from
 * the Check & save step.
 */

import { Link } from "react-router";
import { CircleCheck, Table2 } from "lucide-react";

import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { datasetUrl } from "@/features/processing/hooks/use-document-processing";
import type { OcrDocument } from "@/types/ocr";

export function SaveStep({ doc, onBack }: { doc: OcrDocument; onBack: () => void }) {
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
