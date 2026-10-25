/**
 * Profile Photo
 * The signed-in person's photo for the Account page and the account menu.
 * It is kept only on this device (a small JPEG data URL in the settings
 * table, one per account) and is never sent to City Vet: Salin never uploads
 * images. Photos are shrunk to 256 px on the longest side before saving.
 */

import { db } from "@/core/storage/database";

const SIDE = 256;
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
const photoKey = (account: string) => `profile-photo:${account.trim().toUpperCase()}`;

export async function loadProfilePhoto(account: string): Promise<string | null> {
  const value = (await db.settings.get(photoKey(account)))?.value;
  return typeof value === "string" && value.startsWith("data:image/") ? value : null;
}

export async function saveProfilePhoto(account: string, dataUrl: string) {
  if (!dataUrl.startsWith("data:image/")) throw new Error("Choose an image file.");
  await db.settings.put({ key: photoKey(account), value: dataUrl });
}

export async function removeProfilePhoto(account: string) {
  await db.settings.delete(photoKey(account));
}

/** Decodes an image file and re-encodes it as a small square-ish JPEG data URL (browser only). */
export async function shrinkPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Choose a photo under 15 MB.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That photo couldn't be read. Try a JPG or PNG.");
  });
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
