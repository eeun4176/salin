/**
 * Census Sheet Extraction
 * Turns what was read from printed census sheets into values for the review
 * screen: per sheet, the barangay, date and sheet number (from the code
 * strip, so never handwritten) and the owner; per pet, every tick-box and
 * bubble answer (OMR) and the handwriting in the letter boxes (OCR, in
 * capitals, with spaces where boxes were left empty). Anything uncertain —
 * two boxes ticked, a faint mark, writing that couldn't be read — is flagged
 * so it can't count as validated until a person checks it. Every value keeps
 * its box on the sheet, linking it back to the photo.
 */

import { CENSUS_LAYOUT, type Rect, type WriteIn } from "@/core/census/census-layout";
import { barangayName } from "@/core/census/barangays";
import type { AnswerRead, CensusSheetRead } from "@/core/census/omr/read-sheet";
import { SHEET_SCALE } from "@/core/census/omr/read-sheet";
import { makeValue } from "@/core/ocr/templates/field-mapping";
import { parseTemplate } from "@/core/ocr/templates/template-schema";
import type { Box, ExtractedField, ExtractedValue, Extraction, FieldSpec, FormRecord, OcrLine, RecordRow } from "@/types/ocr";

export const CENSUS_TEMPLATE_ID = "cvo-census-v1";
export const CENSUS_TEMPLATE_NAME = "CVO census sheet (v1)";

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
  { key: "registered", label: "Registered in", type: "number", required: false },
  { key: "other_vaccines", label: "Other vaccines", type: "text", required: false },
  { key: "remarks", label: "Remarks", type: "text", required: false },
];

const asTemplateField = ({ key, label, type, required, options }: FieldSpec) => ({ key, label, type, required, ...(options ? { options } : {}) });

/** The census sheet as a template (names and types of its fields, for review); sheets are read by position, not by label. */
export const CENSUS_TEMPLATE = parseTemplate({
  id: CENSUS_TEMPLATE_ID,
  name: CENSUS_TEMPLATE_NAME,
  description: "The printed CVO-CENSUS v1 working sheet: one owner and up to three pets, read from tick boxes, bubbles and letter boxes.",
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

function answerValue(spec: FieldSpec, read: AnswerRead | undefined, page: number): ExtractedValue {
  if (!read) return makeValue(spec, null);
  const box = px(read.box);
  if (read.state === "answered") return makeValue(spec, { text: spec.type === "choice" ? optionLabel(read.value!) : read.value!, confidence: 99, mapping: 1, page, box });
  if (read.state === "unanswered") return { ...makeValue(spec, null), page, box };
  const empty = { text: "", confidence: 0, mapping: 1, page, box };
  if (read.state === "multiple") {
    const marked = read.marked.map((m) => (spec.type === "choice" ? optionLabel(m) : m)).join(", ");
    return makeValue(spec, empty, ["multiple-marks"], `More than one box is marked (${marked}). Check the sheet and pick one.`);
  }
  return makeValue(spec, empty, ["checkbox-unclear"], "A mark is too faint to be sure. Check the sheet.");
}

const LETTERS = /[^A-ZÑ0-9 .,'#/-]/g;
// Look-alikes in a digits-only box.
const DIGIT_FIXES: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", "|": "1", Z: "2", S: "5", B: "8", G: "6" };

/** Words whose middle falls inside `rect` (sheet px), left to right. */
function wordsIn(lines: OcrLine[], rect: Box) {
  return lines
    .flatMap((l) => l.words)
    .filter((w) => {
      const cx = w.box.x + w.box.width / 2;
      const cy = w.box.y + w.box.height / 2;
      return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
    })
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
  const box = px(bounds(field.rows.flat()));
  const anyInk = inked?.some((row) => row.some(Boolean)) ?? false;
  if (!anyInk) return { ...makeValue(spec, null), page, box };
  const rowWords = field.rows.map((row) => wordsIn(lines, px(bounds(row))));
  const texts = rowWords.map((words, i) => letterBoxText(words.map((w) => w.text), inked?.[i] ?? [], Boolean(field.digits))).filter(Boolean);
  const words = rowWords.flat();
  let text = texts.join(" ");
  if (field.digits) text = formatContact(text);
  const confidence = words.length ? Math.round(words.reduce((sum, w) => sum + w.confidence, 0) / words.length) : 0;
  const unclear = words.map((w) => w.unclear).join("");
  if (!text) return makeValue(spec, { text: "", confidence: 0, mapping: 1, page, box }, ["illegible"], "Something is written here, but it couldn't be read. Type it from the close-up.");
  const flags = field.digits && text.replace(/\D/g, "").length !== 11 ? (["type-mismatch"] as const) : [];
  return makeValue(spec, { text, confidence, mapping: 1, page, box, unclear }, [...flags]);
}

const field = (spec: FieldSpec, value: ExtractedValue): ExtractedField => ({ ...spec, value });

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
  const layout = CENSUS_LAYOUT;

  for (const { page, read, lines } of pages) {
    const { code } = read;
    const barangay = barangayName(code.barangay);
    const [y, m, d] = code.censusDate.split("-");
    const fields = [
      field(SHEET_FIELDS[0], barangay ? known(SHEET_FIELDS[0], barangay, page, null) : makeValue(SHEET_FIELDS[0], null, ["type-mismatch"], "This sheet names a barangay Salin doesn't know.")),
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
        cells[spec.key] = writeIn ? writtenValue(spec, writeIn, read.inked[`${prefix}.${spec.key}`], lines, page) : answerValue(spec, read.answers[`${prefix}.${spec.key}`], page);
      }
      rows.push({ id: `p${page}-pet${number}`, page, box: px(pet.frame), cells });
    }
  }

  return {
    templateId: CENSUS_TEMPLATE_ID,
    forms,
    tables: [{ key: "pets", label: "Pets", columns: PET_COLUMNS, rows }],
    summaries: [],
    unsupported: pages.length ? null : "These pages aren't Salin census sheets. Print the census form from Census → Print forms, then scan it.",
    warnings,
  };
}
