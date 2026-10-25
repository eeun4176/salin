/**
 * City Vet Handwriting Server (client)
 * The optional online reader for census letter boxes: when Salin is online
 * and the City Vet admin system's address is set (VITE_CITY_VET_READER_URL),
 * only the written rows of letter boxes — never the whole photo — are sent
 * to the city's own server, which runs a stronger open-source reader. Its
 * answers are checked against the sheet before they're offered: exactly one
 * allowed character per written box, or the reading is dropped. Until the
 * server exists this is switched off. Request and response format:
 * docs/CENSUS_HANDWRITING_API.md.
 */

import { z } from "zod";

export const CITY_VET_READER_URL = ((import.meta.env?.VITE_CITY_VET_READER_URL as string | undefined) ?? "").replace(/\/+$/, "") || null;

export const FORM_ID = "CVO-CENSUS";

export interface ServerRow {
  /** Echoed back: which field row this is. */
  id: string;
  /** PNG of the written boxes (handwriting only, no box lines), as a data URL. */
  image: string;
  /** How many letter boxes in the row hold writing — the reading must have this many characters. 0 for an open writing line (any length). */
  boxes: number;
  /** Characters the boxes may hold. */
  allowed: string;
}

const responseSchema = z.object({
  rows: z.array(z.object({ id: z.string().max(100), text: z.string().max(200), confidence: z.number().min(0).max(1) })).max(200),
});

export type ServerReading = z.infer<typeof responseSchema>["rows"][number];

export class CityVetReaderError extends Error {}

/** Does a reading fit its row: only allowed characters, and one per written box on letter-box rows (spaces between words aside)? */
export function fitsRow(text: string, row: Pick<ServerRow, "boxes" | "allowed">) {
  const chars = [...text.replace(/\s+/g, "")];
  return chars.length > 0 && (row.boxes === 0 || chars.length === row.boxes) && chars.every((c) => row.allowed.includes(c));
}

/** Sends the rows to the City Vet server; resolves to the readings that fit their rows. */
export async function readOnCityVetServer(rows: ServerRow[], options: { url?: string | null; signal?: AbortSignal; fetch?: typeof fetch } = {}): Promise<ServerReading[]> {
  const url = options.url === undefined ? CITY_VET_READER_URL : options.url;
  if (!url) throw new CityVetReaderError("The City Vet handwriting server isn't connected yet.");
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new CityVetReaderError("You're offline. Connect to the internet to use the City Vet server.");
  const response = await (options.fetch ?? fetch)(`${url}/census/handwriting`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ form: FORM_ID, rows }),
    signal: options.signal,
  }).catch((error: unknown) => {
    if (options.signal?.aborted) throw error;
    throw new CityVetReaderError("The City Vet server couldn't be reached. Try again later.");
  });
  if (!response.ok) throw new CityVetReaderError(`The City Vet server couldn't read these boxes (${response.status}).`);
  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new CityVetReaderError("The City Vet server sent an answer e-Vet doesn't understand.");
  const byId = new Map(rows.map((r) => [r.id, r]));
  return parsed.data.rows.filter((reading) => {
    const row = byId.get(reading.id);
    return row !== undefined && fitsRow(reading.text.toUpperCase(), row);
  }).map((reading) => ({ ...reading, text: reading.text.toUpperCase() }));
}
