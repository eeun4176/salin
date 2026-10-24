/**
 * Attendance (the Attendance tab of /programs)
 * Program day. Salin downloads the program's stubs beforehand, so scanning
 * works with no signal: scan a stub's QR (or type its code), check the pets
 * that came, and the attendance waits in the outbox until there's signal.
 * Owners without a stub are recorded as walk-ins. Scanning counts only on
 * the program date — before it is too early, after it the day is over —
 * and a stub already used (on the server, or on this phone) is refused.
 */

import { useMemo, useState, type FormEvent } from "react";
import { CalendarClock, CircleCheck, Clock, LoaderCircle, ScanLine, Trash2, UserPlus } from "lucide-react";

import { ChoiceMenu } from "@/components/common/choice-menu";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { findStub, pickProgram, programDay, redeemStub, walkIn, type AttendedPet, type DayPack, type PackStub, type StubOwner, type StubProgram } from "@/core/programs/stubs";
import { OwnerNameInput } from "@/features/programs/owner-name-input";
import { programWhen, services } from "@/features/programs/program-format";
import { QrScanner } from "@/features/programs/qr-scanner";
import { field, SavedCopy, ServiceToggles } from "@/features/programs/requests-page";
import { useOwnerSuggestions } from "@/features/programs/use-owner-suggestions";
import { useProgramDay, useStubs } from "@/features/programs/use-stubs";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { queueChange } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";

const MOBILE = /^09\d{2}[- ]?\d{3}[- ]?\d{4}$/;

type Attending = { kind: "stub"; stub: PackStub } | { kind: "walk-in" };

export function AttendanceTab() {
  const stubs = useStubs();
  const programs = useMemo(() => stubs.data?.programs ?? [], [stubs.data]);
  const [chosen, setChosen] = useState<string | null>(null);
  const program = programs.find((p) => String(p.id) === chosen) ?? pickProgram(programs);

  if (stubs.status === "loading") {
    return (
      <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-salin-muted">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin motion-reduce:animate-none" /> Loading programs…
      </p>
    );
  }
  if (!program) return <p className="py-14 text-center text-sm text-salin-muted">{stubs.status === "unavailable" ? "Connect to the internet once to load your programs." : "No scheduled programs yet."}</p>;

  return (
    <div className="space-y-4">
      {programs.length > 1 && (
        <ChoiceMenu
          variant="field"
          label="Program"
          heading="Program"
          value={String(program.id)}
          onChange={setChosen}
          options={programs.map((p) => ({ value: String(p.id), label: p.title, short: `${p.title} · ${programWhen(p)}` }))}
        />
      )}
      <ProgramDayPanel key={program.id} program={program} />
    </div>
  );
}

function ProgramDayPanel({ program }: { program: StubProgram }) {
  const day = useProgramDay(program.id);
  const online = useOnline();
  const known = useOwnerSuggestions();
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [attending, setAttending] = useState<Attending | null>(null);
  const when = programDay(program);
  const pack = day.data?.pack ?? null;
  const packIds = useMemo(() => new Set(pack?.stubs.map((s) => s.id)), [pack]);
  const pending = day.pending.filter((item) => item.body.campaignId === program.id || packIds.has(item.body.stubId as number));
  const recorded = (day.data?.attendance ?? []).filter((a) => a.status !== "Voided");
  const used = new Set<number>([...recorded.flatMap((a) => (a.stubId ? [a.stubId] : [])), ...pending.flatMap((item) => (item.body.action === "redeem" ? [item.body.stubId as number] : []))]);

  function open(code: string) {
    setScanning(false);
    if (!pack) return;
    const result = findStub(pack, code, used);
    if (result.kind === "invalid") toast("That isn't a City Vet stub code.");
    else if (result.kind === "unknown") toast("This stub isn't for this program or your barangay.");
    else if (result.kind === "used") toast(`Stub ${result.stub.id} was already used.`);
    else {
      setTyped("");
      setAttending({ kind: "stub", stub: result.stub });
    }
  }

  async function save(change: Parameters<typeof queueChange>[0], message: string) {
    await queueChange(change);
    setAttending(null);
    toast(online ? message : `${message} It will be sent when you're back online.`);
  }

  return (
    <div className="space-y-5">
      {day.fromDevice && day.savedAt && <SavedCopy at={day.savedAt} />}
      <section aria-label="Program" className="rounded-2xl bg-salin-tile p-4">
        <p className="text-sm font-semibold text-salin-text">{program.title}</p>
        <p className="text-xs text-salin-muted">
          {programWhen(program)} · {program.location}
        </p>
        <p className="mt-1 text-xs text-salin-muted">{services(program.processes)}</p>
        <p className="mt-3 flex items-start gap-2 text-sm text-salin-text">
          {when === "today" ? <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-salin-primary" /> : <CalendarClock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-salin-muted" />}
          {when === "before" ? "Scanning opens on the program day." : when === "today" ? "Program day: scans and walk-ins are saved on this phone and sent when there's signal." : "This program day is over. Scanning a stub no longer counts."}
        </p>
        <p className="mt-1 text-xs text-salin-muted">
          {pack ? `${pack.stubs.length} stub${pack.stubs.length === 1 ? "" : "s"} saved on this phone for scanning offline.` : day.status === "loading" ? "Downloading the stubs…" : "Connect to the internet before program day to download the stubs."}
        </p>
      </section>

      {when === "today" && pack && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:flex">
            <button type="button" onClick={() => setScanning(true)} className={primaryButton}>
              <ScanLine aria-hidden="true" className="size-4" /> Scan stub
            </button>
            <button type="button" onClick={() => setAttending({ kind: "walk-in" })} className={secondaryButton}>
              <UserPlus aria-hidden="true" className="size-4" /> Walk-in
            </button>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              open(typed);
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">Stub code</span>
              <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Or type the code: CVS1.…" autoComplete="off" spellCheck={false} className={cn(field, "h-10 font-mono text-sm")} />
            </label>
            <button type="submit" disabled={!typed.trim()} className={cn(secondaryButton, "h-10")}>
              Find
            </button>
          </form>
        </div>
      )}

      <section aria-labelledby="attendance-heading" className="space-y-2">
        <h2 id="attendance-heading" className="text-sm font-semibold text-salin-text">
          Attendance <span className="text-salin-muted">({recorded.length + pending.length})</span>
        </h2>
        {!recorded.length && !pending.length && <p className="rounded-2xl bg-salin-tile px-4 py-6 text-center text-sm text-salin-muted">No one recorded yet.</p>}
        <ul className="space-y-2">
          {pending.map((item) => (
            <li key={item.id} className="rounded-2xl border border-dashed border-salin-border-strong p-3">
              <p className="text-sm font-semibold text-salin-text">{(item.body.owner as StubOwner).name}</p>
              <p className="flex items-center gap-1 text-xs text-salin-muted">
                <Clock aria-hidden="true" className="size-3" /> {item.body.action === "redeem" ? `Stub ${item.body.stubId as number}` : "Walk-in"} ·{" "}
                {item.status === "attention" ? `Needs attention: ${item.lastError?.message ?? ""}` : "Waiting to send"}
              </p>
            </li>
          ))}
          {recorded.map((a) => (
            <li key={a.id} className="rounded-2xl p-3 ring-1 ring-salin-border">
              <p className="text-sm font-semibold text-salin-text">{a.owner.name}</p>
              <p className="text-xs text-salin-muted">
                {a.source === "Stub" ? `Stub ${a.stubId}` : "Walk-in"} · {a.pets.map((p) => p.name).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {scanning && <QrScanner onCode={open} onClose={() => setScanning(false)} />}
      {attending && pack && (
        <AttendDialog
          attending={attending}
          pack={pack}
          known={known}
          onClose={() => setAttending(null)}
          onSave={(owner, pets) =>
            attending.kind === "stub" ? save(redeemStub(attending.stub, owner, pets), `Stub ${attending.stub.id} recorded.`) : save(walkIn(program.id, owner, pets), "Walk-in recorded.")
          }
        />
      )}
    </div>
  );
}

const newPet = (program: StubProgram): AttendedPet => ({ name: "", species: "Dog", processes: [...program.processes], served: true });

function AttendDialog({ attending, pack, known, onClose, onSave }: { attending: Attending; pack: DayPack; known: ReturnType<typeof useOwnerSuggestions>; onClose: () => void; onSave: (owner: StubOwner, pets: AttendedPet[]) => Promise<void> }) {
  const session = useAuthStore((state) => state.session);
  const { program } = pack;
  const issued = attending.kind === "stub" && attending.stub.status === "Issued" ? attending.stub : null;
  const ownBarangay = session?.barangayId ?? program.hostBarangayId;
  const barangays = [{ id: ownBarangay, name: session?.barangay ?? program.hostBarangay }, { id: program.hostBarangayId, name: program.hostBarangay }, ...program.allowedBarangays].filter((b, i, all) => all.findIndex((o) => o.id === b.id) === i);
  const [name, setName] = useState(issued?.owner?.name ?? "");
  const [mobile, setMobile] = useState(issued?.owner?.mobile ?? "");
  // A blank stub belongs to its batch's barangay; a walk-in can come from any participating one.
  const [barangayId, setBarangayId] = useState(String(attending.kind === "stub" ? attending.stub.barangayId : ownBarangay));
  const [pets, setPets] = useState<AttendedPet[]>(issued ? issued.pets.map((p) => ({ ...p, served: true })) : [newPet(program)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const maxPets = attending.kind === "stub" ? 3 : 10;
  const setPet = (index: number, next: Partial<AttendedPet>) => setPets((all) => all.map((p, i) => (i === index ? { ...p, ...next } : p)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const named = pets.filter((p) => p.name.trim());
    const problem = !name.trim() ? "Enter the owner's name." : mobile.trim() && !MOBILE.test(mobile.trim()) ? "Enter the mobile number as 09XX-XXX-XXXX, or leave it blank." : !named.length ? "Add at least one pet." : named.some((p) => !p.processes.length) ? "Choose at least one service for each pet." : null;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const owner = issued?.owner ?? { name: name.trim(), mobile: mobile.trim(), address: "", barangayId: Number(barangayId) };
      await onSave(owner, named);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Attendance couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{attending.kind === "stub" ? `Stub ${attending.stub.id}` : "Walk-in"}</DialogTitle>
        <DialogDescription>{issued ? "Check the pets that came, then record." : attending.kind === "stub" ? "A blank stub: enter the owner and pets." : "An owner without a stub."}</DialogDescription>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          {issued ? (
            <div className="rounded-xl bg-salin-tile p-3">
              <p className="text-sm font-semibold text-salin-text">{issued.owner?.name}</p>
              {issued.owner?.mobile && <p className="text-xs text-salin-muted">{issued.owner.mobile}</p>}
            </div>
          ) : (
            <>
              <label className="block text-sm font-medium text-salin-text">
                Owner name
                <OwnerNameInput
                  autoFocus
                  value={name}
                  owners={known}
                  onChange={setName}
                  onPick={(picked) => {
                    if (!mobile.trim()) setMobile(picked.mobile);
                    if (!pets.some((p) => p.name.trim()) && picked.pets.length) setPets(picked.pets.slice(0, maxPets).map((p) => ({ ...p, processes: [...program.processes], served: true })));
                  }}
                  maxLength={120}
                  className={cn(field, "mt-1.5")}
                />
              </label>
              <label className="block text-sm font-medium text-salin-text">
                Mobile <span className="font-normal text-salin-muted">(optional)</span>
                <input value={mobile} onChange={(event) => setMobile(event.target.value)} inputMode="tel" placeholder="09XX-XXX-XXXX" className={cn(field, "mt-1.5")} />
              </label>
              {attending.kind === "walk-in" && barangays.length > 1 && (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium text-salin-text">Barangay</span>
                  <ChoiceMenu variant="field" label="Barangay" heading="Barangay" value={barangayId} onChange={setBarangayId} options={barangays.map((b) => ({ value: String(b.id), label: b.name }))} />
                </div>
              )}
            </>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-salin-text">Pets</legend>
            {pets.map((pet, index) =>
              issued ? (
                <label key={index} className="flex items-start gap-2.5 rounded-xl p-3 ring-1 ring-salin-border">
                  <input type="checkbox" checked={pet.served} onChange={(event) => setPet(index, { served: event.target.checked })} className="mt-0.5 size-4 accent-salin-primary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-salin-text">
                      {pet.name} · {pet.species}
                    </span>
                    <span className="block text-xs text-salin-muted">{pet.served ? services(pet.processes) : "Came but not served (deferred)"}</span>
                  </span>
                </label>
              ) : (
                <div key={index} className="space-y-2 rounded-xl p-3 ring-1 ring-salin-border">
                  <div className="flex gap-2">
                    <input aria-label={`Pet ${index + 1} name`} placeholder={`Pet ${index + 1} name`} value={pet.name} onChange={(event) => setPet(index, { name: event.target.value })} maxLength={80} className={cn(field, "h-10 min-w-0 flex-1 text-sm")} />
                    <div role="radiogroup" aria-label={`Pet ${index + 1} species`} className="flex shrink-0 rounded-xl bg-salin-tile p-1">
                      {(["Dog", "Cat"] as const).map((species) => (
                        <button key={species} type="button" role="radio" aria-checked={pet.species === species} onClick={() => setPet(index, { species })} className={cn("h-8 rounded-lg px-3 text-[13px] font-medium", pet.species === species ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted")}>
                          {species}
                        </button>
                      ))}
                    </div>
                    <button type="button" aria-label={`Remove pet ${index + 1}`} onClick={() => setPets((all) => all.filter((_, i) => i !== index))} className="grid size-10 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <ServiceToggles label={`Pet ${index + 1} services`} options={program.processes} value={pet.processes} onChange={(processes) => setPet(index, { processes })} />
                  <label className="flex items-center gap-2 text-xs text-salin-text">
                    <input type="checkbox" checked={pet.served} onChange={(event) => setPet(index, { served: event.target.checked })} className="size-4 accent-salin-primary" /> Served today
                  </label>
                </div>
              ),
            )}
            {!issued && pets.length < maxPets && (
              <button type="button" onClick={() => setPets((all) => [...all, newPet(program)])} className="text-sm font-semibold text-salin-primary-ink hover:underline">
                + Add a pet
              </button>
            )}
          </fieldset>

          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
            <button type="submit" disabled={busy} className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50">
              Record attendance
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

