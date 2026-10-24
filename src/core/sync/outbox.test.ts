/**
 * Outbox Tests
 * Items go out oldest first with their id as the request id; offline and
 * signed-out stop the run and keep everything; server trouble backs off and
 * holds later items; a refusal needs attention while later items still go;
 * "already done" codes count as sent; and only the owner's session sends.
 */

import { describe, expect, it, vi } from "vitest";

import { db } from "@/core/storage/database";

import { discardItem, enqueue, flushOutbox, listOutbox, nextRetryAt, retryItem } from "./outbox";

const ME = { token: "tok", key: "PV2026-TMP001-3023" };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refuse = (status: number, code: string) => reply(status, { error: { code, message: `Server says ${code}.` } });
const add = (label: string, extra: Partial<Parameters<typeof enqueue>[0]> = {}) => enqueue({ account: ME.key, path: "/program-interest", body: { action: "add-interest", label }, label, ...extra });

function serve(...replies: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = replies.shift() ?? reply(200, { ok: true });
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("outbox", () => {
  it("sends items oldest first, with the Bearer token, and removes them once sent", async () => {
    await add("Add Ana");
    await add("Add Ben");
    const fetch = serve(reply(201, { personId: 1 }), reply(201, { personId: 2 }));
    expect(await flushOutbox(ME)).toEqual({ sent: 2, stopped: null });
    const bodies = fetch.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).label);
    expect(bodies).toEqual(["Add Ana", "Add Ben"]);
    expect(((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(await listOutbox()).toEqual([]);
  });

  it("keeps everything when offline or signed out", async () => {
    await add("Add Ana");
    serve(new TypeError("Failed to fetch"));
    expect(await flushOutbox(ME)).toEqual({ sent: 0, stopped: "offline" });
    serve(refuse(401, "UNAUTHENTICATED"));
    expect(await flushOutbox(ME)).toEqual({ sent: 0, stopped: "unauthenticated" });
    expect(await listOutbox()).toMatchObject([{ label: "Add Ana", status: "pending" }]);
  });

  it("backs off on server trouble and keeps later items behind it", async () => {
    await add("Add Ana");
    await add("Add Ben");
    let clock = 1_000_000;
    const fetch = serve(refuse(503, "DOWN"));
    expect(await flushOutbox(ME, () => clock)).toEqual({ sent: 0, stopped: "server" });
    expect(await nextRetryAt(ME.key)).toBe(clock + 5_000);
    expect(await flushOutbox(ME, () => clock)).toEqual({ sent: 0, stopped: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    clock += 5_000;
    expect(await flushOutbox(ME, () => clock)).toEqual({ sent: 2, stopped: null });
  });

  it("parks a refused item for attention, still sends later ones, and can retry or discard it", async () => {
    const refused = await add("Add Ana");
    await add("Add Ben");
    serve(refuse(409, "STALE_EDIT"), reply(201, {}));
    expect(await flushOutbox(ME)).toEqual({ sent: 1, stopped: null });
    expect(await listOutbox()).toMatchObject([{ id: refused, status: "attention", lastError: { code: "STALE_EDIT" } }]);
    await retryItem(refused);
    expect(await db.outbox.get(refused)).toMatchObject({ status: "pending" });
    await discardItem(refused);
    expect(await listOutbox()).toEqual([]);
  });

  it("counts an 'already done' answer as sent and leaves other accounts' items alone", async () => {
    await add("Withdraw Ana", { doneIfCodes: ["NOT_FOUND"] });
    await enqueue({ account: "PV2026-OTHER1-3023", path: "/program-interest", body: {}, label: "Someone else's" });
    serve(refuse(404, "NOT_FOUND"));
    expect(await flushOutbox(ME)).toEqual({ sent: 1, stopped: null });
    expect(await listOutbox()).toMatchObject([{ label: "Someone else's", status: "pending" }]);
  });
});
