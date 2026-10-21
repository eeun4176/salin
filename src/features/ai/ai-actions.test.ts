/**
 * AI Studio Answers
 * Checks how questions about a dataset are answered: the rule-based reader
 * answers what it fully understands at once, without the model; names that
 * aren't in the data are said to be missing; only questions it can't fully
 * read go to the model (mocked here), whose plan is still held to what the
 * question asks — a filter value copied from the column examples is
 * refused, and the reader's own reading is given instead.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const generate = vi.hoisted(() => vi.fn(async () => ""));
vi.mock("@/core/ai/ai-runtime", () => ({ aiRuntime: { generate }, AiError: Error }));

import type { AiModelVariant } from "@/core/ai/ai-models";
import type { DatasetColumn, DatasetRow } from "@/types/processing";

import { answerDataQuestion, commandFromRequest } from "./ai-actions";

const col = (name: string, type: DatasetColumn["type"] = "text"): DatasetColumn => ({ id: name.toLowerCase().replace(/\W+/g, "_"), name, type, required: false, sourceHeader: name });
const columns = [col("Owner"), col("Pet name"), col("Species"), col("Contact no."), col("Email")];
const rows: DatasetRow[] = [
  ["Juan Dela Cruz", "Bantay", "Dog", "0917", "juan@example.com"],
  ["Maria Santos", "Mingming", "Cat", "0928", "maria@example.com"],
  ["Pedro Reyes", "Brownie", "Dog", "", "pedro@example.com"],
].map((values, i) => ({ id: `r${i}`, datasetId: "d", position: i, source: null, values: Object.fromEntries(columns.map((c, j) => [c.id, values[j]])) }));
const variant = { device: "wasm", assets: [] } as AiModelVariant;
const ask = (question: string, plan?: object, model: AiModelVariant | null = variant) => {
  generate.mockResolvedValue(JSON.stringify(plan ?? { action: "unsupported" }));
  return answerDataQuestion(question, columns, rows, model);
};

describe("answerDataQuestion", () => {
  beforeEach(() => generate.mockClear());

  it("refuses a write plan with invented conditions instead of broadening it", async () => {
    generate.mockResolvedValue(JSON.stringify({ action: "delete_rows", where: [{ column: "Species", op: "equals", value: "Dog" }, { column: "Owner", op: "equals", value: "Maria Santos" }] }));
    expect(await commandFromRequest("delete dogs", columns, rows, variant)).toMatchObject({ ok: false, message: expect.stringContaining("added conditions") });
    expect(rows).toHaveLength(3);
  });

  it("answers what the reader fully understands without the model", async () => {
    expect(await ask("Extract the pet names of the dogs only")).toMatchObject({ kind: "table", headers: ["Pet name"], rows: [["Bantay"], ["Brownie"]], understood: expect.stringContaining("Species") });
    expect(await ask("How many dogs are there?")).toMatchObject({ kind: "text", text: "2 rows match." });
    expect(await ask("How many pets are there in each species?")).toMatchObject({ kind: "table", headers: ["Species", "Count"], rows: [["Cat", 1], ["Dog", 2]] });
    expect(await ask("Which email belongs to Pedro?")).toMatchObject({ headers: ["Email"], rows: [["pedro@example.com"]] });
    expect(generate).not.toHaveBeenCalled();
  });

  it("says when a name isn't in the data instead of answering about every row", async () => {
    expect(await ask("Which owners are from Chile?")).toMatchObject({ kind: "text", text: expect.stringContaining("couldn't find “Chile”") });
  });

  it("asks the model only when the reader can't place every word, and still refuses a value it copied from the examples", async () => {
    const answer = await ask("What does Pedro prefer?", { action: "table", where: [{ column: "Email", op: "equals", value: "maria@example.com" }], columns: ["Email"] });
    expect(generate).toHaveBeenCalledTimes(1);
    // The copied filter is dropped; the reader's own reading (Pedro's row) is the answer, never Maria's.
    expect(answer).toMatchObject({ kind: "table", totalRows: 1, text: expect.stringContaining("prefer") });
    expect(JSON.stringify(answer)).toContain("pedro@example.com");
    expect(JSON.stringify(answer)).not.toContain("maria@example.com");
  });

  it("without a model, gives the partial reading and the words it didn't use", async () => {
    expect(await ask("What does Pedro prefer?", undefined, null)).toMatchObject({ kind: "table", totalRows: 1, text: expect.stringMatching(/didn.t use: “prefer”/) });
    expect(generate).not.toHaveBeenCalled();
  });
});
