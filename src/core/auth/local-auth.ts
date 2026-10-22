/**
 * Local Sign-in
 * Checks a paravet's Account Key and password on this device and keeps the
 * signed-in session in IndexedDB, so sign-in works offline. For now there is
 * one temporary account; the City Vet admin system will issue real ones.
 * Signing out only forgets the session — documents and datasets stay.
 */

import { db } from "@/core/storage/database";

export interface Account {
  key: string;
  name: string;
}

export interface Session extends Account {
  signedInAt: number;
}

export interface LoginInput {
  key: string;
  password: string;
}

export type LoginErrors = Partial<Record<keyof LoginInput, string>>;

export const MIN_PASSWORD_LENGTH = 8;
const SESSION_KEY = "session";

// shortcut: credentials are checked on-device against a bundled hash; replace with the City Vet admin API when it exists.
const ACCOUNTS: (Account & { passwordSha256: string })[] = [
  { key: "PV2026-TMP001-3023", name: "Temporary Paravet", passwordSha256: "494a715f7e9b4071aca61bac42ca858a309524e5864f0920030862a4ae7589be" },
];

export const normalizeKey = (key: string) => key.trim().toUpperCase();

/** Field errors before anything is checked: the key is required and the password needs 8+ characters. */
export function validateLogin({ key, password }: LoginInput): LoginErrors {
  const errors: LoginErrors = {};
  if (!normalizeKey(key)) errors.key = "Enter your Account Key.";
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  return errors;
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The account these credentials belong to, or `null` when the key or password is wrong. */
export async function verifyCredentials({ key, password }: LoginInput): Promise<Account | null> {
  const account = ACCOUNTS.find((candidate) => candidate.key === normalizeKey(key));
  if (!account || (await sha256Hex(password)) !== account.passwordSha256) return null;
  return { key: account.key, name: account.name };
}

export async function getSession(): Promise<Session | null> {
  const saved = (await db.settings.get(SESSION_KEY))?.value as Session | undefined;
  return saved?.key ? saved : null;
}

export async function signIn(input: LoginInput): Promise<Session | null> {
  const account = await verifyCredentials(input);
  if (!account) return null;
  const session: Session = { ...account, signedInAt: Date.now() };
  await db.settings.put({ key: SESSION_KEY, value: session });
  return session;
}

export async function signOut() {
  await db.settings.delete(SESSION_KEY);
}
