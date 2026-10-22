/**
 * City Vet Handwriting Server Tests
 * Switched off without an address; readings that don't fit their row (wrong
 * number of characters, characters a box can't hold, unknown rows) are
 * dropped; malformed answers and server errors are explained.
 */

import { describe, expect, it } from "vitest";

import { CityVetReaderError, fitsRow, readOnCityVetServer, type ServerRow } from "./city-vet-reader";

const rows: ServerRow[] = [
  { id: "owner_name.0", image: "data:image/png;base64,AA==", boxes: 6, allowed: "ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
  { id: "contact.0", image: "data:image/png;base64,AA==", boxes: 11, allowed: "0123456789" },
];

const server = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("City Vet handwriting server", () => {
  it("is off until its address is set", async () => {
    await expect(readOnCityVetServer(rows, { url: null })).rejects.toBeInstanceOf(CityVetReaderError);
  });

  it("keeps only readings that fit their boxes", async () => {
    const readings = await readOnCityVetServer(rows, {
      url: "https://cvo.example",
      fetch: server({
        rows: [
          { id: "owner_name.0", text: "ian cab", confidence: 0.9 },
          { id: "contact.0", text: "0917123456", confidence: 0.99 },
          { id: "unknown", text: "X", confidence: 1 },
        ],
      }),
    });
    expect(readings).toEqual([{ id: "owner_name.0", text: "IAN CAB", confidence: 0.9 }]);
    expect(fitsRow("0917 123 4567", rows[1])).toBe(true);
    expect(fitsRow("0917I234567", rows[1])).toBe(false);
  });

  it("explains malformed answers and errors", async () => {
    await expect(readOnCityVetServer(rows, { url: "https://cvo.example", fetch: server({ nope: true }) })).rejects.toThrow("doesn't understand");
    await expect(readOnCityVetServer(rows, { url: "https://cvo.example", fetch: server({}, 503) })).rejects.toThrow("(503)");
  });
});
