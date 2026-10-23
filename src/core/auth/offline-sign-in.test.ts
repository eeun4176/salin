/**
 * Offline Sign-in Tests
 * A sealed session opens with the right password only, the password is not
 * kept in the record, accounts are kept apart, and forgetting removes it.
 */

import { describe, expect, it } from "vitest";

import type { Session } from "@/core/auth/local-auth";
import { db } from "@/core/storage/database";

import { forgetSealedSession, openSealedSession, sealSession } from "./offline-sign-in";

const SESSION: Session = { key: "PV2026-TMP001-3023", name: "Juana", role: "Paravet", barangayId: 4, barangay: "Assumption", token: "tok", expiresAt: 2, signedInAt: 1 };

describe("sealed sessions", () => {
  it("open only with the password they were sealed with", async () => {
    await sealSession(SESSION.key, "Strong-Pass-1", SESSION);
    expect(await openSealedSession(" pv2026-tmp001-3023 ", "Strong-Pass-1")).toEqual(SESSION);
    expect(await openSealedSession(SESSION.key, "Strong-Pass-2")).toBeNull();
    expect(await openSealedSession("PV2026-OTHER1-3023", "Strong-Pass-1")).toBeUndefined();
  });

  it("never store the password or the token in readable form", async () => {
    await sealSession(SESSION.key, "Strong-Pass-1", SESSION);
    const record = (await db.settings.get("offline-sign-in:pv2026-tmp001-3023"))?.value as { data: ArrayBuffer };
    const text = new TextDecoder().decode(record.data);
    expect(text).not.toContain("Strong-Pass-1");
    expect(text).not.toContain("Juana");
  });

  it("are gone once forgotten", async () => {
    await sealSession(SESSION.key, "Strong-Pass-1", SESSION);
    await forgetSealedSession(SESSION.key);
    expect(await openSealedSession(SESSION.key, "Strong-Pass-1")).toBeUndefined();
  });
});
