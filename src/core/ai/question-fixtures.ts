/**
 * Question Test Data
 * Small, unrelated datasets — customers, sales orders, inventory, grades,
 * employees, barangay households — for testing that questions are read the
 * same way whatever the data is about (and not only on the veterinary
 * forms Salin started from). Test-only.
 */

import type { QueryResult } from "@/core/ai/data-query";
import type { CellValue, DatasetColumn, DatasetRow } from "@/types/processing";

export interface Fixture {
  columns: DatasetColumn[];
  rows: DatasetRow[];
}

/** The answer a question should get, checked on the calculated result (not on how the query looks). */
export type Expect = { count: number } | { rows: number } | { values: CellValue[] } | { value: CellValue } | { first: CellValue } | { group: [CellValue, CellValue] } | { columns: string[] };

export function check(r: QueryResult, e: Expect) {
  if ("count" in e) return r.headers.length === 0 && r.total === e.count;
  if ("rows" in e) return r.total === e.rows;
  if ("values" in e) return JSON.stringify(r.rows.map((x) => x[0]).sort()) === JSON.stringify([...e.values].sort());
  if ("value" in e) return r.rows.length === 1 && r.rows[0].at(-1) === e.value;
  if ("first" in e) return r.rows[0]?.includes(e.first) ?? false;
  if ("columns" in e) return JSON.stringify(r.headers.filter((h) => h !== "Source")) === JSON.stringify(e.columns);
  return r.rows.some((x) => x[0] === e.group[0] && x.at(-1) === e.group[1]);
}

function table(header: [string, DatasetColumn["type"]][], data: CellValue[][]): Fixture {
  const columns = header.map(([name, type], i): DatasetColumn => ({ id: `c${i}`, name, type, required: false, sourceHeader: name }));
  const rows = data.map((values, r): DatasetRow => ({ id: `r${r}`, datasetId: "d", position: r, source: { fileId: "f", page: null, sheet: "Sheet1", row: r + 2, range: null }, values: Object.fromEntries(columns.map((c, i) => [c.id, values[i]])) }));
  return { columns, rows };
}

export const CUSTOMERS = table(
  [["Index", "number"], ["Customer Id", "text"], ["First Name", "text"], ["Last Name", "text"], ["Company", "text"], ["City", "text"], ["Country", "text"], ["Phone 1", "text"], ["Email", "text"], ["Subscription Date", "date"]],
  [
    [1, "KHID4HiDzp", "Hector", "Huang", "Baxter Group", "Port Ianshire", "Finland", "6233837777", "janecooper@chambers-underwood.com", "2022-06-12"],
    [2, "W50PcDdk1a", "Marcus", "Hahn", "Rich-Santos", "West Erica", "New Zealand", "250-574-1941", "mercedes43@hooper-newman.com", "2020-12-06"],
    [3, "Ab12Cd34Ef", "José", "Rizal", "Calamba Trading", "Calamba", "Philippines", "09171234567", "jose@calamba.ph", "2021-03-15"],
    [4, "Zx98Yw76Vu", "Maria", "Clara", "Calamba Trading", "Manila", "Philippines", "", "maria@calamba.ph", "2023-01-20"],
    [5, "Qw12Er34Ty", "Hector", "Daniel", "Conway-Ashley", "Velezmouth", "Kiribati", "9189997310", "crosbyalison@herman.net", "2020-01-20"],
    [6, "Lk09Jh87Gf", "Ana", "Lopez", "Baxter Group", "Madrid", "Spain", "34600111222", "", "2024-07-01"],
  ],
);

export const ORDERS = table(
  [["Order No", "text"], ["Date", "date"], ["Customer", "text"], ["Product", "text"], ["Category", "text"], ["Quantity", "number"], ["Unit Price", "number"], ["Total", "number"], ["Region", "text"], ["Paid", "boolean"]],
  [
    ["SO-1001", "2026-01-05", "Juan Dela Cruz", "Rice 25kg", "Groceries", 2, 1200, 2400, "Luzon", true],
    ["SO-1002", "2026-01-18", "Liza Soberano", "Cooking Oil", "Groceries", 5, 150, 750, "Visayas", false],
    ["SO-1003", "2026-02-02", "Juan Dela Cruz", "Electric Fan", "Appliances", 1, 2500, 2500, "Luzon", true],
    ["SO-1004", "2026-02-20", "Pedro Penduko", "Rice 25kg", "Groceries", 1, 1200, 1200, "Mindanao", true],
    ["SO-1005", "2026-03-11", "Liza Soberano", "Rice Cooker", "Appliances", 2, 1800, 3600, "Visayas", false],
    ["SO-1006", "2026-03-30", "Maria Makiling", "Sugar 1kg", "Groceries", 10, 80, 800, "Luzon", true],
  ],
);

export const INVENTORY = table(
  [["SKU", "text"], ["Item", "text"], ["Category", "text"], ["Stock", "number"], ["Price", "number"], ["Supplier", "text"], ["Last Restocked", "date"]],
  [
    ["A-001", "Ballpen Blue", "Office", 120, 12, "Mabuhay Supplies", "2026-02-01"],
    ["A-002", "Bond Paper A4", "Office", 0, 250, "Mabuhay Supplies", "2025-12-15"],
    ["B-010", "Hand Soap", "Cleaning", 35, 45, "Linis Corp", "2026-03-01"],
    ["B-011", "Bleach", "Cleaning", 4, 60, "Linis Corp", "2025-11-20"],
    ["C-100", "Stapler", "Office", 15, 180, "Opisina Inc", "2026-01-10"],
  ],
);

export const GRADES = table(
  [["Student", "text"], ["Section", "text"], ["Subject", "text"], ["Grade", "number"], ["Sex", "text"], ["Passed", "boolean"]],
  [
    ["Andres Bonifacio", "Rizal", "Math", 88, "Male", true],
    ["Gabriela Silang", "Rizal", "Math", 92, "Female", true],
    ["Emilio Aguinaldo", "Mabini", "Math", 72, "Male", false],
    ["Melchora Aquino", "Mabini", "Science", 95, "Female", true],
    ["Apolinario Mabini", "Rizal", "Science", 74, "Male", false],
    ["Teresa Magbanua", "Mabini", "Science", 81, "Female", true],
  ],
);

export const EMPLOYEES = table(
  [["Employee", "text"], ["Department", "text"], ["Position", "text"], ["Salary", "number"], ["Hire Date", "date"], ["City", "text"], ["Email", "text"]],
  [
    ["Carlo Reyes", "Finance", "Accountant", 35000, "2019-04-01", "Quezon City", "carlo@acme.ph"],
    ["Bea Santos", "Finance", "Manager", 60000, "2016-09-15", "Makati", "bea@acme.ph"],
    ["Dino Cruz", "IT", "Developer", 45000, "2021-02-10", "Pasig", "dino@acme.ph"],
    ["Elle Garcia", "IT", "Developer", 48000, "2022-07-01", "Quezon City", ""],
    ["Fe Ramos", "HR", "Officer", 30000, "2023-11-20", "Makati", "fe@acme.ph"],
  ],
);

/** A filled-in checkbox-grid form (the CVO census layout) as Salin extracts it: group and sub-heading joined, ticks as yes. */
export const CENSUS = table(
  [["No.", "number"], ["Name of Owner", "text"], ["Type of Pet Dog", "boolean"], ["Type of Pet Cat", "boolean"], ["Sex M", "boolean"], ["Sex F", "boolean"], ["Classification Confined", "boolean"], ["Classification Free Roam", "boolean"], ["Remarks", "text"]],
  [
    [1, "Juan Dela Cruz", true, null, true, null, true, null, null],
    [2, "Maria Santos", null, true, null, true, null, true, "spayed"],
    [3, "Pedro Reyes", true, null, null, true, null, true, null],
    [4, "Liza Soberano", true, null, true, null, null, true, null],
  ],
);

export const HOUSEHOLDS = table(
  [["Household Head", "text"], ["Barangay", "text"], ["Members", "number"], ["Monthly Income", "number"], ["Has Electricity", "boolean"], ["Contact No.", "text"]],
  [
    ["Rodrigo Santos", "San Isidro", 5, 15000, true, "09181112222"],
    ["Lorna Dizon", "San Isidro", 3, 9000, false, ""],
    ["Ernesto Bautista", "Poblacion", 7, 22000, true, "09193334444"],
    ["Nida Flores", "Poblacion", 2, 7000, true, ""],
    ["Ramon Villanueva", "Malanday", 4, 12000, false, "09205556666"],
  ],
);
