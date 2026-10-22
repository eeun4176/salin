/**
 * XLSX Template Patching
 * Fills cells of an existing Excel workbook without rebuilding it: only the
 * cell values in a sheet's XML change, so the template's fonts, borders,
 * merged cells, page setup and logos stay exactly as the office made them
 * (SheetJS Community would drop styles and images). Text is written as
 * inline strings, never formulas, so nothing typed on a sheet can run in
 * Excel. Also copies a sheet (for more rows than one page holds) and adds
 * plain new sheets.
 */

import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from "fflate";

export type CellInput = string | number | null;

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "AB12" → column 28. */
const columnIndex = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const rowIndex = (ref: string) => Number(ref.replace(/^[A-Z]+/, ""));

function cellXml(ref: string, style: string | null, value: CellInput) {
  const s = style ? ` s="${style}"` : "";
  if (value === null || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** Sets cell values in a worksheet's XML, keeping each cell's style; adds cells and rows that don't exist yet. */
export function setCells(sheetXml: string, cells: Record<string, CellInput>): string {
  let xml = sheetXml;
  for (const [ref, value] of Object.entries(cells)) {
    const existing = new RegExp(`<c r="${ref}"(?=[ />])([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    const match = xml.match(existing);
    if (match) {
      const style = match[1].match(/\ss="(\d+)"/)?.[1] ?? null;
      xml = xml.replace(existing, cellXml(ref, style, value));
      continue;
    }
    const r = rowIndex(ref);
    const row = new RegExp(`<row r="${r}"(?=[ >/])([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
    const rowMatch = xml.match(row);
    if (rowMatch) {
      const cellsXml = rowMatch[3] ?? "";
      const parts = cellsXml.match(/<c r="[A-Z]+\d+"[\s\S]*?(?:\/>|<\/c>)/g) ?? [];
      const at = parts.findIndex((p) => columnIndex(p.match(/r="([A-Z]+\d+)"/)![1]) > columnIndex(ref));
      parts.splice(at < 0 ? parts.length : at, 0, cellXml(ref, null, value));
      xml = xml.replace(row, `<row r="${r}"${rowMatch[1].replace(/\/$/, "")}>${parts.join("")}</row>`);
      continue;
    }
    const rows = [...xml.matchAll(/<row r="(\d+)"/g)];
    const after = rows.find((m) => Number(m[1]) > r);
    const newRow = `<row r="${r}">${cellXml(ref, null, value)}</row>`;
    xml = after ? xml.slice(0, after.index) + newRow + xml.slice(after.index) : xml.replace(/<sheetData\s*\/>|<\/sheetData>/, (tag) => (tag.endsWith("/>") ? `<sheetData>${newRow}</sheetData>` : `${newRow}</sheetData>`));
  }
  return xml;
}

export class Workbook {
  private files: Unzipped;

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes);
  }

  private text(path: string) {
    const file = this.files[path];
    if (!file) throw new Error(`The workbook template is missing ${path}.`);
    return strFromU8(file);
  }

  private write(path: string, text: string) {
    this.files[path] = strToU8(text);
  }

  /** The worksheet part for a sheet name, e.g. "xl/worksheets/sheet3.xml". */
  sheetPath(name: string) {
    const workbook = this.text("xl/workbook.xml");
    const sheet = [...workbook.matchAll(/<sheet [^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g)].find((m) => m[1] === escapeXml(name));
    if (!sheet) throw new Error(`The workbook template has no sheet named “${name}”.`);
    const rels = this.text("xl/_rels/workbook.xml.rels");
    const target = rels.match(new RegExp(`<Relationship [^>]*Id="${sheet[2]}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${sheet[2]}"`))?.[1];
    if (!target) throw new Error(`The workbook template's sheet “${name}” has no part.`);
    return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }

  setCells(sheetName: string, cells: Record<string, CellInput>) {
    const path = this.sheetPath(sheetName);
    this.write(path, setCells(this.text(path), cells));
  }

  /** Adds a sheet with this XML after the others. */
  private addSheetPart(name: string, xml: string) {
    let n = 1;
    while (this.files[`xl/worksheets/sheet${n}.xml`]) n++;
    const path = `xl/worksheets/sheet${n}.xml`;
    this.write(path, xml);
    const rels = this.text("xl/_rels/workbook.xml.rels");
    const rid = `rIdSalin${n}`;
    this.write("xl/_rels/workbook.xml.rels", rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`));
    const workbook = this.text("xl/workbook.xml");
    const nextId = Math.max(0, ...[...workbook.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
    this.write("xl/workbook.xml", workbook.replace("</sheets>", `<sheet name="${escapeXml(name)}" sheetId="${nextId}" r:id="${rid}"/></sheets>`));
    const types = this.text("[Content_Types].xml");
    this.write("[Content_Types].xml", types.replace("</Types>", `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  }

  /** A copy of a sheet (values, styles, merges, page setup) — without its pictures, which belong to the first page. */
  copySheet(sourceName: string, newName: string) {
    const xml = this.text(this.sheetPath(sourceName))
      .replace(/<drawing [^>]*\/>|<legacyDrawing [^>]*\/>/g, "")
      .replace(/\sr:id="[^"]*"/g, "")
      .replace(/\stabSelected="1"/g, "");
    this.addSheetPart(newName, xml);
  }

  /** A new, unstyled sheet with these rows (first row as headings). */
  addTableSheet(name: string, rows: CellInput[][]) {
    const cols = (i: number) => {
      let s = "";
      for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      return s;
    };
    const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cellXml(`${cols(c)}${r + 1}`, null, v)).join("")}</row>`).join("");
    this.addSheetPart(name, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`);
  }

  toBytes() {
    return zipSync(this.files, { level: 6 });
  }
}
