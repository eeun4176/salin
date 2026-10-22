/**
 * Handwriting Recognition (pre- and post-processing)
 * Salin reads handwriting one value at a time: the region of a form field
 * or table cell (from the template mapping) is cropped from the prepared
 * page, scaled to the 48-pixel line height the recognizer expects, and read
 * by PaddleOCR's PP-OCRv5 English recognizer (an ONNX model run by ONNX
 * Runtime Web — chosen over TrOCR and Tesseract in Salin's benchmark, see
 * docs/PHASE5_AI.md). Its output is decoded here (CTC: per-column best
 * character, repeats and blanks collapsed) into text plus a confidence —
 * the mean probability of the characters read. This module is pure, so
 * the worker and the tests share it.
 */

/** The recognizer's characters, in output order (index 0 is the CTC blank, the last is a space). */
export const HANDWRITING_CHARACTERS: readonly string[] = ["", ..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!\"#$%&'()*+,-./:;<=>?@[\\]_`{|}^~©®℉№Ω℮™∆✓✔✗✘✕☑☒●▪▫◼▶◀⬆¤¦§¨ª«¬¯°²³´µ¶¸¹º»¼½¾¿×‐‑‒—―‖‗‘’‚‛“”„‟†‡‣․…‧‰‴‵‶‷‸‹›※‼‽‾−₤₡₹₽₴₿¢€£¥ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ➀➁➂➃➄➅➆➇➈➉➊➋➌➍➎➏➐➑➒➓❶❷❸❹❺❻❼❽❾❿①②③④⑤⑥⑦⑧⑨⑩↑→↓↕←↔⇒⇐⇔∀∃∄∴∵∝∞∩∪∂∫∬∭∮∯∰∑∏√∛∜∱∲∳∶∷∼∖∗≈≠≡≤≥⊂⊃⊥⊾⊿□∥∋ƒ′″ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψωÅℏ⌀⍺⍵𝑢𝜓०‥︽﹥•÷∕∙⋅·±∓∟∠∡∢℧☺", " "];

export const LINE_HEIGHT = 48;
const MAX_WIDTH = 1600;
/** Below this share of dark pixels a crop is treated as empty (nothing written). */
const MIN_INK = 0.004;

/** The model input width for a crop, keeping its proportions (at least a few columns). */
export function lineWidth(width: number, height: number) {
  return Math.max(16, Math.min(MAX_WIDTH, Math.round((LINE_HEIGHT * width) / Math.max(1, height))));
}

/**
 * Model input from a crop already scaled to LINE_HEIGHT × width (RGBA, as
 * canvases give it): three identical grey channels scaled to −1…1.
 * Returns `null` when the crop holds (almost) no ink.
 */
export function lineTensor(rgba: Uint8ClampedArray, width: number): Float32Array | null {
  const size = LINE_HEIGHT * width;
  const out = new Float32Array(3 * size);
  const luma = (i: number) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  // Faint ink (a light ballpoint, a pale photo): stretch so the darkest stroke is near black (at most 3×).
  let darkest = 255;
  for (let i = 0; i < size; i++) darkest = Math.min(darkest, luma(i));
  const gain = darkest < 250 ? Math.min(3, 235 / (255 - darkest)) : 1;
  let ink = 0;
  for (let i = 0; i < size; i++) {
    const gray = gain > 1 ? Math.max(0, 255 - (255 - luma(i)) * gain) : luma(i);
    if (gray < 110) ink++;
    const v = gray / 127.5 - 1;
    out[i] = v;
    out[size + i] = v;
    out[2 * size + i] = v;
  }
  return ink / size < MIN_INK ? null : out;
}

export interface LineReading {
  text: string;
  /** Mean probability of the characters read, 0–1 (0 when nothing was read). */
  confidence: number;
}

/**
 * Greedy CTC decoding of the recognizer's per-column probabilities ([steps ×
 * classes], softmaxed). With `allowed`, only those characters (and the blank)
 * can be read — a written-in line of capitals reads as capitals, with
 * lowercase and look-alikes folded in ("o" → "O"; "O" → "0" where only digits
 * are allowed). `gaps` (0–1 across the crop) are where the ink shows a space
 * between words: a space goes there even when the model didn't read one.
 */
export function decodeLine(probs: Float32Array, steps: number, classes: number, characters: readonly string[] = HANDWRITING_CHARACTERS, allowed?: string, gaps: number[] = []): LineReading {
  // Output character for each class the line may hold (all classes when nothing is restricted).
  const output = new Map<number, string>();
  if (allowed) for (const char of allowed) for (const c of classesFor(char, characters)) if (c < classes && !output.has(c)) output.set(c, char);
  let text = "";
  let last = -1;
  let lastAt = -1;
  const kept: number[] = [];
  for (let s = 0; s < steps; s++) {
    let best = 0;
    let p = -1;
    for (let c = 0; c < classes; c++) {
      if (allowed && c !== 0 && !output.has(c)) continue;
      const v = probs[s * classes + c];
      if (v > p) [p, best] = [v, c];
    }
    if (best !== 0 && best !== last) {
      const char = (allowed ? output.get(best) : characters[best]) ?? "";
      const at = (s + 0.5) / steps;
      if (char !== " " && text && !text.endsWith(" ") && gaps.some((g) => g > lastAt && g < at)) text += " ";
      text += char;
      if (char !== " ") lastAt = at;
      kept.push(p);
    }
    last = best;
  }
  return { text: cleanReading(text), confidence: kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0 };
}

/**
 * One letter box inside a line crop: where it is (0–1 across the crop), the
 * characters it may hold, and whether a space comes before it (an empty
 * box in between).
 */
export interface LineSlot {
  from: number;
  to: number;
  allowed: string;
  spaceBefore?: boolean;
}

// Handwritten capitals are often read as their lowercase twin, and digits as look-alike letters.
const LOOK_ALIKES: Record<string, string> = { "0": "OoDQ", "1": "Il|i", "2": "Zz", "5": "Ss", "6": "Gb", "8": "B", "9": "gq" };

function classesFor(char: string, characters: readonly string[]) {
  const forms = new Set([char, char.toLowerCase(), ...(LOOK_ALIKES[char] ?? "")]);
  return characters.flatMap((c, i) => (i > 0 && forms.has(c) ? [i] : []));
}

/**
 * Decoding for letter boxes: exactly one character per box, chosen among
 * the box's allowed characters by the highest probability in the columns
 * over that box. A box can't be skipped, doubled or read as a stray mark,
 * and capitals and digits come out as such ("o" → "O", "O" → "0" in digit
 * boxes). Confidence is the mean of the boxes' probabilities, like decodeLine.
 */
export function decodeSlots(probs: Float32Array, steps: number, classes: number, slots: LineSlot[], characters: readonly string[] = HANDWRITING_CHARACTERS): LineReading {
  let text = "";
  let total = 0;
  const options = new Map<string, number[]>();
  for (const slot of slots) {
    const from = Math.max(0, Math.floor(slot.from * steps));
    const to = Math.min(steps, Math.max(from + 1, Math.ceil(slot.to * steps)));
    let best = { char: "", p: 0 };
    for (const char of slot.allowed) {
      if (!options.has(char)) options.set(char, classesFor(char, characters));
      for (const c of options.get(char)!) {
        if (c >= classes) continue;
        for (let s = from; s < to; s++) {
          const p = probs[s * classes + c];
          if (p > best.p) best = { char, p };
        }
      }
    }
    text += (slot.spaceBefore && text ? " " : "") + best.char;
    total += best.p;
  }
  return { text, confidence: slots.length ? total / slots.length : 0 };
}

/** Drops ruling-line and border fragments at the edges ("|Juan Cruz_") and doubled spaces. */
export function cleanReading(text: string) {
  return text.replace(/^[\s|_\-–—[\]()!.,:;'"`~]+|[\s|_\-–—[\]!:;'"`~]+$/g, "").replace(/\s+/g, " ");
}
