/**
 * Recognition Accuracy
 * Measures OCR quality against manually verified text, kept separate as the
 * phase requires: character error rate (CER) and word error rate (WER) for
 * raw recognition, and field-level accuracy for what the template mapping
 * extracted. Text is compared after normalising spaces and case, so layout
 * differences don't count as errors.
 */

/** Edit distance between two sequences (insertions, deletions, substitutions). */
export function levenshtein<T>(a: readonly T[], b: readonly T[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

export const normalizeText = (text: string) => text.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** Character error rate, 0 = perfect (can exceed 1 when OCR adds a lot of noise). */
export function characterErrorRate(reference: string, recognized: string) {
  const ref = [...normalizeText(reference)];
  const hyp = [...normalizeText(recognized)];
  return ref.length ? levenshtein(ref, hyp) / ref.length : hyp.length ? 1 : 0;
}

/** Word error rate, 0 = perfect. */
export function wordErrorRate(reference: string, recognized: string) {
  const ref = normalizeText(reference).split(" ").filter(Boolean);
  const hyp = normalizeText(recognized).split(" ").filter(Boolean);
  return ref.length ? levenshtein(ref, hyp) / ref.length : hyp.length ? 1 : 0;
}

export interface FieldScore {
  key: string;
  expected: string;
  actual: string;
  correct: boolean;
}

/** Share of expected fields whose extracted value matches exactly (after normalising). */
export function fieldAccuracy(expected: Record<string, string>, actual: Record<string, string>) {
  const scores: FieldScore[] = Object.entries(expected).map(([key, value]) => {
    const got = actual[key] ?? "";
    return { key, expected: value, actual: got, correct: normalizeText(got) === normalizeText(value) };
  });
  const correct = scores.filter((s) => s.correct).length;
  return { accuracy: scores.length ? correct / scores.length : 1, correct, total: scores.length, scores };
}
