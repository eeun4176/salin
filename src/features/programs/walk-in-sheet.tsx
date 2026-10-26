/**
 * Walk-in Sheet (Attendance tab)
 * Records program-day walk-ins like a spreadsheet: one row per pet, with the
 * owner cell left blank for more pets of the owner above. Typing an owner
 * this phone knows fills the mobile and pets. Rows can be added one or five
 * at a time; Record saves one walk-in per owner to the outbox.
 */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PROCESS_LABEL } from "@/core/programs/program-requests";
import type { AttendedPet, StubOwner, StubProgram } from "@/core/programs/stubs";
import { blankWalkInRow, groupWalkIns, type WalkInRow } from "@/core/programs/walk-in-sheet";
import { OwnerNameInput } from "@/features/programs/owner-name-input";
import type { useOwnerSuggestions } from "@/features/programs/use-owner-suggestions";
import { cn } from "@/lib/utils";
import { mobileDigits, mobileInput } from "@/core/programs/mobile";

const cell = "h-10 w-full min-w-0 bg-transparent px-2.5 text-sm text-salin-text outline-none placeholder:text-salin-subtle focus:bg-salin-primary-soft/40 focus:ring-2 focus:ring-salin-primary focus:ring-inset";
const head = "h-9 border-b border-salin-border px-2.5 text-left text-[11px] font-semibold tracking-[0.06em] text-salin-muted uppercase";

export function WalkInSheet({
  program,
  barangays,
  known,
  onClose,
  onSave,
}: {
  program: StubProgram;
  barangays: { id: number; name: string }[];
  known: ReturnType<typeof useOwnerSuggestions>;
  onClose: () => void;
  onSave: (walkIns: { owner: StubOwner; pets: AttendedPet[] }[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<WalkInRow[]>(() => Array.from({ length: 5 }, () => blankWalkInRow(program.processes)));
  const [barangayId, setBarangayId] = useState(String(barangays[0]?.id ?? program.hostBarangayId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setRow = (index: number, next: Partial<WalkInRow>) => setRows((all) => all.map((row, i) => (i === index ? { ...row, ...next } : row)));
  const addRows = (count: number) => setRows((all) => [...all, ...Array.from({ length: count }, () => blankWalkInRow(program.processes))]);
  const { owners } = groupWalkIns(rows);

  async function submit() {
    if (busy) return;
    const grouped = groupWalkIns(rows);
    if (grouped.error) return setError(grouped.error);
    setBusy(true);
    try {
      await onSave(grouped.owners.map((o) => ({ owner: { name: o.name, mobile: o.mobile, address: "", barangayId: Number(barangayId) }, pets: o.pets })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Walk-ins couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[92dvh] max-w-5xl flex-col">
        <DialogTitle>Walk-ins</DialogTitle>
        <DialogDescription>One row per pet. Leave the owner blank for another pet of the owner above.</DialogDescription>
        {barangays.length > 1 && (
          <div className="mt-3 max-w-xs">
            <ChoiceMenu variant="field" label="Barangay" heading="Barangay of these owners" value={barangayId} onChange={setBarangayId} options={barangays.map((b) => ({ value: String(b.id), label: b.name }))} />
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-xl ring-1 ring-salin-border" data-lenis-prevent="">
          <table className="w-full min-w-[56rem] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-salin-tile">
              <tr>
                <th className={cn(head, "w-10 text-center")}>#</th>
                <th className={head}>Owner</th>
                <th className={cn(head, "w-40")}>Mobile</th>
                <th className={head}>Pet</th>
                <th className={cn(head, "w-28")}>Species</th>
                <th className={head}>Services</th>
                <th className={cn(head, "w-16 text-center")}>Served</th>
                <th className={cn(head, "w-11")}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const n = index + 1;
                return (
                  <tr key={index} className="[&>td]:border-b [&>td]:border-salin-border [&>td+td]:border-l">
                    <td className="bg-salin-tile/60 text-center text-xs text-salin-subtle tabular-nums">{n}</td>
                    <td>
                      <OwnerNameInput
                        aria-label={`Row ${n} owner`}
                        placeholder={index > 0 ? "Same as above" : "Owner name"}
                        value={row.owner}
                        owners={known}
                        onChange={(owner) => setRow(index, { owner })}
                        onPick={(picked) => {
                          const [first, ...more] = picked.pets;
                          setRows((all) => {
                            const next = all.map((r, i) => (i === index ? { ...r, mobile: r.mobile || picked.mobile, pet: r.pet || first?.name || "", species: r.pet ? r.species : (first?.species ?? r.species) } : r));
                            // The owner's other pets go on new rows under this one, owner left blank.
                            const extra = row.pet ? [] : more.slice(0, 9).map((p) => ({ ...blankWalkInRow(program.processes), pet: p.name, species: p.species }));
                            return [...next.slice(0, index + 1), ...extra, ...next.slice(index + 1)];
                          });
                        }}
                        maxLength={120}
                        className={cell}
                      />
                    </td>
                    <td>
                      <input aria-label={`Row ${n} mobile`} {...mobileInput} value={row.mobile} onChange={(event) => setRow(index, { mobile: mobileDigits(event.target.value) })} className={cell} />
                    </td>
                    <td>
                      <input aria-label={`Row ${n} pet`} value={row.pet} onChange={(event) => setRow(index, { pet: event.target.value })} maxLength={80} placeholder="Pet name" className={cell} />
                    </td>
                    <td className="px-1.5">
                      <div role="radiogroup" aria-label={`Row ${n} species`} className="seg-track flex rounded-lg bg-salin-tile p-0.5">
                        {(["Dog", "Cat"] as const).map((species) => (
                          <button key={species} type="button" role="radio" aria-checked={row.species === species} onClick={() => setRow(index, { species })} className={cn("h-7 flex-1 rounded-md text-xs font-medium", row.species === species ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted")}>
                            {species}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-1.5">
                      <div role="group" aria-label={`Row ${n} services`} className="flex flex-wrap gap-1">
                        {program.processes.map((process) => {
                          const on = row.processes.includes(process);
                          return (
                            <button
                              key={process}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setRow(index, { processes: on ? row.processes.filter((p) => p !== process) : [...row.processes, process] })}
                              className={cn("h-7 rounded-full px-2.5 text-xs font-medium ring-1", on ? "bg-salin-primary-soft text-salin-primary-ink ring-salin-primary/40" : "text-salin-muted ring-salin-border")}
                            >
                              {PROCESS_LABEL[process]}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="text-center">
                      <input type="checkbox" aria-label={`Row ${n} served today`} checked={row.served} onChange={(event) => setRow(index, { served: event.target.checked })} className="size-4 accent-salin-primary" />
                    </td>
                    <td>
                      <button type="button" aria-label={`Remove row ${n}`} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((_, i) => i !== index))} className="grid size-10 place-items-center text-salin-muted hover:text-salin-text disabled:opacity-30">
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => addRows(1)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-salin-primary-ink hover:bg-salin-tile">
            <Plus className="size-4" /> Add row
          </button>
          <button type="button" onClick={() => addRows(5)} className="inline-flex h-9 items-center rounded-lg px-2.5 text-sm font-medium text-salin-muted hover:bg-salin-tile hover:text-salin-text">
            Add 5 rows
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-xs text-salin-muted" aria-live="polite">
            {owners.length} owner{owners.length === 1 ? "" : "s"} · {owners.reduce((sum, o) => sum + o.pets.length, 0)} pets
          </p>
          <DialogClose className={secondaryButton}>Cancel</DialogClose>
          <button type="button" disabled={busy} onClick={() => void submit()} className={primaryButton}>
            Record walk-ins
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
