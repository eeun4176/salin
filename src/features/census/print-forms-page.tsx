/**
 * Print Census Forms (/census/print)
 * Prints blank CVO-CENSUS v1 working sheets for one barangay and census
 * date: the barangay, date and a running sheet number are printed (and
 * encoded in each sheet's code strip), so the paravet never writes them by
 * hand. Continuation sheets carry pets 4–6 of an owner. Prints at true size
 * on long bond paper (8.5 × 13 in); "Save as PDF" in the print dialog makes
 * a PDF instead.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { primaryButton } from "@/components/common/step-footer";
import { PageFrame } from "@/components/layout/page-frame";
import { BARANGAYS } from "@/core/census/barangays";
import { FORM_VERSION, MAX_SHEET_NUMBER, type SheetCode } from "@/core/census/code-strip";
import { CensusSheet } from "@/features/census/components/census-sheet";
import { cn } from "@/lib/utils";

const MAX_COPIES = 50;
const today = () => new Date().toLocaleDateString("en-CA");
const field = "h-10 w-full rounded-xl border border-salin-border bg-salin-surface px-3 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/15";

// Only the sheets are printed, at true size, one per page.
const PRINT_CSS = `
@media print {
  @page { size: 216mm 330mm; margin: 0; }
  body > *:not(.census-print) { display: none !important; }
  .census-print { display: block !important; }
  .census-print svg { display: block; width: 216mm; height: 330mm; break-after: page; }
}
@media screen { .census-print { display: none; } }
`;

export function PrintFormsPage() {
  const [barangay, setBarangay] = useState("0");
  const [date, setDate] = useState(today);
  const [firstSheet, setFirstSheet] = useState(1);
  const [copies, setCopies] = useState(10);
  const [continuation, setContinuation] = useState(false);

  const lastSheet = firstSheet + copies - 1;
  const error =
    !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2024-01-01"
      ? "Pick the census date."
      : !Number.isInteger(firstSheet) || firstSheet < 1
        ? "Sheet numbers start at 1."
        : !Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES
          ? `Print 1 to ${MAX_COPIES} sheets at a time.`
          : lastSheet > MAX_SHEET_NUMBER
            ? `Sheet numbers go up to ${MAX_SHEET_NUMBER}.`
            : null;
  const codes: SheetCode[] = error ? [] : Array.from({ length: copies }, (_, i) => ({ version: FORM_VERSION, continuation, barangay: Number(barangay), censusDate: date, sheetNumber: firstSheet + i }));

  return (
    <PageFrame title="Print census forms" description="Barangay, date and sheet number are printed on every sheet — paravets only fill in the owner and pets." back={{ to: "/census", label: "Census" }}>
      <style>{PRINT_CSS}</style>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!error) window.print();
          }}
        >
          <div className="grid gap-1.5">
            <span id="barangay-label" className="text-sm font-medium text-salin-text">
              Barangay
            </span>
            <ChoiceMenu
              variant="field"
              label="Barangay"
              heading="Barangay"
              value={barangay}
              onChange={setBarangay}
              options={BARANGAYS.map((b, i) => ({ value: String(i), label: b.name, hint: `District ${b.district}` }))}
            />
          </div>
          <label className="grid gap-1.5 text-sm font-medium text-salin-text">
            Date of census
            <input type="date" required min="2024-01-01" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm font-medium text-salin-text">
              First sheet no.
              <input type="number" min={1} max={MAX_SHEET_NUMBER} value={firstSheet} onChange={(e) => setFirstSheet(e.target.valueAsNumber)} className={field} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-salin-text">
              How many
              <input type="number" min={1} max={MAX_COPIES} value={copies} onChange={(e) => setCopies(e.target.valueAsNumber)} className={field} />
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium text-salin-text">Kind of sheet</legend>
            {[
              { value: false, label: "Main sheets", hint: "One owner and up to 3 pets." },
              { value: true, label: "Continuation sheets", hint: "Pets 4–6 of an owner already on a main sheet." },
            ].map((option) => (
              <label key={option.label} className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl p-3 ring-1", continuation === option.value ? "ring-salin-primary" : "ring-salin-border")}>
                <input type="radio" name="kind" checked={continuation === option.value} onChange={() => setContinuation(option.value)} className="mt-0.5 size-4 accent-salin-primary" />
                <span>
                  <span className="block text-sm font-medium text-salin-text">{option.label}</span>
                  <span className="block text-xs text-salin-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <p className="text-sm text-salin-muted">
              Sheets {firstSheet}–{lastSheet}. Print on long bond (8.5 × 13 in) at 100% scale — don't “fit to page”. Keep a note of the last sheet number for next time.
            </p>
          )}
          <button type="submit" disabled={Boolean(error)} className={cn(primaryButton, "w-full disabled:opacity-50")}>
            <Printer className="size-4" /> Print {error ? "" : `${copies} sheet${copies === 1 ? "" : "s"}`}
          </button>
        </form>

        <div className="min-w-0">
          <p className="mb-2 text-sm font-medium text-salin-text">Preview of sheet {error ? "" : firstSheet}</p>
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-salin-border">{codes[0] && <CensusSheet code={codes[0]} className="h-auto w-full" />}</div>
        </div>
      </div>

      {createPortal(
        <div className="census-print">
          {codes.map((code) => (
            <CensusSheet key={code.sheetNumber} code={code} />
          ))}
        </div>,
        document.body,
      )}
    </PageFrame>
  );
}
