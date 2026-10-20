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
  let ink = 0;
  for (let i = 0; i < size; i++) {
    const gray = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
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

/** Greedy CTC decoding of the recognizer's per-column probabilities ([steps × classes], softmaxed). */
export function decodeLine(probs: Float32Array, steps: number, classes: number, characters: readonly string[] = HANDWRITING_CHARACTERS): LineReading {
  let text = "";
  let last = -1;
  const kept: number[] = [];
  for (let s = 0; s < steps; s++) {
    let best = 0;
    let p = -1;
    for (let c = 0; c < classes; c++) {
      const v = probs[s * classes + c];
      if (v > p) [p, best] = [v, c];
    }
    if (best !== 0 && best !== last) {
      text += characters[best] ?? "";
      kept.push(p);
    }
    last = best;
  }
  return { text: cleanReading(text), confidence: kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : 0 };
}

/** Drops ruling-line and border fragments at the edges ("|Juan Cruz_") and doubled spaces. */
export function cleanReading(text: string) {
  return text.replace(/^[\s|_\-–—[\]()!.,:;'"`~]+|[\s|_\-–—[\]!:;'"`~]+$/g, "").replace(/\s+/g, " ");
}
