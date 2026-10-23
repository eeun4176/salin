/**
 * City Vet API Tests
 * The request shape (Bearer token, no cookies, JSON) and how failures are
 * grouped: not configured, offline, signed out, conflict, invalid, server,
 * and replies that don't match what Salin expects.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AdminApiError, adminRequest } from "./admin-api";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const schema = z.object({ ok: z.literal(true) });

async function failure(promise: Promise<unknown>) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AdminApiError);
  return error as AdminApiError;
}

describe("adminRequest", () => {
  it("sends JSON with the Bearer token and no cookies, and checks the reply", async () => {
    const fetch = vi.fn(async () => reply(200, { ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await adminRequest("/auth/me", { method: "POST", token: "abc", body: { a: 1 }, schema })).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("https://ekapon.test/api/v1/auth/me", expect.objectContaining({ method: "POST", credentials: "omit", body: '{"a":1}' }));
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer abc", "Content-Type": "application/json" });
  });

  it("refuses to run when no City Vet server is configured", async () => {
    expect((await failure(adminRequest("/health", { schema }, null))).kind).toBe("not_configured");
  });

  it("groups failures and keeps the server's message", async () => {
    const cases: [number, string][] = [[401, "unauthenticated"], [403, "refused"], [409, "conflict"], [422, "invalid"], [503, "server"]];
    for (const [status, kind] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => reply(status, { error: { code: "SOME_CODE", message: "Server says no." } })));
      const error = await failure(adminRequest("/x", { schema }));
      expect([error.kind, error.code, error.message]).toEqual([kind, "SOME_CODE", "Server says no."]);
    }
  });

  it("treats a network failure as offline and an unexpected reply as a server problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect((await failure(adminRequest("/x", { schema }))).kind).toBe("offline");
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { ok: "yes" })));
    expect((await failure(adminRequest("/x", { schema }))).code).toBe("BAD_REPLY");
  });
});
