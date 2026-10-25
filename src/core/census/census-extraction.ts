/**
 * Census Sheet Extraction
 * Turns what was read from printed census sheets into values for the review
 * screen: per sheet, the barangay, date and sheet number (from the code
 * strip, so never handwritten) and the owner; per pet, every tick-box and
 * bubble answer (OMR) and the handwriting (OCR, in capitals: in letter
 * boxes, spaces where boxes were left empty; on open lines (v2), as written).
 * Each sheet is read with the layout of its own version. Anything uncertain —
 * two boxes ticked, a faint mark, writing that couldn't be read — is flagged
 * so it can't count as validated until a person checks it. Every value keeps
 * its box on the sheet, linking it back to the photo.
 */

import { CENSUS_LAYOUT, layoutFor, optionText, type Rect, type WriteIn } from "@/core/census/census-layout";
import { barangayName } from "@/core/census/barangays";
import { SUPPORTED_VERSIONS } from "@/core/census/code-strip";
import type { AnswerRead, CensusSheetRead } from "@/core/census/omr/read-sheet";
import { letterArea, SHEET_SCALE } from "@/core/census/omr/read-sheet";
import { splitCellId } from "@/core/ocr/review/review-state";
import { makeValue } from "@/core/ocr/templates/field-mapping";
import { parseTemplate } from "@/core/ocr/templates/template-schema";
import type { Box, ExtractedField, ExtractedValue, Extraction, FieldSpec, FormRecord, OcrLine, RecordRow, ValueRef } from "@/types/ocr";

export const CENSUS_TEMPLATE_ID = "cvo-census-v1";
export const CENSUS_TEMPLATE_NAME = "CVO census sheet (v1)";

/** Fields written by hand (letter boxes or open lines) in any version, as opposed to tick boxes and bubbles. */
export const CENSUS_LETTER_FIELDS = new Set(SUPPORTED_VERSIONS.flatMap((v) => [...layoutFor(v).owner, ...layoutFor(v).pets[0].writeIns]).map((w) => w.key));

const choice = (key: string, label: string, options: string[], required = false): FieldSpec => ({ key, label, type: "choice", options, required });

/** Printed option → how it reads in the dataset ("FREE ROAMING" → "Free roaming"). */
export const optionLabel = (printed: string) => printed.charAt(0) + printed.slice(1).toLowerCase();

const options = (key: string) => CENSUS_LAYOUT.pets[0].choices.find((g) => g.key === key)!.options.map((o) => optionLabel(o.value));

export const SHEET_FIELDS: FieldSpec[] = [
  { key: "barangay", label: "Barangay", type: "text", required: true },
  { key: "census_date", label: "Date of census", type: "date", required: true },
  { key: "sheet_no", label: "Sheet no.", type: "number", required: true },
];

export const OWNER_FIELDS: FieldSpec[] = [
  { key: "owner_name", label: "Full name of owner", type: "text", required: true },
  { key: "address", label: "Complete address", type: "text", required: false },
  { key: "contact", label: "Contact number", type: "text", required: false },
];

const CONTINUED_FROM: FieldSpec = { key: "continued_from", label: "Continued from sheet no.", type: "number", required: true };

export const PET_COLUMNS: FieldSpec[] = [
  { key: "pet_slot", label: "Pet no.", type: "number", required: true },
  { key: "pet_name", label: "Name of pet", type: "text", required: false },
  { key: "age_years", label: "Age (years)", type: "number", required: false },
  { key: "age_months", label: "Age (months)", type: "number", required: false },
  choice("type", "Type of pet", options("type"), true),
  choice("sex", "Sex", options("sex"), true),
  choice("sterilized", "Sterilized", options("sterilized")),
  choice("breed", "Breed", options("breed")),
  choice("classification", "Classification", options("classification")),
  choice("vaccination", "Vaccination status", options("vaccination")),
  choice("laps", "Laps", options("laps")),
  { key: "color", label: "Color", type: "text", required: false },
  // Text: a year, or "Before 2019" / "Not registered" on v2 sheets.
  { key: "registered", label: "Registered in", type: "text", required: false },
  { key: "other_vaccines", label: "Other vaccines", type: "text", required: false },
  { key: "remarks", label: "Remarks", type: "text", required: false },
];

const asTemplateField = ({ key, label, type, required, options }: FieldSpec) => ({ key, label, type, required, ...(options ? { options } : {}) });

/** The census sheet as a template (names and types of its fields, for review); sheets are read by position, not by label. */
export const CENSUS_TEMPLATE = parseTemplate({
  id: CENSUS_TEMPLATE_ID,
  name: CENSUS_TEMPLATE_NAME,
  description: "The printed CVO-CENSUS working sheet (v1 to v3): one owner and up to three pets, read from tick boxes, bubbles and handwriting fields.",
  kind: "table",
  builtIn: true,
  fields: [...SHEET_FIELDS, ...OWNER_FIELDS].map(asTemplateField),
  tables: [{ key: "pets", label: "Pets", minMatched: 1, columns: PET_COLUMNS.map(asTemplateField) }],
});

export interface CensusPage {
  /** 1-based page within the scan. */
  page: number;
  read: CensusSheetRead;
  /** Text recognised in the letter boxes (on the flattened sheet). */
  lines: OcrLine[];
}

const px = (r: Rect): Box => ({ x: r.x * SHEET_SCALE, y: r.y * SHEET_SCALE, width: r.width * SHEET_SCALE, height: r.height * SHEET_SCALE });

const bounds = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y };
};

/** A value Salin knows for certain (printed in the code strip, or the slot number). */
function known(spec: FieldSpec, text: string, page: number, box: Box | null): ExtractedValue {
  return makeValue(spec, { text, confidence: 100, mapping: 1, page, box });
}

/** `display`: how a marked option reads in the dataset (default: choice labels as "Free roaming", numbers as they are). */
function answerValue(spec: FieldSpec, read: AnswerRead | undefined, page: number, display = (value: string) => (spec.type === "choice" ? optionLabel(value) : value)): ExtractedValue {
  if (!read) return makeValue(spec, null);
  const box = px(read.box);
  if (read.state === "answered") return makeValue(spec, { text: display(read.value!), confidence: 99, mapping: 1, page, box });
  if (read.state === "faint") return makeValue(spec, { text: display(read.value!), confidence: 70, mapping: 1, page, box }, ["checkbox-unclear"], `The mark is faint. Check that ${display(read.value!)} is right.`);
  if (read.state === "unanswered") return { ...makeValue(spec, null), page, box };
  const empty = { text: "", confidence: 0, mapping: 1, page, box };
  if (read.state === "multiple") {
    const marked = read.marked.map(display).join(", ");
    return makeValue(spec, empty, ["multiple-marks"], `More than one box is marked (${marked}). Check the sheet and pick one.`);
  }
  return makeValue(spec, empty, ["checkbox-unclear"], "A mark is too faint to be sure. Check the sheet.");
}

const LETTERS = /[^A-ZÑ0-9 .,'#/-]/g;
// Look-alikes in a digits-only box.
const DIGIT_FIXES: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", "|": "1", Z: "2", S: "5", B: "8", G: "6" };

/** Does the middle of `box` fall inside `rect`? */
function inside(box: Box, rect: Box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
}

/** Words whose middle falls inside `rect` (sheet px), left to right. */
function wordsIn(lines: OcrLine[], rect: Box) {
  return lines
    .flatMap((l) => l.words)
    .filter((w) => inside(w.box, rect))
    .sort((a, b) => a.box.x - b.box.x);
}

/** Runs of written-in boxes, e.g. [4, 3] for "JUAN" + gap + "DEL". */
function runs(inked: boolean[]) {
  const out: number[] = [];
  let n = 0;
  for (const on of inked) {
    if (on) n++;
    else if (n) {
      out.push(n);
      n = 0;
    }
  }
  if (n) out.push(n);
  return out;
}

/**
 * What's written in a row of letter boxes: the recognised words in capitals.
 * When as many letters were read as boxes were written in, the empty boxes
 * between them decide where the spaces go.
 */
export function letterBoxText(words: string[], inked: boolean[], digits: boolean) {
  const clean = (s: string) => {
    const upper = s.toUpperCase();
    return digits ? [...upper].map((c) => DIGIT_FIXES[c] ?? c).join("").replace(/\D/g, "") : upper.replace(LETTERS, "");
  };
  const parts = words.map(clean).filter(Boolean);
  const letters = parts.join("").replace(/\s/g, "");
  const groups = runs(inked);
  if (!digits && groups.length > 1 && letters.length === groups.reduce((a, b) => a + b, 0)) {
    let at = 0;
    return groups.map((n) => letters.slice(at, (at += n))).join(" ");
  }
  return digits ? letters : parts.join(" ").replace(/\s+/g, " ").trim();
}

const formatContact = (digits: string) => (digits.length === 11 ? `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}` : digits);

function writtenValue(spec: FieldSpec, field: WriteIn, inked: boolean[][] | undefined, lines: OcrLine[], page: number): ExtractedValue {
  // The written-in boxes (plus one each side), so close-ups and the handwriting reader get just the writing.
  const written = field.rows.flatMap((row, r) => row.filter((_, i) => inked?.[r]?.[i] || inked?.[r]?.[i - 1] || inked?.[r]?.[i + 1]));
  const box = px(bounds(written.length ? written : field.rows.flat()));
  if (!written.length) return { ...makeValue(spec, null), page, box };
  const rowWords = field.rows.map((row) => wordsIn(lines, px(bounds(row))));
  const texts = rowWords.map((words, r) => letterBoxText(words.map((w) => w.text), inked?.[r] ?? [], Boolean(field.digits))).filter(Boolean);
  const words = rowWords.flat().filter((w) => w.text);
  let text = texts.join(" ");
  if (field.digits) text = formatContact(text);
  const confidence = words.length ? Math.round(words.reduce((sum, w) => sum + w.confidence, 0) / words.length) : 0;
  const unclear = words.map((w) => w.unclear).join("");
  if (!text) return makeValue(spec, { text: "", confidence: 0, mapping: 1, page, box }, ["illegible"], "Something is written here, but it couldn't be read. Type it from the close-up.");
  const flags = field.digits && text.replace(/\D/g, "").length !== 11 ? (["type-mismatch"] as const) : [];
  return makeValue(spec, { text, confidence, mapping: 1, page, box, unclear }, [...flags]);
}

const field = (spec: FieldSpec, value: ExtractedValue): ExtractedField => ({ ...spec, value });

/**
 * A handwriting reading of a census letter-box field, tidied the same way as
 * OCR text: capitals, spaces where boxes were left empty, digits only (and
 * 0000-000-0000) for the contact number. Other values pass through.
 */
/** The census letter-box field a review value belongs to (owner or pet, on which sheet), or null. */
function censusField(extraction: Extraction, pages: { census?: CensusSheetRead | null }[], ref: ValueRef) {
  if (extraction.templateId !== CENSUS_TEMPLATE_ID) return null;
  let key = ref.id;
  let page: number | undefined;
  let prefix = "owner";
  if (ref.kind === "form") page = extraction.forms[ref.group]?.page;
  else if (ref.kind === "table") {
    const [rowId, column] = splitCellId(ref.id);
    const row = extraction.tables[ref.group]?.rows.find((r) => r.id === rowId);
    key = column;
    page = row?.page;
    prefix = `pet${(Number(row?.cells.pet_slot?.text) - 1) % 3}`;
  }
  const read = page ? pages[page - 1]?.census : undefined;
  const layout = read ? layoutFor(read.code.version) : CENSUS_LAYOUT;
  const writeIn = [...layout.owner, ...layout.pets[0].writeIns].find((w) => w.key === key);
  const id = `${prefix}.${key}`;
  if (!writeIn || !read?.inked[id] || !read.cells[id]) return null;
  return { writeIn, key, inked: read.inked[id], cells: read.cells[id], writing: read.writing?.[id] };
}

/**
 * A handwriting reading of a census letter-box field, tidied the same way as
 * OCR text: capitals, spaces where boxes were left empty, digits only (and
 * 0000-000-0000) for the contact number. Other values pass through.
 */
export function tidyCensusReading(extraction: Extraction, pages: { census?: CensusSheetRead | null }[], ref: ValueRef, text: string): string {
  const found = censusField(extraction, pages, ref);
  if (!found) return text;
  // Rows of a multi-row field read as one line: their boxes in a row, with a gap between rows.
  const tidy = letterBoxText([text], found.inked.flatMap((row) => [...row, false]), Boolean(found.writeIn.digits));
  return found.writeIn.digits ? formatContact(tidy) : tidy || text;
}

/**
 * One written row of a census handwriting field, for the handwriting reader:
 * the row (sheet pixels), each written letter box in it (none on an open
 * line), and the characters it may hold.
 */
export interface LetterBoxRow {
  box: Box;
  slots: { box: Box; allowed: string; spaceBefore: boolean }[];
  allowed: string;
  /** Open lines: x (sheet px) of the gaps between written words. */
  gaps?: number[];
}

/** The written rows of a census letter-box field (first to last written box), or null for other values. */
export function censusLetterRows(extraction: Extraction, pages: { census?: CensusSheetRead | null }[], ref: ValueRef): LetterBoxRow[] | null {
  const found = censusField(extraction, pages, ref);
  return found ? writtenRows(found.writeIn, found.key, found.inked, found.cells, found.writing) : null;
}

type Writing = NonNullable<CensusSheetRead["writing"]>[string];

function writtenRows(writeIn: WriteIn, key: string, inked: boolean[][], cells: Rect[][], writing?: Writing): LetterBoxRow[] {
  const allowed = allowedFor(key);
  const rows: LetterBoxRow[] = [];
  // Open lines are read as a whole, cropped to the writing (plus a margin), with the gaps between words.
  if (writeIn.open) {
    cells.forEach((row, r) => {
      if (!inked[r]?.[0]) return;
      const line = row[0];
      const span = writing?.[r];
      const from = span ? Math.max(line.x, span.from - 1.5) : line.x;
      const to = span ? Math.min(line.x + line.width, span.to + 1.5) : line.x + line.width;
      rows.push({ box: px({ ...line, x: from, width: to - from }), slots: [], allowed: `${allowed} `, gaps: (span?.gaps ?? []).map((g) => g * SHEET_SCALE) });
    });
    return rows;
  }
  cells.forEach((row, r) => {
    const written = row.map((_, i) => i).filter((i) => inked[r]?.[i]);
    if (!written.length) return;
    const span = row.slice(written[0], written[written.length - 1] + 1).map(px);
    const slots = written.map((i, n) => ({ box: px(row[i]), allowed, spaceBefore: n > 0 && i - written[n - 1] > 1 }));
    const first = span[0];
    const last = span[span.length - 1];
    rows.push({ box: { x: first.x, y: first.y, width: last.x + last.width - first.x, height: first.height }, slots, allowed });
  });
  return rows;
}

/** Every written row of a sheet's handwriting fields (owner and pets), for reading them all at once while scanning. */
export function sheetLetterRows(read: CensusSheetRead): LetterBoxRow[] {
  const layout = layoutFor(read.code.version);
  const fields = [...(read.code.continuation ? [] : layout.owner.map((w) => ["owner", w] as const)), ...layout.pets.flatMap((p) => p.writeIns.map((w) => [`pet${p.slot}`, w] as const))];
  return fields.flatMap(([prefix, writeIn]) => {
    const id = `${prefix}.${writeIn.key}`;
    return read.inked[id] && read.cells[id] ? writtenRows(writeIn, writeIn.key, read.inked[id], read.cells[id], read.writing?.[id]) : [];
  });
}

/** A field's text from its rows' box-by-box readings: rows joined by a space; the contact number as 0000-000-0000. */
export function joinLetterRows(extraction: Extraction, pages: { census?: CensusSheetRead | null }[], ref: ValueRef, rows: string[]) {
  const found = censusField(extraction, pages, ref);
  const text = rows.filter(Boolean).join(" ");
  return found?.writeIn.digits ? formatContact(text.replace(/\D/g, "")) : text;
}

/* ------------------------------------------------------------------
   Reading letter boxes a row at a time
------------------------------------------------------------------- */

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
/** Characters each kind of letter box may hold. */
const ALLOWED: Record<string, string> = { owner_name: `${UPPER}.-'`, pet_name: `${UPPER}.-'`, contact: DIGITS };
const allowedFor = (key: string) => ALLOWED[key] ?? `${UPPER}${DIGITS}.,-/#`;

export interface LetterBoxGroup {
  allowed: string;
  /** Written-in rows of letter boxes (first to last written box, plus a box each side), as sheet pixels. */
  boxes: Box[];
}

/** The written-in letter-box rows of a sheet, grouped by the characters they may hold (one OCR pass each). */
export function letterBoxGroups(read: CensusSheetRead): LetterBoxGroup[] {
  const groups = new Map<string, Box[]>();
  for (const [key, rows] of Object.entries(read.cells)) {
    const allowed = allowedFor(key.split(".")[1]);
    rows.forEach((row, r) => {
      const written = row.map((_, i) => i).filter((i) => read.inked[key]?.[r]?.[i]);
      if (!written.length) return;
      const first = letterArea(row[Math.max(0, written[0] - 1)]);
      const last = letterArea(row[Math.min(row.length - 1, written[written.length - 1] + 1)]);
      groups.set(allowed, [...(groups.get(allowed) ?? []), { x: first.x, y: first.y, width: last.x + last.width - first.x, height: first.height }]);
    });
  }
  return [...groups.entries()].map(([allowed, boxes]) => ({ allowed, boxes }));
}

/** One "word" per letter-box row read, kept as the page's OCR result. */
export function linesFromLetterBoxes(groups: LetterBoxGroup[], reads: { text: string; confidence: number }[][]): OcrLine[] {
  return groups.flatMap((g, i) =>
    g.boxes.map((box, j) => {
      const word = { text: reads[i][j]?.text ?? "", confidence: reads[i][j]?.confidence ?? 0, box, unclear: "" };
      return { text: word.text, confidence: word.confidence, box, block: 0, words: [word] };
    }),
  );
}

/** Is a pet slot completely untouched (no marks, no writing)? Then it's simply not used. */
function blankSlot(read: CensusSheetRead, slot: number) {
  const prefix = `pet${slot}.`;
  const answers = Object.entries(read.answers).filter(([key]) => key.startsWith(prefix));
  const inked = Object.entries(read.inked).filter(([key]) => key.startsWith(prefix));
  return answers.every(([, a]) => a.state === "unanswered") && inked.every(([, rows]) => rows.every((row) => row.every((on) => !on)));
}

/** The review extraction for one or more census sheets (one form per sheet, one table of pets). */
export function censusExtraction(pages: CensusPage[]): Extraction {
  const forms: FormRecord[] = [];
  const rows: RecordRow[] = [];
  const warnings: string[] = [];

  for (const { page, read, lines } of pages) {
    const { code } = read;
    const layout = layoutFor(code.version);
    const censusYear = Number(code.censusDate.slice(0, 4));
    // v2 tick boxes: Color reads as "Brown"; Registered In as a year, "Before 2019" or "Not registered".
    const display: Record<string, (value: string) => string> = {
      color: optionLabel,
      registered: (value) => (value === "EARLIER" ? `Before ${censusYear - 7}` : value === "NOT YET" ? "Not registered" : optionText(value, censusYear)),
    };
    const barangay = barangayName(code.barangay);
    const [y, m, d] = code.censusDate.split("-");
    const fields = [
      field(SHEET_FIELDS[0], barangay ? known(SHEET_FIELDS[0], barangay, page, null) : makeValue(SHEET_FIELDS[0], null, ["type-mismatch"], "This sheet names a barangay e-Vet doesn't know.")),
      field(SHEET_FIELDS[1], known(SHEET_FIELDS[1], `${m}/${d}/${y}`, page, null)),
      field(SHEET_FIELDS[2], known(SHEET_FIELDS[2], String(code.sheetNumber), page, null)),
    ];
    if (code.continuation) fields.push(field(CONTINUED_FROM, answerValue(CONTINUED_FROM, read.answers["owner.continued_from"], page)));
    else layout.owner.forEach((box, i) => fields.push(field(OWNER_FIELDS[i], writtenValue(OWNER_FIELDS[i], box, read.inked[`owner.${box.key}`], lines, page))));
    forms.push({ page, fields });

    for (const pet of layout.pets) {
      const number = pet.slot + 1 + (code.continuation ? 3 : 0);
      if (read.emptySlots[pet.slot]) continue;
      if (blankSlot(read, pet.slot)) {
        warnings.push(`Sheet ${code.sheetNumber}: pet ${number} is blank — counted as no pet. Tick “N/A” on empty slots to make this explicit.`);
        continue;
      }
      const prefix = `pet${pet.slot}`;
      const cells: Record<string, ExtractedValue> = { pet_slot: known(PET_COLUMNS[0], String(number), page, null) };
      for (const spec of PET_COLUMNS.slice(1)) {
        const writeIn = pet.writeIns.find((w) => w.key === spec.key);
        cells[spec.key] = writeIn ? writtenValue(spec, writeIn, read.inked[`${prefix}.${spec.key}`], lines, page) : answerValue(spec, read.answers[`${prefix}.${spec.key}`], page, display[spec.key]);
      }
      rows.push({ id: `p${page}-pet${number}`, page, box: px(pet.frame), cells });
    }
  }

  return {
    templateId: CENSUS_TEMPLATE_ID,
    forms,
    tables: [{ key: "pets", label: "Pets", columns: PET_COLUMNS, rows }],
    summaries: [],
    unsupported: pages.length ? null : "These pages aren't e-Vet census sheets. Print the census form from Census → Print forms, then scan it.",
    warnings,
  };
}
