/**
 * Local Sign-in Tests
 * Field validation, the temporary account's key and password check, and the
 * session surviving in IndexedDB until sign-out.
 */

import { describe, expect, it } from "vitest";

import { getSession, signIn, signOut, validateLogin, verifyCredentials } from "./local-auth";

const KEY = "PV2026-TMP001-3023";
const PASSWORD = "changeme123";

describe("validateLogin", () => {
  it("requires a key and an 8+ character password", () => {
    expect(validateLogin({ key: "  ", password: "short" })).toEqual({ key: expect.any(String), password: expect.any(String) });
    expect(validateLogin({ key: KEY, password: PASSWORD })).toEqual({});
  });
});

describe("verifyCredentials", () => {
  it("accepts the temporary account, ignoring key case and spaces", async () => {
    expect(await verifyCredentials({ key: ` ${KEY.toLowerCase()} `, password: PASSWORD })).toEqual({ key: KEY, name: "Temporary Paravet" });
  });

  it("rejects a wrong password or unknown key", async () => {
    expect(await verifyCredentials({ key: KEY, password: "changeme124" })).toBeNull();
    expect(await verifyCredentials({ key: "PV2026-XXXXXX-0000", password: PASSWORD })).toBeNull();
  });
});

describe("session", () => {
  it("is saved on sign-in and cleared on sign-out", async () => {
    expect(await getSession()).toBeNull();
    expect(await signIn({ key: KEY, password: "wrong-password" })).toBeNull();
    expect(await getSession()).toBeNull();

    const session = await signIn({ key: KEY, password: PASSWORD });
    expect(session).toMatchObject({ key: KEY, name: "Temporary Paravet" });
    expect(await getSession()).toEqual(session);

    await signOut();
    expect(await getSession()).toBeNull();
  });
});
