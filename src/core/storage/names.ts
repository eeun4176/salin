/**
 * Item Name Rules
 * Validation for folder and file names typed by the user, cleanup for names
 * coming from imported files, and "Name (2)" de-duplication when the app
 * creates items automatically (imports, copies, moves, restores).
 */

export const MAX_NAME_LENGTH = 255;

// Characters that break file downloads or folder paths on common operating systems.
// Control characters are matched on purpose, so the lint rule against them doesn't apply.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

export interface NamedSibling {
  id: string;
  name: string;
}

/** Trims and collapses internal whitespace. */
export function normalizeName(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Checks a user-entered name. Returns an error message, or `null` if valid.
 * `siblings` are the other live items of the same kind in the same folder.
 */
export function validateName(raw: string, siblings: NamedSibling[], selfId?: string): string | null {
  const name = normalizeName(raw);
  if (!name) return "Enter a name.";
  if (name.length > MAX_NAME_LENGTH) return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  if (FORBIDDEN.test(name)) return 'Names can\'t contain \\ / : * ? " < > |';
  if (name === "." || name === "..") return "Choose a different name.";
  const lower = name.toLowerCase();
  if (siblings.some((s) => s.id !== selfId && s.name.toLowerCase() === lower)) {
    return "An item with this name is already in this folder.";
  }
  return null;
}

/** Makes an imported or generated name storable: forbidden characters become "_". */
export function sanitizeName(raw: string, fallback = "Untitled") {
  const name = normalizeName(raw.replace(new RegExp(FORBIDDEN, "g"), "_"));
  if (!name || name === "." || name === "..") return fallback;
  return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) : name;
}

/** Splits "report.final.pdf" into ["report.final", ".pdf"]; folders have no extension. */
export function splitExtension(name: string, isFile: boolean): [string, string] {
  if (!isFile) return [name, ""];
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Returns `name`, or "name (2)", "name (3)"… — whichever is not in `taken`
 * (lower-cased names). For files the counter goes before the extension.
 */
export function uniqueName(name: string, taken: Set<string>, isFile: boolean) {
  if (!taken.has(name.toLowerCase())) return name;
  const [base, ext] = splitExtension(name, isFile);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
