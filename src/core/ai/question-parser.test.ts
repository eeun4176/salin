/**
 * Question Reader Tests
 * The rule-based reader on six unrelated datasets (customers, orders,
 * inventory, grades, employees, barangay households), in English, Filipino
 * and Taglish: each question must be read completely and give the right
 * calculated answer. Also: names not in the data are reported, ambiguous
 * numbers aren't guessed, typos and accents still match, and common words
 * ("last month", "customers") don't link to columns they merely resemble.
 */

import { describe, expect, it } from "vitest";

import { runQuery } from "@/core/ai/data-query";
import { CENSUS, check, CUSTOMERS, EMPLOYEES, GRADES, HOUSEHOLDS, INVENTORY, ORDERS, type Expect, type Fixture } from "@/core/ai/question-fixtures";
import { linkQuestion } from "@/core/ai/question-linking";
import { parseQuestion } from "@/core/ai/question-parser";

const today = new Date(Date.UTC(2026, 3, 15));

const CASES: [Fixture, string, Expect][] = [
  [CUSTOMERS, "What is the email of Hector?", { values: ["janecooper@chambers-underwood.com", "crosbyalison@herman.net"] }],
  [CUSTOMERS, "How many customers are there in each country?", { group: ["Philippines", 2] }],
  [CUSTOMERS, "Extract only the first names and emails", { columns: ["First Name", "Email"] }],
  [CUSTOMERS, "Who works at Rich-Santos?", { first: "Marcus" }],
  [CUSTOMERS, "customers from the philippines", { rows: 2 }],
  [CUSTOMERS, "Where does Maria live?", { values: ["Manila"] }],
  [CUSTOMERS, "who subscribed in 2020", { rows: 2 }],
  [CUSTOMERS, "customers without an email", { rows: 1 }],
  [CUSTOMERS, "list the countries", { group: ["Philippines", 2] }],
  [CUSTOMERS, "email ni Jose", { values: ["jose@calamba.ph"] }],
  [CUSTOMERS, "Which country has the most customers?", { values: ["Philippines"] }],
  [CUSTOMERS, "customers from Finlnad", { rows: 1 }],
  [ORDERS, "total sales per region", { group: ["Luzon", 5700] }],
  [ORDERS, "What is the total of all orders?", { value: 11250 }],
  [ORDERS, "unpaid orders", { rows: 2 }],
  [ORDERS, "orders by Juan Dela Cruz", { rows: 2 }],
  [ORDERS, "top 3 orders by total", { first: "SO-1005" }],
  [ORDERS, "how many orders in February 2026", { count: 2 }],
  [ORDERS, "average quantity per category", { group: ["Groceries", 4.5] }],
  [ORDERS, "what did Liza buy", { rows: 2 }],
  [ORDERS, "orders last month", { rows: 2 }],
  [INVENTORY, "items out of stock", { rows: 1 }],
  [INVENTORY, "which items have stock less than 10", { rows: 2 }],
  [INVENTORY, "most expensive item", { first: "Bond Paper A4" }],
  [INVENTORY, "ilan ang items sa bawat category", { group: ["Office", 3] }],
  [INVENTORY, "items from Linis Corp", { rows: 2 }],
  [GRADES, "average grade per subject", { group: ["Math", 84] }],
  [GRADES, "who failed", { rows: 2 }],
  [GRADES, "students with grades between 80 and 90", { rows: 2 }],
  [GRADES, "pinakamataas na grade", { value: 95 }],
  [GRADES, "female students in section Rizal", { rows: 1 }],
  [GRADES, "how many passed", { count: 4 }],
  [EMPLOYEES, "who earns the highest salary", { first: "Bea Santos" }],
  [EMPLOYEES, "developers in IT", { rows: 2 }],
  [EMPLOYEES, "employees hired after 2020", { rows: 3 }],
  [EMPLOYEES, "average salary by department", { group: ["IT", 46500] }],
  [EMPLOYEES, "employees in Makati", { rows: 2 }],
  [EMPLOYEES, "sino ang walang email", { rows: 1 }],
  [HOUSEHOLDS, "households without electricity", { rows: 2 }],
  [HOUSEHOLDS, "households in Poblacion", { rows: 2 }],
  [HOUSEHOLDS, "total members per barangay", { group: ["Poblacion", 9] }],
  [HOUSEHOLDS, "income below 10000", { rows: 2 }],
  [HOUSEHOLDS, "ilan ang pamilya sa San Isidro", { count: 2 }],
  // A checkbox-grid form: the ticked boxes are the answers.
  [CENSUS, "how many dogs", { count: 3 }],
  [CENSUS, "how many cats", { count: 1 }],
  [CENSUS, "ilan ang aso", { count: 3 }],
  [CENSUS, "female dogs", { rows: 1 }],
  [CENSUS, "how many male dogs", { count: 2 }],
  [CENSUS, "dogs that are not confined", { rows: 2 }],
  [CENSUS, "ilan ang free roam", { count: 3 }],
  [CENSUS, "pets of Juan Dela Cruz", { rows: 1 }],
];

describe("question reader", () => {
  it.each(CASES)("reads “%s”", (data, question, expected) => {
    const parsed = parseQuestion(question, data.columns, data.rows, today);
    expect(parsed, question).not.toBeNull();
    expect({ question, unknown: parsed!.unknown, note: parsed!.note }).toEqual({ question, unknown: [], note: undefined });
    const result = runQuery(parsed!.query, data.columns, data.rows);
    expect(check(result, expected), `${question} → ${parsed!.understood} → ${result.text} ${JSON.stringify(result.rows.slice(0, 3))}`).toBe(true);
  });

  it("reports names that aren't in the data, and doesn't guess which number column is meant", () => {
    expect(parseQuestion("Which customers are from Chile?", CUSTOMERS.columns, CUSTOMERS.rows, today)?.notFound).toEqual(["Chile"]);
    // Orders have three number columns; "over 2000" doesn't say which.
    expect(parseQuestion("orders over 2000", ORDERS.columns, ORDERS.rows, today)?.confident).toBe(false);
  });

  it("doesn't link common words to columns they only resemble", () => {
    const names = (q: string) => linkQuestion(q, CUSTOMERS.columns, CUSTOMERS.rows).columns.map((l) => l.column.name);
    expect(names("customers who joined last month")).not.toContain("Last Name");
    expect(names("how many customers are there")).not.toContain("Customer Id");
    expect(names("show the first 3 customers")).not.toContain("First Name");
    expect(names("their names")).toEqual(expect.arrayContaining(["First Name", "Last Name"]));
    expect(parseQuestion("how many customers are there", CUSTOMERS.columns, CUSTOMERS.rows, today)?.query).toMatchObject({ give: "count", where: [] });
  });
});
