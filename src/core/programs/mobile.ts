/**
 * Mobile Numbers
 * One format for owners' mobile numbers everywhere in e-Vet, as e-Kapon
 * stores them: exactly 11 digits starting with 09 (09171234567). Inputs keep
 * digits only while typing, at most 11; spaces and dashes are dropped.
 */

export const MOBILE_HINT = "11 digits starting with 09, like 09171234567";

/** What a mobile input keeps while typing: digits only, at most 11. */
export const mobileDigits = (value: string) => value.replace(/\D/g, "").slice(0, 11);

/** A complete mobile number: 11 digits starting with 09 (spaces and dashes ignored). */
export const isMobile = (value: string) => /^09\d{9}$/.test(value.replace(/[\s-]/g, ""));

/** Props for every mobile input. No maxLength: a pasted 0917-123-4567 would be cut before its dashes are dropped. */
export const mobileInput = { type: "tel", inputMode: "numeric", placeholder: "09XXXXXXXXX", title: MOBILE_HINT } as const;
