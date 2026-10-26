/**
 * Stubs (the Stubs tab of /programs)
 * The numbered stubs City Vet sent the barangay, blank. Paravets print them
 * (two columns of 90 × 40 mm slips on A4, QR on the right) — only when the
 * barangay has requested or encoded owners — and hand them out. Each stub
 * handed over is then encoded against its number in a spreadsheet: the owner
 * on the stub's first row, one row per pet (up to three), the services as
 * columns. Encoded and not-yet-encoded stubs are listed apart, a search finds
 * any stub by number, owner, pet or mobile, and scanning a stub's QR (from
 * /scan) jumps to its row — or, on program day, to its attendance.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router";
import { CircleAlert, CircleCheck, Clock, Plus, Printer, ScanLine, Search, Ticket, Trash2, UserX } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { PROCESS_LABEL } from "@/core/programs/program-requests";
import type { OwnerSuggestion } from "@/core/programs/owner-suggestions";
import { canPrint, draftIsBlank, draftProblem, emptyDraft, issueStub, markPrinted, MAX_STUB_PETS, programDay, stubMatches, type DayPack, type PrintStub, type StubDraft, type StubSheet } from "@/core/programs/stubs";
import { programWhen } from "@/features/programs/program-format";
import { field, SavedCopy } from "@/features/programs/requests-page";
import { useOwnerSuggestions } from "@/features/programs/use-owner-suggestions";
import { useStubs } from "@/features/programs/use-stubs";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { queueChange } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";
import type { OutboxItem } from "@/types/sync";
import { mobileDigits, mobileInput } from "@/core/programs/mobile";

export function StubsTab() {
  const state = useStubs();
  const known = useOwnerSuggestions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [typed, setTyped] = useState("");
  const [printing, setPrinting] = useState<StubSheet | null>(null);
  const stopPrinting = useCallback(() => setPrinting(null), []);
  const sheets = useMemo(() => state.data?.sheets ?? [], [state.data]);
  const packs = useMemo(() => state.data?.packs ?? [], [state.data]);

  // A QR scanned on /scan arrives as ?stub=<code>: on its program day it goes to attendance, else to its row here (until a search is typed).
  // A stub not on a sheet sent here (e.g. printed by the office and handed over) is left for attendance to check against the day's stubs.
  const code = params.get("stub");
  const found = useMemo(() => {
    const sheet = code ? sheets.find((s) => s.stubs.some((stub) => stub.code === code)) : undefined;
    return sheet ? { sheet, stub: sheet.stubs.find((s) => s.code === code)! } : null;
  }, [code, sheets]);
  const focus = found?.stub.id ?? null;
  const query = code ? "" : typed;
  useEffect(() => {
    if (!code || state.status === "loading") return;
    if (found && programDay(found.sheet.program) === "today") navigate(`/programs?tab=attendance&program=${found.sheet.program.id}&stub=${encodeURIComponent(code)}`, { replace: true });
    else if (!found) navigate(`/programs?tab=attendance&stub=${encodeURIComponent(code)}`, { replace: true });
  }, [code, found, state.status, navigate, setParams]);

  if (state.status === "loading") return <LoadingSkeleton label="Loading your stubs" />;
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
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search stubs</span>
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-salin-subtle" />
              <input
                value={query}
                onChange={(event) => {
                  setTyped(event.target.value);
                  if (code) setParams({ tab: "stubs" }, { replace: true });
                }}
                placeholder="Search stub no., owner, pet or mobile" className={cn(field, "h-10 pl-9 text-sm")} />
            </label>
            <button type="button" onClick={() => navigate("/scan")} className={cn(secondaryButton, "h-10")}>
              <ScanLine aria-hidden="true" className="size-4" /> Scan stub
            </button>
          </div>
          {sheets.map((sheet) => (
            <StubSheetCard key={sheet.batch.id} sheet={sheet} pack={packs.find((pack) => pack.program.id === sheet.program.id)} pending={state.pending} known={known} query={query} focus={focus} onPrint={() => setPrinting(sheet)} />
          ))}
        </div>
      )}
      {printing && <PrintStubs sheet={printing} onDone={stopPrinting} />}
    </>
  );
}

type Encoded = { stub: PrintStub; owner: { name: string; mobile?: string }; pets: { name: string; species: string }[]; item?: OutboxItem };

function StubSheetCard({ sheet, pack, pending, known, query, focus, onPrint }: { sheet: StubSheet; pack?: DayPack; pending: OutboxItem[]; known: OwnerSuggestion[]; query: string; focus: number | null; onPrint: () => void }) {
  const online = useOnline();
  const session = useAuthStore((state) => state.session);
  const printedPending = pending.some((item) => item.body.action === "confirm-print" && item.body.batchId === sheet.batch.id);
  const issuing = (stub: PrintStub) => pending.find((item) => item.body.action === "issue" && item.body.stubId === stub.id);
  // shortcut: drafts live in this card's memory; they're lost on leaving the tab before Save. Keep them in the settings table if paravets encode long batches in pieces.
  const [drafts, setDrafts] = useState<Record<number, StubDraft>>({});
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const packed = new Map(pack?.stubs.map((stub) => [stub.id, stub]));
  const encoded: Encoded[] = [];
  const blank: PrintStub[] = [];
  for (const stub of sheet.stubs) {
    const item = issuing(stub);
    if (item) encoded.push({ stub, owner: item.body.owner as Encoded["owner"], pets: item.body.pets as Encoded["pets"], item });
    else if (stub.status === "Available") blank.push(stub);
    else encoded.push({ stub, owner: packed.get(stub.id)?.owner ?? { name: stub.ownerName ?? "" }, pets: packed.get(stub.id)?.pets ?? [] });
  }
  // Used stubs drop off the print list; the day pack still has them, with who came.
  for (const used of pack?.stubs ?? []) if (used.batchId === sheet.batch.id && used.status === "Redeemed") encoded.push({ stub: { id: used.id, code: used.code, status: used.status, services: [] }, owner: used.owner ?? { name: "" }, pets: used.pets });
  const shownBlank = blank.filter((stub) => stubMatches(query, { id: stub.id, owner: { name: drafts[stub.id]?.owner ?? "", mobile: drafts[stub.id]?.mobile }, pets: drafts[stub.id]?.pets }));
  const shownEncoded = encoded.filter((entry) => stubMatches(query, { id: entry.stub.id, owner: entry.owner, pets: entry.pets }));
  const filled = blank.filter((stub) => drafts[stub.id] && !draftIsBlank(drafts[stub.id]));
  const printable = canPrint(sheet);
  const over = programDay(sheet.program) === "over";

  async function save() {
    if (busy || !session) return;
    setBusy(true);
    const next: Record<number, string> = {};
    let sent = 0;
    for (const stub of filled) {
      const problem = draftProblem(drafts[stub.id]);
      if (problem) next[stub.id] = problem;
      else {
        await queueChange(issueStub(stub, session.barangayId ?? sheet.program.hostBarangayId, drafts[stub.id]));
        sent++;
      }
    }
    setDrafts((all) => Object.fromEntries(Object.entries(all).filter(([id]) => next[Number(id)])));
    setProblems(next);
    setBusy(false);
    if (sent) toast(`${sent} stub${sent === 1 ? "" : "s"} encoded.${online ? "" : " They will be sent when you're back online."}`);
  }

  return (
    <section aria-label={`Stubs ${sheet.batch.reference}`} className="space-y-4">
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
          {sheet.stubs.length} stubs · {encoded.length} encoded · {blank.length} not encoded
        </p>
        <div className="mt-3 grid gap-2 sm:flex">
          <button type="button" onClick={onPrint} disabled={!printable} className={primaryButton}>
            <Printer aria-hidden="true" className="size-4" /> Print stubs
          </button>
          {printable && sheet.batch.status === "Approved" && !printedPending && (
            <button type="button" onClick={() => void queueChange(markPrinted(sheet)).then(() => toast(online ? "Marked as printed." : "Marked as printed. City Vet is told when you're back online."))} className={secondaryButton}>
              Mark as printed
            </button>
          )}
        </div>
        {!printable && <p className="mt-2 text-xs text-salin-muted">No owners on your barangay's request yet, so these stubs can't be printed. Add owners under Requests first.</p>}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-salin-text">
            Not encoded <span className="text-salin-muted">({blank.length})</span>
          </h3>
          {filled.length > 0 && (
            <button type="button" onClick={() => void save()} disabled={busy} className={cn(primaryButton, "h-9 px-4")}>
              Save {filled.length} stub{filled.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
        {!blank.length ? (
          <p className="rounded-2xl bg-salin-tile px-4 py-5 text-center text-sm text-salin-muted">Every stub is encoded.</p>
        ) : !shownBlank.length ? (
          <p className="text-sm text-salin-muted">No blank stub matches the search.</p>
        ) : (
          <EncodeSheet stubs={shownBlank} sheet={sheet} drafts={drafts} problems={problems} known={known} focus={focus} onChange={(id, draft) => setDrafts((all) => ({ ...all, [id]: draft }))} />
        )}
        {Object.keys(problems).length > 0 && (
          <ul role="alert" className="space-y-0.5 text-[13px] text-destructive">
            {Object.entries(problems).map(([id, problem]) => (
              <li key={id}>
                Stub {id}: {problem}.
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-salin-text">
          Encoded <span className="text-salin-muted">({encoded.length})</span>
        </h3>
        {!encoded.length ? (
          <p className="rounded-2xl bg-salin-tile px-4 py-5 text-center text-sm text-salin-muted">No stub encoded yet. Hand a stub to an owner, then type their details above.</p>
        ) : !shownEncoded.length ? (
          <p className="text-sm text-salin-muted">No encoded stub matches the search.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl ring-1 ring-salin-border" data-lenis-prevent-horizontal="">
            <table className="w-full min-w-[36rem] table-fixed text-left text-sm">
              <caption className="sr-only">Encoded stubs</caption>
              <thead className="bg-salin-tile text-xs text-salin-muted">
                <tr>
                  <th scope="col" className="w-20 px-3 py-2 font-semibold">Stub No.</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Owner</th>
                  <th scope="col" className="w-36 px-3 py-2 font-semibold">Mobile</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Pets</th>
                  <th scope="col" className="w-36 px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-salin-border">
                {shownEncoded.map((entry) => (
                  <EncodedRow key={entry.stub.id} entry={entry} over={over} focused={focus === entry.stub.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function EncodedRow({ entry, over, focused }: { entry: Encoded; over: boolean; focused: boolean }) {
  const row = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focused]);
  const { stub, item } = entry;
  const [Icon, label] = item
    ? item.status === "attention"
      ? [CircleAlert, `Needs attention: ${item.lastError?.message ?? ""}`]
      : [Clock, "Waiting to send"]
    : stub.status === "Redeemed"
      ? [CircleCheck, "Attended"]
      : over
        ? [UserX, "Absent"]
        : [CircleCheck, "Encoded"];
  return (
    <tr ref={row} className={cn("align-top", focused && "bg-salin-primary-soft")}>
      <th scope="row" className="px-3 py-2.5 font-mono text-xs font-semibold text-salin-text">{stub.id}</th>
      <td className="truncate px-3 py-2.5 font-medium text-salin-text">{entry.owner.name}</td>
      <td className="truncate px-3 py-2.5 text-salin-muted">{entry.owner.mobile || "—"}</td>
      <td className="px-3 py-2.5 text-salin-muted">{entry.pets.map((pet) => `${pet.name} (${pet.species})`).join(", ") || "—"}</td>
      <td className="px-3 py-2.5">
        <span className="flex items-start gap-1 text-xs text-salin-text">
          <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> {label}
        </span>
      </td>
    </tr>
  );
}

const cell = "h-10 w-full min-w-0 bg-transparent px-2.5 text-sm text-salin-text outline-none placeholder:text-salin-subtle focus:bg-salin-primary-soft focus:ring-2 focus:ring-salin-primary focus:ring-inset";
const head = "h-9 border-b border-salin-border bg-salin-tile px-2.5 text-left text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-salin-muted uppercase";

/** The blank stubs as a sheet: the owner on the stub's first row, one row per pet, a column per service. */
function EncodeSheet({ stubs, sheet, drafts, problems, known, focus, onChange }: { stubs: PrintStub[]; sheet: StubSheet; drafts: Record<number, StubDraft>; problems: Record<number, string>; known: OwnerSuggestion[]; focus: number | null; onChange: (id: number, draft: StubDraft) => void }) {
  const processes = sheet.program.processes;
  const listId = `owners-${sheet.batch.id}`;
  const focusRow = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus === null || !focusRow.current) return;
    focusRow.current.scrollIntoView({ block: "center", behavior: "smooth" });
    focusRow.current.focus({ preventScroll: true });
  }, [focus]);
  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-salin-border" data-lenis-prevent-horizontal="">
      <datalist id={listId}>
        {known.slice(0, 300).map((owner) => (
          <option key={owner.name} value={owner.name} />
        ))}
      </datalist>
      <table className="w-full table-fixed text-sm" style={{ minWidth: `${58 + processes.length * 7}rem` }}>
        <caption className="sr-only">Encode the owner and pets of each blank stub</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "w-20")}>Stub No.</th>
            <th scope="col" className={cn(head, "w-48")}>Owner</th>
            <th scope="col" className={cn(head, "w-36")}>Mobile</th>
            <th scope="col" className={cn(head, "w-44")}>Address</th>
            <th scope="col" className={cn(head, "w-36")}>Pet</th>
            <th scope="col" className={cn(head, "w-24")}>Species</th>
            <th scope="col" className={cn(head, "w-28")}>Sex</th>
            {processes.map((process) => (
              <th key={process} scope="col" className={cn(head, "w-28 text-center")}>
                {PROCESS_LABEL[process]}
              </th>
            ))}
            <th scope="col" className={cn(head, "w-24")}>
              <span className="sr-only">Pets</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {stubs.flatMap((stub) => {
            const draft = drafts[stub.id] ?? emptyDraft(processes);
            const set = (next: Partial<StubDraft>) => onChange(stub.id, { ...draft, ...next });
            const setPet = (index: number, next: Partial<StubDraft["pets"][number]>) => set({ pets: draft.pets.map((pet, i) => (i === index ? { ...pet, ...next } : pet)) });
            const flagged = Boolean(problems[stub.id]);
            return draft.pets.map((pet, index) => (
              <tr key={`${stub.id}-${index}`} className={cn("border-b border-salin-border last:border-0", flagged && "bg-amber-50 dark:bg-amber-400/10", focus === stub.id && "bg-salin-primary-soft")}>
                <th scope="row" className="h-10 px-2.5 text-left font-mono text-xs font-semibold text-salin-text">{index === 0 ? stub.id : ""}</th>
                {index === 0 ? (
                  <>
                    <td className="p-0">
                      <input
                        ref={focus === stub.id ? focusRow : undefined}
                        aria-label={`Stub ${stub.id} owner`}
                        list={listId}
                        value={draft.owner}
                        maxLength={120}
                        placeholder="Owner name"
                        onChange={(event) => {
                          const name = event.target.value;
                          const match = known.find((owner) => owner.name === name);
                          // A known owner fills the mobile and pets still empty; nothing typed is overwritten.
                          set({ owner: name, ...(match && !draft.mobile.trim() ? { mobile: match.mobile } : {}), ...(match && draft.pets.every((p) => !p.name.trim()) && match.pets.length ? { pets: match.pets.slice(0, MAX_STUB_PETS).map((p) => ({ name: p.name, species: p.species, sex: p.sex ?? "", processes: [...processes] })) } : {}) });
                        }}
                        className={cell}
                      />
                    </td>
                    <td className="p-0">
                      <input aria-label={`Stub ${stub.id} mobile`} {...mobileInput} value={draft.mobile} onChange={(event) => set({ mobile: mobileDigits(event.target.value) })} className={cell} />
                    </td>
                    <td className="p-0">
                      <input aria-label={`Stub ${stub.id} address`} value={draft.address} maxLength={300} placeholder="Street, purok" onChange={(event) => set({ address: event.target.value })} className={cell} />
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="h-10 px-2.5 text-xs text-salin-subtle">
                    Same owner · pet {index + 1}
                  </td>
                )}
                <td className="p-0">
                  <input aria-label={`Stub ${stub.id} pet ${index + 1} name`} value={pet.name} maxLength={80} placeholder="Pet name" onChange={(event) => setPet(index, { name: event.target.value })} className={cell} />
                </td>
                <td className="p-0">
                  <select aria-label={`Stub ${stub.id} pet ${index + 1} species`} value={pet.species} onChange={(event) => setPet(index, { species: event.target.value as "Dog" | "Cat" })} className={cell}>
                    <option>Dog</option>
                    <option>Cat</option>
                  </select>
                </td>
                <td className="p-0">
                  <select aria-label={`Stub ${stub.id} pet ${index + 1} sex`} value={pet.sex} onChange={(event) => setPet(index, { sex: event.target.value as "" | "Male" | "Female" })} className={cell}>
                    <option value="">Not recorded</option>
                    <option>Male</option>
                    <option>Female</option>
                  </select>
                </td>
                {processes.map((process) => (
                  <td key={process} className="p-0">
                    <label className="flex h-10 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`Stub ${stub.id} pet ${index + 1} ${PROCESS_LABEL[process]}`}
                        checked={pet.processes.includes(process)}
                        onChange={(event) => setPet(index, { processes: event.target.checked ? [...pet.processes, process] : pet.processes.filter((p) => p !== process) })}
                        className="size-4 accent-salin-primary"
                      />
                    </label>
                  </td>
                ))}
                <td className="p-0">
                  <div className="flex h-10 items-center justify-end gap-0.5 pr-1">
                    {index > 0 && (
                      <button type="button" aria-label={`Remove pet ${index + 1} of stub ${stub.id}`} onClick={() => set({ pets: draft.pets.filter((_, i) => i !== index) })} className="grid size-8 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile">
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    )}
                    {index === draft.pets.length - 1 && draft.pets.length < MAX_STUB_PETS && (
                      <button type="button" aria-label={`Add a pet to stub ${stub.id}`} onClick={() => set({ pets: [...draft.pets, { name: "", species: "Dog", sex: "", processes: [...processes] }] })} className="grid size-8 place-items-center rounded-lg text-salin-primary-ink hover:bg-salin-tile">
                        <Plus aria-hidden="true" className="size-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
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

/** Makes the QR images, opens the print dialog once they're on the page, and closes after. Used stubs aren't printed again. */
function PrintStubs({ sheet, onDone }: { sheet: StubSheet; onDone: () => void }) {
  const stubs = useMemo(() => sheet.stubs.filter((stub) => stub.status !== "Redeemed"), [sheet]);
  const [images, setImages] = useState<Record<number, string> | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then(({ default: qr }) => Promise.all(stubs.map(async (stub) => [stub.id, await qr.toDataURL(stub.code, { errorCorrectionLevel: "M", margin: 4, width: 384 })] as const)))
      .then((entries) => live && setImages(Object.fromEntries(entries)))
      .catch(() => {
        toast("The QR codes couldn't be made. Try again.");
        onDone();
      });
    return () => {
      live = false;
    };
  }, [stubs, onDone]);
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
          {stubs.map((stub) => (
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
