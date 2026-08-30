// =============================================================================
// accountMatch — the ONE answer to "which account is this transaction on?"
//
// There were four rules for this, and they disagreed:
//   1. `matchAccount` in the store, used at INGEST to assign `accountId` — exact
//      mask or aliasMask (bank-guarded), then a suffix match (last-4 ↔ last-6,
//      type- and bank-guarded), then a bare type fallback.
//   2. `AnalyticsScreen.accountBreakdown` — an exact `Map` of mask → account,
//      with no suffix match, no type guard, no bank guard.
//   3. `AccountDetailsScreen.belongsToAccount` — exact mask AND `accountType`
//      equality, or an exact aliasMask; a hard stop on `accountId` with no
//      fallback when that id no longer resolves.
//   4. `aggregate()`'s `byAccount`, which only ever looks at `accountId`.
//
// Because (2) and (3) differ, the same transaction could appear in the analytics
// bar for a card and NOT in that card's own ledger. That is the reported bug:
// ~14k of spend on a card in analytics against ~11k in the account section.
//
// The rule here is (1) — the store's own, the one that decided `accountId` in the
// first place — so display can never contradict ingest. Everything that groups
// transactions by account MUST come through `resolveTxnAccount`, and the two
// screens ask it the same question rather than each answering it themselves.
// =============================================================================

import { maskMatch, onlyDigits } from './selfTransfer';

/**
 * Do two bank names refer to the same bank?
 *
 * Unknown on either side does NOT block a match — plenty of SMS carry a mask and
 * no issuer name, and refusing those would strand real transactions. It only
 * blocks when both names are present and disagree, so two different banks that
 * happen to share a last-4 are never merged.
 */
export const banksAgree = (a, b) => {
  if (!a || !b) return true;
  const na = String(a).toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
  return !na || !nb || na.includes(nb) || nb.includes(na);
};

/**
 * Best-fit account for a PARSED transaction (ingest-time).
 * 1. EXACT mask (or aliasMask) match, bank-guarded.
 * 2. SUFFIX match — the same account shown with different mask lengths across
 *    banks' SMS ("XX9532" vs "XX119532"). Type- and bank-guarded so a card and a
 *    bank sharing trailing digits are never merged. Prefer the longest mask.
 * 3. No mask → fall back to account type.
 */
/**
 * Every account that could plausibly be the one, best first.
 *
 * SCORED rather than first-match, because `.find()` answers by ARRAY ORDER — and
 * two cards from different banks really can share a last-4. With HDFC ··1234 and
 * ICICI ··1234 both present, a transaction that carried no issuer name resolved to
 * whichever account happened to be listed first, and flipping the array flipped the
 * answer for identical data. A coin toss between two real cards, silently.
 *
 * So: a match the BANK NAME confirms always outranks one where the bank is unknown,
 * a type match breaks the next tie, and account id breaks the last one so the same
 * data always gives the same answer.
 *
 * `banksAgree` treating "unknown" as agreement is deliberate and must stay — plenty
 * of real SMS carry a mask and no issuer, and refusing those would strand genuine
 * transactions. Ranking is what stops that leniency from picking the wrong card when
 * a better-evidenced candidate exists.
 */
export const accountCandidates = (accounts, parsed) => {
  if (!parsed) return [];
  const list = accounts || [];
  const wantMask = parsed.accountMask;
  const wantType = parsed.accountType;
  const wantBank = parsed.bankName;

  if (!wantMask) {
    // No digits at all: type is the only signal there is.
    return list
      .filter((a) => a.type === wantType)
      .map((a) => ({ account: a, score: 10, bankConfirmed: false }))
      .sort((x, y) => String(x.account.id).localeCompare(String(y.account.id)));
  }

  const scored = [];
  for (const a of list) {
    if (!banksAgree(a.bankName, wantBank)) continue;      // both known and different
    const bankConfirmed = !!(a.bankName && wantBank);      // both sides actually said so
    const typeMatches = a.type === wantType;
    const exact = a.mask === wantMask || (a.aliasMasks || []).includes(wantMask);
    // Suffix: the SAME account reported with different mask lengths across banks'
    // SMS ("XX9532" vs "XX119532"). Type-guarded — a card and a bank sharing
    // trailing digits are different money.
    const suffix =
      !exact && typeMatches &&
      (maskMatch(a.mask, wantMask) || (a.aliasMasks || []).some((m) => maskMatch(m, wantMask)));
    if (!exact && !suffix) continue;

    let score = exact ? 100 : 40;
    if (bankConfirmed) score += 50;   // beats ANY unconfirmed candidate at the same tier
    if (typeMatches) score += 5;
    scored.push({ account: a, score, bankConfirmed, exact });
  }

  return scored.sort(
    (x, y) =>
      y.score - x.score ||
      // Prefer the most specific mask, as before.
      onlyDigits(y.account.mask).length - onlyDigits(x.account.mask).length ||
      // Deterministic last resort: never let array order decide.
      String(x.account.id).localeCompare(String(y.account.id)),
  );
};

/**
 * True when the top two candidates are indistinguishable on the evidence — i.e.
 * the bank name would have decided it and we do not have one. The caller can then
 * choose to ask rather than guess; `matchAccount` itself still returns its best
 * (deterministic) pick, because refusing to match would make ingest invent a THIRD
 * account for a card the user already has.
 */
export const isAmbiguousMatch = (accounts, parsed) => {
  const c = accountCandidates(accounts, parsed);
  return c.length > 1 && c[0].score === c[1].score && !c[0].bankConfirmed;
};

/** Best-fit account for a PARSED transaction (ingest-time). */
export const matchAccount = (accounts, parsed) => accountCandidates(accounts, parsed)[0]?.account || null;

/**
 * The account a STORED transaction belongs to, or null.
 *
 * `accountId` is authoritative when it still resolves — the store wrote it via
 * `matchAccount` and the user may since have re-linked the account deliberately.
 *
 * It falls back to mask matching in exactly two cases, both of which used to
 * strand a transaction in the "Unknown" bucket or drop it from a ledger:
 *   • the row predates stable account ids (no `accountId` at all), and
 *   • the id is DANGLING — the account it named was deleted or merged away.
 * A dangling id is not evidence the transaction belongs nowhere; the mask still
 * says where the money moved.
 *
 * NOTE it deliberately does NOT filter ignored/non-spend rows. Those are separate
 * questions with separate answers per surface (a ledger shows an ignored row, a
 * spend chart doesn't), and folding them in here is how one caller silently
 * inherits another's policy.
 */
export const resolveTxnAccount = (txn, accounts) => {
  if (!txn) return null;
  const list = accounts || [];
  if (txn.accountId) {
    const direct = list.find((a) => a.id === txn.accountId);
    if (direct) return direct;
    // fall through — dangling id, let the mask speak
  }
  if (!txn.accountMask) return null;
  return matchAccount(list, {
    accountMask: txn.accountMask,
    accountType: txn.accountType,
    bankName: txn.bankName,
  });
};

/** Convenience for a ledger filter: is this stored txn on this account? */
export const txnBelongsToAccount = (txn, account, accounts) =>
  !!account && resolveTxnAccount(txn, accounts)?.id === account.id;
