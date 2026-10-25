/**
 * Stubs (the Stubs tab of /programs)
 * The stubs City Vet sent the barangay to print: one per requested owner,
 * with the services they asked for ticked and a blank line where the owner
 * writes their name. Paravets print them here (two columns of 90 × 40 mm
 * slips on A4, QR on the right), then type each written name into the
 * spreadsheet-style list — it suggests owners already known, and the names
 * go to City Vet through the outbox. Blank stubs (no requested owner) are
 * filled in on program day.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Clock, Printer, Ticket } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { PROCESS_LABEL } from "@/core/programs/program-requests";
import { confirmOwner, markPrinted, type PrintStub, type StubSheet } from "@/core/programs/stubs";
import { OwnerNameInput } from "@/features/programs/owner-name-input";
import { programWhen } from "@/features/programs/program-format";
import { SavedCopy } from "@/features/programs/requests-page";
import { useOwnerSuggestions } from "@/features/programs/use-owner-suggestions";
import { useStubs } from "@/features/programs/use-stubs";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { queueChange } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";
import type { OutboxItem } from "@/types/sync";

export function StubsTab() {
  const state = useStubs();
  const known = useOwnerSuggestions();
  const [printing, setPrinting] = useState<StubSheet | null>(null);
  const stopPrinting = useCallback(() => setPrinting(null), []);
  const sheets = state.data?.sheets ?? [];

  if (state.status === "loading") {
    return (
      <LoadingSkeleton label="Loading your stubs" />
    );
  }
  if (state.status === "unavailable") return <p className="py-14 text-center text-sm text-salin-muted">Connect to the internet once to load your barangay's stubs.</p>;

  return (
    <>
      {state.fromDevice && state.savedAt && <SavedCopy at={state.savedAt} />}
      {!sheets.length ? (
        <div className="py-14 text-center">
          <Ticket aria-hidden="true" className="mx-auto size-6 text-salin-muted" />
          <p className="mt-3 font-semibold text-salin-text">No stubs yet</p>
          <p className="mt-1 text-sm text-salin-muted">When City Vet approves your request and sends the stubs, they appear here to print.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {sheets.map((sheet) => (
            <StubSheetCard key={sheet.batch.id} sheet={sheet} pending={state.pending} known={known} onPrint={() => setPrinting(sheet)} />
          ))}
        </div>
      )}
      {printing && <PrintStubs sheet={printing} onDone={stopPrinting} />}
    </>
  );
}

function StubSheetCard({ sheet, pending, known, onPrint }: { sheet: StubSheet; pending: OutboxItem[]; known: ReturnType<typeof useOwnerSuggestions>; onPrint: () => void }) {
  const online = useOnline();
  const printedPending = pending.some((item) => item.body.action === "confirm-print" && item.body.batchId === sheet.batch.id);
  const named = sheet.stubs.filter((stub) => stub.status === "Issued");
  return (
    <section aria-label={`Stubs ${sheet.batch.reference}`} className="space-y-3">
      <div className="rounded-2xl bg-salin-tile p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-salin-muted">{sheet.batch.reference}</p>
          <span className="text-xs font-semibold text-salin-muted">{sheet.batch.status === "Approved" && !printedPending ? "Not printed yet" : "Printed"}</span>
        </div>
        <p className="mt-2 text-sm font-semibold text-salin-text">{sheet.program.title}</p>
        <p className="text-xs text-salin-muted">
          {programWhen(sheet.program)} · {sheet.program.location}
        </p>
        <p className="mt-1 text-xs text-salin-muted">
          {sheet.stubs.length} stubs · {named.length} for requested owners
        </p>
        <div className="mt-3 grid gap-2 sm:flex">
          <button type="button" onClick={onPrint} className={primaryButton}>
            <Printer aria-hidden="true" className="size-4" /> Print stubs
          </button>
          {sheet.batch.status === "Approved" && !printedPending && (
            <button type="button" onClick={() => void queueChange(markPrinted(sheet)).then(() => toast(online ? "Marked as printed." : "Marked as printed. City Vet is told when you're back online."))} className={secondaryButton}>
              Mark as printed
            </button>
          )}
        </div>
      </div>

      <div className="rounded-2xl ring-1 ring-salin-border">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">Names written on the stubs</caption>
          <thead className="bg-salin-tile text-xs text-salin-muted">
            <tr>
              <th scope="col" className="w-14 px-3 py-2 font-semibold">Stub</th>
              <th scope="col" className="px-3 py-2 font-semibold">Owner's name (as written)</th>
              <th scope="col" className="hidden w-40 px-3 py-2 font-semibold sm:table-cell">Services</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-salin-border">
            {sheet.stubs.map((stub) => (
              <StubRow key={stub.id} stub={stub} pending={pending.find((item) => item.body.action === "confirm-owner" && item.body.stubId === stub.id)} known={known} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StubRow({ stub, pending, known }: { stub: PrintStub; pending?: OutboxItem; known: ReturnType<typeof useOwnerSuggestions> }) {
  const saved = (pending?.body.ownerName as string | undefined) ?? stub.ownerName ?? "";
  const [name, setName] = useState(saved);
  const dirty = name.trim() !== saved.trim() && name.trim() !== "";
  const confirmed = Boolean(stub.ownerConfirmedAt || pending);
  const services = stub.services.map((s) => PROCESS_LABEL[s]).join(", ");

  async function save() {
    if (!dirty && confirmed) return;
    if (!name.trim()) return;
    await queueChange(confirmOwner(stub, name));
    toast(`Name on stub ${stub.id} saved.`);
  }

  return (
    <tr className="align-top">
      <th scope="row" className="px-3 py-2.5 font-mono text-xs font-semibold text-salin-text">{stub.id}</th>
      <td className="px-3 py-1.5">
        {stub.status === "Available" ? (
          <p className="py-1 text-xs text-salin-muted">Blank stub · filled in on program day</p>
        ) : (
          <>
            <div className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <OwnerNameInput
                  aria-label={`Name written on stub ${stub.id}`}
                  value={name}
                  owners={known}
                  onChange={setName}
                  onKeyDown={(event) => event.key === "Enter" && void save()}
                  maxLength={120}
                  className="h-9 w-full rounded-lg border border-salin-border bg-salin-surface px-2.5 text-sm text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/20"
                />
              </div>
              {(dirty || !confirmed) && (
                <button type="button" onClick={() => void save()} disabled={!name.trim()} className="h-9 shrink-0 rounded-lg bg-salin-primary px-3 text-xs font-semibold text-white disabled:opacity-50">
                  {confirmed ? "Save" : "Confirm"}
                </button>
              )}
            </div>
            <p className={cn("mt-1 flex items-center gap-1 text-[11px]", confirmed && !dirty ? "text-salin-primary-ink" : "text-salin-muted")}>
              {pending ? <Clock aria-hidden="true" className="size-3" /> : confirmed ? <CircleCheck aria-hidden="true" className="size-3" /> : null}
              {pending ? (pending.status === "attention" ? `Needs attention: ${pending.lastError?.message ?? ""}` : "Waiting to send") : confirmed ? "Name confirmed" : "From the request · confirm what the owner wrote"}
            </p>
            <p className="mt-0.5 text-[11px] text-salin-muted sm:hidden">{services}</p>
          </>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-xs text-salin-muted sm:table-cell">{services || "—"}</td>
    </tr>
  );
}

// The slips only, at true size: two columns of 90 × 40 mm on A4, like e-Kapon's.
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  html, body { background: #fff !important; }
  body > *:not(.stub-print) { display: none !important; }
  .stub-print { display: grid !important; grid-template-columns: 90mm 90mm; grid-auto-rows: 40mm; gap: 5mm 10mm; }
}
@media screen { .stub-print { display: none; } }
.stub-slip { box-sizing: border-box; display: flex; align-items: center; gap: 1mm; padding: 2mm; border: .2mm solid #999; color: #000; font: 7.5pt/1.15 Arial, sans-serif; break-inside: avoid; }
.stub-slip-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .7mm; }
.stub-slip-copy * { margin: 0; color: #000; overflow-wrap: anywhere; }
.stub-slip-copy h3 { font: 700 8.5pt/1.12 Arial, sans-serif; }
.stub-slip-services { display: flex; flex-wrap: wrap; gap: .4mm 2mm; font-size: 6.5pt; }
.stub-box { display: inline-block; width: 2.6mm; height: 2.6mm; margin-right: .6mm; border: .25mm solid #000; font: 700 6pt/2.6mm Arial, sans-serif; text-align: center; vertical-align: -.5mm; }
.stub-slip-qr { flex: none; width: 30mm; height: 30mm; image-rendering: pixelated; }
`;

/** Makes the QR images, opens the print dialog once they're on the page, and closes after. */
function PrintStubs({ sheet, onDone }: { sheet: StubSheet; onDone: () => void }) {
  const [images, setImages] = useState<Record<number, string> | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then(({ default: qr }) => Promise.all(sheet.stubs.map(async (stub) => [stub.id, await qr.toDataURL(stub.code, { errorCorrectionLevel: "M", margin: 4, width: 384 })] as const)))
      .then((entries) => live && setImages(Object.fromEntries(entries)))
      .catch(() => {
        toast("The QR codes couldn't be made. Try again.");
        onDone();
      });
    return () => {
      live = false;
    };
  }, [sheet, onDone]);
  useEffect(() => {
    if (!images) return;
    const done = () => onDone();
    window.addEventListener("afterprint", done, { once: true });
    // Let the images decode before the print dialog takes its snapshot.
    const timer = setTimeout(() => window.print(), 300);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("afterprint", done);
    };
  }, [images, onDone]);

  return createPortal(
    <>
      <style>{PRINT_CSS}</style>
      {!images && (
        <p role="status" className="sr-only">
          Preparing stubs to print…
        </p>
      )}
      {images && (
        <div className="stub-print">
          {sheet.stubs.map((stub) => (
            <article key={stub.id} className="stub-slip">
              <div className="stub-slip-copy">
                <p style={{ fontSize: "6pt" }}>City Veterinary Office</p>
                <h3>{sheet.program.title}</h3>
                <p style={{ fontWeight: 700 }}>Stub No. {stub.id}</p>
                <p>{programWhen(sheet.program)}</p>
                <p>{sheet.program.location}</p>
                <p className="stub-slip-services">
                  {sheet.program.processes.map((process) => (
                    <span key={process}>
                      <span className="stub-box">{stub.services.includes(process) ? "✓" : ""}</span>
                      {process}
                    </span>
                  ))}
                </p>
                <p style={{ marginTop: "1.2mm", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden" }}>Owner: ______________________________</p>
              </div>
              <img src={images[stub.id]} alt="" className="stub-slip-qr" />
            </article>
          ))}
        </div>
      )}
    </>,
    document.body,
  );
}
