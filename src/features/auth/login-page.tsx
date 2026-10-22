/**
 * Login Page
 * Where a paravet unlocks their local workspace with an Account Key and
 * password. Checks run on the device (see local-auth.ts), so it works with
 * no connection. Wrong or missing entries shake the field and explain what
 * to fix; a correct sign-in shows a short welcome while the workspace
 * opens, then returns to the page the user was trying to reach.
 */

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Check, CircleCheck, Eye, EyeOff, Key, Lock } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { validateLogin, type LoginErrors } from "@/core/auth/local-auth";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

type Phase = "form" | "checking" | "accepted" | "welcome";

const WRONG_CREDENTIALS = "That Account Key and password don't match. Check them and try again.";
// How long the workspace "loads" on the welcome view before it opens.
const WELCOME_MS = 1400;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms));

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const session = useAuthStore((state) => state.session);
  const ready = useAuthStore((state) => state.status === "ready");
  const signIn = useAuthStore((state) => state.signIn);

  const [phase, setPhase] = useState<Phase>("form");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Bumped on every failed attempt so the shake restarts even when the same field fails twice.
  const [attempt, setAttempt] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  // After render: the shaking field was re-mounted, so focus it only now.
  useEffect(() => {
    if (focusId) document.getElementById(focusId)?.focus();
  }, [focusId, attempt]);

  useEffect(() => {
    if (phase !== "welcome") return;
    const timer = setTimeout(() => navigate(from, { replace: true }), prefersReducedMotion() ? 0 : WELCOME_MS);
    return () => clearTimeout(timer);
  }, [phase, from, navigate]);

  // Already signed in (e.g. Back from the workspace): skip the form.
  if (ready && session && phase === "form") return <Navigate to={from} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "form") return;
    const found = validateLogin({ key, password });
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setAttempt((n) => n + 1);
      setFocusId(found.key ? "account-key" : "password");
      return;
    }
    setPhase("checking");
    const [ok] = await Promise.all([signIn({ key, password }), wait(650)]);
    if (!ok) {
      setPhase("form");
      setFormError(WRONG_CREDENTIALS);
      setAttempt((n) => n + 1);
      return;
    }
    setPhase("accepted");
    await wait(450);
    setPhase("welcome");
  }

  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-salin-canvas">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 -left-40 -z-10 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(1_168_90/0.10),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -bottom-40 -z-10 size-[560px] rounded-full bg-[radial-gradient(closest-side,rgb(1_168_90/0.10),transparent)]" />

      <header className="flex h-16 items-center justify-between px-4 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2 text-xs font-medium text-salin-muted">
          <OfflineBadge />
          <span className="rounded-full bg-salin-surface px-2.5 py-1 ring-1 ring-salin-border">Filipino / EN</span>
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[420px] rounded-[22px] border border-salin-border bg-salin-surface p-6 shadow-[0_1px_2px_rgb(16_24_20/0.04),0_12px_32px_-12px_rgb(16_24_20/0.12)] sm:p-8">
          {phase === "welcome" ? (
            <WelcomeView name={session?.name ?? ""} />
          ) : (
            <>
              <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-salin-text">Access Your Workspace</h1>
              <p className="mt-1.5 text-sm text-salin-muted">Enter your Account Key and password to unlock your local workspace.</p>

              <form noValidate onSubmit={submit} className="mt-6 space-y-4">
                <Field id="account-key" label="Account Key" icon={<Key />} error={errors.key} shake={attempt}>
                  {(props) => (
                    <input
                      {...props}
                      name="account-key"
                      autoComplete="username"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="e.g. PV2026-XXXXXX-0000"
                      value={key}
                      onChange={(event) => {
                        setKey(event.target.value);
                        if (errors.key) setErrors((e) => ({ ...e, key: undefined }));
                      }}
                    />
                  )}
                </Field>

                <Field
                  id="password"
                  label="Password"
                  icon={<Lock />}
                  error={errors.password}
                  shake={attempt}
                  aside={
                    <button type="button" onClick={() => setForgotOpen(true)} className="rounded text-xs font-medium text-salin-primary-ink hover:underline">
                      Forgot key?
                    </button>
                  }
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((shown) => !shown)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="grid size-9 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text [&_svg]:size-[18px]"
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </button>
                  }
                >
                  {(props) => (
                    <input
                      {...props}
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
                      }}
                    />
                  )}
                </Field>

                {formError && (
                  <p key={attempt} role="alert" className="animate-shake rounded-xl bg-[#FEF2F2] px-3 py-2.5 text-sm text-[#B91C1C] ring-1 ring-[#FECACA]">
                    {formError}
                  </p>
                )}

                <SubmitButton phase={phase} />
              </form>
            </>
          )}
        </div>
      </main>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogTitle>Forgot your key?</DialogTitle>
          <DialogDescription>
            Contact the City Veterinary Office to get your Account Key or reset your password. Your scans and datasets stay on this device.
          </DialogDescription>
          <div className="mt-5 flex justify-end">
            <DialogClose className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong">OK</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface InputProps {
  id: string;
  className: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
}

interface FieldProps {
  id: string;
  label: string;
  icon: ReactNode;
  error?: string;
  shake: number;
  aside?: ReactNode;
  trailing?: ReactNode;
  children: (props: InputProps) => ReactNode;
}

function Field({ id, label, icon, error, shake, aside, trailing, children }: FieldProps) {
  const errorId = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-salin-text">
          {label}
        </label>
        {aside}
      </div>
      {/* Keyed by attempt so a repeat error shakes again. */}
      <div key={error ? shake : "ok"} className={cn("relative", error && "animate-shake")}>
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-salin-subtle [&_svg]:size-[18px]">
          {icon}
        </span>
        {children({
          id,
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? errorId : undefined,
          className: cn(
            "h-[46px] w-full rounded-xl border border-salin-border bg-salin-surface pl-11 text-[15px] text-salin-text outline-none transition-[border-color,box-shadow] placeholder:text-salin-subtle",
            "focus-visible:outline-none focus:border-salin-primary focus:shadow-[0_0_0_0.5px_var(--color-salin-primary),0_0_0_4.5px_rgb(1_168_90/0.16)]",
            "aria-invalid:border-[#EF4444] aria-invalid:focus:shadow-[0_0_0_0.5px_#EF4444,0_0_0_4.5px_rgb(239_68_68/0.16)]",
            trailing ? "pr-12" : "pr-3.5",
          ),
        })}
        {trailing && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-[#B91C1C]">
          {error}
        </p>
      )}
    </div>
  );
}

function SubmitButton({ phase }: { phase: Phase }) {
  const accepted = phase === "accepted";
  return (
    <button
      type="submit"
      disabled={phase !== "form"}
      aria-live="polite"
      className={cn(
        "press relative isolate mt-2 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-[15px] font-semibold text-white transition-colors duration-300",
        accepted ? "bg-salin-primary-strong" : "bg-salin-primary hover:bg-salin-primary-strong",
      )}
    >
      {phase === "checking" && <span aria-hidden="true" className="animate-sheen absolute inset-y-0 -left-1/2 -z-10 w-1/2 bg-[linear-gradient(100deg,transparent,rgb(255_255_255/0.35),transparent)]" />}
      {accepted ? (
        <>
          <Check className="size-5" aria-hidden="true" /> Unlocked
        </>
      ) : phase === "checking" ? (
        "Checking…"
      ) : (
        "Unlock Workspace"
      )}
    </button>
  );
}

function WelcomeView({ name }: { name: string }) {
  return (
    <div role="status" className="flex flex-col items-center py-4 text-center">
      <svg viewBox="0 0 52 52" className="size-16" aria-hidden="true">
        <circle cx="26" cy="26" r="24" fill="none" stroke="var(--color-salin-primary)" strokeWidth="2.5" pathLength={1} className="animate-draw" />
        <path d="M15 27l7 7 15-16" fill="none" stroke="var(--color-salin-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className="animate-draw [animation-delay:250ms]" />
      </svg>
      <h1 className="mt-5 text-[22px] font-semibold text-salin-text">Welcome back, {name}</h1>
      <p className="mt-1.5 text-sm text-salin-muted">Opening your workspace…</p>
      <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-salin-tile">
        <div className="animate-fill-progress h-full origin-left rounded-full bg-salin-primary" style={{ animationDuration: `${WELCOME_MS}ms` }} />
      </div>
    </div>
  );
}

/** "Ready Offline" once the service worker controls the page (the app shell is cached). */
function OfflineBadge() {
  const [ready, setReady] = useState(() => typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller));
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const update = () => setReady(Boolean(sw.controller));
    sw.addEventListener("controllerchange", update);
    return () => sw.removeEventListener("controllerchange", update);
  }, []);
  if (!ready) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-salin-primary-soft px-2.5 py-1 text-salin-primary-ink">
      <CircleCheck className="size-3.5" aria-hidden="true" /> Ready Offline
    </span>
  );
}
