/**
 * CSV Preview Parser
 * A small RFC 4180 reader (quoted fields, escaped quotes, CRLF, comma /
 * semicolon / tab delimiters) used to preview the first rows of a CSV file.
 * Full spreadsheet import and editing arrive with Papa Parse in Phase 3.
 */

export interface CsvPreview {
  rows: string[][];
  /** True when the file had more rows than `maxRows`. */
  truncated: boolean;
}

function detectDelimiter(text: string) {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? undefined : text.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsvPreview(input: string, maxRows = 200): CsvPreview {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length > maxRows) return { rows: rows.slice(0, maxRows), truncated: true };
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}
