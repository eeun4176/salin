/**
 * Sign-in
 * Paravets (and City Vet staff, for program day) sign in with the accounts
 * the City Veterinary Office's admin system issues: an Account Key (staff: a
 * username) and password, checked online by the City Vet API. The session —
 * its token, role and assigned barangay — is then kept in IndexedDB, so Salin
 * keeps opening offline. While online, a token past half its life is renewed
 * quietly, so active users rarely sign in again; one that expired (14 days
 * offline) or an account the office put on hold asks to sign in again.
 * Someone who signed in online on this device before can also sign in again
 * with no connection (offline-sign-in.ts).
 * New accounts start with a one-time temporary password: first sign-in
 * swaps it for their own password and records the paravet terms. Signing
 * out only forgets the session — documents and datasets stay.
 */

import { z } from "zod";

import { AdminApiError, adminRequest } from "@/core/admin/admin-api";
import { forgetSealedSession, openSealedSession, sealSession } from "@/core/auth/offline-sign-in";
import { db } from "@/core/storage/database";

export type Role = "Paravet" | "Admin" | "SuperAdmin";

export interface Account {
  /** Account Key (paravets) or username (staff), shown under the name. */
  key: string;
  name: string;
  role: Role;
  barangayId: number | null;
  barangay: string | null;
}

export interface Session extends Account {
  signedInAt: number;
  token: string;
  /** Epoch ms when the token stops working; sign in again after it. */
  expiresAt: number;
  /** When this token was issued; it is renewed once half its life has passed. */
  tokenIssuedAt?: number;
}

export interface LoginInput {
  key: string;
  password: string;
}

export type LoginErrors = Partial<Record<keyof LoginInput, string>>;

/** `ended`: the server no longer accepts the token used (e.g. first sign-in's 10-minute reset token ran out). */
export type SignInResult = { ok: true; session: Session } | { ok: false; firstSignIn: boolean; ended?: boolean; message: string };

export const MIN_PASSWORD_LENGTH = 8;
const SESSION_KEY = "session";

export const normalizeKey = (key: string) => key.trim().toUpperCase();

/** Field errors before anything is checked: the key is required and the password needs 8+ characters. */
export function validateLogin({ key, password }: LoginInput): LoginErrors {
  const errors: LoginErrors = {};
  if (!key.trim()) errors.key = "Enter your Account Key.";
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return errors;
}

/** e-Kapon's own rule for a new password: 8+ characters with a letter and a number, typed the same twice. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use at least 8 characters with a letter and a number.";
  if (password !== confirm) return "The passwords don't match.";
  return null;
}

const accountReply = z.object({
  id: z.number(),
  type: z.enum(["Paravet", "Admin", "SuperAdmin"]),
  name: z.string(),
  username: z.string().nullish(),
  accountKey: z.string().nullish(),
  barangayId: z.number().nullish(),
  barangay: z.string().nullish(),
});
const tokenReply = z.object({ token: z.string().min(1), expiresAt: z.string() });
const sessionReply = tokenReply.extend({ account: accountReply });

const policySchema = z.object({ title: z.string(), draft: z.string(), sections: z.array(z.tuple([z.string(), z.string()])) });
const firstSignInReply = tokenReply.extend({ mustCreatePassword: z.literal(true), policy: z.object({ version: z.string(), en: policySchema, fil: policySchema }) });
export type ParavetPolicy = z.infer<typeof firstSignInReply>["policy"];

function toSession({ account, token, expiresAt }: z.infer<typeof sessionReply>): Session {
  return {
    key: account.accountKey ?? account.username ?? "",
    name: account.name,
    role: account.type,
    barangayId: account.barangayId ?? null,
    barangay: account.barangay ?? null,
    token,
    expiresAt: Date.parse(expiresAt),
    signedInAt: Date.now(),
    tokenIssuedAt: Date.now(),
  };
}

const save = async (session: Session) => {
  await db.settings.put({ key: SESSION_KEY, value: session });
  return session;
};

const failure = (error: unknown, firstSignIn = false): SignInResult => {
  if (!(error instanceof AdminApiError)) throw error;
  if (error.code === "INVALID_CREDENTIALS") return { ok: false, firstSignIn, message: "That Account Key and password don't match. Check them and try again." };
  if (error.kind === "offline") return { ok: false, firstSignIn, message: "You're offline, and this account hasn't signed in on this phone yet. Connect to the internet for the first sign-in." };
  return { ok: false, firstSignIn: firstSignIn || error.code === "FIRST_SIGN_IN_REQUIRED", ended: error.kind === "unauthenticated", message: error.message };
};

/** The saved session; sessions from before real accounts (no token) count as signed out. */
export async function getSession(): Promise<Session | null> {
  const saved = (await db.settings.get(SESSION_KEY))?.value as Session | undefined;
  return saved?.key && saved.token ? saved : null;
}

/** Signs in online; with no connection, opens the session sealed at this account's last online sign-in on this device. */
export async function signIn({ key, password }: LoginInput): Promise<SignInResult> {
  try {
    const reply = await adminRequest("/auth/login", { method: "POST", body: { identifier: key.trim(), password, client: "salin" }, schema: sessionReply });
    const session = toSession(reply);
    await sealSession(key, password, session);
    return { ok: true, session: await save(session) };
  } catch (error) {
    if (error instanceof AdminApiError && error.kind === "offline") {
      const sealed = await openSealedSession(key, password);
      if (sealed) return { ok: true, session: await save({ ...sealed, signedInAt: Date.now() }) };
      if (sealed === null) return { ok: false, firstSignIn: false, message: "That Account Key and password don't match. Check them and try again." };
    }
    // The office rejected this account or password: an older sealed copy must not keep working offline.
    if (error instanceof AdminApiError && (error.kind === "unauthenticated" || error.kind === "refused")) await forgetSealedSession(key);
    return failure(error);
  }
}

/** First sign-in, step 1: the temporary password gives a 10-minute token that can only set the new password, plus the terms to accept. */
export async function startFirstSignIn({ key, password }: LoginInput): Promise<{ ok: true; resetToken: string; policy: ParavetPolicy } | Extract<SignInResult, { ok: false }>> {
  try {
    const reply = await adminRequest("/auth/first-signin", { method: "POST", body: { accountKey: normalizeKey(key), temporaryPassword: password, client: "salin" }, schema: firstSignInReply });
    return { ok: true, resetToken: reply.token, policy: reply.policy };
  } catch (error) {
    return failure(error, true) as Extract<SignInResult, { ok: false }>;
  }
}

export interface NewPassword {
  newPassword: string;
  confirmPassword: string;
  policyVersion: string;
  policyLanguage: "en" | "fil";
}

/** First sign-in, step 2: the new password and the accepted terms; signs in. */
export async function finishFirstSignIn(resetToken: string, input: NewPassword): Promise<SignInResult> {
  try {
    const reply = await adminRequest("/auth/set-password", { method: "POST", token: resetToken, body: { ...input, acceptedTerms: true, acknowledgedPrivacy: true }, schema: sessionReply });
    const session = toSession(reply);
    await sealSession(session.key, input.newPassword, session);
    return { ok: true, session: await save(session) };
  } catch (error) {
    return failure(error, true);
  }
}

/** True once half of the token's life has passed. */
export function shouldRenew(session: Session, now = Date.now()) {
  const issued = session.tokenIssuedAt ?? session.signedInAt;
  return now - issued > (session.expiresAt - issued) / 2;
}

/**
 * Online, re-reads the account (barangay or name changes) — renewing the
 * token when half its life has passed — and returns the updated session, or
 * `null` when the office ended it (expired, on hold, archived). Offline or on
 * a server error the saved session simply stays.
 */
export async function refreshSession(session: Session): Promise<Session | null> {
  try {
    if (shouldRenew(session)) {
      const reply = await adminRequest("/auth/renew", { method: "POST", token: session.token, schema: sessionReply });
      return save({ ...toSession(reply), signedInAt: session.signedInAt });
    }
    const { account } = await adminRequest("/auth/me", { token: session.token, schema: z.object({ account: accountReply }) });
    return save({ ...toSession({ account, token: session.token, expiresAt: new Date(session.expiresAt).toISOString() }), signedInAt: session.signedInAt, tokenIssuedAt: session.tokenIssuedAt });
  } catch (error) {
    if (error instanceof AdminApiError && error.kind === "unauthenticated") return null;
    return session;
  }
}

export async function signOut() {
  await db.settings.delete(SESSION_KEY);
}
