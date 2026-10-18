/**
 * Test Setup
 * Runs before every Vitest file: installs fake-indexeddb as the global
 * IndexedDB and gives each test a fresh, empty Salin database.
 */

import "fake-indexeddb/auto";
import { afterEach, beforeEach, vi } from "vitest";

import { db } from "@/core/storage/database";

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});
