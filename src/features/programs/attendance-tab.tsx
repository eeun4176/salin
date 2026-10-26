/**
 * Attendance (the Attendance tab of /programs)
 * Program day. Salin downloads the program's stubs beforehand, so scanning
 * works with no signal: scan a stub's QR with the one scanner (/scan, which
 * comes back here with ?stub=<code>) or type its code: an encoded stub is
 * recorded present at once (every pet served); a blank stub asks who came.
 * The attendance waits in the outbox until there's signal. Every
 * encoded stub is listed as present once scanned, and absent if it never was
 * by the end of the program day.
 * Owners without a stub are typed in as walk-ins on a sheet, one row per
 * pet, so a queue of owners goes in at once. Scanning counts only on
 * the program date — before it is too early, after it the day is over —
 * and a stub already used (on the server, or on this phone) is refused.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CalendarClock, CircleCheck, Clock, Hourglass, ScanLine, Trash2, UserPlus, UserX } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { ChoiceMenu } from "@/components/common/choice-menu";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { attendanceRoster, findStub, pickProgram, programDay, redeemStub, walkIn, type AttendedPet, type DayPack, type PackStub, type StubOwner, type StubProgram } from "@/core/programs/stubs";
import { OwnerNameInput } from "@/features/programs/owner-name-input";
import { programWhen, services } from "@/features/programs/program-format";
import { field, SavedCopy, ServiceToggles } from "@/features/programs/requests-page";
import { useOwnerSuggestions } from "@/features/programs/use-owner-suggestions";
import { useProgramDay, useStubs } from "@/features/programs/use-stubs";
import { WalkInSheet } from "@/features/programs/walk-in-sheet";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { queueChange } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";
import { isMobile, mobileDigits, mobileInput, MOBILE_HINT } from "@/core/programs/mobile";



type Attending = { kind: "stub"; stub: PackStub };

export function AttendanceTab() {
  const stubs = useStubs();
  const programs = useMemo(() => stubs.data?.programs ?? [], [stubs.data]);
  // The calendar links here with ?program=<id>.
  const [chosen, setChosen] = useState<string | null>(() => new URLSearchParams(window.location.search).get("program"));
  const program = programs.find((p) => String(p.id) === chosen) ?? pickProgram(programs);

  if (stubs.status === "loading") {
    return (
      <LoadingSkeleton label="Loading programs" />
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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState("");
  const [attending, setAttending] = useState<Attending | null>(null);
  const [walkIns, setWalkIns] = useState(false);
  const session = useAuthStore((state) => state.session);
  // Walk-ins can come from any participating barangay; the paravet's own is listed first.
  const barangays = [{ id: session?.barangayId ?? program.hostBarangayId, name: session?.barangay ?? program.hostBarangay }, { id: program.hostBarangayId, name: program.hostBarangay }, ...program.allowedBarangays].filter((b, i, all) => all.findIndex((o) => o.id === b.id) === i);
  const when = programDay(program);
  const pack = day.data?.pack ?? null;
  const packIds = useMemo(() => new Set(pack?.stubs.map((s) => s.id)), [pack]);
  const pending = day.pending.filter((item) => item.body.campaignId === program.id || packIds.has(item.body.stubId as number));
  const recorded = (day.data?.attendance ?? []).filter((a) => a.status !== "Voided");
  const used = new Set<number>([...recorded.flatMap((a) => (a.stubId ? [a.stubId] : [])), ...pending.flatMap((item) => (item.body.action === "redeem" ? [item.body.stubId as number] : []))]);

  const refusal = (result: ReturnType<typeof findStub>) =>
    result.kind === "invalid" ? "That isn't a City Vet stub code." : result.kind === "unknown" ? "This stub isn't for this program or your barangay." : result.kind === "used" ? `Stub ${result.stub.id} was already used.` : null;

  function open(code: string) {
    if (!pack) return;
    const result = findStub(pack, code, used);
    if (result.kind !== "ok") return toast(refusal(result)!);
    setTyped("");
    const encoded = encodedStub(result.stub);
    if (encoded) void recordPresent(encoded, online);
    else setAttending({ kind: "stub", stub: result.stub });
  }

  // A stub QR read on /scan comes back as ?stub=<code>: once the day pack is on the phone, it counts like a typed code.
  const scanned = params.get("stub");
  const fromScan = scanned && pack ? findStub(pack, scanned, used) : null;
  const clearScan = () =>
    setParams((p) => {
      p.delete("stub");
      return p;
    }, { replace: true });
  // The scanned code already recorded here; once saved it reads as "used", which is not news.
  const handled = useRef<string | null>(null);
  const direct = fromScan?.kind === "ok" ? encodedStub(fromScan.stub) : null;
  useEffect(() => {
    if (!scanned || !direct || handled.current === scanned) return;
    handled.current = scanned;
    setParams((p) => {
      p.delete("stub");
      return p;
    }, { replace: true });
    void recordPresent(direct, online);
  }, [scanned, direct, online, setParams]);
  const scanRefusal = fromScan ? refusal(fromScan) : null;
  useEffect(() => {
    if (!scanRefusal || handled.current === scanned) return;
    toast(scanRefusal);
    setParams((p) => {
      p.delete("stub");
      return p;
    }, { replace: true });
  }, [scanRefusal, scanned, setParams]);
  const shown: Attending | null = attending ?? (fromScan?.kind === "ok" && !direct ? { kind: "stub", stub: fromScan.stub } : null);
  const roster = pack ? attendanceRoster(pack, used) : [];
  const present = roster.filter((entry) => entry.state === "present").length;
  const missing = roster.filter((entry) => entry.state !== "present").length;

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
            <button type="button" onClick={() => navigate("/scan")} className={primaryButton}>
              <ScanLine aria-hidden="true" className="size-4" /> Scan stub
            </button>
            <button type="button" onClick={() => setWalkIns(true)} className={secondaryButton}>
              <UserPlus aria-hidden="true" className="size-4" /> Walk-ins
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

      {roster.length > 0 && (
        <section aria-labelledby="holders-heading" className="space-y-2">
          <h2 id="holders-heading" className="text-sm font-semibold text-salin-text">
            Stub holders <span className="text-salin-muted">· {present} present · {missing} {when === "over" ? "absent" : "not yet scanned"}</span>
          </h2>
          <ul className="divide-y divide-salin-border rounded-2xl ring-1 ring-salin-border">
            {roster.map(({ stub, state }) => {
              const [Icon, label] = state === "present" ? [CircleCheck, "Present"] : state === "absent" ? [UserX, "Absent"] : [Hourglass, "Not yet scanned"];
              return (
                <li key={stub.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-12 shrink-0 font-mono text-xs font-semibold text-salin-text">{stub.id}</span>
                  <span className="min-w-0 flex-1 truncate text-salin-text">{stub.owner?.name ?? "—"}</span>
                  <span className={cn("flex shrink-0 items-center gap-1 text-xs", state === "present" ? "text-salin-primary-ink" : "text-salin-muted")}>
                    <Icon aria-hidden="true" className="size-3.5" /> {label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
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

      {shown && pack && (
        <AttendDialog
          attending={shown}
          pack={pack}
          known={known}
          onClose={() => {
            setAttending(null);
            clearScan();
          }}
          onSave={async (owner, pets) => {
            clearScan();
            await save(redeemStub(shown.stub, owner, pets), `Stub ${shown.stub.id} recorded.`);
          }}
        />
      )}
      {walkIns && (
        <WalkInSheet
          program={program}
          barangays={barangays}
          known={known}
          onClose={() => setWalkIns(false)}
          onSave={async (entries) => {
            for (const entry of entries) await queueChange(walkIn(program.id, entry.owner, entry.pets));
            setWalkIns(false);
            const message = `${entries.length} walk-in${entries.length === 1 ? "" : "s"} recorded.`;
            toast(online ? message : `${message} They will be sent when you're back online.`);
          }}
        />
      )}
    </div>
  );
}

/** An encoded stub: its owner and pets are known, so a scan alone records attendance. A blank stub still asks who came. */
const encodedStub = (stub: PackStub) => (stub.status === "Issued" && stub.owner && stub.pets.length ? (stub as PackStub & { owner: StubOwner }) : null);

/** Records the stub's owner as present, every pet served, the moment it is scanned. */
async function recordPresent(stub: PackStub & { owner: StubOwner }, online: boolean) {
  await queueChange(redeemStub(stub, stub.owner, stub.pets.map((pet) => ({ ...pet, served: true }))));
  const message = `Stub ${stub.id} · ${stub.owner.name}: present.`;
  toast(online ? message : `${message} It will be sent when you're back online.`);
}

const newPet = (program: StubProgram): AttendedPet => ({ name: "", species: "Dog", processes: [...program.processes], served: true });

function AttendDialog({ attending, pack, known, onClose, onSave }: { attending: Attending; pack: DayPack; known: ReturnType<typeof useOwnerSuggestions>; onClose: () => void; onSave: (owner: StubOwner, pets: AttendedPet[]) => Promise<void> }) {
  const { program } = pack;
  const issued = attending.stub.status === "Issued" ? attending.stub : null;
  const [name, setName] = useState(issued?.owner?.name ?? "");
  const [mobile, setMobile] = useState(issued?.owner?.mobile ?? "");
  // A blank stub belongs to its batch's barangay.
  const barangayId = attending.stub.barangayId;
  const [pets, setPets] = useState<AttendedPet[]>(issued ? issued.pets.map((p) => ({ ...p, served: true })) : [newPet(program)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const maxPets = 3;
  const setPet = (index: number, next: Partial<AttendedPet>) => setPets((all) => all.map((p, i) => (i === index ? { ...p, ...next } : p)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const named = pets.filter((p) => p.name.trim());
    const problem = !name.trim() ? "Enter the owner's name." : mobile.trim() && !isMobile(mobile) ? `Enter the mobile number as ${MOBILE_HINT}, or leave it blank.` : !named.length ? "Add at least one pet." : named.some((p) => !p.processes.length) ? "Choose at least one service for each pet." : null;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const owner = issued?.owner ?? { name: name.trim(), mobile: mobile.trim(), address: "", barangayId };
      await onSave(owner, named);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Attendance couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{`Stub ${attending.stub.id}`}</DialogTitle>
        <DialogDescription>{issued ? "Check the pets that came, then record." : "A blank stub: enter the owner and pets."}</DialogDescription>
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
                <input {...mobileInput} value={mobile} onChange={(event) => setMobile(mobileDigits(event.target.value))} className={cn(field, "mt-1.5")} />
              </label>
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
                    <div role="radiogroup" aria-label={`Pet ${index + 1} species`} className="seg-track flex shrink-0 rounded-xl bg-salin-tile p-1">
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

