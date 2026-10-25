/**
 * Profile Photo Tests
 * A photo is saved per account on this device, read back, rejected when it
 * isn't an image data URL, and removed.
 */

import { describe, expect, it } from "vitest";

import { loadProfilePhoto, removeProfilePhoto, saveProfilePhoto } from "./profile-photo";

const PHOTO = "data:image/jpeg;base64,/9j/AA==";

describe("profile photo", () => {
  it("is kept per account and can be removed", async () => {
    await saveProfilePhoto("pv2026-tmp001", PHOTO);
    expect(await loadProfilePhoto(" PV2026-TMP001 ")).toBe(PHOTO);
    expect(await loadProfilePhoto("PV2026-OTHER")).toBeNull();
    await removeProfilePhoto("PV2026-TMP001");
    expect(await loadProfilePhoto("PV2026-TMP001")).toBeNull();
  });

  it("only accepts image data", async () => {
    await expect(saveProfilePhoto("PV1", "https://example.com/me.jpg")).rejects.toThrow("Choose an image file.");
  });
});
