/**
 * Offline Sign-in
 * Lets someone who already signed in online on this device sign in again
 * with no connection. After each online sign-in the session is sealed with
 * AES-GCM under a key derived from their password (PBKDF2-SHA-256, 600,000
 * rounds, a random salt), one record per account; the password itself is
 * never stored. Opening the seal is the password check: a wrong password
 * can't decrypt it. The record is dropped when the office's server rejects
 * the account or password, so an old password stops working too.
 */

import type { Session } from "@/core/auth/local-auth";
import { db } from "@/core/storage/database";

// OWASP's current guidance for PBKDF2-HMAC-SHA256; about a second on a low-end phone, once per sign-in.
const ITERATIONS = 600_000;

interface Sealed {
  salt: Uint8Array;
  iv: Uint8Array;
  data: ArrayBuffer;
  iterations: number;
}

const recordKey = (identifier: string) => `offline-sign-in:${identifier.trim().toLowerCase()}`;

async function keyFor(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Seals `session` under `password`, replacing this account's earlier record. */
export async function sealSession(identifier: string, password: string, session: Session) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(session)));
  const sealed: Sealed = { salt, iv, data, iterations: ITERATIONS };
  await db.settings.put({ key: recordKey(identifier), value: sealed });
}

/** The sealed session, `null` when the password is wrong, or `undefined` when this account never signed in online here. */
export async function openSealedSession(identifier: string, password: string): Promise<Session | null | undefined> {
  const sealed = (await db.settings.get(recordKey(identifier)))?.value as Sealed | undefined;
  if (!sealed) return undefined;
  try {
    const key = await keyFor(password, sealed.salt, sealed.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.iv as BufferSource }, key, sealed.data);
    return JSON.parse(new TextDecoder().decode(plain)) as Session;
  } catch {
    return null;
  }
}

export async function forgetSealedSession(identifier: string) {
  await db.settings.delete(recordKey(identifier));
}
