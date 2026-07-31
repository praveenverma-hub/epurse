// =============================================================================
// validation.js — shared input sanitisers, validators, and length limits.
// -----------------------------------------------------------------------------
// Single source of truth for "how long / how valid" every user-typed value is
// across the app. Screens and modals should import from here instead of
// re-implementing inline `.trim().length >= 2` / `parseFloat` checks so the
// rules stay consistent everywhere.
//
// Usage pattern:
//   • Hard cap typing      → pass INPUT_LIMITS.* to a TextInput `maxLength`.
//   • Clean while typing   → wrap onChangeText with sanitize*().
//   • Gate submit / errors → use isValid*() in the handler.
//
// See .claude/skills/input-validation/SKILL.md for the full convention.
// =============================================================================

import { MAX_ALLOWED_AMOUNT } from '../constants/limits';

// ── Length limits (characters) ───────────────────────────────────────────────
// 10 crore = 100000000 → 9 integer digits. With ".00" the longest valid amount
// string is "100000000.00" = 12 chars.
export const INPUT_LIMITS = {
  NAME_MIN: 2,
  NAME_MAX: 40,        // full name, person name, custom account name
  CATEGORY_MAX: 24,    // custom category label
  MERCHANT_MAX: 40,    // merchant / person on a transaction
  NOTE_MAX: 140,       // free-text note
  PHONE_LEN: 10,       // Indian mobile, exactly 10 digits
  AMOUNT_INT_DIGITS: 9, // integer part cap (10 crore)
  AMOUNT_MAX_LEN: 12,  // "100000000.00"
};

// ── Names ─────────────────────────────────────────────────────────────────────
/** Collapse runs of whitespace and hard-cap length. Safe to call per keystroke. */
export const sanitizeName = (raw, max = INPUT_LIMITS.NAME_MAX) =>
  String(raw ?? '').replace(/\s{2,}/g, ' ').slice(0, max);

/** A name is valid when its trimmed length is within [NAME_MIN, NAME_MAX]. */
export const isValidName = (raw) => {
  const t = String(raw ?? '').trim();
  return t.length >= INPUT_LIMITS.NAME_MIN && t.length <= INPUT_LIMITS.NAME_MAX;
};

// ── Phone (Indian mobile) ──────────────────────────────────────────────────────
/** Strip everything but digits and cap to 10. Safe per keystroke. */
export const sanitizePhone = (raw) =>
  String(raw ?? '').replace(/\D/g, '').slice(0, INPUT_LIMITS.PHONE_LEN);

/**
 * Normalise a number from an EXTERNAL source (contact picker, paste, SMS) to the
 * local 10-digit form. Same as `sanitizePhone` except it keeps the LAST 10 digits,
 * so a country code ("+91 98765 43210") is dropped from the FRONT instead of the
 * real number being truncated from the back.
 *
 * Use this for anything you didn't watch the user type; `sanitizePhone` stays the
 * per-keystroke handler. Mirrors the `normPhone` keying in `getPersonBalances`, so
 * a picked contact matches an existing person instead of opening a second section.
 */
export const normalizePhone = (raw) => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length > INPUT_LIMITS.PHONE_LEN
    ? digits.slice(-INPUT_LIMITS.PHONE_LEN)
    : digits;
};

/** Exactly 10 digits. (Keep loose — don't reject test numbers by first digit.) */
export const isValidPhone = (raw) => /^\d{10}$/.test(String(raw ?? ''));

// ── Amounts ─────────────────────────────────────────────────────────────────
/**
 * Keep only digits and a single decimal point, cap the integer part to 10 crore
 * and the fraction to 2 places. Safe to call per keystroke — returns a string
 * suitable to feed straight back into the TextInput value.
 */
export const sanitizeAmount = (raw) => {
  let s = String(raw ?? '').replace(/[^0-9.]/g, '');
  const dot = s.indexOf('.');
  if (dot === -1) return s.slice(0, INPUT_LIMITS.AMOUNT_INT_DIGITS);
  // keep the first dot, drop any later ones
  const intPart = s.slice(0, dot).slice(0, INPUT_LIMITS.AMOUNT_INT_DIGITS);
  const decPart = s.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  return `${intPart}.${decPart}`;
};

/** parseFloat with NaN coerced to 0. */
export const parseAmount = (raw) => {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? 0 : n;
};

/** A positive amount within the 10-crore ceiling. */
export const isValidAmount = (raw) => {
  const n = parseAmount(raw);
  return n > 0 && n <= MAX_ALLOWED_AMOUNT;
};
