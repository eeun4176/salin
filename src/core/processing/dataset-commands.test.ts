/**
 * Dataset Command Tests
 * Commands are validated against the dataset before they run (unknown
 * columns, wrong value types, unsupported comparisons and malformed AI
 * output are rejected with a reason), then run purely: filters return a
 * view, changes return a before/after preview without touching the input,
 * summaries and duplicate checks return tables and groups. Also the value
 * normalizers, which never invent a value they don't recognise.
 */

import { describe, expect, it } from "vitest";

import type { DatasetColumn, DatasetRow } from "@/types/processing";

import { describeCommand, removeRows, resolveCommand, runCommand, type CommandOutcome } from "./dataset-commands";
import { normalizeValue, ruleForLabel } from "./value-normalizers";

const col = (id: string, name: string, type: DatasetColumn["type"] = "text"): DatasetColumn => ({ id, name, type, required: false, sourceHeader: name });
const COLUMNS = [col("owner", "Owner"), col("brgy", "Barangay"), col("pet", "Pet's name"), col("species", "Species"), col("sex", "Sex"), col("age", "Age", "number"), col("vax", "Vaccinated", "boolean"), col("date", "Date registered", "date"), col("phone", "Contact no.")];

function row(id: string, values: Partial<Record<string, string | number | boolean | null>>): DatasetRow {
  return { id, datasetId: "d", position: 0, source: null, values: values as DatasetRow["values"] };
}

const ROWS = [
  row("r1", { owner: "juan dela cruz", brgy: "Muzon", pet: "Bantay", species: "Dog", sex: "M", age: 2, vax: true, date: "2026-03-14", phone: "09171234567" }),
  row("r2", { owner: "Maria Santos", brgy: "Tungkong Mangga", pet: "Mingming", species: "cat", sex: "Babae", age: 1, vax: false, date: "2026-07-02", phone: "09281234567" }),
  row("r3", { owner: "Pedro Reyes", brgy: "muzon", pet: "Brownie", species: "Dog", sex: "female", age: 5, vax: false, date: "2026-08-21", phone: null }),
  row("r4", { owner: "Juan Dela Cruz", brgy: "Muzon", pet: "Bantay", species: "Dog", sex: "Male", age: null, vax: null, date: null, phone: "" }),
];
const target = { columns: COLUMNS, rows: ROWS };

function run(input: unknown): CommandOutcome {
  const resolved = resolveCommand(input, COLUMNS);
  if (!resolved.ok) throw new Error(resolved.message);
  return runCommand(resolved.command, target);
}

describe("resolveCommand", () => {
  it("matches column names loosely and converts values to the column type", () => {
    const resolved = resolveCommand({ action: "filter", where: [{ column: "pet name", op: "equals", value: "Bantay" }, { column: "vaccinated", op: "equals", value: "no" }, { column: "AGE", op: "greater_than", value: "1" }] }, COLUMNS);
    expect(resolved).toEqual({
      ok: true,
      command: {
        action: "filter",
        match: "all",
        where: [
          { column: "pet", op: "equals", value: "Bantay" },
          { column: "vax", op: "equals", value: false },
          { column: "age", op: "greater_than", value: 1 },
        ],
      },
    });
  });

  it("rejects unknown columns, impossible comparisons and wrongly typed values with a reason", () => {
    const fail = (input: unknown) => {
      const r = resolveCommand(input, COLUMNS);
      return r.ok ? null : r.message;
    };
    expect(fail({ action: "filter", where: [{ column: "Weight", op: "equals", value: 3 }] })).toMatch(/no column called “Weight”/);
    expect(fail({ action: "filter", where: [{ column: "Owner", op: "greater_than", value: "A" }] })).toMatch(/can't be compared/);
    expect(fail({ action: "filter", where: [{ column: "Age", op: "equals", value: "two" }] })).toMatch(/isn't a number/);
    expect(fail({ action: "filter", where: [{ column: "Owner", op: "equals" }] })).toMatch(/compared with/);
    expect(fail({ action: "summarize", group_by: ["Species"], aggregate: "average", column: "Owner" })).toMatch(/can't be added up|can't be averaged/);
    expect(fail({ action: "normalize", column: "Age", rule: "sex" })).toMatch(/doesn't apply/);
    expect(fail({ action: "rename_column", column: "Owner", to: "species" })).toMatch(/already a column/);
  });

  it("rejects malformed or unknown actions (e.g. from a confused model)", () => {
    expect(resolveCommand({ action: "drop_table" }, COLUMNS).ok).toBe(false);
    expect(resolveCommand({ action: "delete_rows", where: [] }, COLUMNS).ok).toBe(false);
    expect(resolveCommand("filter dogs", COLUMNS).ok).toBe(false);
    expect(resolveCommand({ action: "filter", where: [{ column: "Owner", op: "like", value: "x" }] }, COLUMNS).ok).toBe(false);
  });
});

describe("runCommand", () => {
  it("filters into a view without changing anything (text ignores case, yes/no and numbers are typed)", () => {
    const outcome = run({ action: "filter", where: [{ column: "Barangay", op: "equals", value: "MUZON" }, { column: "Vaccinated", op: "equals", value: false }] });
    expect(outcome).toMatchObject({ kind: "view", rowIds: ["r3"] });
    expect(run({ action: "filter", where: [{ column: "Contact no.", op: "is_empty" }] })).toMatchObject({ rowIds: ["r3", "r4"] });
    expect(run({ action: "filter", where: [{ column: "Date registered", op: "greater_than", value: "June 30, 2026" }] })).toMatchObject({ rowIds: ["r2", "r3"] });
    expect(run({ action: "filter", match: "any", where: [{ column: "Species", op: "equals", value: "cat" }, { column: "Age", op: "at_least", value: 5 }] })).toMatchObject({ rowIds: ["r2", "r3"] });
  });

  it("sorts with empty values last in both directions", () => {
    const asc = run({ action: "sort", by: [{ column: "Age" }] });
    const desc = run({ action: "sort", by: [{ column: "Age", direction: "desc" }] });
    expect(asc.kind === "change" && asc.rows.map((r) => r.id)).toEqual(["r2", "r1", "r3", "r4"]);
    expect(desc.kind === "change" && desc.rows.map((r) => r.id)).toEqual(["r3", "r1", "r2", "r4"]);
    expect(ROWS.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("previews bulk changes with before/after samples and leaves the input untouched", () => {
    const outcome = run({ action: "set_value", column: "Vaccinated", value: "yes", where: [{ column: "Species", op: "equals", value: "Cat" }] });
    expect(outcome).toMatchObject({ kind: "change", destructive: true, affectedRows: 1, changedRowIds: ["r2"], samples: [{ row: 2, column: "Vaccinated", before: false, after: true }] });
    expect(ROWS[1].values.vax).toBe(false);
  });

  it("standardizes values with a rule and leaves values it doesn't recognise alone", () => {
    const outcome = run({ action: "normalize", column: "Sex", rule: "sex" });
    expect(outcome.kind === "change" && outcome.rows.map((r) => r.values.sex)).toEqual(["Male", "Female", "Female", "Male"]);
    expect(outcome).toMatchObject({ affectedRows: 3 });
  });

  it("deletes only matching rows, and says so when none match", () => {
    expect(run({ action: "delete_rows", where: [{ column: "Owner", op: "contains", value: "reyes" }] })).toMatchObject({ kind: "change", affectedRows: 1, destructive: true });
    expect(run({ action: "delete_rows", where: [{ column: "Owner", op: "equals", value: "Nobody" }] })).toMatchObject({ affectedRows: 0, destructive: false });
  });

  it("renames and converts column types (values that don't fit are counted, not dropped)", () => {
    const renamed = run({ action: "rename_column", column: "Pet's name", to: "Name of pet" });
    expect(renamed.kind === "change" && renamed.columns.find((c) => c.id === "pet")?.name).toBe("Name of pet");
    const typed = run({ action: "change_type", column: "Owner", to: "number" });
    expect(typed).toMatchObject({ kind: "change", affectedRows: 0 });
    expect(typed.kind === "change" && typed.message).toMatch(/4 values don't fit/);
  });

  it("groups and aggregates, and gives an overview without a group", () => {
    const counts = run({ action: "summarize", group_by: ["Barangay"] });
    expect(counts).toMatchObject({ kind: "table", headers: ["Barangay", "Count"], rows: [["Muzon", 3], ["Tungkong Mangga", 1]] });
    const average = run({ action: "summarize", group_by: ["Species"], aggregate: "average", column: "Age" });
    expect(average).toMatchObject({ rows: [["cat", 1], ["Dog", 3.5]] });
    const overview = run({ action: "summarize" });
    expect(overview).toMatchObject({ kind: "table", title: "Summary" });
    expect(overview.kind === "table" && overview.rows[0]).toEqual(["Owner", 4, 0, 3, "juan dela cruz (1), Maria Santos (1), Pedro Reyes (1)"]);
  });

  it("finds duplicates deterministically (case and spacing ignored) without removing them", () => {
    const outcome = run({ action: "find_duplicates", columns: ["Owner", "Pet's name"] });
    expect(outcome).toMatchObject({ kind: "duplicates", groups: [{ rowIds: ["r1", "r4"], rows: [1, 4] }] });
    const removed = removeRows(target, new Set(["r4"]));
    expect(removed).toMatchObject({ kind: "change", affectedRows: 1 });
    expect(ROWS).toHaveLength(4);
  });

  it("keeps only the named columns, in that order, with every row and its source", () => {
    const outcome = run({ action: "keep_columns", columns: ["pet name", "owner", "Owner"] });
    if (outcome.kind !== "change") throw new Error("expected a change");
    expect(outcome.columns.map((c) => c.id)).toEqual(["pet", "owner"]);
    expect(outcome.rows.map((r) => r.values)).toEqual(ROWS.map((r) => ({ pet: r.values.pet, owner: r.values.owner })));
    expect(outcome.rows.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
    expect(outcome).toMatchObject({ structural: true, destructive: true, affectedColumns: ["Barangay", "Species", "Sex", "Age", "Vaccinated", "Date registered", "Contact no."] });
    expect(ROWS[0].values.brgy).toBe("Muzon");
    expect(resolveCommand({ action: "keep_columns", columns: ["Breed"] }, COLUMNS)).toMatchObject({ ok: false, message: expect.stringContaining("“Breed”") });
    expect(resolveCommand({ action: "keep_columns", columns: [] }, COLUMNS).ok).toBe(false);
    const same = run({ action: "keep_columns", columns: COLUMNS.map((c) => c.name) });
    expect(same).toMatchObject({ affectedColumns: [], destructive: false });
  });

  it("describes commands in plain language", () => {
    const resolved = resolveCommand({ action: "filter", where: [{ column: "Species", op: "equals", value: "Dog" }, { column: "Vaccinated", op: "equals", value: false }] }, COLUMNS);
    expect(resolved.ok && describeCommand(resolved.command, COLUMNS)).toBe("Show rows where Species is “Dog” and Vaccinated is “No”");
  });
});

describe("normalizeValue", () => {
  it("standardizes English and Filipino values and keeps unknown ones", () => {
    expect(["M", "lalaki", "Babae", "F.", "unknown"].map((v) => normalizeValue("sex", v))).toEqual(["Male", "Male", "Female", "Female", "unknown"]);
    expect(["aso", "Pusa", "canine", "Aspin"].map((v) => normalizeValue("species", v))).toEqual(["Dog", "Cat", "Dog", "Aspin"]);
    expect(normalizeValue("yes_no", "oo", "boolean")).toBe(true);
    expect(normalizeValue("yes_no", "✓")).toBe("Yes");
    expect(normalizeValue("yes_no", "maybe")).toBe("maybe");
    expect(normalizeValue("date", "Oct. 18, 2026")).toBe("2026-10-18");
    expect(normalizeValue("title_case", "  juan  DELA cruz iii ")).toBe("Juan Dela Cruz III");
  });

  it("never changes leading zeros, numbers or empty values", () => {
    expect(normalizeValue("trim", " 0917 123 4567 ")).toBe("0917 123 4567");
    expect(normalizeValue("uppercase", 42)).toBe(42);
    expect(normalizeValue("sex", null)).toBeNull();
  });

  it("suggests a rule from field labels in English and Filipino", () => {
    expect(["Sex", "Kasarian", "Type of Pet", "Vaccinated", "Date of latest rabies vaccination", "Owner"].map(ruleForLabel)).toEqual(["sex", "sex", "species", "yes_no", null, null]);
  });
});
