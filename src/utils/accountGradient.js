// =============================================================================
// accountGradient — resolves the SAME 2-stop gradient an account's
// AccountDetailsScreen hero card uses, for anywhere else that wants to reuse
// it (e.g. AccountsScreen's plain list row icon background). One shared
// resolver, not a second hand-copied color-picking chain that could disagree
// with the hero card's own.
// -----------------------------------------------------------------------------
// Priority: an explicit manual "Card Color" pick (`account.colorKey`) → Indian
// Bank's exact theme-token green → a known bank-name match in BANK_GRADIENTS →
// the account's own legacy flat `color` field → a hash-based fallback palette,
// stable per account id so the same account always lands on the same fallback.
// =============================================================================

import { BANK_GRADIENTS } from '../constants/accountCardColors';

export const FALLBACK_PALETTES = [
  ['#1F1147', '#5B247A'],
  ['#0F2027', '#2C5364'],
  ['#061236', '#0D2E6E'],
  ['#0A1F11', '#153A28'],
  ['#130F08', '#2D2010'],
  ['#0E1020', '#1A2040'],
];

const hashIndex = (seed, mod) => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % mod;
};

/**
 * @param {{ id?: string, name?: string, bankName?: string, color?: string, colorKey?: string | null }} account
 * @param {any} theme — only read for the "Indian Bank" special case (its exact
 *   green tokens); every other branch is plain static hex, no theme dependency.
 * @returns {[string, string]}
 */
export const resolveAccountGradient = (account, theme) => {
  // An explicit manual pick (AccountFormScreen's "Card Color") wins over every
  // automatic guess below — the user deliberately chose it.
  if (account.colorKey && BANK_GRADIENTS[account.colorKey]) return BANK_GRADIENTS[account.colorKey];
  const key = (account.bankName || account.name || '').toUpperCase();
  // Indian Bank → exact emerald token from the active theme palette.
  if (key.includes('INDIAN')) return [theme.gradientGreenStart, theme.gradientGreenEnd];
  const matched = Object.keys(BANK_GRADIENTS).find((b) => key.includes(b));
  if (matched) return BANK_GRADIENTS[matched];
  if (account.color) return [account.color, account.color];
  return FALLBACK_PALETTES[hashIndex(account.id || key, FALLBACK_PALETTES.length)];
};
