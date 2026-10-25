/**
 * Reset Email Card (Settings, paravets only)
 * The email City Vet sends password reset codes to. The paravet types it,
 * gets a 6-digit code there and enters it; only then does City Vet save it,
 * so a mistyped address never receives reset codes. Needs the internet:
 * offline, the card says so.
 */

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

import { Input } from "@/components/ui/input";
import { confirmEmail, getAccountEmail, sendEmailCode } from "@/core/auth/local-auth";
import { SectionCard } from "@/features/settings/section-card";
import { useOnline } from "@/hooks/use-online";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "@/stores/toast-store";

const button =
  "press inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ring-1 ring-salin-border hover:bg-salin-tile disabled:opacity-50";
const primary = "press inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong disabled:opacity-50";

export function ResetEmailCard() {
  const session = useAuthStore((state) => state.session);
  const online = useOnline();
  // undefined: not known yet (loading, or offline).
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [step, setStep] = useState<"view" | "email" | "code">("view");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = session?.role === "Paravet" ? session.token : null;

  useEffect(() => {
    if (!token || !online) return;
    let live = true;
    getAccountEmail(token).then(
      (value) => live && setCurrent(value),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [token, online]);

  if (!token) return null;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      await sendEmailCode(token, email);
      setCode("");
      setStep("code");
    });

  return (
    <SectionCard icon={Mail} title="Email for password reset" id="reset-email-heading">
      <p className="text-sm text-salin-muted">If you forget your password, City Vet emails a 6-digit reset code to this address. It isn't used for anything else.</p>

      {step === "view" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-salin-text" role="status">
            {current ? (
              <>
                Codes go to <strong className="font-semibold break-all">{current}</strong>.
              </>
            ) : current === null ? (
              "No email yet. Add one so you can reset a forgotten password yourself."
            ) : online ? (
              "Checking…"
            ) : (
              "Connect to the internet to see or change it."
            )}
          </p>
          <button
            type="button"
            disabled={!online}
            onClick={() => {
              setEmail(current ?? "");
              setError(null);
              setStep("email");
            }}
            className={button}
          >
            {current ? "Change email" : "Add email"}
          </button>
        </div>
      )}

      {step === "email" && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="block text-sm font-medium text-salin-text" htmlFor="reset-email">
            Email address
          </label>
          <Input id="reset-email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="h-10" />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setStep("view")} className={button}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !email.trim() || !online} className={primary}>
              {busy ? "Sending…" : "Send code"}
            </button>
          </div>
        </form>
      )}

      {step === "code" && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const saved = await confirmEmail(token, code);
              setCurrent(saved);
              setStep("view");
              toast("Email confirmed. Reset codes will go there.");
            });
          }}
        >
          <p className="text-sm text-salin-text" role="status">
            We sent a 6-digit code to <strong className="font-semibold break-all">{email.trim()}</strong>. It expires in 10 minutes; check the spam folder too.
          </p>
          <label className="block text-sm font-medium text-salin-text" htmlFor="reset-email-code">
            Code from the email
          </label>
          <Input
            id="reset-email-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            className="h-10 max-w-40 tracking-[0.3em]"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setStep("view")} className={button}>
              Cancel
            </button>
            <button type="button" disabled={busy || !online} onClick={() => void send()} className={button}>
              Send again
            </button>
            <button type="submit" disabled={busy || code.length !== 6 || !online} className={primary}>
              {busy ? "Checking…" : "Confirm email"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
