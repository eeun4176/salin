/**
 * Test Workbooks
 * Builds real .xlsx files for tests: sheets from rows (with merged cells,
 * formulas and hidden sheets), plus extra package parts SheetJS can't write
 * — an Excel-defined table, or a drawing with a chart, picture and shape —
 * so table detection and warnings can be tested on realistic workbooks.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";

export interface TestSheet {
  name: string;
  rows: unknown[][];
  /** A1 ranges to merge, e.g. "A1:C1". */
  merges?: string[];
  hidden?: boolean;
  /** Cells to set directly, e.g. { B5: { t: "n", f: "B3+B4", v: 7 } }. */
  cells?: Record<string, XLSX.CellObject>;
}

export function workbookBytes(sheets: TestSheet[]): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    if (sheet.merges) ws["!merges"] = sheet.merges.map((m) => XLSX.utils.decode_range(m));
    for (const [address, cell] of Object.entries(sheet.cells ?? {})) {
      ws[address] = cell;
      const ref = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      const at = XLSX.utils.decode_cell(address);
      ref.e.r = Math.max(ref.e.r, at.r);
      ref.e.c = Math.max(ref.e.c, at.c);
      ws["!ref"] = XLSX.utils.encode_range(ref);
    }
    XLSX.utils.book_append_sheet(book, ws, sheet.name);
  }
  book.Workbook = { Sheets: sheets.map((s) => ({ name: s.name, Hidden: s.hidden ? 1 : 0 })) };
  return new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Adds parts to sheet N (1-based) of a workbook: each entry becomes a relationship of the given type. */
export function withSheetParts(bytes: Uint8Array, sheet: number, parts: { type: "table" | "drawing" | "pivotTable"; path: string; xml: string }[]) {
  const files = unzipSync(bytes);
  const relsPath = `xl/worksheets/_rels/sheet${sheet}.xml.rels`;
  const existing = files[relsPath] ? strFromU8(files[relsPath]) : `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const rels = parts.map((p, i) => `<Relationship Id="rIdTest${i}" Type="${REL}/${p.type}" Target="../${p.path.replace(/^xl\//, "")}"/>`).join("");
  files[relsPath] = strToU8(existing.replace("</Relationships>", `${rels}</Relationships>`));
  for (const part of parts) files[part.path] = strToU8(part.xml);
  return zipSync(files);
}

export const excelTableXml = (ref: string, name = "Households", totalsRowCount = 0) =>
  `<?xml version="1.0"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="${name}" displayName="${name}" ref="${ref}"${totalsRowCount ? ` totalsRowCount="${totalsRowCount}"` : ""}/>`;

export const drawingXml = `<?xml version="1.0"?><xdr:wsDr xmlns:xdr="x" xmlns:c="c">
<xdr:twoCellAnchor><xdr:pic></xdr:pic></xdr:twoCellAnchor>
<xdr:twoCellAnchor><xdr:graphicFrame><c:chart r:id="rId1"/></xdr:graphicFrame></xdr:twoCellAnchor>
<xdr:twoCellAnchor><xdr:sp></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`;
