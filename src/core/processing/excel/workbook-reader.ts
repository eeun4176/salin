/**
 * Workbook Reader
 * Opens an .xlsx file into a model the table detector and previews use:
 * every worksheet (and whether it's hidden or a chart sheet), each cell's
 * displayed text, formulas and their saved results, merged cells, and Excel's
 * own defined tables. It also looks inside the file package for things that
 * can't become rows — charts, pictures, shapes/text boxes, pivot tables and
 * links to other workbooks — so the user can be warned. Never modifies the
 * file.
 */

import { strFromU8, unzipSync } from "fflate";
import * as XLSX from "xlsx";

import { ProcessingError } from "@/core/processing/processing-errors";
import { assertDocumentSize, MAX_TABLE_ROWS } from "@/core/processing/parsers/parser-helpers";

import { cellKey, parseRange, type CellRange } from "./cell-range";



export interface ExcelTable {
  name: string;
  range: CellRange;
  headerRows: number;
  totalsRows: number;
}

export interface SheetObjects {
  charts: number;
  images: number;
  shapes: number;
  pivotTables: number;
}

export interface SheetModel {
  name: string;
  visibility: "visible" | "hidden" | "very-hidden";
  isChartSheet: boolean;
  /** Displayed text by 0-based [row][column]. Rows/cells past the data may be missing. */
  cells: string[][];
  /** Formula text (without "=") keyed by `cellKey(r, c)`. */
  formulas: Map<string, string>;
  /** Formula cells with no saved result — Excel never calculated them, so they read as empty. */
  uncalculated: Set<string>;
  /** Cells whose saved result is an error such as #DIV/0! or #REF!. */
  errors: Set<string>;
  merges: CellRange[];
  /** Bounding box of the cells with content, or `null` for an empty sheet. */
  used: CellRange | null;
  /** True when only the first rows were read (size limit or a quick preview). */
  truncated: boolean;
  /** Ranges the author defined as tables in Excel (Insert → Table). */
  excelTables: ExcelTable[];
  objects: SheetObjects;
}

export interface WorkbookModel {
  sheets: SheetModel[];
  /** Links to other workbooks: their values are whatever was last saved. */
  externalLinks: number;
}

export interface ReadOptions {
  /** Read only this many rows per sheet (quick previews and thumbnails). */
  maxRows?: number;
  /** Read only the first N sheets. */
  maxSheets?: number;
  /** Look inside the package for tables, charts and pictures (default true). */
  inspectPackage?: boolean;
}

const NO_OBJECTS: SheetObjects = { charts: 0, images: 0, shapes: 0, pivotTables: 0 };

/* ------------------------------------------------------------------
   Package inspection (the .xlsx is a zip of XML parts)
------------------------------------------------------------------- */

type Parts = Record<string, Uint8Array>;

function attributes(tag: string) {
  const attrs: Record<string, string> = {};
  for (const [, key, value] of tag.matchAll(/([\w:]+)="([^"]*)"/g)) attrs[key] = value;
  return attrs;
}

function decodeXml(text: string) {
  return text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Relationship id → target part path, for the part at `partPath`. */
function relationships(parts: Parts, partPath: string) {
  const slash = partPath.lastIndexOf("/");
  const dir = partPath.slice(0, slash);
  const relsPath = `${dir}/_rels/${partPath.slice(slash + 1)}.rels`;
  const xml = parts[relsPath] ? strFromU8(parts[relsPath]) : "";
  const rels: { id: string; type: string; target: string }[] = [];
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const a = attributes(tag);
    if (a.TargetMode === "External") continue;
    rels.push({ id: a.Id, type: a.Type?.split("/").pop() ?? "", target: resolvePath(dir, a.Target ?? "") });
  }
  return rels;
}

function resolvePath(dir: string, target: string) {
  const segments = target.startsWith("/") ? [] : dir.split("/");
  for (const part of target.replace(/^\//, "").split("/")) {
    if (part === "..") segments.pop();
    else if (part !== ".") segments.push(part);
  }
  return segments.filter(Boolean).join("/");
}

const count = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0;

interface SheetPackageInfo {
  isChartSheet: boolean;
  excelTables: ExcelTable[];
  objects: SheetObjects;
}

function inspectSheet(parts: Parts, sheetPath: string): SheetPackageInfo {
  const objects = { ...NO_OBJECTS };
  const excelTables: ExcelTable[] = [];
  for (const rel of relationships(parts, sheetPath)) {
    if (rel.type === "drawing" && parts[rel.target]) {
      const xml = strFromU8(parts[rel.target]);
      objects.images += count(xml, /<xdr:pic>/g);
      objects.charts += count(xml, /<c:chart\b/g);
      objects.shapes += count(xml, /<xdr:sp>/g);
    } else if (rel.type === "pivotTable") {
      objects.pivotTables++;
    } else if (rel.type === "table" && parts[rel.target]) {
      const tag = /<table\b[^>]*>/.exec(strFromU8(parts[rel.target]))?.[0] ?? "";
      const a = attributes(tag);
      const range = parseRange(a.ref ?? "");
      if (range) {
        excelTables.push({
          name: decodeXml(a.displayName ?? a.name ?? "Table"),
          range,
          headerRows: a.headerRowCount === undefined ? 1 : Number(a.headerRowCount),
          totalsRows: Number(a.totalsRowCount ?? 0),
        });
      }
    }
  }
  return { isChartSheet: sheetPath.includes("/chartsheets/"), excelTables, objects };
}

/** Sheet relationship id → package info, plus workbook-level counts. */
function inspectPackage(bytes: Uint8Array) {
  const parts: Parts = unzipSync(bytes, {
    filter: (f) => f.name.endsWith(".rels") || /^xl\/(workbook\.xml|drawings\/|tables\/)/.test(f.name),
  });
  const bySheetId = new Map<string, SheetPackageInfo>();
  for (const rel of relationships(parts, "xl/workbook.xml")) {
    if (rel.type === "worksheet" || rel.type === "chartsheet") bySheetId.set(rel.id, inspectSheet(parts, rel.target));
  }
  const externalLinks = relationships(parts, "xl/workbook.xml").filter((r) => r.type === "externalLink").length;
  return { bySheetId, externalLinks };
}

/* ------------------------------------------------------------------
   Cells
------------------------------------------------------------------- */

function readCells(sheet: XLSX.WorkSheet) {
  const cells: string[][] = [];
  const formulas = new Map<string, string>();
  const uncalculated = new Set<string>();
  const errors = new Set<string>();
  let used: CellRange | null = null;

  const data = (sheet["!data"] ?? []) as (XLSX.CellObject | undefined)[][];
  data.forEach((row, r) => {
    if (!row) return;
    const texts: string[] = [];
    row.forEach((cell, c) => {
      if (!cell) return;
      const key = cellKey(r, c);
      let text = cell.w ?? (cell.v === undefined || cell.v === null ? "" : String(cell.v));
      if (cell.f) {
        formulas.set(key, cell.f);
        if (cell.v === undefined || cell.t === "z") {
          uncalculated.add(key);
          text = "";
        }
      }
      if (cell.t === "e" && !uncalculated.has(key)) errors.add(key);
      texts[c] = text;
      if (text.trim() !== "" || cell.f) {
        used = used
          ? { s: { r: Math.min(used.s.r, r), c: Math.min(used.s.c, c) }, e: { r: Math.max(used.e.r, r), c: Math.max(used.e.c, c) } }
          : { s: { r, c }, e: { r, c } };
      }
    });
    cells[r] = Array.from(texts, (t) => t ?? "");
  });
  return { cells, formulas, uncalculated, errors, used: used as CellRange | null };
}

/** Reads a workbook. Throws a ProcessingError if it isn't a readable .xlsx. */
export async function readWorkbook(blob: Blob, fileName: string, options: ReadOptions = {}): Promise<WorkbookModel> {
  assertDocumentSize(blob, fileName);
  const unreadable = () => new ProcessingError("parse-failed", `"${fileName}" isn't a readable Excel workbook. It may be damaged or password-protected.`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // .xlsx files are zip archives; without this check SheetJS reads random text as a one-cell sheet.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw unreadable();

  const maxRows = Math.min(options.maxRows ?? MAX_TABLE_ROWS, MAX_TABLE_ROWS);
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, {
      type: "array",
      dense: true,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      sheetRows: maxRows,
      ...(options.maxSheets ? { sheets: Array.from({ length: options.maxSheets }, (_, i) => i) } : {}),
    });
  } catch {
    throw unreadable();
  }

  let pkg: ReturnType<typeof inspectPackage> | null = null;
  if (options.inspectPackage !== false) {
    try {
      pkg = inspectPackage(bytes);
    } catch {
      pkg = null; // Inspection only adds warnings; the data is still readable.
    }
  }

  const sheetMeta = book.Workbook?.Sheets ?? [];
  const sheets = book.SheetNames.filter((name) => book.Sheets[name]).map((name, index): SheetModel => {
    const sheet = book.Sheets[name];
    const meta = sheetMeta.find((m) => m.name === name) ?? sheetMeta[index];
    const info = (meta as { id?: string } | undefined)?.id ? pkg?.bySheetId.get((meta as { id: string }).id) : undefined;
    const full = sheet["!fullref"] ? XLSX.utils.decode_range(sheet["!fullref"]) : null;
    return {
      name,
      visibility: meta?.Hidden === 1 ? "hidden" : meta?.Hidden === 2 ? "very-hidden" : "visible",
      isChartSheet: info?.isChartSheet ?? false,
      ...readCells(sheet),
      merges: (sheet["!merges"] ?? []).map((m) => ({ s: { ...m.s }, e: { ...m.e } })),
      truncated: full !== null && full.e.r - full.s.r + 1 > maxRows,
      excelTables: info?.excelTables ?? [],
      objects: info?.objects ?? { ...NO_OBJECTS },
    };
  });
  return { sheets, externalLinks: pkg?.externalLinks ?? 0 };
}
