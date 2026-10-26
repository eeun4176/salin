/**
 * Program Requests (the Requests tab of /programs)
 * The barangay's shared request for City Vet programs — Kapon, anti-rabies
 * and microchip — that its paravets fill together: the status, who filed,
 * sent and last edited it, progress toward the owner target, and the owner
 * list with each owner's pets and services. Owners can be added, edited and
 * removed offline; the changes wait on the phone ("Waiting to send") and go
 * out when there is signal. A barangay starts a new request only after the
 * current one finishes; when City Vet merged it into another barangay's
 * request, that one is shown.
 */

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CalendarCheck, CircleCheck, CircleSlash, Clock, CloudOff, GitMerge, Pencil, Plus, Search, Send, Trash2, type LucideIcon } from "lucide-react";

import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { primaryButton, secondaryButton } from "@/components/common/step-footer";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  addOwner,
  editOwner,
  possibleDuplicates,
  PROCESS_LABEL,
  PROCESSES,
  removeOwner,
  sendRequest,
  startRequest,
  STATUS_HINT,
  STATUS_LABEL,
  type OwnerInput,
  type Process,
  type ProgramRequest,
  type RequestOwner,
  type RequestStatus,
} from "@/core/programs/program-requests";
import { OwnerNameInput } from "@/features/programs/owner-name-input";
import { services } from "@/features/programs/program-format";
import { useOwnerSuggestions } from "@/features/programs/use-owner-suggestions";
import { useProgramRequests } from "@/features/programs/use-program-requests";
import { formatDate } from "@/features/workspace/query";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { queueChange } from "@/stores/sync-store";
import { toast } from "@/stores/toast-store";
import type { OutboxItem } from "@/types/sync";

export const field = "h-11 w-full rounded-xl border border-salin-border bg-salin-surface px-3 text-[15px] text-salin-text outline-none focus:border-salin-primary focus:ring-3 focus:ring-salin-primary/20";
const MOBILE = /^09\d{2}[- ]?\d{3}[- ]?\d{4}$/;

// Icon + word for each status, never colour alone.
const STATUS_ICON: Record<RequestStatus, LucideIcon> = {
  gathering: Clock, requested: Send, approved: CircleCheck, scheduled: CalendarCheck, merged: GitMerge, closed: CircleCheck, rejected: CircleSlash, cancelled: CircleSlash,
};

function StatusBadge({ status }: { status: RequestStatus }) {
  const Icon = STATUS_ICON[status] ?? Clock;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", status === "rejected" || status === "cancelled" ? "bg-salin-tile text-salin-muted" : "bg-salin-primary-soft text-salin-primary-ink")}>
      <Icon aria-hidden="true" className="size-3.5" /> {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Tag({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "attention" }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone === "attention" ? "bg-amber-50 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" : "bg-salin-tile text-salin-muted")}>{children}</span>;
}

export function RequestsTab() {
  const session = useAuthStore((state) => state.session);
  const online = useOnline();
  const state = useProgramRequests();
  const { current, detail, pending } = state;
  const [ownerDialog, setOwnerDialog] = useState<{ owner?: RequestOwner } | null>(null);
  const [removing, setRemoving] = useState<RequestOwner | null>(null);
  const [query, setQuery] = useState("");

  const isParavet = session?.role === "Paravet";
  const forCurrent = pending.filter((item) => item.body.campaignId === current?.id);
  const pendingAdds = forCurrent.filter((item) => item.body.action === "add-interest");
  const pendingFor = (personId: number) => forCurrent.find((item) => item.body.personId === personId);
  const startPending = pending.some((item) => item.body.action === "create-demand");
  const sendPending = forCurrent.some((item) => item.body.action === "submit-request");
  const owners = useMemo(() => (detail && current && detail.campaign.id === current.id ? detail.people.filter((p) => p.status === "interested") : []), [detail, current]);
  const shown = owners.filter((owner) => owner.owner_name.toLowerCase().includes(query.trim().toLowerCase()));
  const editable = current ? ["gathering", "scheduled"].includes(current.status) : false;
  const ownerTotal = (current?.ownerCount ?? 0) + pendingAdds.length;
  const isHost = current?.hostBarangayId === session?.barangayId;

  async function queue(change: Parameters<typeof queueChange>[0], message: string) {
    await queueChange(change);
    toast(online ? message : `${message} It will be sent when you're back online.`);
  }

  if (!isParavet) return <p className="py-10 text-center text-sm text-salin-muted">Program requests are filled by paravets. City Vet staff review them in e-Kapon.</p>;

  return (
    <>
      {state.fromDevice && state.savedAt && <SavedCopy at={state.savedAt} />}
      {state.status === "loading" ? (
        <LoadingSkeleton label="Loading your barangay's request" />
      ) : state.status === "unavailable" ? (
        <div role="alert" className="py-14 text-center">
          <CloudOff aria-hidden="true" className="mx-auto size-6 text-salin-muted" />
          <p className="mt-3 font-semibold text-salin-text">Connect to the internet once to load your barangay's request.</p>
          <p className="mt-1 text-sm text-salin-muted">After that it opens on this phone even without signal.</p>
        </div>
      ) : !current ? (
        startPending ? (
          <p className="py-14 text-center text-sm text-salin-muted">Your new request is waiting to send. It appears here once City Vet receives it.</p>
        ) : (
          <StartRequest completed={state.completed} onStart={(input) => queue(startRequest(input), "Request started.")} />
        )
      ) : (
        <div className="space-y-5">
          <RequestSummary request={current} merged={state.merged} ownerTotal={ownerTotal} />

          {current.status === "rejected" && current.reviewNote && <p className="rounded-xl bg-salin-tile p-3 text-sm text-salin-text">City Vet's note: {current.reviewNote}</p>}

          <div className="grid gap-2 sm:flex sm:flex-wrap">
            {editable && (
              <button type="button" onClick={() => setOwnerDialog({})} className={primaryButton}>
                <Plus aria-hidden="true" className="size-4" /> Add owner
              </button>
            )}
            {current.status === "gathering" && isHost && (
              <button
                type="button"
                disabled={sendPending || ownerTotal < current.targetPeople}
                onClick={() => void queue(sendRequest(current), "List sent to City Vet.")}
                className={secondaryButton}
              >
                <Send aria-hidden="true" className="size-4" /> {sendPending ? "Waiting to send" : "Send list to City Vet"}
              </button>
            )}
          </div>
          {current.status === "gathering" && isHost && ownerTotal < current.targetPeople && (
            <p className="-mt-3 text-xs text-salin-muted">{current.targetPeople - ownerTotal} more owners needed before the list can be sent.</p>
          )}
          {!editable && current.status !== "merged" && <p className="-mt-2 text-xs text-salin-muted">The list can't be changed while City Vet reviews it.</p>}

          <section aria-labelledby="owners-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="owners-heading" className="text-sm font-semibold text-salin-text">
                Owners <span className="text-salin-muted">({ownerTotal})</span>
              </h2>
              {owners.length > 5 && (
                <label className="relative w-full sm:w-64">
                  <span className="sr-only">Search owners</span>
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-salin-subtle" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search owners" className={cn(field, "h-10 pl-9 text-sm")} />
                </label>
              )}
            </div>
            {pendingAdds.map((item) => (
              <PendingOwner key={item.id} item={item} />
            ))}
            {!owners.length && !pendingAdds.length && <p className="rounded-2xl bg-salin-tile px-4 py-8 text-center text-sm text-salin-muted">No owners yet. Add the first one.</p>}
            <ul className="space-y-2">
              {shown.map((owner) => (
                <OwnerCard key={owner.id} owner={owner} change={pendingFor(owner.id)} editable={editable && owner.residence_barangay_id === session?.barangayId} onEdit={() => setOwnerDialog({ owner })} onRemove={() => setRemoving(owner)} />
              ))}
            </ul>
          </section>

          {!!detail?.activity.length && (
            <details className="rounded-2xl p-3 ring-1 ring-salin-border">
              <summary className="cursor-pointer text-sm font-semibold text-salin-text">Activity</summary>
              <ul className="mt-2 space-y-1.5 text-xs text-salin-muted">
                {detail.activity.slice(0, 30).map((item) => (
                  <li key={item.id}>
                    {formatDate(Date.parse(item.createdAt))} · <span className="font-medium text-salin-text">{item.actorName}</span> · {item.action.replaceAll("-", " ")}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {ownerDialog && current && session && (
        <OwnerDialog
          request={current}
          owner={ownerDialog.owner}
          listed={owners}
          onClose={() => setOwnerDialog(null)}
          onSave={async (input) => {
            await queue(ownerDialog.owner ? editOwner(current, ownerDialog.owner, input) : addOwner(current, session.barangayId ?? current.hostBarangayId, input), ownerDialog.owner ? "Changes saved." : "Owner added.");
            setOwnerDialog(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.owner_name ?? "this owner"}?`}
        description="They are taken off this request. Their entry stays in the request's history."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (current && removing) await queue(removeOwner(current, removing), "Owner removed.");
        }}
      />
    </>
  );
}

/** "Saved copy · 24 Oct": the page shows what was last loaded, because the server can't be reached. */
export function SavedCopy({ at }: { at: number }) {
  return (
    <p className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-salin-tile px-3 py-1.5 text-xs text-salin-muted">
      <CloudOff aria-hidden="true" className="size-3.5" /> Saved copy · {formatDate(at)}
    </p>
  );
}

function RequestSummary({ request, merged, ownerTotal }: { request: ProgramRequest; merged: ProgramRequest | null; ownerTotal: number }) {
  const who = [request.createdByName && `Filed by ${request.createdByName}`, request.submittedByName && `Sent by ${request.submittedByName}`, request.lastEditedBy && `Last edited by ${request.lastEditedBy}`].filter(Boolean).join(" · ");
  const progress = Math.min(100, Math.round((ownerTotal / Math.max(1, request.targetPeople)) * 100));
  return (
    <section aria-label="Request" className="rounded-2xl bg-salin-tile p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-salin-muted">{request.reference}</p>
        <StatusBadge status={request.status} />
      </div>
      {!merged && STATUS_HINT[request.status] && <p className="mt-2 text-sm text-salin-text">{STATUS_HINT[request.status]}</p>}
      {merged && (
        <p className="mt-3 flex items-start gap-2 text-sm text-salin-text">
          <GitMerge aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-salin-primary" /> City Vet merged your request into {request.hostBarangay}'s. Your owners continue here.
        </p>
      )}
      {request.programTitle && <p className="mt-2 text-sm font-semibold text-salin-text">{request.programTitle}{request.programDate ? ` · ${formatDate(Date.parse(request.programDate))}` : ""}</p>}
      <div className="mt-3">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-semibold text-salin-text">
            {ownerTotal} of {request.targetPeople} owners
          </span>
          <span className="text-xs text-salin-muted">{request.petCount} pets</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-salin-surface" role="progressbar" aria-label="Owners toward the target" aria-valuemin={0} aria-valuemax={request.targetPeople} aria-valuenow={ownerTotal}>
          <div className="h-full rounded-full bg-salin-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <p className="mt-3 text-xs text-salin-muted">{services(request.processes)}</p>
      {who && <p className="mt-1 text-xs text-salin-muted">{who}</p>}
    </section>
  );
}

function OwnerCard({ owner, change, editable, onEdit, onRemove }: { owner: RequestOwner; change?: OutboxItem; editable: boolean; onEdit: () => void; onRemove: () => void }) {
  const removal = change?.body.action === "withdraw-interest";
  return (
    <li className={cn("rounded-2xl p-3.5 ring-1 ring-salin-border", removal && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-salin-text">{owner.owner_name}</p>
          <p className="text-xs text-salin-muted">{owner.mobile || "No mobile"}{owner.residence_barangay ? ` · ${owner.residence_barangay}` : ""}</p>
        </div>
        {editable && !change && (
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onEdit} aria-label={`Edit ${owner.owner_name}`} className="grid size-9 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile hover:text-salin-text">
              <Pencil className="size-4" />
            </button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${owner.owner_name}`} className="grid size-9 place-items-center rounded-lg text-salin-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-400/15">
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>
      {owner.pets.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-salin-text">
          {owner.pets.map((pet, index) => (
            <li key={index}>
              <span className="font-medium">{pet.name}</span> · {pet.species} · <span className="text-salin-muted">{services(pet.processes)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-salin-subtle">
        {[owner.added_by_name && `Added by ${owner.added_by_name}`, owner.updated_by_name && `edited by ${owner.updated_by_name}`].filter(Boolean).join(" · ")}
        {change && <Tag tone={change.status === "attention" ? "attention" : "muted"}>{change.status === "attention" ? "Needs attention" : removal ? "Removal waiting to send" : "Changes waiting to send"}</Tag>}
      </div>
    </li>
  );
}

function PendingOwner({ item }: { item: OutboxItem }) {
  const body = item.body as { ownerName: string; mobile: string; pets: { name: string; species: string; processes: Process[] }[] };
  return (
    <div className="rounded-2xl border border-dashed border-salin-border-strong p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-salin-text">{body.ownerName}</p>
        <Tag tone={item.status === "attention" ? "attention" : "muted"}>{item.status === "attention" ? "Needs attention" : "Waiting to send"}</Tag>
      </div>
      {item.status === "attention" && item.lastError && <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{item.lastError.message}</p>}
      {body.pets.length > 0 && <p className="mt-1 text-xs text-salin-muted">{body.pets.map((pet) => `${pet.name} · ${services(pet.processes)}`).join(" · ")}</p>}
    </div>
  );
}

function StartRequest({ completed, onStart }: { completed: ProgramRequest | null; onStart: (input: { targetPeople: number; processes: Process[]; note: string }) => Promise<void> }) {
  const [target, setTarget] = useState("100");
  const [chosen, setChosen] = useState<Process[]>([...PROCESSES]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const targetPeople = Number(target);
  const valid = Number.isInteger(targetPeople) && targetPeople >= 1 && targetPeople <= 100000 && chosen.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onStart({ targetPeople, processes: chosen, note });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-md space-y-4 py-4">
      <div className="text-center">
        <p className="font-semibold text-salin-text">{completed ? "Your last program is completed" : "No active request"}</p>
        <p className="mt-1 text-sm text-salin-muted">
          {completed ? `${completed.programTitle ?? completed.reference} is done. Start the next request for your barangay.` : "Start one for your barangay. The other paravets assigned here can add owners to it too."}
        </p>
      </div>
      <label className="block text-sm font-medium text-salin-text">
        Owner target
        <input value={target} onChange={(event) => setTarget(event.target.value)} inputMode="numeric" className={cn(field, "mt-1.5")} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium text-salin-text">Services</legend>
        <ServiceToggles options={[...PROCESSES]} value={chosen} onChange={setChosen} />
      </fieldset>
      <label className="block text-sm font-medium text-salin-text">
        Note for City Vet <span className="font-normal text-salin-muted">(optional)</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} className={cn(field, "mt-1.5 h-auto py-2.5")} />
      </label>
      <button type="submit" disabled={!valid || busy} className={cn(primaryButton, "w-full")}>
        Start request
      </button>
    </form>
  );
}

export function ServiceToggles({ options, value, onChange, label }: { options: Process[]; value: Process[]; onChange: (next: Process[]) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="mt-1.5 flex flex-wrap gap-2">
      {options.map((process) => {
        const on = value.includes(process);
        return (
          <button
            key={process}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((item) => item !== process) : [...value, process])}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium ring-1 transition-colors", on ? "bg-salin-primary-soft text-salin-primary-ink ring-salin-primary/40" : "text-salin-muted ring-salin-border hover:text-salin-text")}
          >
            {on && <CircleCheck aria-hidden="true" className="size-3.5" />} {PROCESS_LABEL[process]}
          </button>
        );
      })}
    </div>
  );
}

type DraftPet = OwnerInput["pets"][number];

function OwnerDialog({ request, owner, listed, onClose, onSave }: { request: ProgramRequest; owner?: RequestOwner; listed: RequestOwner[]; onClose: () => void; onSave: (input: OwnerInput) => Promise<void> }) {
  const [ownerName, setOwnerName] = useState(owner?.owner_name ?? "");
  const [mobile, setMobile] = useState(owner?.mobile ?? "");
  const [pets, setPets] = useState<DraftPet[]>(owner?.pets.map((pet) => ({ name: pet.name, species: pet.species, sex: pet.sex ?? undefined, processes: pet.processes })) ?? [{ name: "", species: "Dog", processes: [...request.processes] }]);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = useOwnerSuggestions();
  const duplicates = possibleDuplicates(listed, { ownerName, mobile }, owner?.id);
  const setPet = (index: number, next: Partial<DraftPet>) => setPets((all) => all.map((pet, i) => (i === index ? { ...pet, ...next } : pet)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const named = pets.filter((pet) => pet.name.trim());
    const problem = !ownerName.trim() ? "Enter the owner's name." : mobile.trim() && !MOBILE.test(mobile.trim()) ? "Enter the mobile number as 09XX-XXX-XXXX, or leave it blank." : !named.length ? "Add at least one pet: an owner joins the request with their pets." : named.some((pet) => !pet.processes.length) ? "Choose at least one service for each pet." : null;
    if (problem) return setError(problem);
    if (duplicates.length && !confirmed) return setError(null);
    setBusy(true);
    try {
      await onSave({ ownerName, mobile, pets: named });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The owner couldn't be saved.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogTitle>{owner ? "Edit owner" : "Add owner"}</DialogTitle>
        <DialogDescription>Saved on this phone first, then sent to City Vet.</DialogDescription>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <label className="block text-sm font-medium text-salin-text">
            Owner name
            <OwnerNameInput
              autoFocus
              value={ownerName}
              owners={known}
              onChange={(name) => {
                setOwnerName(name);
                setConfirmed(false);
              }}
              onPick={(picked) => {
                // Fill in what's still empty; never overwrite what the paravet typed.
                if (!mobile.trim()) setMobile(picked.mobile);
                if (!pets.some((pet) => pet.name.trim()) && picked.pets.length) setPets(picked.pets.slice(0, 10).map((pet) => ({ ...pet, processes: [...request.processes] })));
              }}
              maxLength={120}
              className={cn(field, "mt-1.5")}
            />
          </label>
          <label className="block text-sm font-medium text-salin-text">
            Mobile <span className="font-normal text-salin-muted">(optional)</span>
            <input value={mobile} onChange={(event) => { setMobile(event.target.value); setConfirmed(false); }} inputMode="tel" placeholder="09XX-XXX-XXXX" className={cn(field, "mt-1.5")} />
          </label>

          <div className="space-y-3">
            <p className="text-sm font-medium text-salin-text">Pets <span className="font-normal text-salin-muted">(at least one)</span></p>
            {pets.map((pet, index) => (
              <fieldset key={index} className="space-y-2 rounded-xl p-3 ring-1 ring-salin-border">
                <legend className="sr-only">Pet {index + 1}</legend>
                <div className="flex gap-2">
                  <input aria-label={`Pet ${index + 1} name`} placeholder={`Pet ${index + 1} name`} value={pet.name} onChange={(event) => setPet(index, { name: event.target.value })} maxLength={80} className={cn(field, "h-10 min-w-0 flex-1 text-sm")} />
                  <div role="radiogroup" aria-label={`Pet ${index + 1} species`} className="seg-track flex shrink-0 rounded-xl bg-salin-tile p-1">
                    {(["Dog", "Cat"] as const).map((species) => (
                      <button key={species} type="button" role="radio" aria-checked={pet.species === species} onClick={() => setPet(index, { species })} className={cn("h-8 rounded-lg px-3 text-[13px] font-medium", pet.species === species ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted")}>
                        {species}
                      </button>
                    ))}
                  </div>
                  <button type="button" aria-label={`Remove pet ${index + 1}`} disabled={pets.length === 1} onClick={() => setPets((all) => all.filter((_, i) => i !== index))} className="grid size-10 shrink-0 place-items-center rounded-lg text-salin-muted hover:bg-salin-tile disabled:opacity-30">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <ServiceToggles label={`Pet ${index + 1} services`} options={request.processes} value={pet.processes} onChange={(processes) => setPet(index, { processes })} />
              </fieldset>
            ))}
            {pets.length < 10 && (
              <button type="button" onClick={() => setPets((all) => [...all, { name: "", species: "Dog", processes: [...request.processes] }])} className="text-sm font-semibold text-salin-primary-ink hover:underline">
                + Add a pet
              </button>
            )}
          </div>

          {duplicates.length > 0 && !confirmed && (
            <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
              <p>{duplicates.map((d) => d.owner_name).join(", ")} {duplicates.length === 1 ? "is" : "are"} already on this list with the same name or mobile.</p>
              <button type="button" onClick={() => setConfirmed(true)} className="mt-2 font-semibold underline">
                It's a different owner — save anyway
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose className="press h-10 rounded-xl px-4 text-sm font-medium text-salin-muted hover:bg-salin-tile">Cancel</DialogClose>
            <button type="submit" disabled={busy || (duplicates.length > 0 && !confirmed)} className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50">
              {owner ? "Save changes" : "Add owner"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
