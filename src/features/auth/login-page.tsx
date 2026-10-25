/**
 * Login Page
 * Where a paravet (or City Vet staff member) signs in with the Account Key
 * (staff: username) and password the City Veterinary Office issued, in
 * floating-label fields. The first sign-in on a phone needs the internet;
 * after that the workspace opens, and signing in again works, offline (see
 * local-auth.ts). New accounts take a first
 * sign-in: the one-time temporary password, then their own password and the
 * paravet terms (English or Filipino). Wrong or missing entries shake the
 * field and explain what to fix; a correct sign-in shows a short welcome
 * while the workspace opens, then returns to the page the user wanted.
 */

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Check, CircleCheck, Eye, EyeOff, Key, Lock, WifiOff } from "lucide-react";

import { APP_SUBTITLE, Logo } from "@/components/brand/logo";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { startFirstSignIn, validateLogin, validateNewPassword, type LoginErrors, type ParavetPolicy } from "@/core/auth/local-auth";
import { useOnline } from "@/hooks/use-online";
import { prefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

type Phase = "form" | "checking" | "accepted" | "welcome";
/** signin: Account Key + password · first: temporary password · password: new password + terms. */
type Mode = "signin" | "first" | "password";

// How long the workspace "loads" on the welcome view before it opens.
const WELCOME_MS = 1400;

const COPY: Record<Mode, { title: string; help: string; submit: string }> = {
  signin: { title: "Access Your Workspace", help: "Sign in with your City Vet account.", submit: "Unlock Workspace" },
  first: { title: "First sign-in", help: "Use the temporary password from the office.", submit: "Continue" },
  password: { title: "Create your password", help: "8+ characters, with a letter and a number.", submit: "Save password and sign in" },
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, prefersReducedMotion() ? 0 : ms));

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const session = useAuthStore((state) => state.session);
  const ready = useAuthStore((state) => state.status === "ready");
  const signIn = useAuthStore((state) => state.signIn);
  const finishFirstSignIn = useAuthStore((state) => state.finishFirstSignIn);
  const online = useOnline();

  const [mode, setMode] = useState<Mode>("signin");
  const [phase, setPhase] = useState<Phase>("form");
  const [key, setKey] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped on every failed attempt so the shake restarts even when the same field fails twice.
  const [attempt, setAttempt] = useState(0);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [reset, setReset] = useState<{ token: string; policy: ParavetPolicy } | null>(null);
  const [language, setLanguage] = useState<"en" | "fil">("en");
  const [agreed, setAgreed] = useState({ terms: false, privacy: false });

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

  function switchMode(next: Mode, message: string | null = null) {
    setMode(next);
    setPassword("");
    setErrors({});
    setFormError(null);
    setNotice(message);
    setFocusId(next === "password" ? "new-password" : key ? "password" : "account-key");
  }

  function fail(message: string, field?: string) {
    setPhase("form");
    setFormError(message);
    setAttempt((n) => n + 1);
    if (field) setFocusId(field);
  }

  async function welcome() {
    setPhase("accepted");
    await wait(450);
    setPhase("welcome");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "form") return;
    setFormError(null);
    if (mode === "password") {
      const problem = validateNewPassword(newPassword, confirmPassword) ?? (!agreed.terms || !agreed.privacy ? "Accept the terms and acknowledge the privacy notice to continue." : null);
      if (problem) return fail(problem, agreed.terms && agreed.privacy ? "new-password" : undefined);
      setPhase("checking");
      const [result] = await Promise.all([finishFirstSignIn(reset!.token, { newPassword, confirmPassword, policyVersion: reset!.policy.version, policyLanguage: language }), wait(650)]);
      if (result.ok) return welcome();
      // The 10-minute reset token ran out: start over with a new temporary password.
      if (result.ended) {
        setPhase("form");
        return switchMode("first", "That took longer than 10 minutes. Ask the office for a new temporary password and start again.");
      }
      return fail(result.message);
    }
    const found = mode === "first" ? { ...(key.trim() ? {} : { key: "Enter your Account Key." }), ...(password ? {} : { password: "Enter the temporary password." }) } : validateLogin({ key, password });
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setAttempt((n) => n + 1);
      setFocusId(found.key ? "account-key" : "password");
      return;
    }
    setPhase("checking");
    if (mode === "first") {
      const [result] = await Promise.all([startFirstSignIn({ key, password }), wait(650)]);
      if (!result.ok) return fail(result.message, "password");
      setReset({ token: result.resetToken, policy: result.policy });
      setPhase("form");
      return switchMode("password");
    }
    const [result] = await Promise.all([signIn({ key, password }), wait(650)]);
    if (result.ok) return welcome();
    if (result.firstSignIn) {
      setPhase("form");
      return switchMode("first", "This account still has its temporary password. Enter it below to create your own password.");
    }
    fail(result.message, "password");
  }

  const copy = COPY[mode];
  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((shown) => !shown)}
      aria-label={showPassword ? "Hide password" : "Show password"}
      aria-pressed={showPassword}
      className="grid size-9 place-items-center rounded-lg text-salin-subtle hover:bg-salin-tile hover:text-salin-text [&_svg]:size-[18px]"
    >
      {showPassword ? <EyeOff /> : <Eye />}
    </button>
  );

  return (
    <div className="relative isolate flex min-h-[100dvh] flex-col overflow-hidden bg-salin-canvas">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 -left-40 -z-10 size-[520px] rounded-full bg-[radial-gradient(closest-side,rgb(1_168_90/0.10),transparent)]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -bottom-40 -z-10 size-[560px] rounded-full bg-[radial-gradient(closest-side,rgb(1_168_90/0.10),transparent)]" />

      <header className="flex h-16 items-center justify-between gap-3 px-4 sm:px-8">
        <Logo subtitleClassName="max-[600px]:hidden" />
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
              {/* The header hides the subtitle on phones: show it here instead. */}
              <p className="mb-1 text-xs font-medium text-salin-muted min-[601px]:hidden">{APP_SUBTITLE}</p>
              <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-salin-text">{copy.title}</h1>
              <p className="mt-1.5 text-sm text-salin-muted">{copy.help}</p>
              {!online && (
                <p role="status" className="mt-4 flex items-start gap-2 rounded-xl bg-salin-tile px-3 py-2.5 text-sm text-salin-text">
                  <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-salin-muted" /> You're offline. If you've signed in on this phone before, you can sign in now; a first sign-in needs the internet.
                </p>
              )}
              {notice && (
                <p role="status" className="mt-4 rounded-xl bg-salin-primary-soft px-3 py-2.5 text-sm text-salin-primary-ink">
                  {notice}
                </p>
              )}

              <form noValidate onSubmit={submit} className="mt-5 space-y-4">
                {mode !== "password" && (
                  <Field id="account-key" label="Account Key" icon={<Key />} error={errors.key} shake={attempt}>
                    {(props) => (
                      <input
                        {...props}
                        name="account-key"
                        autoComplete="username"
                        autoCapitalize={mode === "first" ? "characters" : "none"}
                        spellCheck={false}
                        value={key}
                        onChange={(event) => {
                          setKey(event.target.value);
                          if (errors.key) setErrors((e) => ({ ...e, key: undefined }));
                        }}
                      />
                    )}
                  </Field>
                )}

                {mode !== "password" ? (
                  <Field
                    id="password"
                    label={mode === "first" ? "Temporary password" : "Password"}
                    icon={<Lock />}
                    error={errors.password}
                    shake={attempt}
                    aside={
                      <button type="button" onClick={() => setForgotOpen(true)} className="rounded text-xs font-medium text-salin-primary-ink hover:underline">
                        Forgot key?
                      </button>
                    }
                    trailing={passwordToggle}
                  >
                    {(props) => (
                      <input
                        {...props}
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete={mode === "first" ? "one-time-code" : "current-password"}
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          if (errors.password) setErrors((e) => ({ ...e, password: undefined }));
                        }}
                      />
                    )}
                  </Field>
                ) : (
                  <>
                    <Field id="new-password" label="New password" icon={<Lock />} shake={attempt} trailing={passwordToggle}>
                      {(props) => <input {...props} name="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />}
                    </Field>
                    <Field id="confirm-password" label="Confirm new password" icon={<Lock />} shake={attempt}>
                      {(props) => <input {...props} name="confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />}
                    </Field>
                    {reset && <TermsAgreement policy={reset.policy} language={language} onLanguage={setLanguage} agreed={agreed} onAgreed={setAgreed} />}
                  </>
                )}

                {formError && (
                  <p key={attempt} role="alert" className="animate-shake rounded-xl bg-[#FEF2F2] px-3 py-2.5 text-sm text-[#B91C1C] ring-1 ring-[#FECACA]">
                    {formError}
                  </p>
                )}

                <SubmitButton phase={phase} label={copy.submit} />
              </form>

              {mode !== "password" && (
                <button
                  type="button"
                  onClick={() => switchMode(mode === "signin" ? "first" : "signin")}
                  className="mt-3 h-9 w-full rounded-lg text-center text-[13px] font-medium text-salin-muted hover:text-salin-primary-ink"
                >
                  {mode === "signin" ? "First time? Use your temporary password" : "Back to sign in"}
                </button>
              )}
            </>
          )}
        </div>
      </main>

      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent>
          <DialogTitle>Forgot your key?</DialogTitle>
          <DialogDescription>
            Contact the City Veterinary Office to get your Account Key or a new temporary password. Your scans and datasets stay on this device.
          </DialogDescription>
          <div className="mt-5 flex justify-end">
            <DialogClose className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong">OK</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TERMS_COPY = {
  en: { read: "Read the terms and privacy notice", terms: "I accept the Paravet Terms of Use.", privacy: "I have read and acknowledge the Privacy Notice, including its draft items.", close: "Close" },
  fil: { read: "Basahin ang tuntunin at abiso", terms: "Tinatanggap ko ang mga tuntunin sa paggamit para sa Paravet.", privacy: "Nabasa at kinikilala ko ang abiso sa pagkapribado, kasama ang mga hindi pa kumpletong detalye.", close: "Isara" },
};

/** The office's paravet terms (as e-Kapon serves them), in English or Filipino, with the two acknowledgements set-password requires. */
function TermsAgreement({ policy, language, onLanguage, agreed, onAgreed }: {
  policy: ParavetPolicy;
  language: "en" | "fil";
  onLanguage: (language: "en" | "fil") => void;
  agreed: { terms: boolean; privacy: boolean };
  onAgreed: (agreed: { terms: boolean; privacy: boolean }) => void;
}) {
  const [open, setOpen] = useState(false);
  const text = policy[language];
  const words = TERMS_COPY[language];
  const checkbox = "mt-0.5 size-[18px] shrink-0 accent-[var(--color-salin-primary)]";
  return (
    <section aria-label="Paravet terms" className="space-y-3 rounded-xl p-3.5 ring-1 ring-salin-border">
      <div role="radiogroup" aria-label="Terms language" className="flex gap-1 rounded-full bg-salin-tile p-1 text-[13px] font-medium">
        {(["en", "fil"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={language === value} onClick={() => onLanguage(value)} className={cn("h-8 flex-1 rounded-full", language === value ? "bg-salin-surface text-salin-text shadow-sm" : "text-salin-muted hover:text-salin-text")}>
            {value === "en" ? "English" : "Filipino"}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-salin-primary-ink hover:underline">
        {words.read}
      </button>
      <p className="text-xs text-salin-muted">{text.draft}</p>
      <label className="flex items-start gap-2.5 text-sm text-salin-text">
        <input type="checkbox" checked={agreed.terms} onChange={(event) => onAgreed({ ...agreed, terms: event.target.checked })} className={checkbox} />
        {words.terms}
      </label>
      <label className="flex items-start gap-2.5 text-sm text-salin-text">
        <input type="checkbox" checked={agreed.privacy} onChange={(event) => onAgreed({ ...agreed, privacy: event.target.checked })} className={checkbox} />
        {words.privacy}
      </label>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>City Veterinary Office · {policy.version}</DialogDescription>
          <div className="mt-4 space-y-4">
            <p className="rounded-xl bg-salin-tile p-3 text-sm text-salin-text">{text.draft}</p>
            {text.sections.map(([title, body]) => (
              <section key={title}>
                <h3 className="text-sm font-semibold text-salin-text">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-salin-muted">{body}</p>
              </section>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <DialogClose className="press h-10 rounded-xl bg-salin-primary px-4 text-sm font-semibold text-white hover:bg-salin-primary-strong">{words.close}</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface InputProps {
  id: string;
  /** One space, so the label can float while the field has text (:placeholder-shown). */
  placeholder: " ";
  className: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
}

interface FieldProps {
  id: string;
  label: string;
  /** Example shown under the field (the floating label takes the placeholder's place). */
  hint?: string;
  icon: ReactNode;
  error?: string;
  shake: number;
  aside?: ReactNode;
  trailing?: ReactNode;
  children: (props: InputProps) => ReactNode;
}

function Field({ id, label, hint, icon, error, shake, aside, trailing, children }: FieldProps) {
  const errorId = useId();
  const hintId = useId();
  return (
    <div>
      {/* Keyed by attempt so a repeat error shakes again. */}
      <div key={error ? shake : "ok"} className={cn("relative", error && "animate-shake")}>
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-salin-subtle [&_svg]:size-[18px]">
          {icon}
        </span>
        {children({
          id,
          placeholder: " ",
          "aria-invalid": Boolean(error),
          "aria-describedby": error ? errorId : hint ? hintId : undefined,
          className: cn(
            "peer h-[54px] w-full rounded-xl border border-salin-border bg-salin-surface pt-[21px] pb-1.5 pl-11 text-[15px] text-salin-text outline-none transition-[border-color,box-shadow]",
            "focus-visible:outline-none focus:border-salin-primary focus:ring-4 focus:ring-salin-primary/20",
            "aria-invalid:border-[#EF4444] aria-invalid:focus:ring-[#EF4444]/20",
            trailing ? "pr-12" : "pr-3.5",
          ),
        })}
        {/* Rests inside the field; lifts above the text on focus or once filled. */}
        <label
          htmlFor={id}
          className={cn(
            "pointer-events-none absolute top-[17px] left-11 origin-left text-[15px] leading-5 whitespace-nowrap text-salin-muted",
            "transition-[translate,scale,color] duration-[580ms] ease-[cubic-bezier(.32,.72,0,1)] motion-reduce:transition-none",
            "peer-focus:-translate-y-[10px] peer-focus:scale-[0.74] peer-focus:text-salin-primary",
            "peer-[:not(:placeholder-shown)]:-translate-y-[10px] peer-[:not(:placeholder-shown)]:scale-[0.74] peer-[:not(:placeholder-shown)]:text-salin-primary",
            "peer-aria-invalid:text-[#B91C1C]",
          )}
        >
          {label}
        </label>
        {trailing && <span className="absolute top-1/2 right-1.5 -translate-y-1/2">{trailing}</span>}
      </div>
      {(error || hint || aside) && (
        <div className="mt-1.5 flex items-start justify-between gap-3">
          {error ? (
            <p id={errorId} role="alert" className="text-[13px] text-[#B91C1C]">
              {error}
            </p>
          ) : (
            <p id={hintId} className="text-xs text-salin-subtle">
              {hint}
            </p>
          )}
          {aside}
        </div>
      )}
    </div>
  );
}

function SubmitButton({ phase, label }: { phase: Phase; label: string }) {
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
        label
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
