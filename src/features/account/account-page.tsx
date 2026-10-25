/**
 * Account Page (/account)
 * The signed-in person's details from City Vet, shown locked (City Vet
 * changes them in e-Kapon): name, role, Account Key and barangay. Only the
 * profile photo can be changed here, and it stays on this device. Paravets
 * also set the email their password reset codes go to.
 */

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";

import { PageFrame } from "@/components/layout/page-frame";
import { ResetEmailCard } from "@/features/account/reset-email-card";
import { roleLabel } from "@/core/auth/local-auth";
import { useAuthStore } from "@/stores/auth-store";
import { useProfilePhotoStore } from "@/stores/profile-photo-store";
import { toast } from "@/stores/toast-store";

const smallButton =
  "press inline-flex h-9 items-center justify-center rounded-lg px-3 text-[13px] font-semibold text-salin-text ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";

export function AccountPage() {
  const session = useAuthStore((s) => s.session);
  const { photo, load, change, remove } = useProfilePhotoStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (session) void load(session.key);
  }, [session, load]);
  if (!session) return null;

  const initials = session.name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const details: [string, string | null][] = [
    ["Full name", session.name],
    ["Role", roleLabel(session.role)],
    [session.role === "Paravet" ? "Account Key" : "Username", session.key],
    ["Barangay", session.barangay],
  ];

  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      await change(session!.key, file);
      toast("Photo updated on this device.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "That photo couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame title="Account" description="How you appear in e-Vet. City Vet manages your name, role and barangay.">
      <div className="space-y-5">
        <section aria-label="Your account" className="rounded-2xl p-5 shadow-sm ring-1 ring-salin-border sm:p-6">
          <div className="flex flex-wrap items-center gap-4 border-b border-salin-border pb-5">
            <span className="relative shrink-0">
              {photo ? (
                <img src={photo} alt="Your profile" className="size-16 rounded-full object-cover ring-1 ring-salin-border" />
              ) : (
                <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-salin-primary-soft text-xl font-semibold text-salin-primary-ink">
                  {initials}
                </span>
              )}
              <span aria-hidden="true" className="absolute right-0.5 bottom-0.5 size-3.5 rounded-full bg-salin-primary ring-2 ring-salin-surface" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-salin-text">{session.name}</p>
              <p className="truncate text-sm text-salin-muted">{[roleLabel(session.role), session.barangay].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className={smallButton}>
                {busy ? "Saving…" : "Upload photo"}
              </button>
              {photo && (
                <button type="button" disabled={busy} onClick={() => void remove(session.key)} className={smallButton}>
                  Remove
                </button>
              )}
              <input
                ref={input}
                type="file"
                accept="image/*"
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          </div>
          <dl className="grid gap-4 pt-5 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm font-medium text-salin-text">{label}</dt>
                <dd title="Locked" className="mt-1.5 flex h-11 cursor-not-allowed items-center gap-2 rounded-xl bg-salin-tile px-3.5 text-sm font-medium text-salin-text">
                  <span className="min-w-0 flex-1 truncate">{value || <span className="font-normal text-salin-subtle">Not set</span>}</span>
                  <Lock aria-label="Locked" className="size-3.5 shrink-0 text-salin-subtle" />
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-salin-muted">Your photo stays on this device. It is never sent to City Vet.</p>
        </section>
        <ResetEmailCard />
      </div>
    </PageFrame>
  );
}
