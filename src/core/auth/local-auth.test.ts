/**
 * Sign-in Tests
 * Field and new-password rules; sign-in against a stubbed City Vet API
 * (the saved session, wrong passwords, accounts that still need their first
 * sign-in); first sign-in from temporary password to a signed-in session;
 * the background re-check that keeps, updates or ends the session; offline
 * sign-in for accounts that signed in here before; and token renewal.
 */

import { describe, expect, it, vi } from "vitest";

import { db } from "@/core/storage/database";

import { finishFirstSignIn, getSession, refreshSession, shouldRenew, signIn, signOut, startFirstSignIn, validateLogin, validateNewPassword } from "./local-auth";

const KEY = "PV2026-TMP001-3023";
const PASSWORD = "Strong-Pass-1";
const ACCOUNT = { id: 7, type: "Paravet", name: "Juana Dela Cruz", username: null, accountKey: KEY, barangayId: 4, barangay: "Assumption" };
const POLICY = { title: "Terms", draft: "Draft", sections: [["Use", "Only for office work."]] };

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const error = (status: number, code: string, message: string) => reply(status, { error: { code, message } });

/** Stubs fetch with one reply per call, in order, and records each request. */
function serve(...replies: Response[]) {
  const fetch = vi.fn(async () => replies.shift() ?? reply(500, {}));
  vi.stubGlobal("fetch", fetch);
  return (call: number) => {
    const [url, init] = fetch.mock.calls[call] as unknown as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
  };
}

describe("field rules", () => {
  it("requires a key and an 8+ character password", () => {
    expect(validateLogin({ key: "  ", password: "short" })).toEqual({ key: expect.any(String), password: expect.any(String) });
    expect(validateLogin({ key: KEY, password: PASSWORD })).toEqual({});
  });

  it("asks for a new password with a letter and a number, typed twice", () => {
    expect(validateNewPassword("abcdefgh", "abcdefgh")).toMatch(/letter and a number/);
    expect(validateNewPassword("abcdefg1", "abcdefg2")).toMatch(/don't match/);
    expect(validateNewPassword("abcdefg1", "abcdefg1")).toBeNull();
  });
});

describe("signIn", () => {
  it("signs in as Salin and keeps the session (token, role, barangay) on the device", async () => {
    const request = serve(reply(200, { account: ACCOUNT, token: "tok", expiresAt: "2026-11-07T00:00:00.000Z" }));
    const result = await signIn({ key: ` ${KEY} `, password: PASSWORD });
    expect(request(0)).toMatchObject({ url: "https://ekapon.test/api/v1/auth/login", body: { identifier: KEY, password: PASSWORD, client: "salin" } });
    expect(result).toMatchObject({ ok: true, session: { key: KEY, name: "Juana Dela Cruz", role: "Paravet", barangay: "Assumption", barangayId: 4, token: "tok", expiresAt: Date.parse("2026-11-07T00:00:00.000Z") } });
    expect(await getSession()).toMatchObject({ token: "tok", role: "Paravet" });
    await signOut();
    expect(await getSession()).toBeNull();
  });

  it("explains wrong passwords, and sends accounts with a temporary password to first sign-in", async () => {
    serve(error(401, "INVALID_CREDENTIALS", "The username/account key or password is incorrect."), error(403, "FIRST_SIGN_IN_REQUIRED", "Use the first sign-in."));
    expect(await signIn({ key: KEY, password: "wrong-pass1" })).toEqual({ ok: false, firstSignIn: false, message: expect.stringContaining("don't match") });
    expect(await signIn({ key: KEY, password: "temp-pass1" })).toMatchObject({ ok: false, firstSignIn: true });
    expect(await getSession()).toBeNull();
  });

  it("treats a session saved before real accounts (no token) as signed out", async () => {
    await db.settings.put({ key: "session", value: { key: KEY, name: "Temporary Paravet", signedInAt: 1 } });
    expect(await getSession()).toBeNull();
  });
});

describe("first sign-in", () => {
  it("trades the temporary password for a reset token and the terms, then signs in with the new password", async () => {
    const request = serve(
      reply(200, { mustCreatePassword: true, token: "reset", expiresAt: "2026-10-24T00:10:00.000Z", policy: { version: "2026-10-20-draft-1", en: POLICY, fil: POLICY } }),
      reply(200, { account: ACCOUNT, token: "full", expiresAt: "2026-11-07T00:00:00.000Z" }),
    );
    const started = await startFirstSignIn({ key: KEY.toLowerCase(), password: "Temp1234" });
    expect(started).toMatchObject({ ok: true, resetToken: "reset", policy: { version: "2026-10-20-draft-1" } });
    expect(request(0).body).toEqual({ accountKey: KEY, temporaryPassword: "Temp1234", client: "salin" });

    const finished = await finishFirstSignIn("reset", { newPassword: PASSWORD, confirmPassword: PASSWORD, policyVersion: "2026-10-20-draft-1", policyLanguage: "fil" });
    expect(request(1)).toMatchObject({ url: "https://ekapon.test/api/v1/auth/set-password", headers: { Authorization: "Bearer reset" }, body: { acceptedTerms: true, acknowledgedPrivacy: true, policyLanguage: "fil" } });
    expect(finished).toMatchObject({ ok: true, session: { token: "full" } });
    expect(await getSession()).toMatchObject({ token: "full" });
  });

  it("says when the 10-minute reset token has run out", async () => {
    serve(error(401, "UNAUTHENTICATED", "Please sign in again."));
    expect(await finishFirstSignIn("old", { newPassword: PASSWORD, confirmPassword: PASSWORD, policyVersion: "v", policyLanguage: "en" })).toMatchObject({ ok: false, ended: true });
  });
});

describe("refreshSession", () => {
  async function signedIn() {
    serve(reply(200, { account: ACCOUNT, token: "tok", expiresAt: "2026-11-07T00:00:00.000Z" }));
    const result = await signIn({ key: KEY, password: PASSWORD });
    if (!result.ok) throw new Error("sign-in failed");
    return result.session;
  }

  it("picks up a changed barangay, keeps the session offline, and ends it when the office does", async () => {
    const session = await signedIn();
    serve(reply(200, { account: { ...ACCOUNT, barangayId: 9, barangay: "Kaypian" } }));
    expect(await refreshSession(session)).toMatchObject({ token: "tok", barangay: "Kaypian", signedInAt: session.signedInAt });
    expect(await getSession()).toMatchObject({ barangay: "Kaypian" });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await refreshSession(session)).toBe(session);

    serve(error(401, "UNAUTHENTICATED", "Your account is on hold."));
    expect(await refreshSession(session)).toBeNull();
  });
});

describe("offline sign-in", () => {
  const offline = () => vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));

  it("lets an account that signed in online here sign in again with no connection", async () => {
    serve(reply(200, { account: ACCOUNT, token: "tok", expiresAt: "2026-11-07T00:00:00.000Z" }));
    await signIn({ key: KEY, password: PASSWORD });
    await signOut();

    offline();
    expect(await signIn({ key: KEY.toLowerCase(), password: "Wrong-Pass-1" })).toMatchObject({ ok: false, message: expect.stringContaining("don't match") });
    expect(await signIn({ key: KEY, password: PASSWORD })).toMatchObject({ ok: true, session: { key: KEY, token: "tok", barangay: "Assumption" } });
    expect(await getSession()).toMatchObject({ token: "tok" });
  });

  it("needs the internet for an account that never signed in here, and forgets the copy once the office rejects the password", async () => {
    offline();
    expect(await signIn({ key: KEY, password: PASSWORD })).toMatchObject({ ok: false, message: expect.stringContaining("first sign-in") });

    serve(reply(200, { account: ACCOUNT, token: "tok", expiresAt: "2026-11-07T00:00:00.000Z" }));
    await signIn({ key: KEY, password: PASSWORD });
    serve(error(401, "INVALID_CREDENTIALS", "The username/account key or password is incorrect."));
    await signIn({ key: KEY, password: PASSWORD });
    offline();
    expect(await signIn({ key: KEY, password: PASSWORD })).toMatchObject({ ok: false, message: expect.stringContaining("first sign-in") });
  });
});

describe("token renewal", () => {
  it("renews a token past half its life while online and keeps the sign-in time", async () => {
    serve(reply(200, { account: ACCOUNT, token: "old", expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }));
    const result = await signIn({ key: KEY, password: PASSWORD });
    if (!result.ok) throw new Error("sign-in failed");
    const halfway = { ...result.session, tokenIssuedAt: Date.now() - 8 * 86_400_000, expiresAt: Date.now() + 6 * 86_400_000 };
    expect(shouldRenew(result.session)).toBe(false);
    expect(shouldRenew(halfway)).toBe(true);

    const request = serve(reply(200, { account: ACCOUNT, token: "new", expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }));
    const renewed = await refreshSession(halfway);
    expect(request(0)).toMatchObject({ url: "https://ekapon.test/api/v1/auth/renew", headers: { Authorization: "Bearer old" } });
    expect(renewed).toMatchObject({ token: "new", signedInAt: result.session.signedInAt });
    expect(shouldRenew(renewed!)).toBe(false);
    expect(await getSession()).toMatchObject({ token: "new" });
  });
});
