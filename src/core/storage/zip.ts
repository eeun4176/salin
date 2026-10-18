/**
 * ZIP Writer
 * Builds a .zip Blob from a list of paths and Blobs using fflate. Used for
 * workspace backups and for "Download" on a folder. Entries are added one at
 * a time so only one file's bytes are being read at once.
 */

import { Zip, ZipDeflate, ZipPassThrough } from "fflate";

export interface ZipInput {
  path: string;
  data: Blob | Uint8Array;
  /** Deflate text-like data; already-compressed formats (PDF, JPG, XLSX…) are stored as-is. */
  compress?: boolean;
}

export async function createZip(inputs: ZipInput[]): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk as Uint8Array<ArrayBuffer>);
  });

  for (const input of inputs) {
    const entry = input.compress ? new ZipDeflate(input.path, { level: 6 }) : new ZipPassThrough(input.path);
    zip.add(entry);
    const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(await input.data.arrayBuffer());
    entry.push(bytes, true);
    if (failure) throw failure;
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(chunks, { type: "application/zip" });
}
