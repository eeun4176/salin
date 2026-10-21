/**
 * Question Reader Evaluation (opt-in)
 * Scores the rule-based question reader on held-out questions — wordings
 * written once and never used to tune the rules — across unrelated
 * datasets, by the answer it calculates (not by how the query looks). The
 * honest accuracy figure for "works without a language model". Skipped
 * unless SALIN_RULES_EVAL is set:
 *   SALIN_RULES_EVAL=1 npx vitest run src/core/ai/question-eval.test.ts
 * Results are written to docs/benchmarks/rules-eval.json.
 */

import { mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { runQuery } from "@/core/ai/data-query";
import { check, CUSTOMERS, EMPLOYEES, GRADES, HOUSEHOLDS, INVENTORY, ORDERS, type Expect, type Fixture } from "@/core/ai/question-fixtures";
import { parseQuestion } from "@/core/ai/question-parser";

/** Written once, before tuning; don't edit these to make them pass. */
const HELD_OUT: [Fixture, string, Expect][] = [
  [CUSTOMERS, "give me the phone number of Marcus", { values: ["250-574-1941"] }],
  [CUSTOMERS, "how many customers are in the Philippines?", { count: 2 }],
  [CUSTOMERS, "customers who work at Baxter Group", { rows: 2 }],
  [CUSTOMERS, "anong company ni Maria", { values: ["Calamba Trading"] }],
  [CUSTOMERS, "who joined before 2021", { rows: 2 }],
  [CUSTOMERS, "show customers with no phone", { rows: 1 }],
  [CUSTOMERS, "number of customers per company", { group: ["Baxter Group", 2] }],
  [CUSTOMERS, "Hectors email address", { rows: 2 }],
  [CUSTOMERS, "list all customers from spain or finland", { rows: 2 }],
  [CUSTOMERS, "pinakabagong subscriber", { first: "Ana" }],
  [ORDERS, "how much did Juan Dela Cruz spend in total", { value: 4900 }],
  [ORDERS, "orders in Visayas that are not paid", { rows: 2 }],
  [ORDERS, "which product sold the most", { group: ["Rice 25kg", 2] }],
  [ORDERS, "average order total", { value: 1875 }],
  [ORDERS, "ilang order ang galing sa Luzon", { count: 3 }],
  [ORDERS, "orders with quantity of 5 or more", { rows: 2 }],
  [ORDERS, "orders from January 2026", { rows: 2 }],
  [ORDERS, "rice orders", { rows: 3 }],
  [ORDERS, "highest unit price", { value: 2500 }],
  [ORDERS, "total quantity sold per product", { group: ["Rice 25kg", 3] }],
  [INVENTORY, "what is the price of the stapler", { values: [180] }],
  [INVENTORY, "items with low stock below 20", { rows: 3 }],
  [INVENTORY, "cheapest item", { first: "Ballpen Blue" }],
  [INVENTORY, "how many items does Mabuhay Supplies have", { count: 2 }],
  [INVENTORY, "items restocked in 2026", { rows: 3 }],
  [INVENTORY, "total stock per category", { group: ["Office", 135] }],
  [INVENTORY, "magkano ang bleach", { values: [60] }],
  [GRADES, "students who passed in Math", { rows: 2 }],
  [GRADES, "grade of Melchora Aquino", { values: [95] }],
  [GRADES, "top 2 students", { first: "Melchora Aquino" }],
  [GRADES, "how many boys", { count: 3 }],
  [GRADES, "average grade of section Mabini", { value: 82.67 }],
  [GRADES, "sino ang mga bumagsak", { rows: 2 }],
  [GRADES, "lowest grade in science", { value: 74 }],
  [EMPLOYEES, "how many employees work in Quezon City", { count: 2 }],
  [EMPLOYEES, "salary of Dino Cruz", { values: [45000] }],
  [EMPLOYEES, "employees earning more than 40000", { rows: 3 }],
  [EMPLOYEES, "who was hired first", { first: "Bea Santos" }],
  [EMPLOYEES, "list departments", { group: ["IT", 2] }],
  [EMPLOYEES, "total salary of the IT department", { value: 93000 }],
  [EMPLOYEES, "mga empleyado sa Finance", { rows: 2 }],
  [HOUSEHOLDS, "which households have no contact number", { rows: 2 }],
  [HOUSEHOLDS, "average income per barangay", { group: ["Poblacion", 14500] }],
  [HOUSEHOLDS, "families with more than 4 members", { rows: 2 }],
  [HOUSEHOLDS, "ilan ang may kuryente", { count: 3 }],
  [HOUSEHOLDS, "biggest household", { first: "Ernesto Bautista" }],
  [HOUSEHOLDS, "households in Malanday or San Isidro", { rows: 3 }],
];

describe.skipIf(!process.env.SALIN_RULES_EVAL)("question reader evaluation", () => {
  it("answers held-out questions on unrelated datasets without a model", async () => {
    const today = new Date(Date.UTC(2026, 3, 15));
    const results = HELD_OUT.map(([data, question, expected]) => {
      const parsed = parseQuestion(question, data.columns, data.rows, today);
      const result = parsed ? runQuery(parsed.query, data.columns, data.rows) : null;
      return { question, understood: parsed?.understood ?? null, confident: parsed?.confident ?? false, unknown: parsed?.unknown ?? [], correct: !!result && check(result, expected) };
    });
    const correct = results.filter((r) => r.correct).length;
    const summary = {
      heldOutAccuracy: correct / results.length,
      // When the reader says it's sure, how often it's right (it hands the rest to the model or asks).
      confidentAnswers: results.filter((r) => r.confident).length,
      confidentCorrect: results.filter((r) => r.confident && r.correct).length,
    };
    console.log(JSON.stringify(summary));
    console.table(results.map((r) => ({ ok: r.correct ? "✓" : "✗", sure: r.confident ? "sure" : "", question: r.question, understood: (r.understood ?? "—").slice(0, 70), unknown: r.unknown.join(",") })));
    await mkdir("docs/benchmarks", { recursive: true });
    await writeFile("docs/benchmarks/rules-eval.json", JSON.stringify({ summary, results }, null, 2));
    expect(results.length).toBe(HELD_OUT.length);
  });
});
