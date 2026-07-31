// =============================================================================
// ePurse — centralised state
// -----------------------------------------------------------------------------
// Single source of truth for:
//   • accounts             — created on the fly from incoming SMSes
//   • transactions         — auto-parsed (SMS) + manual entries
//       · isIgnored        — excluded everywhere + balances reversed (see ignoreTransaction)
//   • monthlyAggregates    — compacted summaries for older months
//   • categories           — defaults + custom user-added
//   • lentBorrowed         — informal IOUs ("you lent ₹500 to Rohit")
//   • smsAutoImport        — toggle for the live Android SMS listener
//   • lastSmsSync          — timestamp of the last successful sync
//   • userName             — collected during onboarding, shown on dashboard
//   • hasOnboarded         — true after first-launch onboarding completes
//   • smsPermissionGranted — true once OS-level SMS permission is granted
//
// Retention rules (enforced by `compactTransactions`):
//   • 0 – 3 months  → raw transactions (general categories only)
//   • 3 – 24 months → only monthly aggregates per category & account
//   • > 24 months   → dropped entirely (aggregates), raw pruned per rules below
//   • Lent / borrow (REAL txns too — any SMS or manual row with these categoryIds):
//       · `lent`, `borrowed` — stay raw forever; never rolled into monthly aggregates
//         (so they are not lost when general data older than 3 months compacts away).
//       · `lent_settled`, `borrow_repaid` — stay raw up to 1 year from that row’s date,
//         then removed; still never aggregated.
//   • Manual IOU list (`lentBorrowed`): unsettled kept; settled rows pruned after 1 year (`settledAt`)
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CATEGORIES, ACCOUNT_TYPES, TRANSACTION_TYPES, NON_SPEND_CATEGORY_IDS } from '../constants/categories';
import {
  twoTierToLegacyCatId,
  parentCatIdForTxn,
  buildCategoryTree,
  buildLegacyMaps,
  findParentById,
  LB_ALL_CATS,
  BUDGETABLE_PARENT_ID_SET as BUDGETABLE_PARENT_IDS,
} from '../constants/twoTierCategories';
import { DEFAULT_THEME_ID } from '../constants/themes';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { parseMessageDetailed } from '../utils/messageParser';
import { cleanMerchantName, detectIsSubscription } from '../utils/merchantEnricher';
import {
  isSelfTransfer,
  propagateSelfByRef,
  maskMatch,
  onlyDigits,
  SELF_TXN_FIELDS,
} from '../utils/selfTransfer';
import { isSameMonth, monthKey } from '../utils/format';
import { fireBudgetBreachNotification, fireMidmonthNudgeNotification, fireCCPaymentNotification, scheduleCCBillDueReminder, cancelScheduledNotification, fireSubscriptionHikeNotification, fireMonthlyRecapNotification } from '../utils/notifications';
import { detectSubscriptions, getMerchantBubbles } from '../analytics/behavioralSelectors';
import { locationKey } from '../utils/location';
import { IS_PREVIEW_BUILD } from '../constants/buildVariant';
import { useNotificationStore } from './useNotificationStore';
import {
  computeEqualSplit,
  computePercentSplit,
  canSplitTransaction,
  debitDisplayAmount,
  isGroupExcluded,
  isRefundCredit,
  spendContribution,
  countsForSpend,
  buildGroupLbRows,
} from '../utils/split';

// =============================================================================
// Constants
// =============================================================================
const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_RETENTION_MS  = 90  * DAY_MS;  // 3 months of raw transactions
const AGG_RETENTION_MS  = 730 * DAY_MS;  // 24 months of aggregates
const COMPACT_THROTTLE  = 6   * 60 * 60 * 1000; // run at most every 6 hrs
const REQUIRED_CATEGORY_IDS = ['lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'self', 'cc_bill', 'repayment'];

/** Outstanding lend/borrow categories — all matching txns (SMS/manual) skip the 3-mo→aggregate path. */
const LB_OUTSTANDING_CATS = new Set(['lent', 'borrowed']);
/** Settled categories — same; kept raw ≤ 1 yr then dropped, never merged into monthly aggregates. */
const LB_SETTLED_CATS = new Set(['lent_settled', 'borrow_repaid']);
const LB_SETTLED_RETENTION_MS = 365 * DAY_MS;
/** Groups untouched this long AND fully settled are auto-removed (debts, if any, keep them alive). */
const GROUP_INACTIVE_PRUNE_MS = 180 * DAY_MS;

/** CC-payment prompts only fire for recent payments; older swept SMS are ignored
 *  outright (never prompted, never filed) so ccHandledSmsIds can't balloon. */
const CC_PROMPT_MAX_AGE_MS = 5 * DAY_MS;
// TODO: remove RAW_SMS_RETENTION_MS + rawSms/rawSender fields before production — preview-only debug data
const RAW_SMS_RETENTION_MS = 3 * DAY_MS;

/** SMS `_id` strings we must never re-ingest (user deleted / ignored the txn). */
const SUPPRESS_SMS_CAP = 2500;

const appendSuppressedSmsIds = (existing = [], additions = []) => {
  const seen = new Set(existing);
  const next = [...existing];
  for (const id of additions) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(String(id));
  }
  if (next.length <= SUPPRESS_SMS_CAP) return next;
  return next.slice(-SUPPRESS_SMS_CAP);
};

/** Highest numeric suffix among manual txn ids `IdM0001`, so the counter never collides after restore. */
const maxManualIdSuffixFromTransactions = (transactions = []) => {
  let max = 0;
  transactions.forEach((t) => {
    if (t.source !== 'manual') return;
    const m = /^IdM(\d+)$/i.exec(String(t.id || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max;
};

// =============================================================================
// Helpers
// =============================================================================

/** Two bank labels are compatible if either is missing or one contains the other. */
const banksAgree = (a, b) => {
  if (!a || !b) return true; // unknown on either side → don't block a match
  const na = String(a).toLowerCase().replace(/[^a-z0-9]/g, '');
  const nb = String(b).toLowerCase().replace(/[^a-z0-9]/g, '');
  return !na || !nb || na.includes(nb) || nb.includes(na);
};

/**
 * Best-fit account for a parsed transaction.
 * 1. EXACT mask (or aliasMask) match
 * 2. SUFFIX match — the SAME account shown with different mask lengths across banks'
 *    SMS (last-4 "XX9532" vs last-6 "XX119532"). Guarded by same account-type + a
 *    compatible bank name so two unrelated accounts sharing trailing digits (or a card
 *    vs a bank) are never merged by digits alone. Prefer the most-specific (longest) mask.
 * 3. no mask → fall back to account-type match
 */
const matchAccount = (accounts, parsed) => {
  if (!parsed) return null;
  if (parsed.accountMask) {
    // 1. exact — a debit card's mask may live in a bank's aliasMasks (unified account).
    //    Bank-guarded so two DIFFERENT named banks that happen to share a last-4 aren't
    //    merged (only blocks when both bank names are present and disagree).
    const exact = accounts.find(
      (a) =>
        (a.mask === parsed.accountMask ||
          (a.aliasMasks || []).includes(parsed.accountMask)) &&
        banksAgree(a.bankName, parsed.bankName),
    );
    if (exact) return exact;
    // 2. suffix (last-4 ↔ last-6 of one account), bank- and type-guarded.
    const suffix = accounts
      .filter(
        (a) =>
          a.type === parsed.accountType &&
          banksAgree(a.bankName, parsed.bankName) &&
          (maskMatch(a.mask, parsed.accountMask) ||
            (a.aliasMasks || []).some((m) => maskMatch(m, parsed.accountMask))),
      )
      .sort((a, b) => onlyDigits(b.mask).length - onlyDigits(a.mask).length);
    return suffix[0] || null;
  }
  return accounts.find((a) => a.type === parsed.accountType) || null;
};

/** Auto-create an account when an SMS references a mask we haven't seen. */
const ensureAccountForParsed = (accounts, parsed) => {
  if (!parsed) return { accounts, account: null };
  const existing = matchAccount(accounts, parsed);
  if (existing) {
    // Matched the same account under a DIFFERENT mask length (last-4 vs last-6). Record
    // the alternate form on aliasMasks so both variants resolve here and future lookups
    // hit the exact branch. Keeps the first-seen (usually last-4) mask as the display id.
    if (
      parsed.accountMask &&
      parsed.accountMask !== existing.mask &&
      !(existing.aliasMasks || []).includes(parsed.accountMask)
    ) {
      const merged = {
        ...existing,
        aliasMasks: Array.from(
          new Set([...(existing.aliasMasks || []), parsed.accountMask]),
        ),
      };
      return {
        accounts: accounts.map((a) => (a.id === existing.id ? merged : a)),
        account: merged,
      };
    }
    return { accounts, account: existing };
  }
  if (!parsed.accountMask) {
    // No mask — only auto-create for Wallet / Cash. Otherwise return as-is
    // so the txn lands without an associated account.
    if (parsed.accountType === ACCOUNT_TYPES.WALLET || parsed.accountType === ACCOUNT_TYPES.CASH) {
      const auto = {
        id: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: parsed.accountType,
        name: parsed.accountType,
        mask: '',
        balance: 0,
        color: parsed.accountType === ACCOUNT_TYPES.WALLET ? '#10B981' : '#F59E0B',
      };
      return { accounts: [...accounts, auto], account: auto };
    }
    return { accounts, account: null };
  }

  const colorByType = {
    [ACCOUNT_TYPES.BANK]: '#1E40AF',
    [ACCOUNT_TYPES.CREDIT_CARD]: '#6D28D9',
    [ACCOUNT_TYPES.DEBIT_CARD]: '#0EA5E9',
    [ACCOUNT_TYPES.WALLET]: '#10B981',
    [ACCOUNT_TYPES.CASH]: '#F59E0B',
  };
  const bankLabel = parsed.bankName || parsed.accountType;
  const auto = {
    id: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: parsed.accountType,
    name: `${bankLabel} ··${parsed.accountMask}`,
    bankName: parsed.bankName || null,
    mask: parsed.accountMask,
    balance: 0,
    color: colorByType[parsed.accountType] || '#6B7280',
    // `aliasMasks` = linked debit-card masks folded into a bank account (a card is
    // just an access point to the bank — same money). See linkDebitCardToBank.
    aliasMasks: [],
    // TODO(cc-limits): NOT built yet. When credit-card limits / billing dates land,
    // add to this object — `creditLimit` (number), `limitGroupId` (string: cards that
    // SHARE one limit are grouped by this id, e.g. an add-on card on the primary's
    // limit), `statementDay` (1–31), `dueDay` (1–31). Until then, net worth treats a
    // CC purely as a liability (outstanding balance) — see selectEPurseNetWorth.
  };
  return { accounts: [...accounts, auto], account: auto };
};

const applyDelta = (accounts, accountId, parsed) => {
  if (!accountId) return accounts;
  const sign = parsed.type === TRANSACTION_TYPES.DEBIT ? -1 : 1;
  return accounts.map((a) =>
    a.id === accountId ? { ...a, balance: a.balance + sign * parsed.amount } : a
  );
};

/**
 * Book the PAYING side of a CC bill payment onto the source (bank/debit) account:
 * a `cc_bill` debit that reduces its balance and shows under it. If the bank's own
 * debit SMS already recorded this outflow (a recent same-amount debit on that
 * account), reclassify THAT to `cc_bill` instead of adding a second — no double-count.
 * Returns { accounts, transactions } or null (no source / account not found).
 */
const CC_SOURCE_DEDUP_MS = 6 * 24 * 60 * 60 * 1000; // ~6 days — matches a bank's own SMS
const bookCcPaymentSource = (state, sourceAccountId, amount, nowIso) => {
  if (!sourceAccountId || !amount) return null;
  const acct = state.accounts.find((a) => a.id === sourceAccountId);
  if (!acct) return null;
  const ts = new Date(nowIso).getTime();
  const existing = state.transactions.find(
    (t) =>
      !t.isIgnored &&
      t.type === TRANSACTION_TYPES.DEBIT &&
      t.accountId === sourceAccountId &&
      t.categoryId !== 'cc_bill' &&
      Math.round(t.amount) === Math.round(amount) &&
      Math.abs(ts - new Date(t.createdAt).getTime()) <= CC_SOURCE_DEDUP_MS,
  );
  if (existing) {
    // The bank already booked this outflow — just recategorise it (balance already moved).
    return {
      accounts: state.accounts,
      transactions: state.transactions.map((t) =>
        t.id === existing.id
          ? { ...t, categoryId: 'cc_bill', userEditedCategory: true, isSplit: false, splitWith: [] }
          : t,
      ),
    };
  }
  const txn = {
    id: `txn_ccpay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    amount,
    type: TRANSACTION_TYPES.DEBIT,
    categoryId: 'cc_bill',
    accountId: sourceAccountId,
    accountType: acct.type,
    accountMask: acct.mask || null,
    bankName: acct.bankName || null,
    merchant: 'Credit card bill payment',
    createdAt: nowIso,
    source: 'manual',
    isReviewed: true,
    userEditedCategory: true,
    isSplit: false,
    splitWith: [],
  };
  return {
    accounts: applyDelta(state.accounts, sourceAccountId, txn),
    transactions: [txn, ...state.transactions],
  };
};

/**
 * Book a real "Repayment" EXPENSE for settling a borrow: a `repayment` debit on the
 * chosen account (reduces its balance, counts as spend — repayment ∉ NON_SPEND).
 * Returns { accounts, transactions, txnId } or null if no/invalid account.
 */
const bookRepaymentExpense = (state, accountId, amount, personName, nowIso) => {
  if (!accountId || !amount) return null;
  const acct = state.accounts.find((a) => a.id === accountId);
  if (!acct) return null;
  const txnId = `txn_repay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const txn = {
    id: txnId,
    amount,
    type: TRANSACTION_TYPES.DEBIT,
    categoryId: 'repayment',
    parentCategory: 'Transfers',
    childCategory: 'Repayment',
    accountId,
    accountType: acct.type,
    accountMask: acct.mask || null,
    bankName: acct.bankName || null,
    merchant: personName ? `Repaid ${personName}` : 'Loan repayment',
    createdAt: nowIso,
    source: 'manual',
    isReviewed: true,
    userEditedCategory: true,
    isSplit: false,
    splitWith: [],
  };
  return {
    accounts: applyDelta(state.accounts, accountId, txn),
    transactions: [txn, ...state.transactions],
    txnId,
  };
};

/** Stable key for a debit-card↔bank pairing (order-independent on the masks). */
const linkKey = (cardMask, bankMask) => `${cardMask || ''}:${bankMask || ''}`;

const oppositeType = (type) =>
  type === TRANSACTION_TYPES.DEBIT ? TRANSACTION_TYPES.CREDIT : TRANSACTION_TYPES.DEBIT;

/**
 * Synthesize the COUNTERPARTY leg of a *combined* dual-leg self transfer.
 *
 * A single SMS like "A/c X debited Rs.5000 & A/c Y credited" parses to ONE debit
 * leg (on X) — so Y never receives its matching credit and net worth wrongly drifts
 * by the amount. When BOTH X and Y are the user's own accounts (the txn is tagged
 * `self`), we mirror the opposite delta onto Y so the transfer nets to zero.
 *
 * Guarded against double-counting: skips if Y's leg already exists — the bank also
 * sent a SEPARATE SMS for it — matched by shared transfer ref, or by amount + that
 * account + opposite type within the dedup window. The synthetic leg carries the
 * transferRef so a LATER real Y-SMS dedups against it (isDuplicate Tier 1.5).
 *
 * @returns {{ accounts, leg } | null}  new accounts + the synthetic leg, or null.
 */
const buildSelfCounterLeg = (accounts, transactions, leg) => {
  if (!leg || leg.categoryId !== 'self' || !leg.selfDualLeg || !leg.counterpartyMask) return null;
  if (leg.derivedSelfLeg) return null; // never mirror a synthetic leg
  // Counterparty is one of the user's OWN accounts (self-tagging required its mask
  // to be in the user's masks), so it already exists — find it, don't create.
  const cp = accounts.find(
    (a) => maskMatch(a.mask, leg.counterpartyMask)
      || (a.aliasMasks || []).some((m) => maskMatch(m, leg.counterpartyMask)),
  );
  if (!cp || cp.id === leg.accountId) return null;

  const wantType = oppositeType(leg.type);
  const ts = new Date(leg.createdAt || Date.now()).getTime();
  const WINDOW = 10 * 60 * 1000;
  const alreadyBooked = transactions.some((t) => {
    if (!t || t.isIgnored || t.id === leg.id) return false;
    if (t.amount !== leg.amount || t.type !== wantType) return false;
    if (leg.transferRef && t.transferRef === leg.transferRef) return true;
    const onCp = t.accountId === cp.id || maskMatch(t.accountMask, cp.mask);
    return onCp && Math.abs(new Date(t.createdAt).getTime() - ts) <= WINDOW;
  });
  if (alreadyBooked) return null;

  const synthetic = {
    id: `txn_self_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount: leg.amount,
    type: wantType,
    accountType: cp.type,
    accountMask: cp.mask || leg.counterpartyMask,
    accountId: cp.id,
    bankName: cp.bankName || null,
    merchant: 'Self transfer',
    source: 'sms',
    isReviewed: true,
    isSplit: false,
    splitWith: [],
    createdAt: leg.createdAt || new Date().toISOString(),
    transferRef: leg.transferRef || null,
    ...SELF_TXN_FIELDS,
    derivedSelfLeg: true,        // synthetic counterpart — has no SMS of its own
    derivedFromTxnId: leg.id,
  };
  return { accounts: applyDelta(accounts, cp.id, synthetic), leg: synthetic };
};

// ── Self-transfer detection ──────────────────────────────────────────────────
// A "self" transfer moves money between the user's OWN accounts (or to their own
// linked mobile / name). It still adjusts account balances, but is neither income
// nor expense, so it's tagged categoryId='self' and excluded from all totals.
// Pure detection logic lives in src/utils/selfTransfer.js so the parser test
// suite can exercise it without importing this (RN-heavy) store.

const ensureRequiredCategories = (categories = []) => {
  const byId = new Map(categories.map((c) => [c.id, c]));
  DEFAULT_CATEGORIES.forEach((c) => {
    if (REQUIRED_CATEGORY_IDS.includes(c.id) && !byId.has(c.id)) {
      byId.set(c.id, c);
    }
  });
  return Array.from(byId.values());
};

/**
 * Deduplication — three tiers, fastest → slowest:
 *
 * 1. SMS _id match   — exact: if both transactions carry the Android SMS
 *    unique ID they are definitively the same message. Covers inbox-sweep
 *    races and live-listener vs. sweep overlap.
 *
 * 2. Near-time content match — amount + type + accountMask (or merchant) in
 *    a short time window. This catches live-listener vs sweep overlap while
 *    avoiding false positives for legitimate same-day repeated amounts.
 *
 * @param {object[]} transactions  existing store transactions
 * @param {object}   parsed        candidate transaction from parseMessage
 * @param {string|null} smsId      Android SMS _id (null for live-listener)
 */
const isDuplicate = (transactions, parsed, smsId = null, suppressedSmsIds = []) => {
  // Tier 1 — authoritative SMS ID check
  if (smsId) {
    if (suppressedSmsIds.includes(smsId)) return true;
    if (transactions.some((t) => t.smsId === smsId && !t.isIgnored)) return true;
  }

  // Tier 1.5 — transfer-reference match. The two legs of one transfer share an
  // IMPS/UPI ref but have OPPOSITE types, so a ref + SAME-type + amount match means
  // the same leg reported twice — e.g. a real SMS arriving after we synthesized its
  // counterpart leg (buildSelfCounterLeg). Opposite-type legs differ in `type`, so a
  // genuine two-SMS transfer is NOT merged. Time-independent (unlike Tier 2).
  if (parsed.transferRef && parsed.amount) {
    if (transactions.some(
      (t) => !t.isIgnored
        && t.transferRef === parsed.transferRef
        && t.type === parsed.type
        && t.amount === parsed.amount,
    )) return true;
  }

  // Tier 2 — near-time content fingerprint (for messages without smsId)
  const candidateTs = new Date(parsed.createdAt || Date.now()).getTime();
  const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  return transactions.some(
    (t) => {
      if (t.isIgnored) return false;
      if (t.amount !== parsed.amount) return false;
      if (t.type !== parsed.type) return false;

      const tTs = new Date(t.createdAt).getTime();
      if (Math.abs(tTs - candidateTs) > DEDUP_WINDOW_MS) return false;

      const tMask = t.accountMask || null;
      const pMask = parsed.accountMask || null;
      if (tMask && pMask) return tMask === pMask;

      const tMerchant = (t.merchant || '').trim().toLowerCase();
      const pMerchant = (parsed.merchant || '').trim().toLowerCase();
      return tMerchant && pMerchant && tMerchant === pMerchant;
    }
  );
};


/**
 * Categories excluded from every spend/income total and budget calculation.
 * Lent/borrow are tracked per-person in the LB ledger. `self` covers transfers
 * between the user's OWN accounts (or to their own linked mobile) — real money
 * moved, so account balances are still adjusted via applyDelta, but it is
 * neither income nor expense and must not skew totals.
 */
// Re-export of the canonical set (constants/categories.js) so every exclusion
// site in the store shares one definition and can never drift from the analytics
// selectors. Add new non-spend categories THERE, not here.
const NON_SPEND_CATS = NON_SPEND_CATEGORY_IDS;

// `isGroupExcluded` + `buildGroupLbRows` are pure helpers imported from ../utils/split
// (co-located with the rest of the split math + `debitDisplayAmount`, and unit-tested in
// groupExpense.test.mjs). They live there so the zero-dep .mjs runner can import them
// without loading this store's React-Native/AsyncStorage dependency graph.

/** Shared groups always carry the built-in 'me' member (deduped, listed first). Personal → []. */
const ensureSelfMember = (type, members = []) => {
  if (type !== 'shared') return [];
  const others = (members || []).filter((m) => m && m.memberId !== 'me' && !m.isMe);
  return [{ memberId: 'me', name: 'You', isMe: true }, ...others];
};

/** Adjust a group's materialised totalSpend by `delta` (floored at 0). No-op if id is falsy. */
const adjustGroupTotal = (groups, groupId, delta) => {
  if (!groupId || !delta) return groups;
  return (groups || []).map((g) =>
    g.id === groupId ? { ...g, totalSpend: Math.max(0, (g.totalSpend || 0) + delta) } : g
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Budget = FIRST-LEVEL (parent) categories. Children roll up into their parent,
// so a Groceries spend counts against the Food & Dining budget (no separate
// "groceries" budget line). BUDGETABLE_PARENT_IDS is imported from
// twoTierCategories.ts (single source; derived from the tree).
// ─────────────────────────────────────────────────────────────────────────────

// Two-tier ↔ legacy category mappings are centralised in twoTierCategories.ts.
// CAT_MAPS is the custom-aware lookup set (built-ins + the user's custom categories);
// it's rebuilt by refreshCatMaps() whenever custom categories change (CRUD actions +
// on rehydrate). Module-level so the aggregation/budget helpers below stay simple.
let CAT_MAPS = buildLegacyMaps(buildCategoryTree());
const refreshCatMaps = (customParents, customChildren) => {
  CAT_MAPS = buildLegacyMaps(buildCategoryTree(customParents || [], customChildren || []));
};
// txn → first-level (parent) budget category id (custom-aware).
const parentCatId = (t) => parentCatIdForTxn(t, CAT_MAPS);
// two-tier labels → legacy flat categoryId (custom-aware).
const toLegacyCat = (parentLabel, childLabel) => twoTierToLegacyCatId(parentLabel, childLabel, CAT_MAPS);

/** Sum of category caps — the budget total is always derived from this. */
const sumCaps = (perCategory) =>
  Object.values(perCategory || {}).reduce((a, b) => a + (Number(b) || 0), 0);

/**
 * Produce monthly aggregates from a list of transactions.
 * Returns `{ '2025-12': { totalSpend, totalIncome, byCategory, byAccount, byLocation } }`.
 * Lent/borrow categories are stored in byCategory for reference but excluded
 * from totalSpend/totalIncome so they don't skew normal expense tracking.
 *
 * `byLocation` (Jul-31) is spend keyed by the coarse place label on the transaction
 * (see locationService — city/district, never coordinates). Raw transactions are
 * dropped past RAW_RETENTION_MS, so WITHOUT this bucket every stamped location
 * vanished after 90 days and long-run "spend by place" analytics were impossible.
 * Additive + backward compatible: older aggregates simply have no `byLocation`.
 */
const aggregate = (transactions, groups = []) => {
  const out = {};
  transactions.forEach((t) => {
    if (t.isIgnored) return;
    // Group memos AND txns in an excluded personal group stay out of historical totals,
    // matching the live spend paths (isGroupExcluded covers both).
    if (isGroupExcluded(t, groups)) return;
    const key = monthKey(t.createdAt);
    if (!out[key]) {
      out[key] = { totalSpend: 0, totalIncome: 0, byCategory: {}, byAccount: {}, byLocation: {} };
    }
    const a = out[key];
    // Only real spend is bucketed by place — a place total is meant to answer "how
    // much did I spend in Pune", so income and non-spend categories stay out.
    const place = locationKey(t.location);
    if (t.type === TRANSACTION_TYPES.DEBIT) {
      const spend = debitDisplayAmount(t);
      a.byCategory[t.categoryId] = (a.byCategory[t.categoryId] || 0) + spend;
      if (!NON_SPEND_CATS.has(t.categoryId)) a.totalSpend += spend;
      if (place && !NON_SPEND_CATS.has(t.categoryId)) {
        a.byLocation[place] = (a.byLocation[place] || 0) + spend;
      }
      if (t.accountId) a.byAccount[t.accountId] = (a.byAccount[t.accountId] || 0) - t.amount;
    } else if (isRefundCredit(t)) {
      // Refund/cashback: money back for a prior payment. Nets DOWN spend and its
      // own category (not income). Balance-wise it's still a credit (byAccount +).
      if (!NON_SPEND_CATS.has(t.categoryId)) {
        a.byCategory[t.categoryId] = (a.byCategory[t.categoryId] || 0) - t.amount;
        a.totalSpend -= t.amount;
        if (place) a.byLocation[place] = (a.byLocation[place] || 0) - t.amount;
      }
      if (t.accountId) a.byAccount[t.accountId] = (a.byAccount[t.accountId] || 0) + t.amount;
    } else if (t.type === TRANSACTION_TYPES.CREDIT) {
      a.byCategory[t.categoryId] = (a.byCategory[t.categoryId] || 0) + t.amount;
      if (!NON_SPEND_CATS.has(t.categoryId)) a.totalIncome += t.amount;
      if (t.accountId) a.byAccount[t.accountId] = (a.byAccount[t.accountId] || 0) + t.amount;
    }
  });
  return out;
};

// =============================================================================
// Store
// =============================================================================
export const useEPurseStore = create(
  persist(
    (set, get) => ({
      // ----- state -------------------------------------------------------
      accounts: [],          // populated lazily by ingestMessage
      transactions: [],      // raw, max 3 months — ACTIVE ledger (drives everything)
      // Historical SMS captured during the one-time onboarding sweep. Used ONLY to
      // discover accounts (at balance 0) and for read-only reference in Account
      // Details. Never feed totals/insights/budgets/balances/queue — a clean start.
      archivedTransactions: [],
      monthlyAggregates: {}, // { 'YYYY-MM': { totalSpend, totalIncome, byCategory, byAccount } }
      categories: DEFAULT_CATEGORIES,
      // User-created two-tier categories, merged with the built-in tree everywhere
      // via buildCategoryTree(). customParents = new top-level parents; customChildren
      // = sub-categories added under a parent (built-in OR custom) keyed by parentId.
      customParents: [],
      customChildren: [],
      lentBorrowed: [],

      userName: '',
      // The user's own mobile number(s) linked to their bank accounts / UPI.
      // Used to detect self transfers when money lands "by a/c linked to mobile …".
      userPhones: [],
      // Absolute time (epoch ms) onboarding completed. Drives time-boxed first-run
      // UI such as the inline "Top 30-Day Vendor Fix" widget (shown <24h after this).
      // null for users onboarded before this field existed (widget simply won't show).
      userOnboardedAt: null,
      smsAutoImport: false,
      lastSmsSync: null,   // wall-clock time of last sync run (legacy, kept for compat)
      lastSmsDate: null,   // max SMS `date` field (epoch ms) we have ever ingested —
                           // used as the minDate filter for the next inbox sweep so we
                           // never re-read an SMS that was already processed
      lastCompactedAt: null,

      /** Persisted: blocks inbox re-import after user deletes / ignores an SMS-backed txn. */
      suppressedSmsIds: [],

      /** Persisted: last assigned manual reference number (next txn → IdM + zero-padded). */
      manualTxnSeq: 0,

      hasOnboarded: false,
      smsPermissionGranted: false,
      contactsPermissionGranted: false,

      // One-time onboarding nudge: ask the user to anchor their real bank balances
      // on the Accounts screen. Auto-suppressed once any account has been anchored,
      // or when the user explicitly dismisses the card.
      anchorNudgeDismissed: false,

      // Theme preferences
      themeId: DEFAULT_THEME_ID,   // one of THEMES keys: 'orange' | 'blue' | 'amber' | 'sky'
      darkMode: false,             // reserved for future dark-theme rollout

      // Dashboard preference: show the weekly spend recap. On by default; toggled
      // from the Settings sheet. The recap now appears ONLY after a week ends, as a
      // one-time centered modal (no persistent card). Persisted (see partialize).
      showWeeklySummary: true,
      // week-start key (YYYY-M-D of Monday) we've already shown the recap for.
      weeklyRecapHandled: null,
      // Anchor ms (a day in the just-ended week) to render the modal for now (ephemeral).
      pendingWeeklyRecap: null,

      // ── Monthly recap ────────────────────────────────────────────────────
      // Month-end wrap-up: a one-time modal on first open of a new month, then
      // a persistent dashboard card, plus a downloadable PDF. On by default.
      showMonthlyRecap: true,
      // monthKey we've already queued the modal + notification for (so neither
      // re-fires on every launch). null = none handled yet.
      recapMonthHandled: null,
      // monthKey whose dashboard CARD the user dismissed (card hidden for it).
      monthlyRecapCardDismissed: null,
      // monthKey to show the recap MODAL for right now (ephemeral, not persisted).
      pendingMonthlyRecap: null,
      // What the recap/PDF includes (profile toggles). Private included by default;
      // in-app spend logic elsewhere is unaffected. Transaction list off by default.
      recapOptions: { includePrivate: true, includeGroups: true, includeTxnList: false },

      // Notification IDs: { [personKey]: notificationId }  — used to cancel/update reminders
      notificationIds: {},
      // CC bill-due OS reminders: `${cardLast4||bankName}:${dueDate}` → scheduled id, so a
      // resent bill (same card+date) doesn't double-schedule and a NEW bill can cancel the stale one.
      ccDueReminderIds: {},
      // Subscription price-hike alerts already sent: keys `${merchantKey}:${hikeTo}`.
      subscriptionHikesNotified: [],

      // ─── Budget plan ────────────────────────────────────────────────────────
      // `budget` is null until the user sets a plan. When set:
      //   { monthKey, totalCap, perCategory: { [categoryId]: cap }, startDay, createdAt, lastEditedAt }
      // `budgetHistory` keyed by month: { [YYYY-MM]: { totalCap, perCategory, totalActual, status, overshoot } }
      // `budgetStreak` tracks consecutive under-budget months for the gamification layer.
      budget: null,
      budgetHistory: {},
      budgetStreak: { current: 0, best: 0, lastResetMonth: null },
      // Previous month's plan, kept after rollover so the next "Create plan"
      // form can pre-fill the prior caps as a starting point. { perCategory, totalCap, monthKey }
      lastBudgetPlan: null,

      // Per-month dedup so we only fire one breach notification per category
      // (and one for the overall total) — { '2026-05': ['shopping', '__total__'] }
      budgetBreachNotified: {},

      // When a month rollover commits a snapshot, we stash the result here so the
      // dashboard can pop a celebration modal on the user's next visit. Cleared
      // after the modal is dismissed.
      //   { monthKey, totalActual, totalCap, status, overshoot, streakAfter, savedAmount }
      pendingCelebration: null,

      // Queue of CC payments waiting for user response.
      // Each item: { amount, accountId, accountMask, bankName, smsId }
      // The modal shows queue[0]; confirm/dismiss shifts to the next.
      pendingCCPaymentQueue: [],

      // SMS `_id`s of CC payments the user has already answered (True-up or Skip).
      // Stops the inbox sweep from re-opening the prompt for the same payment on
      // every app launch, while still asking for genuinely new payments.
      ccHandledSmsIds: [],

      // Per-cycle dedup for the mid-month nudge (one notification per cycle).
      lastMidmonthNudgeMonth: null,

      // ─── Daily Queue / XP ───────────────────────────────────────────────────
      // `xp` accumulates across all-time approvals (10 XP per reviewed card).
      // `reviewStreak` tracks consecutive calendar days with at least one review.
      xp: 0,
      reviewStreak: { current: 0, best: 0, lastReviewDate: null },
      // One-time tutorial: a sample "welcome" card shown atop the review queue for
      // brand-new users, teaching the swipe-to-approve mechanic. Set true on dismiss.
      welcomeReviewSeen: false,
      // User dismissed the dashboard "Plan your month" CTA banner (the ✕). Hides it.
      planBannerDismissed: false,

      // Two-tier user-defined automation rules — keyed by SCREAMING_SNAKE_CASE merchant.
      userCustomRules: {},

      // ─── Groups ─────────────────────────────────────────────────────────────
      // Each group: { id, name, type('personal'|'shared'), emoji, color, members[],
      //   excludeFromTotals, totalSpend, settlements[], createdAt }
      groups: [],

      // Group Zone: while set, NEW spend transactions (SMS + manual) are auto-tagged
      // to this group by default (user can still untag/edit, e.g. in the review queue).
      // Only ONE zone at a time — setting one replaces any other.
      activeGroupZoneId: null,

      // Debit-card↔bank pairs the user explicitly declined to merge (keys via
      // linkKey(cardMask, bankMask)) — so we never re-suggest a rejected pairing.
      declinedAccountLinks: [],

      hydrated: false,

      // ----- onboarding setters -----------------------------------------
      setUserName: (name) => set({ userName: (name || '').trim() }),

      // ─── User mobile numbers (for self-transfer detection) ───────────────────
      /** Replace the full list. Each entry is normalised to digits only. */
      setUserPhones: (phones) =>
        set({
          userPhones: Array.from(
            new Set((phones || []).map((p) => String(p).replace(/\D/g, '')).filter((p) => p.length >= 4))
          ),
        }),
      addUserPhone: (phone) =>
        set((s) => {
          const digits = String(phone || '').replace(/\D/g, '');
          if (digits.length < 4) return s;
          if ((s.userPhones || []).includes(digits)) return s;
          return { userPhones: [...(s.userPhones || []), digits] };
        }),
      removeUserPhone: (phone) =>
        set((s) => {
          const digits = String(phone || '').replace(/\D/g, '');
          return { userPhones: (s.userPhones || []).filter((p) => p !== digits) };
        }),

      setHasOnboarded: (v) => set({ hasOnboarded: !!v }),
      /** Stamp the moment onboarding completes (defaults to now). */
      setUserOnboardedAt: (ts) => set({ userOnboardedAt: ts ?? Date.now() }),
      /** Mark the review-queue welcome tutorial card as dismissed. */
      setWelcomeReviewSeen: (v = true) => set({ welcomeReviewSeen: !!v }),
      /** User dismissed the dashboard plan-CTA banner. */
      dismissPlanBanner: () => set({ planBannerDismissed: true }),
      setSmsPermissionGranted: (v) => set({ smsPermissionGranted: !!v }),
      setContactsPermissionGranted: (v) => set({ contactsPermissionGranted: !!v }),

      // ----- theme setters ----------------------------------------------
      setThemeId: (id) => set({ themeId: id || DEFAULT_THEME_ID }),
      setDarkMode: (v) => set({ darkMode: !!v }),
      /** Dashboard: show/hide the weekly spend recap (week-end modal). */
      setShowWeeklySummary: (v) => set({ showWeeklySummary: !!v }),

      /**
       * Called on launch/foreground. Once a new week has begun, surface a one-time
       * centered recap modal for the JUST-ENDED week (if it had activity). Guarded
       * by `weeklyRecapHandled` so it shows at most once per week.
       */
      maybeQueueWeeklyRecap: () => {
        const s = get();
        if (!s.showWeeklySummary) return;
        const now = new Date();
        const dow = (now.getDay() + 6) % 7;
        const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow, 0, 0, 0, 0).getTime();
        const lastWeekStart = thisWeekStart - 7 * DAY_MS;
        const lw = new Date(lastWeekStart);
        const key = `${lw.getFullYear()}-${lw.getMonth() + 1}-${lw.getDate()}`;
        if (s.weeklyRecapHandled === key) return;
        const hasData = s.transactions.some((t) => {
          if (t.isIgnored) return false;
          const ts = new Date(t.createdAt).getTime();
          return ts >= lastWeekStart && ts < thisWeekStart;
        });
        if (!hasData) return;
        set({ pendingWeeklyRecap: lastWeekStart, weeklyRecapHandled: key });
      },

      /** Weekly recap modal closed. */
      clearPendingWeeklyRecap: () => set({ pendingWeeklyRecap: null }),

      // ── Monthly recap actions ─────────────────────────────────────────────
      /** Settings: show/hide the monthly recap (modal + card). */
      setShowMonthlyRecap: (v) => set({ showMonthlyRecap: !!v }),

      /** Settings: toggle what the recap/PDF includes (includePrivate | includeGroups | includeTxnList). */
      setRecapOption: (key, value) =>
        set((s) => ({ recapOptions: { ...s.recapOptions, [key]: !!value } })),

      /**
       * Called on launch / foreground (App.js). If a new calendar month has begun
       * and the just-ended month has data we haven't surfaced yet, queue the
       * one-time recap modal and fire a single "recap ready" notification.
       * Guarded by `recapMonthHandled` so it fires at most once per month.
       */
      maybeQueueMonthlyRecap: () => {
        const s = get();
        if (!s.showMonthlyRecap) return;
        const now = new Date();
        const prev = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
        const prevMk = monthKey(prev);
        if (s.recapMonthHandled === prevMk) return; // already queued + notified

        const hasData =
          !!s.monthlyAggregates?.[prevMk] ||
          s.transactions.some((t) => !t.isIgnored && monthKey(t.createdAt) === prevMk);
        if (!hasData) return;

        // The recap IS the month-end moment now — fold in / supersede the old
        // budget celebration so the user gets one popup, not two.
        set({ pendingMonthlyRecap: prevMk, recapMonthHandled: prevMk, pendingCelebration: null });

        // In-app feed + OS notification (both no-op silently without permission).
        // Both carry monthKey so tapping either re-opens THIS month's recap —
        // see openMonthlyRecap() + the notification-tap listener in App.js.
        const label = prev.toLocaleDateString('en-IN', { month: 'long' });
        try {
          useNotificationStore.getState().add({
            kind: 'monthly_recap',
            title: `Your ${label} recap is ready`,
            body: 'See where your money went last month — tap to view and download.',
            dedupeKey: `recap:${prevMk}`,
            meta: { monthKey: prevMk },
          });
        } catch {}
        fireMonthlyRecapNotification({ monthLabel: label, monthKey: prevMk });
      },

      /** Recap modal closed — stop showing it (kept marked handled). */
      clearPendingMonthlyRecap: () => set({ pendingMonthlyRecap: null }),

      /** Re-open the recap modal for `mk` — used by notification/bell taps. */
      openMonthlyRecap: (mk) => set({ pendingMonthlyRecap: mk || null }),

      /** User dismissed the persistent recap card for `mk`. */
      dismissMonthlyRecapCard: (mk) => set({ monthlyRecapCardDismissed: mk || null }),

      setNotificationId: (personKey, id) =>
        set((s) => ({ notificationIds: { ...s.notificationIds, [personKey]: id } })),
      clearNotificationId: (personKey) =>
        set((s) => {
          const next = { ...s.notificationIds };
          delete next[personKey];
          return { notificationIds: next };
        }),

      // ─── Budget actions ─────────────────────────────────────────────────────
      /** Bulk set / replace the active plan. Accepts { totalCap, perCategory }. */
      setBudget: (plan) =>
        set((s) => {
          const nowIso = new Date().toISOString();
          const perCategory = plan?.perCategory ? { ...plan.perCategory } : {};
          const caps = sumCaps(perCategory);
          const totalCap = caps > 0 ? caps : null;
          return {
            budget: {
              monthKey: monthKey(new Date()),
              // Total cap is derived from the category caps — never set directly.
              totalCap,
              perCategory,
              startDay: 1, // calendar month for Phase 1 — settings hook later
              createdAt: s.budget?.createdAt || nowIso,
              lastEditedAt: nowIso,
            },
            // Remember the latest plan so a future "Create plan" (next month, or
            // after a reset) can pre-fill these caps as a starting point.
            lastBudgetPlan: { perCategory, totalCap, monthKey: monthKey(new Date()) },
          };
        }),

      /** Upsert one category cap. Creates the plan record if it doesn't exist yet. */
      updateBudgetCategory: (categoryId, cap) =>
        set((s) => {
          const nowIso = new Date().toISOString();
          const current = s.budget || {
            monthKey: monthKey(new Date()),
            totalCap: null,
            perCategory: {},
            startDay: 1,
            createdAt: nowIso,
            lastEditedAt: nowIso,
          };
          const perCategory = { ...current.perCategory, [categoryId]: Number(cap) || 0 };
          const caps = sumCaps(perCategory);
          return {
            budget: {
              ...current,
              perCategory,
              totalCap: caps > 0 ? caps : null,
              lastEditedAt: nowIso,
            },
          };
        }),

      removeBudgetCategory: (categoryId) =>
        set((s) => {
          if (!s.budget) return s;
          const next = { ...s.budget.perCategory };
          delete next[categoryId];
          // Also clear the dedup mark so re-adding later can re-fire a breach.
          const currentMonth = s.budget.monthKey;
          const breachMonth  = (s.budgetBreachNotified?.[currentMonth] || [])
            .filter((id) => id !== categoryId);
          const caps = sumCaps(next);
          return {
            budget: { ...s.budget, perCategory: next, totalCap: caps > 0 ? caps : null, lastEditedAt: new Date().toISOString() },
            budgetBreachNotified: { ...s.budgetBreachNotified, [currentMonth]: breachMonth },
          };
        }),

      // The total budget is non-editable — it is always the sum of the category
      // caps. This setter just re-derives it (kept for callers that still invoke
      // it, e.g. legacy "top up total" affordances, which are now no-ops).
      setBudgetTotalCap: () =>
        set((s) => {
          if (!s.budget) return s;
          const caps = sumCaps(s.budget.perCategory);
          return {
            budget: { ...s.budget, totalCap: caps > 0 ? caps : null, lastEditedAt: new Date().toISOString() },
          };
        }),

      clearBudget: () => set({ budget: null, budgetBreachNotified: {} }),

      /** Dismisses the celebration modal — called when the user closes it. */
      clearPendingCelebration: () => set({ pendingCelebration: null }),

      // ─── Daily Queue actions ───────────────────────────────────────────────
      // NOTE: Economy (RP/EPC/streak) lives entirely in useRewardStore. This
      // store is responsible only for the txn.isReviewed flag flip. Callers
      // who want to award the user must call useRewardStore.recordReview()
      // explicitly — DailyQueueStack does this on each approval.
      //
      // Legacy `xp` field is kept on the persisted shape for transitional
      // builds but no longer mutated; `addXP` is a no-op. Drop entirely once
      // no on-device cohorts predate v3 of the reward store.
      addXP: (_amount) => { /* deprecated — economy moved to useRewardStore */ },

      /**
       * Mark a transaction as reviewed.
       * Pure state transition — does NOT touch RP/EPC/streak. No-op if
       * already reviewed.
       */
      markReviewed: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn || txn.isReviewed) return s;
          return {
            transactions: s.transactions.map((t) =>
              t.id === id ? { ...t, isReviewed: true } : t
            ),
          };
        }),

      // Called once at the end of the onboarding inbox sweep.
      // Keeps only `limit` newest unreviewed SMS in the queue so a brand-new
      // user isn't overwhelmed by dozens of cards on first open.
      capOnboardingQueue: (limit = 5) =>
        set((s) => {
          const unreviewed = s.transactions
            .filter((t) => t.source === 'sms' && !t.isIgnored && !t.isReviewed)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          if (unreviewed.length <= limit) return s;
          const keepIds = new Set(unreviewed.slice(0, limit).map((t) => t.id));
          return {
            transactions: s.transactions.map((t) =>
              t.source === 'sms' && !t.isReviewed && !keepIds.has(t.id)
                ? { ...t, isReviewed: true }
                : t
            ),
          };
        }),

      /**
       * Fires the mid-cycle nudge notification once per cycle.
       * Conditions: budget exists, today >= day 15, not already nudged this cycle.
       * Copy depends on current usage so the message feels useful, not spammy.
       *
       * Called from BudgetNudgeBoot in App.js on launch + foreground.
       */
      maybeFireMidmonthNudge: () => {
        const s = get();
        if (!s.budget) return;
        const now = new Date();
        if (now.getDate() < 15) return;

        const currentMonth = monthKey(now);
        if (s.lastMidmonthNudgeMonth === currentMonth) return;

        const usage = s.getBudgetUsage();
        if (!usage || usage.total.cap == null) return; // skip without a total cap

        // Mark first so failure to fire doesn't keep retrying every foreground
        set({ lastMidmonthNudgeMonth: currentMonth });

        const pct = usage.total.pct;
        const daysPct = usage.daysElapsedPct;
        let tone, body;
        if (pct >= 85) {
          tone = '🚨';
          body = `You're at ${Math.round(pct)}% of your budget with ${usage.daysLeftInMonth} day${usage.daysLeftInMonth === 1 ? '' : 's'} to go. Tighten up?`;
        } else if (pct > daysPct + 5) {
          tone = '⚠';
          body = `You're at ${Math.round(pct)}% of your budget — slightly ahead of pace. Slow down a bit?`;
        } else {
          tone = '👌';
          body = `You're at ${Math.round(pct)}% of your budget. Nice pace — keep it up.`;
        }
        const monthName = now.toLocaleDateString('en-IN', { month: 'long' });

        // Fire-and-forget — runs through the same budget_alerts channel
        fireMidmonthNudgeNotification({
          title: `${tone} ${monthName} check-in`,
          body,
        }).catch(() => {});
      },

      /**
       * Detect recurring-subscription PRICE HIKES across live transactions and, for
       * each newly-detected hike, drop an in-app feed entry + fire an OS notification.
       * Deduped per `${merchantKey}:${hikeTo}` via `subscriptionHikesNotified` so a hike
       * alerts exactly once (and a later further hike to a new amount alerts again).
       * Called on launch / foreground (see App.js). Cheap: pure detection + set diff.
       */
      maybeFireSubscriptionAlerts: () => {
        const s = get();
        const subs = detectSubscriptions(s.transactions || []).filter(
          (sub) => sub.priceHike && sub.hikeTo,
        );
        if (subs.length === 0) return;
        const notified = new Set(s.subscriptionHikesNotified || []);
        const freshKeys = [];
        subs.forEach((sub) => {
          const key = `${sub.merchantKey}:${Math.round(sub.hikeTo)}`;
          if (notified.has(key)) return;
          freshKeys.push(key);
          useNotificationStore.getState().add({
            kind:  'subscription_hike',
            title: `📈 ${sub.merchant} price went up`,
            body:  `Rose from ₹${Math.round(sub.hikeFrom).toLocaleString('en-IN')} to ₹${Math.round(sub.hikeTo).toLocaleString('en-IN')}. Still using it?`,
            dedupeKey: `sub_hike:${sub.merchantKey}`,
            meta:  { merchant: sub.merchant, hikeFrom: sub.hikeFrom, hikeTo: sub.hikeTo, dayOfMonth: sub.dayOfMonth },
          });
          fireSubscriptionHikeNotification({
            merchant: sub.merchant, oldAmount: sub.hikeFrom, newAmount: sub.hikeTo,
          }).catch(() => {});
        });
        if (freshKeys.length) {
          // Keep the notified list bounded (last 100 keys).
          const merged = [...(s.subscriptionHikesNotified || []), ...freshKeys].slice(-100);
          set({ subscriptionHikesNotified: merged });
        }
      },

      /**
       * Returns how many consecutive recent cycles a category stayed under its
       * cap. Walks backward from the most recent history month. Stops at first
       * breach or missing entry. Used to render mastery badges (⭐ at 3, 🥇 at 6).
       */
      getCategoryMastery: (categoryId) => {
        const s = get();
        if (!categoryId || !s.budgetHistory) return 0;
        const keys = Object.keys(s.budgetHistory).sort().reverse();
        let streak = 0;
        for (const k of keys) {
          const entry = s.budgetHistory[k];
          const cat = entry?.perCategory?.[categoryId];
          if (!cat) break;                // category wasn't budgeted that month
          if (cat.actual > cat.cap) break; // broke
          streak += 1;
        }
        return streak;
      },

      /**
       * Fires a one-shot push notification when a category (and/or the total
       * cap) is freshly breached this month. Dedups via `budgetBreachNotified`
       * so the user gets at most one alert per category per month.
       *
       * Called from addTransaction / ingestMessage after the state commits.
       * Safe no-op when budget is null, category isn't in the plan, or it's
       * already been notified this month.
       */
      checkBudgetBreach: (categoryId) => {
        const s = get();
        if (!s.budget) return;

        // Recompute usage fresh from the updated state
        const usage = s.getBudgetUsage();
        if (!usage) return;

        const month        = usage.monthKey;
        const notifiedList = s.budgetBreachNotified?.[month] || [];
        const toMark       = [];

        // ── Category-level breach ─────────────────────────────────────────
        // Budgets are keyed by first-level (parent) category, but callers pass
        // the transaction's legacy categoryId — roll it up to its parent.
        const parentId = CAT_MAPS.legacyToParentId[categoryId] || categoryId;
        if (parentId && s.budget.perCategory[parentId] != null) {
          const cat = usage.perCategory[parentId];
          if (cat?.over && !notifiedList.includes(parentId)) {
            toMark.push(parentId);
            const meta = s.categories.find((c) => c.id === parentId);
            // Fire-and-forget — don't block the action on permission/network
            fireBudgetBreachNotification({
              scope: 'category',
              categoryName: meta?.name || 'Category',
              actual: cat.actual,
              cap: cat.cap,
            }).catch(() => {});
          }
        }

        // ── Total-level breach ────────────────────────────────────────────
        if (s.budget.totalCap != null && usage.total.over && !notifiedList.includes('__total__')) {
          toMark.push('__total__');
          fireBudgetBreachNotification({
            scope: 'total',
            actual: usage.total.actual,
            cap: usage.total.cap,
          }).catch(() => {});
        }

        if (toMark.length === 0) return;

        set((cur) => ({
          budgetBreachNotified: {
            ...cur.budgetBreachNotified,
            [month]: [...(cur.budgetBreachNotified?.[month] || []), ...toMark],
          },
        }));
      },

      /**
       * Snapshot the previous month's plan + actuals into history when the
       * calendar month rolls over. Updates streak based on under/over status.
       * Safe to call repeatedly — no-op if budget is still on the current month.
       */
      rolloverBudgetIfNeeded: () =>
        set((s) => {
          if (!s.budget) return s;
          const currentMonth = monthKey(new Date());
          if (s.budget.monthKey === currentMonth) return s;

          const prevMonth = s.budget.monthKey;
          const prevAgg   = s.monthlyAggregates[prevMonth];
          // Roll the finished month's by-legacy-category spend up to parent ids
          // so the snapshot matches the parent-based budget (groceries → food).
          const byParentPrev = {};
          Object.entries(prevAgg?.byCategory || {}).forEach(([cid, amt]) => {
            if (NON_SPEND_CATS.has(cid)) return;
            const pid = CAT_MAPS.legacyToParentId[cid] || cid;
            if (!BUDGETABLE_PARENT_IDS.has(pid)) return;
            byParentPrev[pid] = (byParentPrev[pid] || 0) + amt;
          });
          const perCategorySnapshot = {};
          let totalActual = 0;
          Object.entries(s.budget.perCategory).forEach(([catId, cap]) => {
            const actual = byParentPrev[catId] || 0;
            perCategorySnapshot[catId] = { cap, actual };
            totalActual += actual;
          });
          const totalCap    = s.budget.totalCap;
          const status      = totalCap != null
            ? (totalActual <= totalCap ? 'under' : 'over')
            : null;
          const overshoot   = (totalCap != null && totalActual > totalCap) ? (totalActual - totalCap) : 0;

          const historyEntry = { totalCap, perCategory: perCategorySnapshot, totalActual, status, overshoot };

          // Streak math — only meaningful when a total cap was set
          const streak = s.budgetStreak || { current: 0, best: 0, lastResetMonth: null };
          let { current, best, lastResetMonth } = streak;
          if (status === 'under') {
            current += 1;
            if (current > best) best = current;
          } else if (status === 'over') {
            current = 0;
            lastResetMonth = prevMonth;
          }

          // Stash a celebration record so the dashboard can pop a modal on next
          // visit. We do this even on 'over' months so the user gets a gentle
          // wrap-up (no shaming copy — that's handled in the modal).
          const savedAmount = (totalCap != null && totalActual <= totalCap)
            ? totalCap - totalActual
            : 0;
          const pendingCelebration = {
            monthKey:     prevMonth,
            totalCap,
            totalActual,
            status,
            overshoot,
            savedAmount,
            streakAfter:  current,
            perCategory:  perCategorySnapshot,
          };

          return {
            // Do NOT auto-carry the plan into the new month. The user must
            // create the new month's plan themselves. We remember the previous
            // plan so the create form can pre-fill it as a starting point.
            budget: null,
            lastBudgetPlan: {
              perCategory: { ...s.budget.perCategory },
              totalCap: s.budget.totalCap,
              monthKey: prevMonth,
            },
            budgetHistory: { ...s.budgetHistory, [prevMonth]: historyEntry },
            budgetStreak: { current, best, lastResetMonth },
            // No active plan for the new month yet → no dedup marks to keep.
            budgetBreachNotified: {},
            pendingCelebration,
            // Reset mid-month nudge dedup for the new cycle
            lastMidmonthNudgeMonth: null,
          };
        }),

      // ----- accounts ----------------------------------------------------
      addAccount: (account) =>
        set((s) => ({
          accounts: [
            ...s.accounts,
            { id: `acct_${Date.now()}`, balance: 0, color: '#6B7280', ...account },
          ],
        })),

      updateAccountBalance: (accountId, delta) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === accountId ? { ...a, balance: a.balance + delta } : a
          ),
        })),

      // Correct a card's type when the SMS-based inference (inferAccountType) guessed
      // wrong — e.g. a credit-card format that omits the word "credit" was read as a
      // Debit Card. Used by the onboarding card screen's Debit/Credit toggle. Only
      // meaningful between Debit Card and Credit Card; when switching TO a credit card,
      // drop any anchored-balance state (its balance is a liability, tracked separately).
      setAccountType: (accountId, type) =>
        set((s) => ({
          accounts: s.accounts.map((a) => {
            if (a.id !== accountId || a.type === type) return a;
            const next = { ...a, type };
            if (type === ACCOUNT_TYPES.CREDIT_CARD) {
              next.ccPaymentsTracked = false;
            }
            return next;
          }),
        })),

      // Absolute "anchor" set used by the AccountCard flip flow.
      // For credit cards, also enables outstanding-balance tracking so the
      // OUTSTANDING / FULLY PAID display kicks in.
      setAccountAnchor: (accountId, newBalance) =>
        set((s) => ({
          accounts: s.accounts.map((a) => {
            if (a.id !== accountId) return a;
            const next = { ...a, balance: newBalance, anchoredAt: Date.now() };
            if (a.type === ACCOUNT_TYPES.CREDIT_CARD) next.ccPaymentsTracked = true;
            return next;
          }),
        })),

      // User explicitly dismissed the "set your real balances" onboarding card
      // on the Accounts screen. Survives reloads via partialize.
      dismissAnchorNudge: () => set({ anchorNudgeDismissed: true }),

      deleteAccount: (accountId) =>
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== accountId),
          // Unlink transactions that were attached to this account
          transactions: s.transactions.map((t) =>
            t.accountId === accountId ? { ...t, accountId: null } : t
          ),
        })),

      /**
       * Merge a Debit Card account into its Bank account — they're the SAME money
       * (the card just draws from the bank). After this there is ONE balance:
       *   • the card's mask is recorded in the bank's `aliasMasks`, so future
       *     card-referenced SMS match the bank account directly (see matchAccount);
       *   • all of the card's transactions (live + archived) re-point to the bank;
       *   • the card's accumulated balance folds into the bank's;
       *   • the standalone Debit Card account is removed.
       * No-op unless `dcId` is a Debit Card and `bankId` is a Bank. Idempotent-safe.
       */
      linkDebitCardToBank: (dcId, bankId) =>
        set((s) => {
          const dc = s.accounts.find((a) => a.id === dcId);
          const bank = s.accounts.find((a) => a.id === bankId);
          if (!dc || !bank) return s;
          if (dc.type !== ACCOUNT_TYPES.DEBIT_CARD || bank.type !== ACCOUNT_TYPES.BANK) return s;

          const aliasMasks = Array.from(
            new Set([...(bank.aliasMasks || []), dc.mask].filter(Boolean)),
          );
          const accounts = s.accounts
            .filter((a) => a.id !== dcId)
            .map((a) =>
              a.id === bankId
                ? { ...a, balance: (a.balance || 0) + (dc.balance || 0), aliasMasks }
                : a,
            );
          const repoint = (list) =>
            (list || []).map((t) => (t.accountId === dcId ? { ...t, accountId: bankId } : t));

          return {
            accounts,
            transactions: repoint(s.transactions),
            archivedTransactions: repoint(s.archivedTransactions),
            // Remember we've resolved this pair so the suggestion never re-surfaces.
            declinedAccountLinks: Array.from(
              new Set([...(s.declinedAccountLinks || []), linkKey(dc.mask, bank.mask)]),
            ),
          };
        }),

      /** User said "no, these are different accounts" — stop suggesting this pair. */
      dismissAccountLinkSuggestion: (cardMask, bankMask) =>
        set((s) => ({
          declinedAccountLinks: Array.from(
            new Set([...(s.declinedAccountLinks || []), linkKey(cardMask, bankMask)]),
          ),
        })),

      // ----- transactions ------------------------------------------------
      /** Manual entry from the FAB. IDs: `IdM0001`, `IdM0002`, … (persisted counter). */
      addTransaction: (txn) => {
        set((s) => {
          if (!txn?.amount || txn.amount <= 0 || txn.amount > MAX_ALLOWED_AMOUNT) {
            return s;
          }
          const manualSeq = s.manualTxnSeq || 0;
          const useProvidedId = !!txn.id;
          const nextSeq = useProvidedId ? manualSeq : manualSeq + 1;
          const id =
            txn.id ||
            `IdM${String(nextSeq).padStart(4, '0')}`;
          // contactInfo is consumed locally to spawn an LB entry — do not
          // forward it onto the persisted transaction shape.
          const { splitOthers, contactInfo, ...txnRest } = txn;
          const newTxn = {
            id,
            createdAt: new Date().toISOString(),
            isSplit: false,
            splitWith: [],
            source: 'manual',
            isReviewed: true, // manual entries are inherently reviewed by the user
            ...txnRest,
            id,
          };

          let nextLent = s.lentBorrowed;
          const others = Array.isArray(splitOthers) ? splitOthers : [];
          if (
            newTxn.isSplit &&
            others.length > 0 &&
            canSplitTransaction(newTxn)
          ) {
            // Amount mode: accept explicit myShareAmount + splitOthers[].shareAmount
            if (
              typeof txn?.myShareAmount === 'number' &&
              others.every((o) => typeof o.shareAmount === 'number')
            ) {
              newTxn.myShareAmount = txn.myShareAmount;
              newTxn.splitWith = others.map((o) => ({
                contactId: o.contactId ?? null,
                name: (o.name || 'Friend').trim(),
                shareAmount: Number(o.shareAmount) || 0,
              }));
            } else {
              // Percent mode (or fallback to equal)
              const myPercent = typeof txn?.myPercent === 'number' ? txn.myPercent : null;
              const hasPercents = myPercent != null && others.every((o) => typeof o.percent === 'number');
              const { myShare, otherShares } = hasPercents
                ? computePercentSplit(newTxn.amount, myPercent, others)
                : computeEqualSplit(newTxn.amount, others);
              newTxn.myShareAmount = myShare;
              newTxn.splitWith = others.map((o, i) => ({
                contactId: o.contactId ?? null,
                name: (o.name || 'Friend').trim(),
                shareAmount: otherShares[i],
              }));
            }
            const stamp = Date.now();
            const newRows = newTxn.splitWith.map((o, i) => ({
              id: `lb_${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
              kind: 'lent',
              person: (o.name || 'Friend').trim(),
              amount: Number(o.shareAmount) || 0,
              note: `Split · ${newTxn.merchant || 'Expense'}`,
              date: newTxn.createdAt,
              sourceTxnId: newTxn.id,
            }));
            nextLent = [...newRows, ...nextLent];
          } else {
            newTxn.isSplit = false;
            newTxn.splitWith = [];
            delete newTxn.myShareAmount;
          }

          // ─── LB entry creation ───────────────────────────────────────
          // If the transaction's categoryId is an LB category AND a
          // contactInfo was supplied by the caller (typically the
          // AddTransactionScreen contact-picker flow), spawn the matching
          // lentBorrowed row so totals stay in sync. The row is also
          // marked lbLocked on the transaction to prevent later
          // re-categorisation from drifting the books.
          if (LB_ALL_CATS.has(newTxn.categoryId) && contactInfo && !newTxn.isSplit) {
            const person = (contactInfo.person || '').trim();
            const lbEntry = {
              id: `lb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              kind:        newTxn.categoryId, // mirrors the txn's category
              person,
              amount:      newTxn.amount,
              phone:       contactInfo.phone || null,
              contactId:   contactInfo.contactId || null,
              note:        `From txn: ${newTxn.merchant || ''}`.trim(),
              date:        newTxn.createdAt,
              sourceTxnId: newTxn.id,
            };
            nextLent = [lbEntry, ...nextLent];
            newTxn.lbLocked = true;
          }

          // If an explicit accountId was passed (manual form selection), use it directly.
          // Otherwise run the auto-detect/create logic.
          let resolvedAccountId = newTxn.accountId || null;
          let resolvedAccounts = s.accounts;
          if (!resolvedAccountId) {
            const { accounts: ensured, account } = ensureAccountForParsed(s.accounts, newTxn);
            resolvedAccountId = account?.id || null;
            resolvedAccounts = ensured;
            newTxn.accountId = resolvedAccountId;
          }

          // Group Zone: auto-tag a plain expense to the active zone group (no split —
          // the user refines/untags later). Skips income, self/LB, splits, already-tagged.
          let zoneGroups = s.groups;
          const zoneId = s.activeGroupZoneId;
          if (
            zoneId &&
            !newTxn.groupId &&
            !newTxn.isSplit &&
            newTxn.type === TRANSACTION_TYPES.DEBIT &&
            !NON_SPEND_CATS.has(newTxn.categoryId) &&
            s.groups.some((g) => g.id === zoneId)
          ) {
            newTxn.groupId = zoneId;
            zoneGroups = s.groups.map((g) =>
              g.id === zoneId
                ? { ...g, totalSpend: (g.totalSpend || 0) + (Number(newTxn.amount) || 0), lastActivityAt: new Date().toISOString() }
                : g,
            );
          }

          return {
            transactions: [newTxn, ...s.transactions],
            accounts: applyDelta(resolvedAccounts, resolvedAccountId, newTxn),
            lentBorrowed: nextLent,
            ...(zoneGroups !== s.groups ? { groups: zoneGroups } : {}),
            ...(useProvidedId ? {} : { manualTxnSeq: nextSeq }),
          };
        });
        // Budget breach detection runs after the state commits — fire-and-forget.
        if (txn?.categoryId) get().checkBudgetBreach(txn.categoryId);
      },

      // ─── Group actions ────────────────────────────────────────────────────

      createGroup: ({ name, type, members = [], emoji = '', color = '#6366F1', excludeFromTotals = false }) => {
        const id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const baseMembers = ensureSelfMember(type, members);
        const nowIso = new Date().toISOString();
        const group = {
          id,
          name: (name || '').trim(),
          type,
          emoji: emoji || '',
          color: color || '#6366F1',
          members: baseMembers,
          excludeFromTotals: !!excludeFromTotals,
          totalSpend: 0,
          settlements: [],
          createdAt: nowIso,
          lastActivityAt: nowIso,
        };
        set((s) => ({ groups: [group, ...s.groups] }));
        return id;
      },

      updateGroup: (id, patches) => {
        set((s) => ({
          groups: s.groups.map((g) => {
            if (g.id !== id) return g;
            const merged = { ...g, ...patches, lastActivityAt: new Date().toISOString() };
            // Re-normalise members so editing never drops the built-in 'me' (the edit
            // form passes back only the contacts, with 'me' stripped for display).
            merged.members = ensureSelfMember(merged.type, merged.members);
            return merged;
          }),
        }));
      },

      /** Turn a group zone on (groupId) or off (null). Exclusive — one zone at a time. */
      setGroupZone: (groupId) => set({ activeGroupZoneId: groupId || null }),

      deleteGroup: (id) => {
        set((s) => ({
          groups: s.groups.filter((g) => g.id !== id),
          // Deleting the active-zone group turns the zone off.
          ...(s.activeGroupZoneId === id ? { activeGroupZoneId: null } : {}),
          // Drop this group's debt rows; clearing groupSplit + rows together keeps spend/debt
          // consistent (the expense reverts to a plain personal spend — no orphan double-count).
          lentBorrowed: s.lentBorrowed.filter((l) => l.groupId !== id),
          transactions: s.transactions.map((t) => {
            if (t.groupId !== id) return t;
            const next = { ...t };
            delete next.groupId;
            delete next.groupSplit;
            delete next.isGroupMemo;
            return next;
          }),
        }));
      },

      /** Tag an existing transaction to a group. For shared groups pass groupSplit to record payer + shares. */
      tagTransactionToGroup: (txnId, groupId, groupSplit = null) => {
        set((s) => {
          const txn = s.transactions.find((t) => t.id === txnId);
          if (!txn) return s;
          // LB-linked transactions (lent/borrowed/lent_settled/borrow_repaid) live in
          // their own ledger, not in groups. Without this guard, rebuilding this txn's
          // LB rows below (buildGroupLbRows) would silently DELETE its existing
          // lentBorrowed entry (sourceTxnId match) with nothing to replace it — the
          // debt record just vanishes. Groups already have their own independent
          // who-owes-whom via split legs; the two systems must not mix.
          if (txn.lbLocked) return s;
          const group = s.groups.find((g) => g.id === groupId);
          if (!group) return s;
          const prevGroupId = txn.groupId || null;
          const amount = Number(txn.amount) || 0;
          const nowIso = new Date().toISOString();

          // Build the updated txn. A shared-group split SUPERSEDES any direct split representation.
          const updatedTxn = { ...txn, groupId };
          if (groupSplit) {
            updatedTxn.groupSplit = groupSplit;
            if (group.type === 'shared') {
              updatedTxn.isSplit = false;
              updatedTxn.splitWith = [];
              delete updatedTxn.myShareAmount;
            }
          }
          const updatedTxns = s.transactions.map((t) => (t.id === txnId ? updatedTxn : t));

          // Rebuild this txn's debt rows: drop any prior rows for this source, add fresh group legs.
          const lbRows = buildGroupLbRows(group, updatedTxn);
          const lentBorrowed = [
            ...lbRows,
            ...s.lentBorrowed.filter((l) => l.sourceTxnId !== txnId),
          ];

          const updatedGroups = s.groups.map((g) => {
            if (g.id === groupId) {
              const inc = prevGroupId === groupId ? 0 : amount; // re-tag to same group: no double add
              return { ...g, totalSpend: (g.totalSpend || 0) + inc, lastActivityAt: nowIso };
            }
            if (prevGroupId && prevGroupId !== groupId && g.id === prevGroupId) {
              return { ...g, totalSpend: Math.max(0, (g.totalSpend || 0) - amount) };
            }
            return g;
          });
          return { transactions: updatedTxns, groups: updatedGroups, lentBorrowed };
        });
      },

      /** Remove a transaction from its group. */
      untagTransactionFromGroup: (txnId) => {
        set((s) => {
          const txn = s.transactions.find((t) => t.id === txnId);
          if (!txn || !txn.groupId) return s;
          const amount = Number(txn.amount) || 0;
          const groupId = txn.groupId;
          const updatedTxns = s.transactions.map((t) => {
            if (t.id !== txnId) return t;
            const next = { ...t };
            delete next.groupId;
            delete next.groupSplit;
            delete next.isGroupMemo;
            return next;
          });
          const updatedGroups = s.groups.map((g) =>
            g.id === groupId
              ? { ...g, totalSpend: Math.max(0, (g.totalSpend || 0) - amount) }
              : g
          );
          // Strip the debt with the tag.
          const lentBorrowed = s.lentBorrowed.filter((l) => l.sourceTxnId !== txnId);
          return { transactions: updatedTxns, groups: updatedGroups, lentBorrowed };
        });
      },

      /**
       * Add a manual expense directly to a group.
       * paidByMemberId: 'me' | group member's memberId
       * If paidBy !== 'me': isGroupMemo=true, no account balance change.
       */
      addGroupExpense: (groupId, { amount, merchant, categoryId, parentCategory, childCategory, paidByMemberId, paidByName, shares, accountId, date, location, note } = {}) => {
        const s = get();
        const group = s.groups.find((g) => g.id === groupId);
        if (!group || !amount || amount <= 0 || amount > MAX_ALLOWED_AMOUNT) return null;

        const manualSeq = s.manualTxnSeq || 0;
        const nextSeq   = manualSeq + 1;
        const id        = `IdM${String(nextSeq).padStart(4, '0')}`;
        const isGroupMemo = paidByMemberId !== 'me';
        const groupSplit = (shares && shares.length > 0)
          ? { paidByMemberId, paidByName: paidByName || paidByMemberId, shares }
          : null;

        // Derive the legacy flat categoryId from the two-tier labels when not given explicitly.
        const resolvedCategoryId =
          categoryId || toLegacyCat(parentCategory, childCategory) || 'other';

        const newTxn = {
          id,
          createdAt: date || new Date().toISOString(),
          type: TRANSACTION_TYPES.DEBIT,
          amount,
          merchant: (merchant || 'Group Expense').trim(),
          categoryId: resolvedCategoryId,
          ...(parentCategory ? { parentCategory } : {}),
          ...(childCategory  ? { childCategory  } : {}),
          source: 'manual',
          isReviewed: true,
          isSplit: false,
          splitWith: [],
          groupId,
          ...(groupSplit   ? { groupSplit }        : {}),
          ...(isGroupMemo ? { isGroupMemo: true }  : {}),
          ...(location ? { location } : {}),
          ...(note ? { note: note.trim() } : {}),
        };

        let resolvedAccountId = accountId || null;
        let resolvedAccounts  = s.accounts;

        if (!isGroupMemo) {
          if (!resolvedAccountId) {
            const { accounts: ensured, account } = ensureAccountForParsed(s.accounts, newTxn);
            resolvedAccountId = account?.id || null;
            resolvedAccounts  = ensured;
          }
          newTxn.accountId = resolvedAccountId;
        }

        // Debt legs (single source of truth) for shared groups — nets per-person across groups.
        const lbRows = buildGroupLbRows(group, newTxn);
        const nowIso = new Date().toISOString();

        set((ss) => ({
          transactions: [newTxn, ...ss.transactions],
          accounts: isGroupMemo ? ss.accounts : applyDelta(resolvedAccounts, resolvedAccountId, newTxn),
          lentBorrowed: lbRows.length ? [...lbRows, ...ss.lentBorrowed] : ss.lentBorrowed,
          groups: ss.groups.map((g) =>
            g.id === groupId
              ? { ...g, totalSpend: (g.totalSpend || 0) + amount, lastActivityAt: nowIso }
              : g
          ),
          manualTxnSeq: nextSeq,
        }));

        if (!isGroupMemo && newTxn.categoryId) get().checkBudgetBreach(newTxn.categoryId);
        return id;
      },

      /**
       * Edit an existing group transaction in place (keeps the same txn id).
       * Reverses the OLD effects (account balance, group total, debt rows) and
       * re-applies the NEW ones — so editing amount / payer / split / category
       * stays consistent across balances, group totals, and Lent/Borrowed.
       * Works for both manual group expenses and tagged SMS transactions.
       */
      updateGroupExpense: (txnId, { amount, merchant, categoryId, parentCategory, childCategory, paidByMemberId, paidByName, shares, accountId, location, note, date } = {}) => {
        const s = get();
        const old = s.transactions.find((t) => t.id === txnId);
        if (!old || !old.groupId) return null;
        const group = s.groups.find((g) => g.id === old.groupId);
        if (!group) return null;

        const newAmount = Number(amount) || 0;
        if (newAmount <= 0 || newAmount > MAX_ALLOWED_AMOUNT) return null;

        const wasMemo     = !!old.isGroupMemo;
        const isGroupMemo = paidByMemberId !== 'me';
        const groupSplit  = (shares && shares.length > 0)
          ? { paidByMemberId, paidByName: paidByName || paidByMemberId, shares }
          : null;
        const resolvedCategoryId =
          categoryId || toLegacyCat(parentCategory, childCategory) || old.categoryId || 'other';

        // Resolve the paying account (only when YOU paid).
        let resolvedAccountId = isGroupMemo ? null : (accountId || old.accountId || null);
        let workingAccounts   = s.accounts;
        if (!isGroupMemo && !resolvedAccountId) {
          const { accounts: ensured, account } = ensureAccountForParsed(s.accounts, { ...old, amount: newAmount });
          resolvedAccountId = account?.id || null;
          workingAccounts   = ensured;
        }

        // Build the updated transaction — preserve id / createdAt / source / smsId.
        const updatedTxn = {
          ...old,
          type: TRANSACTION_TYPES.DEBIT,
          amount: newAmount,
          merchant: (merchant || old.merchant || 'Group Expense').trim(),
          categoryId: resolvedCategoryId,
          note: note !== undefined ? note.trim() : old.note,
          createdAt: date || old.createdAt,
        };
        if (parentCategory) updatedTxn.parentCategory = parentCategory; else delete updatedTxn.parentCategory;
        if (childCategory)  updatedTxn.childCategory  = childCategory;  else delete updatedTxn.childCategory;
        if (groupSplit)  updatedTxn.groupSplit  = groupSplit;  else delete updatedTxn.groupSplit;
        if (isGroupMemo) updatedTxn.isGroupMemo = true;        else delete updatedTxn.isGroupMemo;
        if (isGroupMemo) delete updatedTxn.accountId; else updatedTxn.accountId = resolvedAccountId;
        if (location) updatedTxn.location = location;

        // Reverse the OLD account effect (old was a debit → add the amount back),
        // then apply the NEW one. Net is zero when account + amount are unchanged.
        let accounts = workingAccounts;
        if (!wasMemo && old.accountId) {
          accounts = applyDelta(accounts, old.accountId, { ...old, type: TRANSACTION_TYPES.CREDIT });
        }
        if (!isGroupMemo && resolvedAccountId) {
          accounts = applyDelta(accounts, resolvedAccountId, updatedTxn);
        }

        const nowIso = new Date().toISOString();
        const groups = s.groups.map((g) =>
          g.id === group.id
            ? { ...g, totalSpend: Math.max(0, (g.totalSpend || 0) - (old.amount || 0) + newAmount), lastActivityAt: nowIso }
            : g
        );

        // Rebuild this txn's debt rows from scratch (drop prior rows for this source).
        const lbRows = buildGroupLbRows(group, updatedTxn);
        const lentBorrowed = [
          ...lbRows,
          ...s.lentBorrowed.filter((l) => l.sourceTxnId !== txnId),
        ];

        set({
          transactions: s.transactions.map((t) => (t.id === txnId ? updatedTxn : t)),
          accounts,
          groups,
          lentBorrowed,
        });

        if (!isGroupMemo && updatedTxn.categoryId) get().checkBudgetBreach(updatedTxn.categoryId);
        return txnId;
      },

      /**
       * Group-scoped settle: settle ONLY this group's portion of a person's balance.
       * Sums the person's lentBorrowed rows tagged with this groupId and writes one
       * counterpart settled row (also tagged groupId) for the net — leaving their
       * balances in OTHER groups / direct splits / manual IOUs untouched. The same row
       * also reduces the person's global net, so the LB screen stays consistent.
       */
      // opts.accountId — for a BORROW settle (net < 0) also books a real "Repayment"
      // expense on that account (same as settlePersonBalance).
      settleGroupPersonBalance: (groupId, personKey, opts = {}) => {
        const person = get().getPersonBalances().find((p) => p.personKey === personKey);
        if (!person) return;
        const groupEntries = (person.entries || []).filter((e) => e.groupId === groupId);
        if (groupEntries.length === 0) return;
        const net = groupEntries.reduce((acc, e) => {
          if (e.kind === 'lent')          return acc + e.amount;
          if (e.kind === 'lent_settled')  return acc - e.amount;
          if (e.kind === 'borrowed')      return acc - e.amount;
          if (e.kind === 'borrow_repaid') return acc + e.amount;
          return acc;
        }, 0);
        if (Math.abs(net) <= 0.005) return;

        const group = get().groups.find((g) => g.id === groupId);
        const now = new Date().toISOString();
        const isBorrowSettle = net < 0;
        const booked = isBorrowSettle
          ? bookRepaymentExpense(get(), opts.accountId, Math.abs(net), person.person, now)
          : null;
        const row = {
          id: `lb_settle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          kind: net > 0 ? 'lent_settled' : 'borrow_repaid',
          person: person.person,
          contactId: person.contactId || null,
          phone: person.phone || null,
          amount: Math.abs(net),
          note: `Group settle · ${group?.name || 'Group'}`,
          date: now,
          groupId,
          ...(booked ? { sourceTxnId: booked.txnId } : {}),
        };
        set((s) => ({
          ...(booked ? { accounts: booked.accounts, transactions: booked.transactions } : {}),
          lentBorrowed: [row, ...s.lentBorrowed],
          groups: s.groups.map((g) => (g.id === groupId ? { ...g, lastActivityAt: now } : g)),
        }));
      },

      /**
       * Single canonical SMS / notification ingestion path.
       * opts: { sender, receivedAt, smsId }
       *   smsId — the Android SMS content-provider _id (string). When present
       *           it is stored on the transaction and used as the primary
       *           deduplication key so the same SMS can never be ingested twice
       *           regardless of timing.
       * Returns the parsed object, or null if not financial / duplicate.
       */
      applyCCPayment: ({ amount, accountMask, bankName }, smsId = null, receivedAt = null) => {
        if (!amount || amount <= 0 || amount > MAX_ALLOWED_AMOUNT) return null;
        const state = get();
        const sid = smsId ? String(smsId) : null;

        // ── IGNORE STALE PAYMENTS ────────────────────────────────────────
        // Only prompt for payments from the last few days. Older swept SMS are
        // dropped outright — not prompted and NOT filed in ccHandledSmsIds — so
        // an initial inbox sweep of months of history can't balloon that list.
        const ts = receivedAt ? new Date(receivedAt).getTime() : NaN;
        if (!Number.isNaN(ts) && Date.now() - ts > CC_PROMPT_MAX_AGE_MS) return null;

        // ── ASK-ONCE-PER-PAYMENT ─────────────────────────────────────────
        // Each distinct CC-payment SMS prompts exactly once. Once the user has
        // responded — True-up (confirmCCTrueUp) or Skip (dismissCCPaymentPrompt)
        // — its smsId is filed in ccHandledSmsIds. The inbox sweep re-reads the
        // whole inbox on every app open, so without this guard the SAME payment
        // SMS would re-open the sheet each launch. A genuinely new payment
        // (different smsId) is NOT in the set, so it still prompts as expected.
        // Also skip if this smsId is already waiting in the queue.
        if (sid && (state.ccHandledSmsIds || []).includes(sid)) return null;
        const queue = state.pendingCCPaymentQueue || [];
        if (sid && queue.some((p) => p.smsId === sid)) return null;

        const pseudoTxn = {
          amount,
          type:        TRANSACTION_TYPES.CREDIT,
          accountType: ACCOUNT_TYPES.CREDIT_CARD,
          accountMask: accountMask || null,
          bankName:    bankName    || null,
        };
        let { accounts: accountsWithMatch, account } =
          ensureAccountForParsed([...state.accounts], pseudoTxn);
        if (!account) return null;

        const newEntry = {
          amount,
          accountId:   account.id,
          accountMask: account.mask  || accountMask || null,
          bankName:    account.bankName || bankName || null,
          smsId:       sid,
        };
        set({
          accounts: accountsWithMatch,
          pendingCCPaymentQueue: [...queue, newEntry],
        });
        fireCCPaymentNotification({
          amount,
          accountMask: account.mask || accountMask || null,
          bankName:    account.bankName || bankName || null,
        });
        return { ccPayment: 'pending', accountId: account.id };
      },

      // User tapped "True-up to Zero" — zero the CC balance, start tracking, and
      // file this payment's SMS so the sweep doesn't re-prompt the same one.
      // Shifts queue so the next pending payment (if any) shows immediately.
      confirmCCTrueUp: (sourceAccountId = null) => {
        const state = get();
        const { pendingCCPaymentQueue, ccHandledSmsIds } = state;
        const current = (pendingCCPaymentQueue || [])[0];
        if (!current) return;
        // Book the paying side onto the chosen account (if any), then zero the card.
        const booked = bookCcPaymentSource(state, sourceAccountId, current.amount, new Date().toISOString());
        const baseAccounts = booked?.accounts || state.accounts;
        set({
          accounts: baseAccounts.map((a) =>
            a.id === current.accountId
              ? { ...a, balance: 0, ccPaymentsTracked: true, anchoredAt: Date.now() }
              : a
          ),
          ...(booked ? { transactions: booked.transactions } : {}),
          ccHandledSmsIds:      appendSuppressedSmsIds(ccHandledSmsIds || [], [current.smsId]),
          pendingCCPaymentQueue: (pendingCCPaymentQueue || []).slice(1),
        });
      },

      // User chose "Settle this payment" — reduce the tracked outstanding by EXACTLY
      // the payment amount (moves the negative balance toward zero, never past it, so
      // an overpayment lands on ₹0 rather than a credit balance). Starts tracking and
      // files this payment's SMS so the sweep doesn't re-prompt the same one.
      // Shifts queue so the next pending payment (if any) shows immediately.
      settleCCPayment: (sourceAccountId = null) => {
        const state = get();
        const { pendingCCPaymentQueue, ccHandledSmsIds } = state;
        const current = (pendingCCPaymentQueue || [])[0];
        if (!current) return;
        const booked = bookCcPaymentSource(state, sourceAccountId, current.amount, new Date().toISOString());
        const baseAccounts = booked?.accounts || state.accounts;
        set({
          accounts: baseAccounts.map((a) =>
            a.id === current.accountId
              ? { ...a, balance: Math.min(0, (a.balance ?? 0) + current.amount), ccPaymentsTracked: true }
              : a
          ),
          ...(booked ? { transactions: booked.transactions } : {}),
          ccHandledSmsIds:      appendSuppressedSmsIds(ccHandledSmsIds || [], [current.smsId]),
          pendingCCPaymentQueue: (pendingCCPaymentQueue || []).slice(1),
        });
      },

      // Reclassify an existing (mis-booked) DEBIT as a credit-card bill payment:
      //   • category → 'cc_bill' (non-spend, so it drops out of every spend total;
      //     the bank balance stays reduced because the money really did leave),
      //   • userEditedCategory so self-transfer reconciliation won't overwrite it,
      //   • optionally reduce the paid card's outstanding:
      //       mode 'trueup' → zero it   |  'settle' → reduce by the txn amount
      //       mode 'none'   → leave the card alone (use when the card's own
      //                       "payment received" SMS already reduced it → no
      //                       double reduction).
      markAsCCBillPayment: (txnId, cardAccountId = null, mode = 'none') =>
        set((s) => {
          const txn = (s.transactions || []).find((t) => t.id === txnId);
          if (!txn || txn.lbLocked) return s;

          // Reclassify the source debit (drop any split — a bill payment isn't shared).
          const transactions = s.transactions.map((t) =>
            t.id === txnId
              ? {
                  ...t,
                  categoryId: 'cc_bill',
                  childCategory: undefined,
                  parentCategory: undefined,
                  userEditedCategory: true,
                  ccBillCardId: cardAccountId || null,
                  isSplit: false,
                  splitWith: [],
                  myShareAmount: undefined,
                }
              : t
          );
          const lentBorrowed = (s.lentBorrowed || []).filter((l) => l.sourceTxnId !== txnId);

          // Optionally knock down the paid card's outstanding.
          let accounts = s.accounts;
          if (cardAccountId && mode !== 'none') {
            accounts = s.accounts.map((a) => {
              if (a.id !== cardAccountId) return a;
              if (mode === 'trueup') {
                return { ...a, balance: 0, ccPaymentsTracked: true, anchoredAt: Date.now() };
              }
              // 'settle' — reduce by exactly the payment, never past zero.
              return { ...a, balance: Math.min(0, (a.balance ?? 0) + (txn.amount || 0)), ccPaymentsTracked: true };
            });
          }

          return { transactions, lentBorrowed, accounts };
        }),

      // User tapped "Skip" — leave the balance untouched, but file this payment's
      // SMS so the sweep won't re-prompt this same one. A future payment still asks.
      // Shifts queue so the next pending payment (if any) shows immediately.
      dismissCCPaymentPrompt: () => {
        const { pendingCCPaymentQueue, ccHandledSmsIds } = get();
        const current = (pendingCCPaymentQueue || [])[0];
        set({
          ccHandledSmsIds:      current
            ? appendSuppressedSmsIds(ccHandledSmsIds || [], [current.smsId])
            : (ccHandledSmsIds || []),
          pendingCCPaymentQueue: (pendingCCPaymentQueue || []).slice(1),
        });
      },

      ingestMessage: (rawMessage, opts = {}) => {
        // Fresh start: ANY message dated before the user's onboarding moment is
        // historical — archived for Account-Details reference only, never activated.
        // Gating on `userOnboardedAt` (not just opts.preOnboarding) covers EVERY path:
        // the onboarding sweep AND the background backfill sweep (which carries no flag),
        // so nothing pre-onboarding leaks into the ledger / totals / balances / queue.
        const onboardedMs = get().userOnboardedAt || 0;
        const parsedResult = parseMessageDetailed(rawMessage, opts);
        if (!parsedResult?.ok) {
          // Historical message: never surface CC prompts / bill reminders or mutate
          // balances for pre-onboarding messages — fresh start = clean slate.
          if (opts.preOnboarding || (onboardedMs > 0 && opts.receivedAt && new Date(opts.receivedAt).getTime() < onboardedMs)) return null;
          if (
            parsedResult?.error?.code === 'credit_card_payment_notification' &&
            parsedResult.ccPayment
          ) {
            get().applyCCPayment(parsedResult.ccPayment, opts.smsId, opts.receivedAt);
          }
          // Surface CC bill reminders as in-app notifications.
          if (
            parsedResult?.error?.code === 'cc_bill_reminder' &&
            parsedResult.ccDue
          ) {
            const { amount, cardLast4, dueDate, bankName } = parsedResult.ccDue;
            const cardLabel = cardLast4
              ? `${bankName || 'Credit Card'} •• ${cardLast4}`
              : (bankName || 'Credit Card');
            useNotificationStore.getState().add({
              kind:      'cc_due',
              title:     `₹${Math.round(amount).toLocaleString('en-IN')} due on ${cardLabel}`,
              body:      dueDate
                ? `Pay by ${dueDate} to avoid late fees.`
                : 'Pay before the due date to avoid late fees.',
              dedupeKey: `cc_due:${cardLast4 || bankName || 'unknown'}`,
              meta:      { amount, cardLast4, dueDate, bankName },
            });
            // Also schedule an OS reminder ahead of the due date (the feed chip alone
            // is easy to miss). Dedupe/replace per card+date so a resent bill doesn't
            // stack reminders, and a bill for a NEW cycle cancels the stale one.
            if (dueDate) {
              const key = `${cardLast4 || bankName || 'unknown'}:${dueDate}`;
              const cardKey = `${cardLast4 || bankName || 'unknown'}`;
              const existingMap = get().ccDueReminderIds || {};
              if (!existingMap[key]) {
                // Cancel any prior reminder for this card (older due date) before scheduling.
                Object.entries(existingMap).forEach(([k, id]) => {
                  if (k.startsWith(`${cardKey}:`)) { cancelScheduledNotification(id); }
                });
                scheduleCCBillDueReminder({ amount, cardLast4, bankName, dueDate })
                  .then((id) => {
                    if (!id) return;
                    set((s) => {
                      const map = { ...(s.ccDueReminderIds || {}) };
                      Object.keys(map).forEach((k) => { if (k.startsWith(`${cardKey}:`)) delete map[k]; });
                      map[key] = id;
                      return { ccDueReminderIds: map };
                    });
                  })
                  .catch(() => {});
              }
            }
          }
          // Outgoing CC bill payment from source bank account — adjust the bank
          // account balance without creating a transaction entry. Individual CC
          // purchases are already counted as expenses; the bill payment is a
          // liability settlement and must not inflate the monthly spend total.
          if (
            parsedResult?.error?.code === 'cc_payment_outgoing' &&
            parsedResult.ccOutgoing
          ) {
            const { amount, accountMask, bankName } = parsedResult.ccOutgoing;
            const pseudoDebit = {
              amount,
              type:        TRANSACTION_TYPES.DEBIT,
              accountType: ACCOUNT_TYPES.BANK,
              accountMask: accountMask || null,
              bankName:    bankName    || null,
            };
            const { accounts: srcAccounts, account: srcAccount } =
              ensureAccountForParsed([...get().accounts], pseudoDebit);
            if (srcAccount) {
              set({ accounts: applyDelta(srcAccounts, srcAccount.id, pseudoDebit) });
            }
          }
          return null;
        }

        const parsedTxns = parsedResult.transactions || [parsedResult.transaction];
        const smsBaseId = opts.smsId ? String(opts.smsId) : null;
        const state = get();

        let nextTransactions = [...state.transactions];
        let nextArchived = [...(state.archivedTransactions || [])];
        let nextAccounts = [...state.accounts];
        const added = [];
        let archivedCount = 0;

        parsedTxns.forEach((txn, idx) => {
          if (!txn?.amount || txn.amount <= 0 || txn.amount > MAX_ALLOWED_AMOUNT) return;
          const smsId = smsBaseId
            ? (parsedTxns.length > 1 ? `${smsBaseId}:${idx + 1}` : smsBaseId)
            : null;

          const candidate = { ...txn, isReviewed: false };
          if (smsId) candidate.smsId = smsId;
          // Live incoming SMS may carry the device's current point (caller passes it
          // only for real-time messages, never the backfill sweep). Optional + backward
          // compatible — older txns simply have no `location`.
          if (opts.location) candidate.location = opts.location;
          // TODO: remove rawSms/rawSender before production — preview-only debug fields
          if (IS_PREVIEW_BUILD) {
            const txnAge = Date.now() - new Date(candidate.createdAt || Date.now()).getTime();
            if (txnAge < RAW_SMS_RETENTION_MS) {
              candidate.rawSms    = rawMessage || '';
              candidate.rawSender = opts.sender || '';
            }
          }

          // ── Merchant + category enrichment (merchantEnricher secondary layer) ──
          // messageParser gives a raw merchant string. merchantEnricher strips VPA
          // suffixes / processor prefixes and maps to brand name + two-tier
          // category (parentCategory/childCategory from twoTierCategories.ts).
          // rawMerchant   — original string, key for userCustomRules
          // cleanMerchant — display-ready name shown in DailyQueueSection
          // merchant      — same as cleanMerchant (backward-compat field)
          // When no dictionary match, messageParser's flat categoryId is kept.
          // Never clobbers user edits.
          candidate.rawMerchant = candidate.merchant || '';
          if (!candidate.userEditedCategory || !candidate.userEditedMerchant) {
            const userRules = state.userCustomRules || {};
            const { cleanMerchant, parentCategory, childCategory, isKnownSubscription } =
              cleanMerchantName(candidate.merchant, userRules);
            if (cleanMerchant && !candidate.userEditedMerchant) {
              candidate.merchant = cleanMerchant;
              candidate.cleanMerchant = cleanMerchant;
            } else {
              candidate.cleanMerchant = candidate.merchant || '';
            }
            if (parentCategory && !candidate.userEditedCategory) {
              candidate.parentCategory = parentCategory;
              candidate.childCategory  = childCategory;
              const legacyId = toLegacyCat(parentCategory, childCategory);
              if (legacyId) candidate.categoryId = legacyId;
            }
            if (isKnownSubscription) candidate.isSubscription = true;
          } else {
            candidate.cleanMerchant = candidate.merchant || '';
          }

          // ── Subscription detection ────────────────────────────────────────
          const subHistory = nextTransactions.map((t) => ({
            amount: t.amount,
            timestamp: t.createdAt,
            cleanMerchant: t.merchant,
            isExcludable: NON_SPEND_CATS.has(t.categoryId),
          }));
          candidate.isSubscription = detectIsSubscription(
            { amount: candidate.amount, timestamp: candidate.createdAt, cleanMerchant: candidate.merchant },
            subHistory,
          );

          if (isDuplicate([...nextTransactions, ...nextArchived], candidate, smsId, state.suppressedSmsIds || [])) return;

          const { accounts: accountsWithMatch, account } = ensureAccountForParsed(nextAccounts, candidate);
          candidate.accountId = account?.id || null;

          // Tag transfers between the user's own accounts as `self` so they're
          // excluded from spend/income totals (balances still update below).
          const userMasks = accountsWithMatch.map((a) => a.mask).filter(Boolean);
          if (isSelfTransfer(candidate, userMasks, state.userPhones, state.userName)) {
            Object.assign(candidate, SELF_TXN_FIELDS);
          }

          // Historical (dated before onboarding) — discover the account (above) but
          // DON'T touch balances or the active ledger. Archived for reference-only
          // display in Account Details. Covers the onboarding sweep AND the backfill
          // sweep (the latter passes no flag, so the timestamp check catches it).
          const txnTime  = new Date(candidate.createdAt || Date.now()).getTime();
          const historical = opts.preOnboarding || (onboardedMs > 0 && txnTime < onboardedMs);
          if (historical) {
            candidate.preOnboarding = true;
            candidate.isReviewed = true;
            nextAccounts = accountsWithMatch;
            nextArchived = [candidate, ...nextArchived];
            archivedCount += 1;
            return;
          }

          // Skip balance delta for transactions older than a manual anchor — the
          // anchor already reflects the correct balance up to that point.
          const anchoredAt = account?.anchoredAt ?? 0;
          nextAccounts = (anchoredAt && txnTime < anchoredAt)
            ? accountsWithMatch
            : applyDelta(accountsWithMatch, account?.id, candidate);
          nextTransactions = [candidate, ...nextTransactions];
          added.push(candidate);
        });

        if (added.length === 0 && archivedCount === 0) return null;

        // Reconcile self-transfer tags: a dual-leg transfer's counterpart account
        // is often only learned from its OWN later SMS, so re-check earlier
        // candidates against the now-grown account set. Re-tagging only changes
        // the category (balances already applied), so it's safe to run anytime.
        // User-edited / LB-locked transactions are left untouched. Only the active
        // ledger needs this — archived (historical) rows are reference-only.
        if (added.length > 0) {
          const finalMasks = nextAccounts.map((a) => a.mask).filter(Boolean);
          const userPhones = state.userPhones || [];
          const userName   = state.userName || '';
          nextTransactions = nextTransactions.map((t) => {
            if (!t || t.userEditedCategory || t.lbLocked || t.categoryId === 'self') return t;
            if (!t.selfDualLeg && !t.counterpartyPhone && !t.counterpartyName) return t;
            return isSelfTransfer(t, finalMasks, userPhones, userName)
              ? { ...t, ...SELF_TXN_FIELDS }
              : t;
          });

          // Cross-leg linkage: the two banks involved in one self transfer each
          // send their own SMS, both carrying the same IMPS/UPI reference. Once
          // either leg is tagged self (above), propagate that to the other leg
          // via the shared reference — handles the receiving-bank credit whose
          // only counterparty signal is a heavily-masked phone.
          nextTransactions = propagateSelfByRef(nextTransactions, finalMasks);

          // Combined dual-leg self transfers ("A/c X debited & A/c Y credited") book
          // only the X leg above, so mirror the opposite delta onto Y — otherwise the
          // money "leaves" X but never "arrives" at Y and net worth drifts. Operates on
          // the FINAL tagged set (so reconciliation-tagged legs are covered) and only
          // for legs added THIS batch; guarded against double-counting a real Y-SMS.
          const addedIds = new Set(added.map((t) => t.id));
          const syntheticLegs = [];
          nextTransactions.forEach((t) => {
            if (!addedIds.has(t.id)) return;
            const r = buildSelfCounterLeg(nextAccounts, [...nextTransactions, ...syntheticLegs], t);
            if (r) { nextAccounts = r.accounts; syntheticLegs.push(r.leg); }
          });
          // Persisted via nextTransactions; intentionally NOT added to `added` — these
          // mirror legs aren't user-reviewable and must not trigger zone-tag/budget/XP.
          if (syntheticLegs.length) nextTransactions = [...syntheticLegs, ...nextTransactions];
        }

        set({ transactions: nextTransactions, accounts: nextAccounts, archivedTransactions: nextArchived });

        // Group Zone: auto-tag freshly-added SMS expenses to the active zone group
        // (no split — they stay isReviewed:false so the user can edit/untag in the
        // review queue). Reuses tagTransactionToGroup (totals + lastActivity). Skips
        // income, self/LB, splits, and already-tagged rows. (Onboarding's archived
        // sweep never reaches here — those rows aren't in `added`.)
        const zoneId = get().activeGroupZoneId;
        if (zoneId && added.length && get().groups.some((g) => g.id === zoneId)) {
          added.forEach((t) => {
            if (
              t.type === TRANSACTION_TYPES.DEBIT &&
              !t.groupId &&
              !t.isSplit &&
              !NON_SPEND_CATS.has(t.categoryId)
            ) {
              get().tagTransactionToGroup(t.id, zoneId);
            }
          });
        }

        // Check budget breach for each unique category affected by this ingest.
        const affectedCats = new Set();
        added.forEach((t) => { if (t.categoryId) affectedCats.add(t.categoryId); });
        affectedCats.forEach((catId) => get().checkBudgetBreach(catId));

        return added[0] || null;
      },

      deleteTransaction: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn) return s;
          // A combined self-transfer's synthetic counterpart leg (derivedFromTxnId)
          // rides along — drop it too and reverse its balance, else the mirror credit
          // lingers and net worth drifts. Children have no groupId / LB rows.
          const children = s.transactions.filter((t) => t.derivedFromTxnId === id);
          const dropIds = new Set([id, ...children.map((c) => c.id)]);
          // Already reversed when ignored — only drop the rows. Group total was also
          // already decremented at ignore time, so don't decrement again here.
          if (txn.isIgnored) {
            return {
              transactions: s.transactions.filter((t) => !dropIds.has(t.id)),
              accounts: s.accounts,
              lentBorrowed: s.lentBorrowed.filter((l) => l.sourceTxnId !== id),
              ...(txn.smsId
                ? {
                    suppressedSmsIds: appendSuppressedSmsIds(s.suppressedSmsIds || [], [
                      txn.smsId,
                    ]),
                  }
                : {}),
            };
          }
          let accounts = applyDelta(s.accounts, txn.accountId, { ...txn, type: oppositeType(txn.type) });
          children.forEach((c) => {
            if (!c.isIgnored) accounts = applyDelta(accounts, c.accountId, { ...c, type: oppositeType(c.type) });
          });
          return {
            transactions: s.transactions.filter((t) => !dropIds.has(t.id)),
            accounts,
            groups: adjustGroupTotal(s.groups, txn.groupId, -(txn.amount || 0)),
            lentBorrowed: s.lentBorrowed.filter((l) => l.sourceTxnId !== id),
            ...(txn.smsId
              ? {
                  suppressedSmsIds: appendSuppressedSmsIds(s.suppressedSmsIds || [], [
                    txn.smsId,
                  ]),
                }
              : {}),
          };
        }),

      /** Reverse account effect and mark ignored — excluded from all totals/lists. */
      ignoreTransaction: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn || txn.isIgnored) return s;
          // Cascade to the synthetic self-transfer counterpart leg so both balances
          // back out together (keeps the transfer net-zero across ignore/unignore).
          const children = s.transactions.filter((t) => t.derivedFromTxnId === id && !t.isIgnored);
          const ignoreIds = new Set([id, ...children.map((c) => c.id)]);
          let accounts = applyDelta(s.accounts, txn.accountId, { ...txn, type: oppositeType(txn.type) });
          children.forEach((c) => { accounts = applyDelta(accounts, c.accountId, { ...c, type: oppositeType(c.type) }); });
          return {
            transactions: s.transactions.map((t) =>
              ignoreIds.has(t.id) ? { ...t, isIgnored: true } : t
            ),
            accounts,
            groups: adjustGroupTotal(s.groups, txn.groupId, -(txn.amount || 0)),
            lentBorrowed: s.lentBorrowed.filter((l) => l.sourceTxnId !== id),
            ...(txn.smsId
              ? {
                  suppressedSmsIds: appendSuppressedSmsIds(s.suppressedSmsIds || [], [
                    txn.smsId,
                  ]),
                }
              : {}),
          };
        }),

      /** Undo ignore — re-apply balances, counts, and allow SMS dedup via smsId again. */
      unignoreTransaction: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn || !txn.isIgnored) return s;
          // Re-apply the synthetic self-transfer counterpart leg alongside the parent.
          const children = s.transactions.filter((t) => t.derivedFromTxnId === id && t.isIgnored);
          const restoreIds = new Set([id, ...children.map((c) => c.id)]);
          let nextAccounts = applyDelta(s.accounts, txn.accountId, txn);
          children.forEach((c) => { nextAccounts = applyDelta(nextAccounts, c.accountId, c); });
          const suppressedSmsIds = txn.smsId
            ? (s.suppressedSmsIds || []).filter((sid) => sid !== txn.smsId)
            : s.suppressedSmsIds || [];
          return {
            transactions: s.transactions.map((t) =>
              restoreIds.has(t.id) ? { ...t, isIgnored: false } : t
            ),
            accounts: nextAccounts,
            groups: adjustGroupTotal(s.groups, txn.groupId, txn.amount || 0),
            ...(txn.smsId ? { suppressedSmsIds } : {}),
          };
        }),

      /**
       * Full-field edit of a PLAIN (non-group) transaction — amount, type, account,
       * merchant, category, note, date. Mirrors `updateGroupExpense`'s reversal/reapply
       * approach so balances stay correct: reverses the OLD delta (skipped if the
       * txn is ignored — an ignored txn's delta is already parked out) and applies
       * the NEW one, keeping id/source (createdAt only changes if a new one is passed).
       * Refuses group-tagged or LB-linked transactions — those have their own dedicated
       * edit flows (group expense form / LB re-link) that keep their own ledgers in sync.
       */
      updateTransaction: (txnId, { amount, type, accountId, merchant, categoryId, parentCategory, childCategory, note, createdAt } = {}) => {
        const old = get().transactions.find((t) => t.id === txnId);
        if (!old || old.groupId || old.lbLocked) return null;

        const newAmount = Number(amount) || 0;
        if (newAmount <= 0 || newAmount > MAX_ALLOWED_AMOUNT) return null;
        const newType = type === TRANSACTION_TYPES.CREDIT ? TRANSACTION_TYPES.CREDIT : TRANSACTION_TYPES.DEBIT;
        const newAccountId = accountId || old.accountId || null;

        const updatedTxn = {
          ...old,
          type: newType,
          amount: newAmount,
          accountId: newAccountId,
          merchant: (merchant || old.merchant || 'Transaction').trim(),
          categoryId: categoryId || old.categoryId,
          note: note ?? old.note,
          createdAt: createdAt || old.createdAt,
        };
        if (parentCategory) updatedTxn.parentCategory = parentCategory; else delete updatedTxn.parentCategory;
        if (childCategory)  updatedTxn.childCategory  = childCategory;  else delete updatedTxn.childCategory;

        // Amount/category changes can invalidate an existing direct split
        // (shares were computed against the old amount/category) — clear it,
        // matching updateTransactionCategory's mustClearSplit guard.
        const mustClearSplit = old.isSplit && (newAmount !== old.amount || !canSplitTransaction(updatedTxn));
        if (mustClearSplit) {
          updatedTxn.isSplit = false;
          updatedTxn.splitWith = [];
          updatedTxn.myShareAmount = undefined;
        }

        set((s) => {
          let accounts = s.accounts;
          if (!old.isIgnored) {
            accounts = applyDelta(accounts, old.accountId, { ...old, type: oppositeType(old.type) });
            accounts = applyDelta(accounts, newAccountId, updatedTxn);
          }
          return {
            transactions: s.transactions.map((t) => (t.id === txnId ? updatedTxn : t)),
            accounts,
            lentBorrowed: mustClearSplit
              ? s.lentBorrowed.filter((l) => l.sourceTxnId !== txnId)
              : s.lentBorrowed,
          };
        });

        if (updatedTxn.categoryId) get().checkBudgetBreach(updatedTxn.categoryId);
        return txnId;
      },

      /**
       * Equal split: `others` = friends (not you). Creates lent rows with `sourceTxnId`.
       * Pass empty `others` to clear split and remove linked lent rows.
       */
      setTransactionSplit: (txnId, others, meta = {}) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === txnId);
          if (!txn) return s;
          if (txn.lbLocked) return s; // LB-tagged transactions cannot be split
          const lb = s.lentBorrowed.filter((l) => l.sourceTxnId !== txnId);
          const clearSplit = {
            isSplit: false,
            splitWith: [],
            myShareAmount: undefined,
          };

          if (!others || others.length === 0 || !canSplitTransaction(txn)) {
            return {
              transactions: s.transactions.map((t) =>
                t.id === txnId ? { ...t, ...clearSplit } : t
              ),
              lentBorrowed: lb,
            };
          }

          const mode = meta?.mode || 'percent';
          let myShare = null;
          let splitWith = [];

          if (
            mode === 'amount' &&
            typeof meta?.myAmount === 'number' &&
            others.every((o) => typeof o.shareAmount === 'number')
          ) {
            myShare = meta.myAmount;
            splitWith = others.map((o) => ({
              contactId: o.contactId ?? null,
              name: (o.name || 'Friend').trim(),
              shareAmount: Number(o.shareAmount) || 0,
            }));
          } else if (
            mode === 'percent' &&
            typeof meta?.myPercent === 'number' &&
            others.every((o) => typeof o.percent === 'number')
          ) {
            const { myShare: ms, otherShares } = computePercentSplit(txn.amount, meta.myPercent, others);
            myShare = ms;
            splitWith = others.map((o, i) => ({
              contactId: o.contactId ?? null,
              name: (o.name || 'Friend').trim(),
              shareAmount: otherShares[i],
            }));
          } else {
            const { myShare: ms, otherShares } = computeEqualSplit(txn.amount, others);
            myShare = ms;
            splitWith = others.map((o, i) => ({
              contactId: o.contactId ?? null,
              name: (o.name || 'Friend').trim(),
              shareAmount: otherShares[i],
            }));
          }

          const stamp = Date.now();
          const newLent = splitWith.map((o, i) => ({
            id: `lb_${stamp}_${i}_${Math.random().toString(36).slice(2, 8)}`,
            kind: 'lent',
            person: (o.name || 'Friend').trim(),
            contactId: o.contactId || null,
            phone: o.phone || null,
            amount: Number(o.shareAmount) || 0,
            note: `Split · ${txn.merchant || 'Expense'}`,
            date: txn.createdAt,
            sourceTxnId: txnId,
          }));

          return {
            transactions: s.transactions.map((t) =>
              t.id === txnId
                ? { ...t, isSplit: true, myShareAmount: Number(myShare) || 0, splitWith }
                : t
            ),
            lentBorrowed: [...newLent, ...lb],
          };
        }),

      updateTwoTierCategory: (id, parentCategory, childCategory) =>
        set((s) => {
          const legacyCategoryId = toLegacyCat(parentCategory, childCategory);

          return {
            transactions: s.transactions.map((t) =>
              t.id === id
                ? {
                    ...t,
                    parentCategory,
                    childCategory,
                    ...(legacyCategoryId ? { categoryId: legacyCategoryId } : {}),
                    userEdited: true,
                    userEditedCategory: true,
                  }
                : t
            ),
          };
        }),

      saveUserCustomRule: (rawMerchantKey, rule) =>
        set((s) => ({
          userCustomRules: { ...s.userCustomRules, [rawMerchantKey]: rule },
        })),

      updateTransactionCategory: (id, categoryId) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn) return s;
          if (txn.lbLocked) return s; // LB-linked transactions cannot be re-categorised
          const hypothetical = { ...txn, categoryId };
          const mustClearSplit = txn.isSplit && !canSplitTransaction(hypothetical);
          const lb = mustClearSplit
            ? s.lentBorrowed.filter((l) => l.sourceTxnId !== id)
            : s.lentBorrowed;
          return {
            transactions: s.transactions.map((t) => {
              if (t.id !== id) return t;
              if (mustClearSplit) {
                return { ...t, categoryId, isSplit: false, splitWith: [], myShareAmount: undefined };
              }
              return { ...t, categoryId };
            }),
            lentBorrowed: lb,
          };
        }),

      /**
       * Change a transaction's category to any LB kind and link it to a person.
       * contactInfo: { person, phone?, contactId? }
       * Creates one lentBorrowed entry with kind=categoryId and locks the transaction.
       * Falls back to plain category update for non-LB categories.
       */
      updateTransactionCategoryWithContact: (id, categoryId, contactInfo) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn) return s;
          if (txn.lbLocked) return s; // LB-linked transactions cannot be re-categorised

          // Plain update for non-lent/borrow categories
          if (!LB_ALL_CATS.has(categoryId)) {
            const hypothetical = { ...txn, categoryId };
            const mustClearSplit = txn.isSplit && !canSplitTransaction(hypothetical);
            const lb = mustClearSplit ? s.lentBorrowed.filter((l) => l.sourceTxnId !== id) : s.lentBorrowed;
            return {
              transactions: s.transactions.map((t) => {
                if (t.id !== id) return t;
                if (mustClearSplit) return { ...t, categoryId, isSplit: false, splitWith: [], myShareAmount: undefined };
                return { ...t, categoryId };
              }),
              lentBorrowed: lb,
            };
          }

          const now = new Date().toISOString();
          const person = (contactInfo?.person || '').trim();
          const phone  = contactInfo?.phone || null;

          // Remove any prior lb entries for this transaction (split entries or earlier tagging)
          const lbList = s.lentBorrowed.filter((l) => l.sourceTxnId !== id);

          // LB and split are mutually exclusive — clear split if set
          const splitClear = txn.isSplit
            ? { isSplit: false, splitWith: [], myShareAmount: undefined }
            : {};

          // One simple entry per transaction — kind mirrors categoryId exactly.
          // Balance is always net = Σlent - Σlent_settled - Σborrowed + Σborrow_repaid.
          const newEntry = {
            id: `lb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: categoryId,
            person,
            amount: txn.amount,
            phone,
            contactId: contactInfo?.contactId || null,
            note: `From txn: ${txn.merchant || ''}`.trim(),
            date: txn.createdAt || now,
            sourceTxnId: id,
          };

          return {
            transactions: s.transactions.map((t) =>
              t.id === id ? { ...t, ...splitClear, categoryId, lbLocked: true } : t
            ),
            lentBorrowed: [newEntry, ...lbList],
          };
        }),

      /**
       * Fix a wrongly-named/linked person on an LB-tagged transaction — WITHOUT
       * touching amount, kind, date, or the transaction's category/lock. Finds the
       * single lentBorrowed row created for this txn (via updateTransactionCategoryWithContact
       * / addTransaction's contactInfo path — sourceTxnId === txnId) and rewrites its
       * person/phone/contactId. No-op if that row can't be found.
       */
      relinkLentBorrowedEntry: (txnId, contactInfo) =>
        set((s) => {
          const idx = s.lentBorrowed.findIndex((l) => l.sourceTxnId === txnId);
          if (idx === -1) return s;
          const person = (contactInfo?.person || '').trim();
          if (!person) return s;
          const lentBorrowed = [...s.lentBorrowed];
          lentBorrowed[idx] = {
            ...lentBorrowed[idx],
            person,
            phone: contactInfo?.phone || null,
            contactId: contactInfo?.contactId || null,
          };
          return { lentBorrowed };
        }),

      setTransactionHidden: (id, hidden) =>
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, isHidden: !!hidden } : t
          ),
        })),

      /**
       * Mark/unmark a CREDIT as a refund/return/cashback. A refund nets DOWN spend
       * (and its own category) instead of counting as income. Balance is unchanged
       * (the money did arrive). No-op on debits. Keep the txn's category so the
       * refund reduces the matching expense category in breakdowns.
       */
      setTransactionRefund: (id, isRefund) =>
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id && t.type === TRANSACTION_TYPES.CREDIT ? { ...t, isRefund: !!isRefund } : t
          ),
        })),

      // ----- custom two-tier categories ---------------------------------
      // Create a new TOP-LEVEL parent. Also registers a flat `categories` entry
      // (same id) so transactions tagged with it resolve a name/emoji for display.
      addCustomParent: ({ label, emoji, color }) => {
        const id = `pcat_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        set((s) => {
          const customParents = [...(s.customParents || []), { id, label, emoji, color, legacyId: id }];
          refreshCatMaps(customParents, s.customChildren);
          return {
            customParents,
            categories: [...s.categories, { id, name: label, emoji, color }],
          };
        });
        return id;
      },

      // Add a SUB-category under a parent (built-in or custom). Registers a flat entry too.
      addCustomChild: (parentId, { label, emoji, color }) => {
        const id = `ccat_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        set((s) => {
          const customChildren = [...(s.customChildren || []), { id, parentId, label, emoji, legacyId: id }];
          refreshCatMaps(s.customParents, customChildren);
          return {
            customChildren,
            categories: [...s.categories, { id, name: label, emoji, color: color || '#6B7280' }],
          };
        });
        return id;
      },

      // Remove a custom category (parent → also removes its custom children).
      // The flat `categories` entries are intentionally KEPT so already-tagged
      // transactions still display their name/emoji.
      removeCustomCategory: (id) =>
        set((s) => {
          const isParent = (s.customParents || []).some((p) => p.id === id);
          const customParents  = (s.customParents || []).filter((p) => p.id !== id);
          const customChildren = (s.customChildren || []).filter(
            (c) => c.id !== id && (!isParent || c.parentId !== id)
          );
          refreshCatMaps(customParents, customChildren);
          return { customParents, customChildren };
        }),

      // ----- lent / borrowed --------------------------------------------
      /**
       * Add a manual OUTSTANDING lent/borrow entry.
       * entry: { kind: 'lent' | 'borrowed', person, amount, note?, contactId?, phone? }
       *
       * kind must be 'lent' or 'borrowed' — NOT a settlement kind. getPersonBalances()
       * nets a settlement kind against a matching origin entry (rec.lent -= amount for
       * lent_settled, etc.); a standalone lent_settled/borrow_repaid with no origin
       * would wrongly skew the person's balance negative/positive. To log a settlement
       * against a person's existing outstanding balance, use addAlreadySettledLentBorrowed
       * instead — it writes a single settlement-kind row (like re-tagging a transaction).
       */
      addLentBorrowed: (entry) =>
        set((s) => {
          if (!entry?.amount || entry.amount <= 0 || entry.amount > MAX_ALLOWED_AMOUNT) return s;
          return {
            lentBorrowed: [
              {
                id: `lb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                date: new Date().toISOString(),
                ...entry,
              },
              ...s.lentBorrowed,
            ],
          };
        }),

      /**
       * True when an LB row may be edited/deleted in place from the ledger UI.
       *
       * A row is DERIVED — and therefore read-only here — when it carries either:
       *   • `groupId`     — materialised from a group expense (buildGroupLbRows). Editing it
       *                     would desync the row from the expense; edit the group expense.
       *   • `sourceTxnId` — backed by a real transaction, either a re-tagged bank SMS
       *                     (`lbLocked`) or a booked Repayment expense. The amount belongs
       *                     to that transaction, so changing it here would contradict the
       *                     account balance the transaction already moved.
       * Everything else came from the LB add form and is the user's own bookkeeping, so it
       * is safe to change. Exported so the UI can grey the row instead of failing on tap.
       */
      isLentBorrowedEditable: (entry) =>
        !!entry && !entry.groupId && !entry.sourceTxnId,

      /**
       * Edit a MANUAL lent/borrowed row in place. Returns true on success, false if the
       * row is missing, derived (see isLentBorrowedEditable) or the amount is invalid.
       * patch may set: { amount, note, date, person, phone, contactId }.
       *
       * No balance reversal is needed (unlike updateTransaction): an LB row never moved an
       * account — getPersonBalances re-derives every net from the rows on read, so writing
       * the new values is the whole update.
       */
      updateLentBorrowedEntry: (id, patch = {}) => {
        const s = get();
        const old = (s.lentBorrowed || []).find((l) => l.id === id);
        if (!old || old.groupId || old.sourceTxnId) return false;

        const next = { ...old };
        if (patch.amount !== undefined) {
          const amt = Number(patch.amount);
          if (!Number.isFinite(amt) || amt <= 0 || amt > MAX_ALLOWED_AMOUNT) return false;
          next.amount = amt;
        }
        if (patch.note   !== undefined) next.note   = patch.note || null;
        if (patch.date   !== undefined) next.date   = patch.date || old.date;
        if (patch.person !== undefined) {
          const p = String(patch.person || '').trim();
          if (!p) return false;
          next.person = p;
        }
        // phone/contactId are cleared with an explicit null, so `undefined` (absent) and
        // null (unlink) must stay distinguishable.
        if (patch.phone     !== undefined) next.phone     = patch.phone || null;
        if (patch.contactId !== undefined) next.contactId = patch.contactId || null;

        set({ lentBorrowed: s.lentBorrowed.map((l) => (l.id === id ? next : l)) });
        return true;
      },

      /**
       * Delete a MANUAL lent/borrowed row. Returns true on success. Derived rows are
       * refused — a group row is removed by untagging/deleting its group expense, and a
       * txn-backed row by deleting its transaction, so that the two systems can't drift.
       */
      deleteLentBorrowedEntry: (id) => {
        const s = get();
        const old = (s.lentBorrowed || []).find((l) => l.id === id);
        if (!old || old.groupId || old.sourceTxnId) return false;
        set({ lentBorrowed: s.lentBorrowed.filter((l) => l.id !== id) });
        return true;
      },

      /**
       * Log a settlement against a person's EXISTING outstanding balance in one step —
       * e.g. "Rohit already paid me back the ₹500 I lent him." Mirrors what re-tagging a
       * normal transaction to lent_settled/borrow_repaid does (updateTransactionCategoryWithContact):
       * creates exactly ONE ledger row of the settlement kind (kind 'lent_settled' for a
       * 'lent' toggle, 'borrow_repaid' for a 'borrowed' toggle) — NOT an origin+counterpart
       * pair. getPersonBalances nets it against the person's outstanding lent/borrowed
       * (net = Σlent − Σlent_settled − Σborrowed + Σborrow_repaid), so it reduces the
       * balance just like any real settled transaction.
       * entry: { kind: 'lent' | 'borrowed', person, amount, note?, contactId?, phone?, date? }
       * entry.date — ISO string to backdate the entry; defaults to now. Also dates the
       * booked Repayment expense below, so ledger and transaction list agree.
       * opts.accountId — for a 'borrowed' toggle (→ 'borrow_repaid', a real expense, since
       * the money left an account just now with no bank SMS backing it), also books a
       * "Repayment" debit on that account via bookRepaymentExpense — same treatment as
       * settlePersonBalance. Omit to stay ledger-only. 'lent' toggles never book a
       * transaction (receiving your own money back isn't income).
       */
      addAlreadySettledLentBorrowed: (entry, opts = {}) =>
        set((s) => {
          if (!entry?.amount || entry.amount <= 0 || entry.amount > MAX_ALLOWED_AMOUNT) return s;
          if (entry.kind !== 'lent' && entry.kind !== 'borrowed') return s;
          // Caller may backdate the entry (the form's date picker); the booked
          // Repayment expense is dated to match so the ledger and the account's
          // transaction list agree on when the money moved.
          const now = entry.date || new Date().toISOString();
          const settleKind = entry.kind === 'lent' ? 'lent_settled' : 'borrow_repaid';
          const booked = settleKind === 'borrow_repaid' && opts.accountId
            ? bookRepaymentExpense(s, opts.accountId, entry.amount, entry.person, now)
            : null;
          const settleEntry = {
            id: `lb_settle_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            kind: settleKind,
            person: entry.person,
            phone: entry.phone || null,
            contactId: entry.contactId || null,
            amount: entry.amount,
            note: entry.note || 'Manual settlement',
            date: now,
            ...(booked ? { sourceTxnId: booked.txnId } : {}),
          };
          return {
            ...(booked ? { accounts: booked.accounts, transactions: booked.transactions } : {}),
            lentBorrowed: [settleEntry, ...s.lentBorrowed],
          };
        }),

      /**
       * Manually settle a 'lent' or 'borrowed' entry in full.
       * Creates a counterpart 'lent_settled'/'borrow_repaid' entry and marks
       * the original with settledAt to prevent double-settling.
       */
      settleLentBorrowed: (id) =>
        set((s) => {
          const entry = s.lentBorrowed.find((l) => l.id === id);
          if (!entry || entry.settledAt) return s;
          if (entry.kind !== 'lent' && entry.kind !== 'borrowed') return s;
          const now = new Date().toISOString();
          const counterpartKind = entry.kind === 'lent' ? 'lent_settled' : 'borrow_repaid';
          const counterpart = {
            id: `lb_settle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            kind: counterpartKind,
            person: entry.person,
            phone: entry.phone || null,
            contactId: entry.contactId || null,
            amount: entry.amount,
            note: 'Manual settlement',
            date: now,
            sourceSettledId: id,
          };
          return {
            lentBorrowed: [
              counterpart,
              ...s.lentBorrowed.map((l) => (l.id === id ? { ...l, settledAt: now } : l)),
            ],
          };
        }),

      // Settle the NET outstanding for a person in one shot.
      // Creates a single lent_settled / borrow_repaid entry for exactly the net
      // amount owed — avoids the per-entry settle bug where settling a full
      // original entry amount flips the balance negative.
      // opts.accountId — for a BORROW settle (net < 0), also book a real "Repayment"
      // expense debit on that account (money leaving now to clear the debt). Lent
      // settles, or borrow settles with no account, stay ledger-only.
      settlePersonBalance: (personKey, opts = {}) => {
        const person = get().getPersonBalances().find((p) => p.personKey === personKey);
        if (!person || person.net === 0) return;
        const netAmt = Math.abs(person.net);
        const isBorrowSettle = person.net < 0;
        const kind   = isBorrowSettle ? 'borrow_repaid' : 'lent_settled';
        const now    = new Date().toISOString();
        const booked = isBorrowSettle
          ? bookRepaymentExpense(get(), opts.accountId, netAmt, person.person, now)
          : null;
        set((s) => ({
          ...(booked ? { accounts: booked.accounts, transactions: booked.transactions } : {}),
          lentBorrowed: [
            {
              id:        `lb_settle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              kind,
              person:    person.person,
              phone:     person.phone    || null,
              contactId: person.contactId || null,
              amount:    netAmt,
              note:      'Manual settlement',
              date:      now,
              ...(booked ? { sourceTxnId: booked.txnId } : {}),
            },
            ...s.lentBorrowed,
          ],
        }));
      },

      // ----- SMS sync flags ---------------------------------------------
      setSmsAutoImport: (val) => set({ smsAutoImport: !!val }),
      setLastSmsSync: (ts) => set({ lastSmsSync: ts || Date.now() }),
      /**
       * Advance the SMS date cursor.
       * Only moves forward — never rewinds — so calling this multiple times
       * with out-of-order values is safe.
       */
      setLastSmsDate: (smsDateMs) => {
        if (!smsDateMs) return;
        const current = get().lastSmsDate || 0;
        if (smsDateMs > current) set({ lastSmsDate: smsDateMs });
      },

      // ----- retention / compaction -------------------------------------
      /**
       * Enforce the retention policy:
       *   • General categories: txns ≥ 3 months old → aggregated, raw row dropped
       *   • Lent/borrow categoryIds on ANY transaction: never aggregated; see LB_* branches below
       *   • drop aggregates older than 24 months
       *
       * Throttled: a no-op if we ran less than COMPACT_THROTTLE ago, unless
       * `force === true`.
       */
      compactTransactions: (force = false) => {
        const now = Date.now();
        const last = get().lastCompactedAt || 0;
        if (!force && now - last < COMPACT_THROTTLE) return;

        set((s) => {
          const rawCutoff = now - RAW_RETENTION_MS;
          const aggCutoffKey = monthKey(new Date(now - AGG_RETENTION_MS));

          // Split transactions into "still raw" and "to be aggregated".
          const stillRaw = [];
          const toAggregate = [];
          s.transactions.forEach((t) => {
            const ts = new Date(t.createdAt).getTime();
            // Ignored txns never contribute to aggregates; drop once past raw retention.
            if (t.isIgnored) {
              if (ts >= rawCutoff) stillRaw.push(t);
              return;
            }

            const cat = t.categoryId;
            // Real bank/SMS/manual txns tagged settled: same rule as manual IOUs — raw ≤ 1 yr, not aggregated.
            if (LB_SETTLED_CATS.has(cat)) {
              if (now - ts > LB_SETTLED_RETENTION_MS) return;
              stillRaw.push(t);
              return;
            }
            // Real txns tagged lent/borrowed: bypass 3-month compaction — stay raw until user changes category.
            if (LB_OUTSTANDING_CATS.has(cat)) {
              stillRaw.push(t);
              return;
            }

            // Group-memo transactions: informational only — drop without aggregating once past raw window.
            if (t.isGroupMemo) {
              if (ts >= rawCutoff) stillRaw.push(t);
              return;
            }

            // Split transactions: keep raw for the full 90-day window so the
            // lentBorrowed sourceTxnId references stay resolvable.
            if (t.isSplit && ts >= rawCutoff) {
              stillRaw.push(t);
              return;
            }
            if (ts >= rawCutoff) stillRaw.push(t);
            else toAggregate.push(t);
          });

          const lentBorrowedPruned = (s.lentBorrowed || []).filter((l) => {
            // Unsettled outstanding entries (lent/borrowed) kept forever.
            if (l.kind === 'lent' || l.kind === 'borrowed') return true;
            // Settlement entries (lent_settled / borrow_repaid) kept for 1 year from their date.
            return new Date(l.date).getTime() >= now - LB_SETTLED_RETENTION_MS;
          });

          // Merge new aggregates into the existing map.
          const newAggs = aggregate(toAggregate, s.groups);
          const merged = { ...s.monthlyAggregates };
          Object.entries(newAggs).forEach(([k, v]) => {
            if (!merged[k]) {
              merged[k] = v;
            } else {
              merged[k] = {
                totalSpend: (merged[k].totalSpend || 0) + v.totalSpend,
                totalIncome: (merged[k].totalIncome || 0) + v.totalIncome,
                byCategory: mergeAdd(merged[k].byCategory, v.byCategory),
                byAccount: mergeAdd(merged[k].byAccount, v.byAccount),
              };
            }
          });

          // Prune aggregates older than 24 months.
          Object.keys(merged).forEach((k) => {
            if (k < aggCutoffKey) delete merged[k];
          });

          // Strip preview-only debug fields from transactions older than 3 days.
          // TODO: remove this block before production
          const rawSmsCutoff = now - RAW_SMS_RETENTION_MS;
          const finalRaw = stillRaw.map((t) => {
            if (!t.rawSms) return t;
            if (new Date(t.createdAt).getTime() < rawSmsCutoff) {
              const { rawSms: _rs, rawSender: _rsd, ...rest } = t;
              return rest;
            }
            return t;
          });

          // ── Auto-prune groups untouched > 6 months AND fully settled ──
          // Outstanding (non-zero net) debt keeps a group alive so we never silently erase money owed.
          // Legacy groups missing lastActivityAt get a fresh clock (backfilled to now), not pruned now.
          const nowIso = new Date(now).toISOString();
          const groupInactiveCutoff = now - GROUP_INACTIVE_PRUNE_MS;
          const groupNet = {}; // groupId -> { personKey -> net (owed-to-me) }
          lentBorrowedPruned.forEach((l) => {
            if (!l.groupId) return;
            const pk = l.contactId || (l.person || '').trim().toLowerCase() || '?';
            const sign = l.kind === 'lent' || l.kind === 'borrow_repaid' ? 1
                       : l.kind === 'borrowed' || l.kind === 'lent_settled' ? -1 : 0;
            if (!groupNet[l.groupId]) groupNet[l.groupId] = {};
            groupNet[l.groupId][pk] = (groupNet[l.groupId][pk] || 0) + sign * l.amount;
          });
          const groupHasOutstanding = (gid) =>
            Object.values(groupNet[gid] || {}).some((v) => Math.abs(v) > 0.005);

          const prunedGroupIds = new Set();
          const keptGroups = (s.groups || [])
            .filter((g) => {
              const lastTs = new Date(g.lastActivityAt || nowIso).getTime();
              if (lastTs < groupInactiveCutoff && !groupHasOutstanding(g.id)) {
                prunedGroupIds.add(g.id);
                return false;
              }
              return true;
            })
            .map((g) => (g.lastActivityAt ? g : { ...g, lastActivityAt: nowIso })); // backfill clock

          const finalRawPruned = prunedGroupIds.size === 0 ? finalRaw : finalRaw.map((t) => {
            if (!t.groupId || !prunedGroupIds.has(t.groupId)) return t;
            const { groupId: _g, groupSplit: _gs, isGroupMemo: _m, ...rest } = t;
            return rest;
          });
          const lbFinal = prunedGroupIds.size === 0
            ? lentBorrowedPruned
            : lentBorrowedPruned.filter((l) => !l.groupId || !prunedGroupIds.has(l.groupId));

          return {
            transactions: finalRawPruned,
            lentBorrowed: lbFinal,
            monthlyAggregates: merged,
            groups: keptGroups,
            lastCompactedAt: now,
          };
        });
      },

      // ----- derived selectors ------------------------------------------
      // Single source of truth — same assets−CC-liability rule as the Accounts
      // screen. Don't re-sum balances here (that would drift from net worth).
      getTotalBalance: () => selectEPurseNetWorth(get()),

      getTotalLent: () =>
        get().getPersonBalances()
          .filter((p) => p.net > 0)
          .reduce((s, p) => s + p.net, 0),

      getTotalBorrowed: () =>
        get().getPersonBalances()
          .filter((p) => p.net < 0)
          .reduce((s, p) => s + Math.abs(p.net), 0),

      /**
       * Monthly spend — uses raw transactions if any are present for that
       * month, otherwise falls back to the aggregate.
       * Lent/borrow categories are excluded from spend totals.
       */
      // Monthly SPEND = expenses − refunds. A refund/cashback credit (isRefund)
      // nets the spend down; income credits do NOT (see getMonthlyIncome).
      getMonthlySpend: (date = new Date()) => {
        const groups = get().groups;
        const txns = get().transactions.filter(
          (t) =>
            !t.isIgnored &&
            countsForSpend(t) &&
            !NON_SPEND_CATS.has(t.categoryId) &&
            !isGroupExcluded(t, groups) &&
            isSameMonth(t.createdAt, date)
        );
        if (txns.length > 0) {
          return Math.max(0, txns.reduce((sum, t) => sum + spendContribution(t), 0));
        }
        return get().monthlyAggregates[monthKey(date)]?.totalSpend || 0;
      },

      // Monthly INCOME = credits that are NOT refunds (salary, interest, P2P-in).
      getMonthlyIncome: (date = new Date()) => {
        const groups = get().groups;
        const txns = get().transactions.filter(
          (t) =>
            !t.isIgnored &&
            t.type === TRANSACTION_TYPES.CREDIT &&
            !isRefundCredit(t) &&
            !NON_SPEND_CATS.has(t.categoryId) &&
            !isGroupExcluded(t, groups) &&
            isSameMonth(t.createdAt, date)
        );
        if (txns.length > 0) return txns.reduce((s, t) => s + t.amount, 0);
        return get().monthlyAggregates[monthKey(date)]?.totalIncome || 0;
      },

      // Monthly REFUNDS = sum of refund/cashback credits (isRefund) — the amount
      // that nets down Spent. Raw-only (aggregates fold it into totalSpend, not
      // stored separately), so older months return 0.
      getMonthlyRefunds: (date = new Date()) => {
        const groups = get().groups;
        return get().transactions
          .filter(
            (t) =>
              !t.isIgnored &&
              isRefundCredit(t) &&
              !NON_SPEND_CATS.has(t.categoryId) &&
              !isGroupExcluded(t, groups) &&
              isSameMonth(t.createdAt, date)
          )
          .reduce((s, t) => s + (t.amount || 0), 0);
      },

      /**
       * Category breakdown for a month.
       * If raw transactions exist for that month, use them. Otherwise build
       * the breakdown from the stored aggregate.
       */
      getCategoryBreakdown: (date = new Date()) => {
        const cats = get().categories;
        const month = monthKey(date);
        const groups = get().groups;
        const raw = get().transactions.filter(
          (t) =>
            !t.isIgnored &&
            countsForSpend(t) &&
            !NON_SPEND_CATS.has(t.categoryId) &&
            !isGroupExcluded(t, groups) &&
            isSameMonth(t.createdAt, date)
        );

        let totals;
        let grandTotal;
        if (raw.length > 0) {
          totals = {};
          // Refunds keep their (purchase) category, so they net that category down.
          raw.forEach((t) => {
            totals[t.categoryId] = (totals[t.categoryId] || 0) + spendContribution(t);
          });
          // Clamp any category that went net-negative (refunds > spend that month).
          Object.keys(totals).forEach((k) => { if (totals[k] < 0) totals[k] = 0; });
          grandTotal = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
        } else {
          const agg = get().monthlyAggregates[month];
          if (!agg) return [];
          // byCategory may include LB entries from historical aggregation — strip them
          totals = {};
          Object.entries(agg.byCategory || {}).forEach(([catId, val]) => {
            if (!NON_SPEND_CATS.has(catId)) totals[catId] = val;
          });
          grandTotal = agg.totalSpend || 1;
        }

        return cats
          .filter((c) => !NON_SPEND_CATS.has(c.id))
          .map((c) => ({ ...c, total: totals[c.id] || 0, percent: ((totals[c.id] || 0) / grandTotal) * 100 }))
          .filter((c) => c.total > 0)
          .sort((a, b) => b.total - a.total);
      },

      getRecentTransactions: (limit = 5) =>
        [...get().transactions]
          .filter((t) => !t.isIgnored && !t.isHidden)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, limit),

      /**
       * Live current-month budget usage. Returns null if no plan is set.
       * Actuals are computed from the transactions list directly so they're
       * always in sync with edits / deletes / ignores. Excludes lent/borrow
       * categories from totalActual to match how the dashboard reports spend.
       */
      getBudgetUsage: () => {
        const s = get();
        if (!s.budget) return null;

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        // Spend rolled up to first-level parent categories. Self & lent/borrow
        // are excluded entirely — they aren't expenses. `allExpense` is every
        // real expense this month (any category) so we can surface the slice
        // that falls OUTSIDE the budgeted categories.
        const byParent = {};
        let allExpense = 0;
        s.transactions.forEach((t) => {
          if (t.isIgnored) return;
          if (new Date(t.createdAt).getTime() < monthStart) return;
          // Expenses add; refunds (isRefund credits) subtract from their parent —
          // a returned purchase lowers that category's budget usage.
          if (!countsForSpend(t)) return;
          if (NON_SPEND_CATS.has(t.categoryId)) return; // self + lent/borrow
          if (isGroupExcluded(t, s.groups)) return;
          const amt = spendContribution(t); // +expense share, −refund amount
          allExpense += amt;
          const pid = parentCatId(t);
          if (BUDGETABLE_PARENT_IDS.has(pid)) byParent[pid] = (byParent[pid] || 0) + amt;
        });
        // A parent net-negative from refunds shouldn't read as "used" — floor at 0.
        Object.keys(byParent).forEach((k) => { if (byParent[k] < 0) byParent[k] = 0; });
        if (allExpense < 0) allExpense = 0;

        // Total cap & actual are DERIVED from the category lines — the total is
        // never edited directly (it is the sum of the per-category caps).
        const perCategory = {};
        let totalCap = 0;
        let totalActual = 0;
        Object.entries(s.budget.perCategory).forEach(([catId, cap]) => {
          const capNum = Number(cap) || 0;
          const actual = byParent[catId] || 0;
          totalCap += capNum;
          totalActual += actual;
          perCategory[catId] = {
            cap: capNum,
            actual,
            pct:       capNum > 0 ? (actual / capNum) * 100 : 0,
            remaining: Math.max(0, capNum - actual),
            over:      actual > capNum,
            overshoot: Math.max(0, actual - capNum),
          };
        });
        const totalCapFinal = totalCap > 0 ? totalCap : null;

        // Expense that falls OUTSIDE the budgeted categories (unbudgeted parents,
        // transfers, unassigned…). Self & LB are already excluded from allExpense.
        const unbudgeted = Math.max(0, allExpense - totalActual);

        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dayOfMonth     = now.getDate();
        const daysLeftInMonth = lastDayOfMonth - dayOfMonth;
        const daysElapsedPct  = (dayOfMonth / lastDayOfMonth) * 100;

        return {
          monthKey: monthKey(now),
          total: {
            cap: totalCapFinal,
            actual: totalActual,
            pct: totalCapFinal ? (totalActual / totalCapFinal) * 100 : 0,
            remaining: totalCapFinal != null ? Math.max(0, totalCapFinal - totalActual) : null,
            over: totalCapFinal != null && totalActual > totalCapFinal,
            overshoot: (totalCapFinal != null && totalActual > totalCapFinal) ? (totalActual - totalCapFinal) : 0,
          },
          perCategory,
          allExpense,
          unbudgeted,
          daysLeftInMonth,
          daysElapsedPct,
          dayOfMonth,
          lastDayOfMonth,
        };
      },

      /**
       * Average monthly spend for a FIRST-LEVEL (parent) budget category over
       * the last N months. Rolls up child legacy ids (e.g. groceries → food)
       * from monthlyAggregates so the figure matches the parent-based budget.
       * Used to suggest caps in the plan form.
       */
      getParentCategoryAverage: (parentId, months = 3) => {
        const s = get();
        const now = new Date();
        let total = 0;
        let count = 0;
        for (let i = 1; i <= months; i++) {
          const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const agg = s.monthlyAggregates[monthKey(d)];
          if (!agg?.byCategory) continue;
          let monthSum = 0;
          let has = false;
          Object.entries(agg.byCategory).forEach(([cid, amt]) => {
            if (CAT_MAPS.legacyToParentId[cid] === parentId) { monthSum += amt; has = true; }
          });
          if (has) { total += monthSum; count += 1; }
        }
        return count > 0 ? Math.round(total / count) : 0;
      },

      /**
       * Current-month spend for a parent budget category, broken down by its
       * child (sub) categories. Powers the budget category drill-down sheet.
       * Self & lent/borrow are excluded. Returns [{ label, total }] desc.
       */
      getBudgetChildBreakdown: (parentId, date = new Date()) => {
        const s = get();
        const catName = (id) => s.categories.find((c) => c.id === id)?.name;
        const rows = {};
        s.transactions.forEach((t) => {
          if (t.isIgnored) return;
          if (!countsForSpend(t)) return;              // expense debit or refund credit
          if (NON_SPEND_CATS.has(t.categoryId)) return;
          if (!isSameMonth(t.createdAt, date)) return;
          if (parentCatId(t) !== parentId) return;
          const label = t.childCategory || catName(t.categoryId) || 'Other';
          rows[label] = (rows[label] || 0) + spendContribution(t); // refund nets its child
        });
        return Object.entries(rows)
          .map(([label, total]) => ({ label, total: Math.max(0, total) }))
          .filter((r) => r.total > 0)
          .sort((a, b) => b.total - a.total);
      },

      /**
       * Current-month expense that falls OUTSIDE the budgeted categories,
       * grouped by first-level category. Powers the "Unbudgeted expenses"
       * card / drill-down. Self & lent/borrow excluded.
       */
      getUnbudgetedBreakdown: (date = new Date()) => {
        const s = get();
        if (!s.budget) return [];
        const budgeted = new Set(Object.keys(s.budget.perCategory));
        const labelFor = (pid) => {
          if (pid === 'transfers') return 'Transfers';
          if (pid === 'other') return 'Other';
          return s.categories.find((c) => c.id === pid)?.name || 'Other';
        };
        const rows = {};
        s.transactions.forEach((t) => {
          if (t.isIgnored) return;
          if (!countsForSpend(t)) return;              // expense debit or refund credit
          if (NON_SPEND_CATS.has(t.categoryId)) return;
          if (isGroupExcluded(t, s.groups)) return;
          if (!isSameMonth(t.createdAt, date)) return;
          const pid = parentCatId(t);
          if (budgeted.has(pid)) return; // already tracked by a budget line
          const label = labelFor(pid);
          rows[label] = (rows[label] || 0) + spendContribution(t); // refund nets
        });
        return Object.entries(rows)
          .map(([label, total]) => ({ label, total: Math.max(0, total) }))
          .filter((r) => r.total > 0)
          .sort((a, b) => b.total - a.total);
      },

      /**
       * Average monthly spend for a category over the last N months, drawn from
       * monthlyAggregates. Returns 0 if there's no historical data.
       * Used to seed budget suggestions in the form.
       */
      getCategoryAverage: (categoryId, months = 3) => {
        const s = get();
        const now = new Date();
        let total = 0;
        let count = 0;
        for (let i = 1; i <= months; i++) {
          const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const key = monthKey(d);
          const agg = s.monthlyAggregates[key];
          if (agg && agg.byCategory && agg.byCategory[categoryId] != null) {
            total += agg.byCategory[categoryId];
            count += 1;
          }
        }
        return count > 0 ? Math.round(total / count) : 0;
      },

      /** Top N categories by historical avg spend — used to seed empty-form suggestions. */
      getTopCategoriesByAverage: (limit = 6) => {
        const s = get();
        const now = new Date();
        const totals = {};
        const counts = {};
        for (let i = 1; i <= 3; i++) {
          const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
          const agg = s.monthlyAggregates[monthKey(d)];
          if (!agg?.byCategory) continue;
          Object.entries(agg.byCategory).forEach(([catId, amt]) => {
            if (NON_SPEND_CATS.has(catId)) return;
            totals[catId] = (totals[catId] || 0) + amt;
            counts[catId] = (counts[catId] || 0) + 1;
          });
        }
        return Object.entries(totals)
          .map(([catId, total]) => ({ categoryId: catId, average: Math.round(total / counts[catId]) }))
          .sort((a, b) => b.average - a.average)
          .slice(0, limit);
      },

      /**
       * Returns per-person cumulative net balance across lentBorrowed entries.
       *
       * ─── Identity: PHONE FIRST, then name ───────────────────────────────
       * The phone number is the authoritative identifier. Consequences:
       *   • Same phone, different names → ONE person. A contact saved as
       *     "Rohit" and later as "Rohit Sharma" (or renamed in the phonebook)
       *     must not split into two sections. The displayed name is the one
       *     from the person's MOST RECENT entry, so a rename takes effect.
       *   • Different phones → DIFFERENT people, even when the names match.
       *     Two unrelated "Rohit"s stay separate; previously a shared name
       *     merged them (name was treated as an equal-weight identifier), which
       *     silently pooled two people's debts.
       *   • Phones are compared by their LAST 10 DIGITS, so "+91 99999 12345",
       *     "099999 12345" and "9999912345" are the same person — a country
       *     code or trunk prefix alone must not fork someone into two sections.
       *   • `contactId` is a second authoritative id, unioned with the phone
       *     when both appear on one entry (so a later contactId-only entry
       *     still finds the phone's group).
       *   • Entries carrying NEITHER phone nor contactId fall back to the
       *     lowercased name, and attach to a phone-bearing person only when
       *     exactly ONE such person has that name (unambiguous). If the name is
       *     ambiguous they stay their own group rather than guessing — a wrong
       *     merge corrupts two balances, a missed merge is merely untidy.
       *
       * Grouping matters beyond cosmetics: a settlement landing in a different
       * group from its origin makes the net negative with no matching `lent`,
       * so it shows up as the OPPOSITE kind in the totals.
       *
       * Returns array of { personKey, person, contactId, phone, lent, borrowed,
       * net, entries } sorted by absolute net (largest first).
       */
      getPersonBalances: () => {
        const entries = get().lentBorrowed;

        // Last 10 digits — drops country code / trunk prefix so the same mobile
        // written any which way collapses to one key. Shorter numbers (landline
        // fragments, partial data) are used as-is.
        const normPhone = (p) => {
          const d = onlyDigits(p);
          if (!d.length) return null;
          return d.length > 10 ? d.slice(-10) : d;
        };
        const normName = (n) => {
          const t = (n || '').trim().toLowerCase();
          return t.length ? t : null;
        };

        // ─── Union-find, but ONLY over authoritative ids (phone/contactId) ──
        // Name is deliberately NOT a union token: unioning by name is what let
        // two different phones bleed into one person.
        const parent = new Map(); // token → its parent token
        const makeSet = (x) => { if (!parent.has(x)) parent.set(x, x); };
        const find = (x) => {
          let r = x;
          while (parent.get(r) !== r) r = parent.get(r);
          let cur = x; // path compression
          while (parent.get(cur) !== r) {
            const next = parent.get(cur);
            parent.set(cur, r);
            cur = next;
          }
          return r;
        };
        const union = (a, b) => {
          const ra = find(a);
          const rb = find(b);
          if (ra !== rb) parent.set(ra, rb);
        };

        // Pass 1 — register authoritative tokens; link phone ↔ contactId when
        // they co-occur on one entry (same person, two ids).
        const strongToken = new Array(entries.length); // null for name-only entries
        entries.forEach((e, i) => {
          const ph  = normPhone(e.phone);
          const cid = e.contactId ? `cid:${e.contactId}` : null;
          const pht = ph ? `ph:${ph}` : null;
          if (pht) makeSet(pht);
          if (cid) makeSet(cid);
          if (pht && cid) union(pht, cid);
          // Phone wins as the primary token when both exist.
          strongToken[i] = pht || cid || null;
        });

        // Pass 2 — map each name to the authoritative groups that use it, so a
        // name-only entry can attach when the name points at exactly one person.
        const nameToRoots = new Map(); // name → Set<root>
        entries.forEach((e, i) => {
          const t = strongToken[i];
          const nm = normName(e.person);
          if (!t || !nm) return;
          if (!nameToRoots.has(nm)) nameToRoots.set(nm, new Set());
          nameToRoots.get(nm).add(find(t));
        });

        // Pass 3 — resolve every entry to its final group token.
        const entryRoot = new Array(entries.length);
        entries.forEach((e, i) => {
          if (strongToken[i]) { entryRoot[i] = find(strongToken[i]); return; }
          const nm = normName(e.person);
          if (!nm) { const anon = `anon:${i}`; makeSet(anon); entryRoot[i] = anon; return; }
          const candidates = nameToRoots.get(nm);
          if (candidates && candidates.size === 1) {
            entryRoot[i] = [...candidates][0]; // unambiguous → join that person
          } else {
            const nmt = `nm:${nm}`;            // ambiguous or name-only → own group
            makeSet(nmt);
            entryRoot[i] = find(nmt);
          }
        });

        // ─── Aggregate per group ───────────────────────────────────────────
        const groups = new Map(); // root token → record
        const latestAt = new Map(); // root token → timestamp of the name we kept
        entries.forEach((e, i) => {
          const root = entryRoot[i];
          if (!groups.has(root)) {
            groups.set(root, {
              personKey: root,
              person:    e.person,
              contactId: e.contactId || null,
              phone:     e.phone || null,
              lent:      0,
              borrowed:  0,
              entries:   [],
            });
            latestAt.set(root, -Infinity);
          }
          const rec = groups.get(root);
          // Promote the richest contact info we've seen in this group.
          if (e.contactId && !rec.contactId) rec.contactId = e.contactId;
          if (e.phone && !rec.phone)         rec.phone     = e.phone;
          // Display the name from the MOST RECENT entry, so renaming a contact
          // (or saving a fuller name later) updates the section label. Undated
          // entries can't win against a dated one.
          const at = e.date ? new Date(e.date).getTime() : NaN;
          const ts = Number.isNaN(at) ? -Infinity : at;
          if (e.person && ts >= latestAt.get(root)) {
            rec.person = e.person;
            latestAt.set(root, ts);
          }

          // Additive formula — every entry contributes to net:
          //   net = Σlent - Σlent_settled - Σborrowed + Σborrow_repaid
          if (e.kind === 'lent')          rec.lent     += e.amount;
          if (e.kind === 'lent_settled')  rec.lent     -= e.amount;
          if (e.kind === 'borrowed')      rec.borrowed += e.amount;
          if (e.kind === 'borrow_repaid') rec.borrowed -= e.amount;
          rec.entries.push(e);
        });

        return [...groups.values()]
          .map((r) => ({ ...r, net: r.lent - r.borrowed }))
          .filter((r) => r.entries.length > 0)
          .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
      },

      // ----- danger zone -------------------------------------------------
      resetAll: () =>
        set({
          accounts: [],
          transactions: [],
          monthlyAggregates: {},
          categories: DEFAULT_CATEGORIES,
          lentBorrowed: [],
          smsAutoImport: false,
          lastSmsSync: null,
          lastSmsDate: null,
          lastCompactedAt: null,
          suppressedSmsIds: [],
          ccHandledSmsIds: [],
          manualTxnSeq: 0,
          userName: '',
          userPhones: [],
          hasOnboarded: false,
          smsPermissionGranted: false,
          contactsPermissionGranted: false,
          themeId: DEFAULT_THEME_ID,
          darkMode: false,
          showWeeklySummary: true,
          weeklyRecapHandled: null,
          pendingWeeklyRecap: null,
          showMonthlyRecap: true,
          recapMonthHandled: null,
          monthlyRecapCardDismissed: null,
          pendingMonthlyRecap: null,
          recapOptions: { includePrivate: true, includeGroups: true, includeTxnList: false },
          notificationIds: {},
          ccDueReminderIds: {},
          subscriptionHikesNotified: [],
          budget: null,
          budgetHistory: {},
          budgetStreak: { current: 0, best: 0, lastResetMonth: null },
          budgetBreachNotified: {},
          pendingCelebration: null,
          lastMidmonthNudgeMonth: null,
          xp: 0,
          reviewStreak: { current: 0, best: 0, lastReviewDate: null },
        }),
    }),
    {
      name: '@ePurse:store',
      // Bump this whenever the schema changes in a way that requires a wipe.
      // The migration below kills any stale demo / seed data that an older
      // build might have written to AsyncStorage before we removed the seeds.
      version: 23,
      migrate: (persistedState, version) => {
        let state = persistedState ? { ...persistedState } : {};

        // Earlier versions seeded dummy accounts, transactions and IOUs.
        if (!persistedState || version < 2) {
          state = {
            ...state,
            accounts: [],
            transactions: [],
            lentBorrowed: [],
            monthlyAggregates: {},
            lastSmsSync: null,
            lastSmsDate: null,
            lastCompactedAt: null,
            suppressedSmsIds: [],
            ccHandledSmsIds: [],
            manualTxnSeq: 0,
            // Keep userName/hasOnboarded/smsPermissionGranted if present so
            // the user isn't bounced back into onboarding after the wipe.
          };
        }

        if (version < 4) {
          state = {
            ...state,
            categories: ensureRequiredCategories(state.categories || []),
          };
        }

        if (version < 5) {
          state = {
            ...state,
            suppressedSmsIds: state.suppressedSmsIds ?? [],
            lastSmsDate: state.lastSmsDate ?? null,
          };
        }

        if (version < 6) {
          const fromTxns = maxManualIdSuffixFromTransactions(state.transactions || []);
          state = {
            ...state,
            manualTxnSeq: Math.max(state.manualTxnSeq ?? 0, fromTxns),
          };
        }

        if (version < 7) {
          state = {
            ...state,
            contactsPermissionGranted: state.contactsPermissionGranted ?? false,
          };
        }

        // v8: lentBorrowed entries gain optional contactId, phone fields — no data wipe needed
        if (version < 8) {
          state = {
            ...state,
            lentBorrowed: (state.lentBorrowed || []).map((l) => ({
              contactId: null,
              phone: null,
              ...l,
            })),
          };
        }

        // v9: theme preferences
        if (version < 9) {
          state = {
            ...state,
            themeId: state.themeId ?? DEFAULT_THEME_ID,
            darkMode: state.darkMode ?? false,
          };
        }

        // v10: fix mis-linked transactions caused by the old type-fallback in
        // matchAccount. Any transaction whose accountMask doesn't match its
        // linked account's mask gets re-linked to the correct account
        // (matched by mask). Creates a new account entry when needed.
        if (version < 10) {
          const accounts = [...(state.accounts || [])];
          const accountById = new Map(accounts.map((a) => [a.id, a]));
          const colorByType = {
            [ACCOUNT_TYPES.BANK]: '#1E40AF',
            [ACCOUNT_TYPES.CREDIT_CARD]: '#6D28D9',
            [ACCOUNT_TYPES.WALLET]: '#10B981',
            [ACCOUNT_TYPES.CASH]: '#F59E0B',
          };
          const transactions = (state.transactions || []).map((t) => {
            if (!t.accountMask) return t;
            const linkedAccount = t.accountId ? accountById.get(t.accountId) : null;
            if (linkedAccount && linkedAccount.mask === t.accountMask) return t;
            // Find an account with the correct mask
            let correct = accounts.find((a) => a.mask === t.accountMask);
            if (!correct) {
              // Create a new account for this mask
              correct = {
                id: `acct_migrate_${t.accountMask}_${Math.random().toString(36).slice(2, 6)}`,
                type: t.accountType || ACCOUNT_TYPES.BANK,
                name: `${t.accountType || 'BANK'} ··${t.accountMask}`,
                bankName: null,
                mask: t.accountMask,
                balance: 0,
                color: colorByType[t.accountType] || '#6B7280',
              };
              accounts.push(correct);
              accountById.set(correct.id, correct);
            }
            return { ...t, accountId: correct.id };
          });
          state = { ...state, accounts, transactions };
        }

        // v11: recompute every account balance by replaying all non-ignored
        // transactions. Fixes balances that drifted due to v10 re-linking,
        // manually-added accounts, or any other historic inconsistency.
        if (version < 11) {
          const accounts = [...(state.accounts || [])];
          const transactions = state.transactions || [];
          const balanceMap = new Map(accounts.map((a) => [a.id, 0]));
          for (const t of transactions) {
            if (t.isIgnored || !t.accountId) continue;
            const sign = t.type === TRANSACTION_TYPES.DEBIT ? -1 : 1;
            balanceMap.set(t.accountId, (balanceMap.get(t.accountId) || 0) + sign * t.amount);
          }
          state = {
            ...state,
            accounts: accounts.map((a) => ({ ...a, balance: balanceMap.get(a.id) ?? 0 })),
          };
        }

        // v12: seed budget feature defaults so existing users have a place
        // for the plan/history/streak/breach-dedup/celebration/nudge state after upgrading.
        if (version < 12) {
          state = {
            ...state,
            budget:                 state.budget                 ?? null,
            budgetHistory:          state.budgetHistory          ?? {},
            budgetStreak:           state.budgetStreak           ?? { current: 0, best: 0, lastResetMonth: null },
            budgetBreachNotified:   state.budgetBreachNotified   ?? {},
            pendingCelebration:     state.pendingCelebration     ?? null,
            lastMidmonthNudgeMonth: state.lastMidmonthNudgeMonth ?? null,
          };
        }

        // v13: Daily Queue — add isReviewed to existing transactions.
        // SMS transactions from the last 72 hours land as unreviewed so the
        // queue isn't flooded; everything older (and all manual entries) is
        // pre-marked reviewed. Seed xp and reviewStreak for new users.
        if (version < 13) {
          const cutoffMs = Date.now() - 3 * 24 * 60 * 60 * 1000; // 72 hours ago
          state = {
            ...state,
            xp: state.xp ?? 0,
            reviewStreak: state.reviewStreak ?? { current: 0, best: 0, lastReviewDate: null },
            transactions: (state.transactions || []).map((t) => ({
              ...t,
              isReviewed: t.isReviewed !== undefined
                ? t.isReviewed
                : (t.source !== 'sms' || new Date(t.createdAt).getTime() < cutoffMs),
            })),
          };
        }

        if (version < 14) {
          state = {
            ...state,
            userCustomRules: state.userCustomRules ?? {},
          };
        }

        if (version < 15) {
          // Backfill bankName for accounts whose names were created with a
          // generic type fallback (e.g. "Bank ··1234", "Credit Card ··5678")
          // instead of the real bank name. We derive the correct name from
          // the bankName field that was already stored on each linked transaction.
          const GENERIC_PREFIXES = new Set(['Bank', 'Credit Card', 'Digital Wallet', 'Cash']);
          const txns = state.transactions || [];

          const updatedAccounts = (state.accounts || []).map((acct) => {
            // Skip accounts that already have an explicit bankName.
            if (acct.bankName) return acct;

            // Determine if the current name prefix is just the account-type
            // fallback rather than a real bank name.
            const prefix = acct.name?.includes('··')
              ? acct.name.split('··')[0].trim()
              : acct.name?.trim() ?? '';
            if (!GENERIC_PREFIXES.has(prefix)) return acct;

            // Collect bankName values from all SMS transactions linked to
            // this account, then pick the most frequently occurring one.
            const freq = {};
            txns.forEach((t) => {
              if (t.accountId === acct.id && t.bankName) {
                freq[t.bankName] = (freq[t.bankName] || 0) + 1;
              }
            });
            const entries = Object.entries(freq);
            if (!entries.length) return acct;

            const bestBank = entries.sort((a, b) => b[1] - a[1])[0][0];
            const newName  = acct.mask ? `${bestBank} ··${acct.mask}` : bestBank;

            return { ...acct, bankName: bestBank, name: newName };
          });

          state = { ...state, accounts: updatedAccounts };
        }

        if (version < 16) {
          // Remove phantom debit transactions that were created from CC bill
          // reminder SMSes before the CC_BILL_REMINDER_REGEX fix. These are
          // identifiable because the transaction note (original SMS text) still
          // matches the reminder pattern without any past-tense action verb.
          const CC_REMINDER_MIG =
            /\b(?:(?:total|min(?:imum)?|amt|amount|payment|payable)\s+(?:amount\s+)?due(?:s)?|due\s*[:\s]\s*\d+|due\s+(?:date|on|by)\s+\d+|outstanding(?:\s+(?:amount|balance|due))?|pay(?:able)?\s+(?:instantly\s+)?by\s+\d+|pay\s+your\s+(?:bill|credit\s+card)|kindly\s+pay|please\s+pay|settle\s+(?:by|your|outstanding)|bill\s+generated|statement\s+(?:generated|is\s+sent))\b/i;
          const CC_HARD_MIG =
            /\b(?:debited|credited|spent|withdrawn|deducted|deposited|refunded|transferred)\b|\bpaid\s+(?:to|via|at|from)\b/i;

          const cleanedTxns = (state.transactions || []).filter((txn) => {
            if (txn.source !== 'sms' || !txn.note) return true;
            const isPhantom =
              CC_REMINDER_MIG.test(txn.note) &&
              !CC_HARD_MIG.test(txn.note) &&
              /credit\s*card|cc\b/i.test(txn.note);
            return !isPhantom;
          });

          state = { ...state, transactions: cleanedTxns };
        }

        // v18: budget moves to first-level (parent) categories. Remap any
        // existing per-category caps to parent ids (groceries → food, etc.),
        // drop non-budgetable keys, and re-derive the total from the sum.
        if (version < 18) {
          let nextBudget = state.budget;
          if (nextBudget?.perCategory) {
            const remapped = {};
            Object.entries(nextBudget.perCategory).forEach(([cid, cap]) => {
              const pid = CAT_MAPS.legacyToParentId[cid] || cid;
              if (!BUDGETABLE_PARENT_IDS.has(pid)) return; // drop transfers/income/etc
              remapped[pid] = (remapped[pid] || 0) + (Number(cap) || 0);
            });
            // A plan that mapped to no budgetable categories (e.g. an old
            // total-only plan, or one with only transfers/income) can't be
            // represented in the parent model — clear it so the user re-creates.
            if (Object.keys(remapped).length === 0) {
              nextBudget = null;
            } else {
              const caps = sumCaps(remapped);
              nextBudget = { ...nextBudget, perCategory: remapped, totalCap: caps > 0 ? caps : null };
            }
          }
          state = { ...state, budget: nextBudget, lastBudgetPlan: state.lastBudgetPlan ?? null };
        }

        // v17: self-transfer support. Seed userPhones (used to detect transfers
        // to the user's own linked mobile) and ensure the new `self` category
        // exists so own-account transfers can be excluded from spend/income.
        if (version < 17) {
          state = {
            ...state,
            userPhones: state.userPhones ?? [],
            categories: ensureRequiredCategories(state.categories || []),
          };
        }

        // v19: remove phantom transactions the OLDER parser booked before the
        // future-scheduled-debit, credit-limit-increase, and expanded
        // promotional-offer fixes. Identified purely from the stored `note`
        // (the raw SMS text) — no past-tense action verb means money never
        // moved, so the row was never a real transaction.
        //
        // FROZEN logic: these regexes are intentionally inlined (not imported
        // from messageParser) so this one-time migration never changes meaning
        // as the live parser evolves. Mirrors the v16 CC-reminder cleanup.
        //
        // Caveats kept deliberately conservative to avoid deleting real data:
        //   • only SMS-sourced rows with a note are considered;
        //   • user-touched rows (edited category / lent-borrow locked) are kept;
        //   • notes are stored truncated to ~120 chars, and rows older than
        //     ~90 days may already be compacted into monthlyAggregates — those
        //     are not reachable here, so this cleans recent/raw phantoms only.
        if (version < 19) {
          // (a) Purely-future / scheduled debit (e.g. "EMI scheduled for
          //     auto-debit", "will be debited") with NO completed verb left
          //     after stripping the future clause.
          const FUTURE_MIG =
            /will\s+be\s+(?:debited|credited|deducted|withdrawn|transferred)|(?:is\s+)?scheduled\s+for\s+(?:auto[\s-]?debit|debit|payment)|is\s+due\s+for\s+(?:auto[\s-]?debit|payment)/i;
          const COMPLETED_VERB_MIG =
            /\b(?:debited|credited|deposited|withdrawn|deducted|refunded|spent)\b/i;
          // (b) Credit / card / loan limit increase — never a transaction.
          const LIMIT_INCREASE_MIG =
            /\b(?:credit|card|loan)\s+limit\b[\s\S]{0,60}\bincreased\b|\bincreased\s+(?:from|to)\s+(?:rs\.?|inr|₹)/i;
          // (c) Promotional / EMI-conversion / loan-offer / URL spam.
          const PROMO_MIG =
            /\beligible\s+for\s+(?:emi|flexi|conversion|offer|cashback|reward|discount)\b|\bconvert\s+(?:now|to|into|your|bill)\b|\bflexi[\s-]*emi\b|\bconvert\s+(?:spends?|bill\s+of)\b|\breward\s+points?\s+eligible\b|\bpre[- ]?approved\b|\bget\s+(?:an?\s+)?(?:instant\s+)?(?:loan|credit)\s+of\b|\bloan\s+of\s+up\s+to\b|\binstant\s+disbursal\b|\busing\s+code\b|\bdownload\s+the\s+\w+\s+app\b|https?:\/\//i;

          const isPhantom19 = (note) => {
            if (FUTURE_MIG.test(note)) {
              const sansFuture = note.replace(new RegExp(FUTURE_MIG.source, 'gi'), ' ');
              if (!COMPLETED_VERB_MIG.test(sansFuture)) return true;
            }
            return LIMIT_INCREASE_MIG.test(note) || PROMO_MIG.test(note);
          };

          const txns = state.transactions || [];
          const kept = txns.filter((t) => {
            if (!t || t.source !== 'sms' || !t.note) return true;     // manual / note-less → keep
            if (t.userEditedCategory || t.lbLocked) return true;      // user owns it → keep
            return !isPhantom19(t.note);
          });

          if (kept.length !== txns.length) {
            // Rows were removed — replay balances so a deleted debit/credit
            // doesn't leave its delta baked into account balances (cf. v11).
            const accounts = [...(state.accounts || [])];
            const balanceMap = new Map(accounts.map((a) => [a.id, 0]));
            for (const t of kept) {
              if (t.isIgnored || !t.accountId) continue;
              const sign = t.type === TRANSACTION_TYPES.DEBIT ? -1 : 1;
              balanceMap.set(t.accountId, (balanceMap.get(t.accountId) || 0) + sign * t.amount);
            }
            state = {
              ...state,
              transactions: kept,
              accounts: accounts.map((a) => ({ ...a, balance: balanceMap.get(a.id) ?? 0 })),
            };
          }
        }

        // v20: fresh-start onboarding fields. Existing users keep their data as-is
        // (we don't retroactively archive their history) — just seed the new keys
        // and skip the review-queue welcome tutorial (they've already used the app).
        if (version < 20) {
          state = {
            ...state,
            archivedTransactions: Array.isArray(state.archivedTransactions) ? state.archivedTransactions : [],
            welcomeReviewSeen: true,
            planBannerDismissed: state.planBannerDismissed ?? false,
          };
        }

        // NOTE: fresh-start is intentionally NOT applied retroactively. Existing users
        // keep all their transactions/balances as-is — we never migrate their history
        // into the archive. The clean slate is for NEW onboards only, enforced at
        // ingestion time (the `userOnboardedAt` gate in `ingestMessage`).

        // v22: debit-card↔bank unification. Seed the new fields — `aliasMasks` on
        // every account (linked card masks fold into a bank; see linkDebitCardToBank)
        // and the `declinedAccountLinks` ledger. Existing standalone Debit Card
        // accounts are LEFT AS-IS (no auto-merge) — the user merges them via the
        // onboarding/Accounts suggestion or the manual link, per the agreed UX.
        if (version < 22) {
          state = {
            ...state,
            accounts: (state.accounts || []).map((a) => ({
              aliasMasks: Array.isArray(a.aliasMasks) ? a.aliasMasks : [],
              ...a,
            })),
            declinedAccountLinks: Array.isArray(state.declinedAccountLinks) ? state.declinedAccountLinks : [],
          };
        }

        if (version < 23) {
          // `note` used to hold a 117-char copy of the bank SMS for every ingested
          // transaction, so the detail sheet's "Note" row showed the bank's message and
          // the edit form prefilled it. Move that text to `smsText` (its own field, still
          // searchable) and leave `note` empty unless the user actually typed one.
          //
          // Only `source === 'sms'` rows are touched: a manual transaction's note has
          // always been the user's, and group/LB rows use note for their own label
          // ("Group · Trip", "Manual settlement").
          // A user CAN have typed their own note on an SMS transaction (the edit form
          // prefilled the SMS text, but they could clear it and type). So don't move
          // every note blindly — only text that actually looks like a bank message:
          // the parser's 120-char truncation marker, or an amount plus a bank verb /
          // account ref. Anything else is treated as the user's and left in `note`.
          const LOOKS_LIKE_SMS =
            /(?:…$)|(?:(?:rs\.?|inr|₹)\s?[\d,]+(?:\.\d+)?[\s\S]*\b(?:debited|credited|spent|withdrawn|deducted|deposited|refunded|transferred|paid|txn|upi|a\/c|acct|avl\s*bal|available\s*balance)\b)/i;
          const splitNote = (t) => {
            if (!t || t.source !== 'sms' || !t.note || t.smsText) return t;
            if (!LOOKS_LIKE_SMS.test(t.note)) return t;   // user's own note — keep it
            const { note, ...rest } = t;
            return { ...rest, smsText: note };
          };
          state = {
            ...state,
            transactions: (state.transactions || []).map(splitNote),
            archivedTransactions: (state.archivedTransactions || []).map(splitNote),
          };
        }

        return state;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        accounts: state.accounts,
        transactions: state.transactions,
        archivedTransactions: state.archivedTransactions ?? [],
        monthlyAggregates: state.monthlyAggregates,
        categories: state.categories,
        customParents: state.customParents ?? [],
        customChildren: state.customChildren ?? [],
        lentBorrowed: state.lentBorrowed,
        smsAutoImport: state.smsAutoImport,
        lastSmsSync: state.lastSmsSync,
        lastSmsDate: state.lastSmsDate,
        suppressedSmsIds: state.suppressedSmsIds,
        manualTxnSeq: state.manualTxnSeq,
        lastCompactedAt: state.lastCompactedAt,
        userName: state.userName,
        userPhones: state.userPhones,
        userOnboardedAt: state.userOnboardedAt,
        hasOnboarded: state.hasOnboarded,
        smsPermissionGranted: state.smsPermissionGranted,
        contactsPermissionGranted: state.contactsPermissionGranted,
        themeId: state.themeId,
        darkMode: state.darkMode,
        showWeeklySummary: state.showWeeklySummary ?? true,
        weeklyRecapHandled: state.weeklyRecapHandled ?? null,
        showMonthlyRecap: state.showMonthlyRecap ?? true,
        recapMonthHandled: state.recapMonthHandled ?? null,
        monthlyRecapCardDismissed: state.monthlyRecapCardDismissed ?? null,
        recapOptions: state.recapOptions ?? { includePrivate: true, includeGroups: true, includeTxnList: false },
        notificationIds: state.notificationIds,
        ccDueReminderIds: state.ccDueReminderIds ?? {},
        subscriptionHikesNotified: state.subscriptionHikesNotified ?? [],
        budget: state.budget,
        lastBudgetPlan: state.lastBudgetPlan,
        budgetHistory: state.budgetHistory,
        budgetStreak: state.budgetStreak,
        budgetBreachNotified: state.budgetBreachNotified,
        pendingCelebration:    state.pendingCelebration,
        pendingCCPayment:      state.pendingCCPayment      ?? null,
        ccHandledSmsIds:       state.ccHandledSmsIds       ?? [],
        lastMidmonthNudgeMonth: state.lastMidmonthNudgeMonth,
        xp: state.xp,
        reviewStreak: state.reviewStreak,
        userCustomRules: state.userCustomRules,
        anchorNudgeDismissed: state.anchorNudgeDismissed,
        welcomeReviewSeen: state.welcomeReviewSeen ?? false,
        planBannerDismissed: state.planBannerDismissed ?? false,
        groups: state.groups ?? [],
        activeGroupZoneId: state.activeGroupZoneId ?? null,
        declinedAccountLinks: state.declinedAccountLinks ?? [],
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hydrated = true;
          // Rebuild the custom-aware category maps from the persisted custom cats.
          refreshCatMaps(state.customParents, state.customChildren);
        }
      },
    }
  )
);

// ---- internal helpers -------------------------------------------------------
function mergeAdd(a = {}, b = {}) {
  const out = { ...a };
  Object.entries(b).forEach(([k, v]) => {
    out[k] = (out[k] || 0) + v;
  });
  return out;
}

export const selectAccounts = (s) => s.accounts;
export const selectTransactions = (s) => s.transactions;
export const selectVisibleTransactions = (s) =>
  s.transactions.filter((t) => !t.isIgnored && !t.isHidden);
export const selectCategories = (s) => s.categories;
export const selectLentBorrowed = (s) => s.lentBorrowed;

/**
 * Unreviewed SMS transactions — the Daily Queue feed.
 * Sorted newest-first so the most recent card is always on top.
 * Excludes ignored transactions (balance already reversed — not actionable).
 */
export const selectUnreviewedQueue = (s) =>
  s.transactions
    .filter((t) => t.source === 'sms' && !t.isIgnored && !t.isReviewed)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

/**
 * Count of SMS transactions that occurred on the previous calendar day
 * (00:00:00–23:59:59 yesterday, local time). Used by the Aware Run check-in
 * to evaluate Zero-Transaction Day eligibility via look-back — NOT the
 * current unreviewed queue, which is always empty on a fresh morning open.
 *
 * Ignored transactions are excluded: they represent user-dismissed noise
 * and shouldn't penalise a genuine zero-spend day.
 */
export const selectYesterdayTransactionCount = (s) => {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0,  0,  0,   0).getTime();
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999).getTime();
  return s.transactions.filter((t) => {
    if (t.source !== 'sms' || t.isIgnored) return false;
    const ts = new Date(t.createdAt).getTime();
    return ts >= start && ts <= end;
  }).length;
};

/**
 * Count of SMS transactions during the MISSED days of an Aware Run gap — every
 * day strictly after `lastCheckedInDate` and up to the end of yesterday. Lets the
 * streak survive a skipped app-open on a day that had nothing to be aware of: if
 * the missed days held zero transactions, the run isn't broken. Returns 0 when
 * there's no full missed day (`lastCheckedInDate` was today or yesterday / null).
 */
export const selectGapTransactionCount = (s, lastCheckedInDate) => {
  if (!lastCheckedInDate) return 0;
  const [y, m, d] = String(lastCheckedInDate).split('-').map(Number);
  if (!y || !m || !d) return 0;
  const now = new Date();
  // First missed day = the day AFTER the last check-in.
  const gapStart = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
  // Last missed day = yesterday (today isn't "missed").
  const gapEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999).getTime();
  if (gapStart > gapEnd) return 0; // checked in today or yesterday → no missed day
  return s.transactions.filter((t) => {
    if (t.source !== 'sms' || t.isIgnored) return false;
    const ts = new Date(t.createdAt).getTime();
    return ts >= gapStart && ts <= gapEnd;
  }).length;
};

// =============================================================================
// Balance selectors — single source of truth for all balance math.
//
// Two distinct flavours, with different exclusion rules:
//
//   ① Expense view  (Dashboard header)
//      "What's my net expense for this period?"
//      Excludes: ignored, private (isHidden), Lent/Borrowed categories.
//      Used to drive: top "ePurse net expense" + Debits / Credits chips.
//
//   ② Money view  (Accounts tab header)
//      "What's the cash I actually have right now?"
//      Excludes: ignored only. Private transactions DO count — they represent
//      real money that moved, the user just didn't want them in expense stats.
//      Lent/Borrowed cats excluded — they're already tracked per-person in
//      the LB ledger, double-counting would distort net worth.
//
// Keeping both as derived selectors (re-computed from transactions) gives us
// a single source of truth and prevents drift from missed delta updates.
// =============================================================================
// Dashboard header/chip exclusions use the same imported NON_SPEND_CATEGORY_IDS
// (LB ledger, self transfers, CC-bill payments) — one source, no drift.

const periodStartMs = (key) => {
  const now = new Date();
  if (key === 'D') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (key === 'W') return Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (key === 'Y') return new Date(now.getFullYear(), 0, 1).getTime();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

/**
 * Expense stats for the Dashboard header.
 * @param {'D'|'W'|'M'|'Y'} period
 * @returns selector: (state) => { debits, credits, net, count, recent }
 *   • debits  — sum of debit display amounts (your share when split)
 *   • credits — sum of credit amounts
 *   • net     — debits − credits  (positive = you spent more than you earned)
 *   • count   — visible transactions in the period (for the section header)
 *   • recent  — newest-first slice of up to 20 visible transactions
 *
 * Excludes ignored, private (isHidden), and Lent/Borrowed transactions.
 * For Year periods, also folds in monthlyAggregates beyond the raw-retention
 * cutoff so the full year is represented.
 */
export const selectExpenseStats = (period) => (state) => {
  const startMs = periodStartMs(period);
  const now = new Date();

  // All transactions in the period, excluding ignored.
  const inPeriod = state.transactions.filter(
    (t) => !t.isIgnored && new Date(t.createdAt).getTime() >= startMs
  );

  // For the chips/header, also exclude private + Lent/Borrowed + self transfers + group exclusions.
  const eligible = inPeriod.filter(
    (t) => !t.isHidden && !NON_SPEND_CATEGORY_IDS.has(t.categoryId) && !isGroupExcluded(t, state.groups)
  );

  // Gross expenses (debit share), refunds (isRefund credits) that net them down,
  // and received = income + P2P-in (credits that are NOT refunds).
  const grossExpense = eligible
    .filter((t) => t.type === TRANSACTION_TYPES.DEBIT)
    .reduce((s, t) => s + debitDisplayAmount(t), 0);
  const refunds = eligible
    .filter((t) => isRefundCredit(t))
    .reduce((s, t) => s + (t.amount || 0), 0);
  const receivedRaw = eligible
    .filter((t) => t.type === TRANSACTION_TYPES.CREDIT && !isRefundCredit(t))
    .reduce((s, t) => s + t.amount, 0);

  // Year folds in aggregates beyond the raw window. `totalSpend` is already net of
  // refunds and `totalIncome` already excludes them (see aggregate()).
  let aggSpent = 0;
  let aggReceived = 0;
  if (period === 'Y') {
    const yearStr   = String(now.getFullYear());
    const cutoffDt  = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const cutoffKey = `${cutoffDt.getFullYear()}-${String(cutoffDt.getMonth() + 1).padStart(2, '0')}`;
    Object.entries(state.monthlyAggregates || {}).forEach(([k, v]) => {
      if (k.startsWith(yearStr) && k < cutoffKey) {
        aggSpent    += v.totalSpend  || 0;
        aggReceived += v.totalIncome || 0;
      }
    });
  }

  const spent    = Math.max(0, grossExpense - refunds + aggSpent);
  const received = receivedRaw + aggReceived;

  // The visible list (transaction cards) follows the same eligibility rules
  // as the chips — private and LB items are hidden from the default home view.
  const recent = [...eligible]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);

  return {
    spent,               // net expense = expenses − refunds (≥ 0)
    received,            // income + non-refund credits (P2P-in)
    refunds,             // total refunded/adjusted this period (raw window)
    grossExpense,        // expenses before refunds (raw window)
    net: spent - received,
    // Legacy aliases so any stray consumer keeps working.
    debits: spent,
    credits: received,
    count: eligible.length,
    recent,
  };
};

// Weekday letters, Monday-first — matches the perDay order in selectWeeklySummary.
const WEEK_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * Weekly spend summary for the Dashboard "This Week" card.
 * SINGLE SOURCE for all weekly-card math. Monday-anchored week
 * (Mon 00:00 → next Mon 00:00, local time). Uses the SAME spend eligibility as
 * getMonthlySpend: excludes ignored / private / NON_SPEND / group-excluded, and
 * uses debitDisplayAmount so split shares count as your share only.
 *
 * @returns {{
 *   total: number, prevTotal: number, deltaPct: number|null,
 *   dailyAvg: number, daysElapsed: number, txnCount: number, maxDay: number,
 *   perDay: Array<{ label:string, amount:number, isToday:boolean, isFuture:boolean }>,
 *   topCategory: { id:string, name:string, emoji:string, color:string, total:number }|null,
 *   weekStartMs: number, weekEndMs: number,
 * }}
 */
export const selectWeeklySummary = (state, anchor) => {
  const now = new Date();
  // Week CONTAINING `anchor` (default = now). Lets the week-end recap render the
  // just-completed week by passing a day from last week.
  const ref = anchor != null ? new Date(anchor) : now;
  const dow = (ref.getDay() + 6) % 7;   // 0 = Mon … 6 = Sun
  const weekStart   = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - dow, 0, 0, 0, 0);
  const weekStartMs = weekStart.getTime();
  const weekEndMs   = weekStartMs + 7 * DAY_MS;   // exclusive upper bound
  const prevStartMs = weekStartMs - 7 * DAY_MS;

  // "today" only applies when now actually falls inside this week (current week);
  // for a past week it's -1 so nothing is marked today/future.
  const nowMs = now.getTime();
  const todayIdx = (nowMs >= weekStartMs && nowMs < weekEndMs) ? Math.floor((nowMs - weekStartMs) / DAY_MS) : -1;

  // Spend = expenses − refunds (refund credits net down via spendContribution),
  // consistent with getMonthlySpend / selectMonthlyReport.
  const isSpend = (t) =>
    !t.isIgnored &&
    !t.isHidden &&
    countsForSpend(t) &&
    !NON_SPEND_CATEGORY_IDS.has(t.categoryId) &&
    !isGroupExcluded(t, state.groups);

  const perDay = WEEK_DAY_LABELS.map((label, i) => ({
    label,
    amount:   0,
    isToday:  i === todayIdx,
    isFuture: todayIdx >= 0 ? i > todayIdx : false,
  }));

  const catTotals = {};
  let total = 0;
  let prevTotal = 0;
  let txnCount = 0;

  state.transactions.forEach((t) => {
    if (!isSpend(t)) return;
    const ts = new Date(t.createdAt).getTime();
    const amt = spendContribution(t); // +expense share, −refund
    if (ts >= weekStartMs && ts < weekEndMs) {
      total += amt;
      txnCount += 1;
      const dayIdx = Math.floor((ts - weekStartMs) / DAY_MS);
      if (dayIdx >= 0 && dayIdx < 7) perDay[dayIdx].amount += amt;
      catTotals[t.categoryId] = (catTotals[t.categoryId] || 0) + amt;
    } else if (ts >= prevStartMs && ts < weekStartMs) {
      prevTotal += amt;
    }
  });

  // Refunds can push a day / category / total net-negative — clamp for display.
  perDay.forEach((d) => { if (d.amount < 0) d.amount = 0; });
  Object.keys(catTotals).forEach((k) => { if (catTotals[k] < 0) catTotals[k] = 0; });
  total = Math.max(0, total);
  prevTotal = Math.max(0, prevTotal);

  const maxDay      = perDay.reduce((m, d) => Math.max(m, d.amount), 0);
  // Current week → days so far (today+1); a completed/past week → all 7.
  const daysElapsed = todayIdx >= 0 ? todayIdx + 1 : 7;
  const dailyAvg    = total / daysElapsed;
  const deltaPct    = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;

  let topCategory = null;
  const topId = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a])[0];
  if (topId && catTotals[topId] > 0) {
    const c = (state.categories || []).find((x) => x.id === topId);
    topCategory = {
      id:    topId,
      name:  c?.name  || 'Other',
      emoji: c?.emoji || '📌',
      color: c?.color || '#9CA3AF',
      total: catTotals[topId],
    };
  }

  return {
    total, prevTotal, deltaPct,
    dailyAvg, daysElapsed, txnCount, maxDay,
    perDay, topCategory,
    weekStartMs, weekEndMs,
  };
};

/**
 * The most recent completed month (YYYY-MM, strictly before the current month)
 * that has any data — from monthlyAggregates or raw transactions. Drives the
 * persistent dashboard recap card. Returns null when there's no prior month.
 */
export const selectLatestRecapMonth = (state) => {
  const curMk = monthKey(new Date());
  const set = new Set(Object.keys(state.monthlyAggregates || {}));
  (state.transactions || []).forEach((t) => { if (!t.isIgnored) set.add(monthKey(t.createdAt)); });
  const past = [...set].filter((k) => k < curMk).sort();
  return past.length ? past[past.length - 1] : null;
};

/**
 * Monthly report — the SINGLE SOURCE for the recap card, modal, and PDF.
 * Assembles cashflow, budget-vs-plan, parent-level category breakdown with
 * month-over-month movers, daily spend series, top merchants, subscriptions,
 * payment methods, highlights, and a next-month budget suggestion for `mk`.
 *
 * Degrades gracefully: cashflow / category / budget work from aggregates for
 * months whose raw transactions have been compacted; the raw-only sections
 * (daily, merchants, subscriptions, payment methods) are null when no raw rows
 * survive for `mk`, so consumers can omit them.
 *
 * @param {string} mk  month key "YYYY-MM"
 * @returns selector: (state) => report object
 */
export const selectMonthlyReport = (mk, opts = {}) => (state) => {
  const includePrivate = opts.includePrivate !== false;   // default: include private
  const includeGroups  = opts.includeGroups  !== false;   // default: include groups
  const includeTxnList = opts.includeTxnList === true;     // default: no txn list

  const [y, m] = String(mk).split('-').map(Number);
  const monthDate = new Date(y, m - 1, 15);
  const prevDate  = new Date(y, m - 2, 15);
  const now = new Date();
  const isCurrent = mk === monthKey(now);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lastDay = isCurrent ? now.getDate() : daysInMonth;
  const money = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const shortLabel = new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long' });

  // Ignored txns are always dropped; private (isHidden) follow the toggle. When
  // raw rows survive for the month we compute EVERY section from them so figures
  // reconcile and honor the private toggle uniformly; older months (raw pruned)
  // fall back to the store getters/aggregates, which always include private.
  const keepHidden = (t) => includePrivate || !t.isHidden;
  const rawMonth = state.transactions.filter((t) => !t.isIgnored && monthKey(t.createdAt) === mk);
  const rawKept  = rawMonth.filter(keepHidden);
  const hasRaw   = rawKept.length > 0;
  // Counts toward SPEND math this month (expense debit or refund credit), after the
  // standard exclusions. Refunds net down via spendContribution (−amount).
  const countsHere = (t) =>
    countsForSpend(t) &&
    !NON_SPEND_CATEGORY_IDS.has(t.categoryId) &&
    !isGroupExcluded(t, state.groups);

  // ── Cashflow (spend nets refunds; income excludes refunds) ──
  let spent = 0, income = 0, refunds = 0;
  if (hasRaw) {
    rawKept.forEach((t) => {
      if (NON_SPEND_CATEGORY_IDS.has(t.categoryId) || isGroupExcluded(t, state.groups)) return;
      if (t.type === TRANSACTION_TYPES.DEBIT) spent += debitDisplayAmount(t);
      else if (isRefundCredit(t)) { spent -= t.amount; refunds += t.amount; }
      else if (t.type === TRANSACTION_TYPES.CREDIT) income += t.amount;
    });
    spent = Math.max(0, spent);
  } else {
    spent = state.getMonthlySpend(monthDate);
    income = state.getMonthlyIncome(monthDate);
  }
  const net    = income - spent;
  const savingsRate = income > 0 ? Math.max(0, net / income) : 0;
  const prevSpent = state.getMonthlySpend(prevDate);
  const spendDeltaPct = prevSpent > 0 ? ((spent - prevSpent) / prevSpent) * 100 : null;

  // ── Budget: planned vs actual (rollover snapshot) ──
  let budget = null;
  const bh = state.budgetHistory?.[mk];
  if (bh && bh.perCategory) {
    const rows = Object.entries(bh.perCategory)
      .map(([pid, v]) => {
        const p = findParentById(pid);
        return {
          id: pid, name: p?.label || pid, color: p?.color || '#9CA3AF', emoji: p?.emoji || '📌',
          cap: v.cap || 0, actual: v.actual || 0, over: (v.actual || 0) > (v.cap || 0),
        };
      })
      .filter((r) => r.cap > 0 || r.actual > 0)
      .sort((a, b) => (b.cap ? b.actual / b.cap : 0) - (a.cap ? a.actual / a.cap : 0));
    budget = {
      totalCap: bh.totalCap ?? null,
      totalActual: bh.totalActual || 0,
      status: bh.status || null,
      overshoot: bh.overshoot || 0,
      saved: (bh.totalCap != null && bh.totalActual <= bh.totalCap) ? bh.totalCap - bh.totalActual : 0,
      streak: state.budgetStreak?.current || 0,
      rows,
    };
  }

  // ── Category breakdown (parent level) + month-over-month movers ──
  const rollup = (rows) => {
    const out = {};
    (rows || []).forEach((r) => {
      const pid = CAT_MAPS.legacyToParentId[r.id] || r.id;
      out[pid] = (out[pid] || 0) + (r.total || 0);
    });
    return out;
  };
  let curByParent;
  if (hasRaw) {
    curByParent = {};
    rawKept.forEach((t) => {
      if (!countsHere(t)) return;
      const pid = parentCatId(t);
      curByParent[pid] = (curByParent[pid] || 0) + spendContribution(t); // refund nets its parent
    });
    Object.keys(curByParent).forEach((k) => { if (curByParent[k] < 0) curByParent[k] = 0; });
  } else {
    curByParent = rollup(state.getCategoryBreakdown(monthDate));
  }
  const prevByParent = rollup(state.getCategoryBreakdown(prevDate));
  const catTotalAll  = Object.values(curByParent).reduce((s, v) => s + v, 0) || 1;
  const categories = Object.entries(curByParent)
    .map(([pid, total]) => {
      const p = findParentById(pid);
      const prev = prevByParent[pid] || 0;
      return {
        id: pid, name: p?.label || pid, color: p?.color || '#9CA3AF', emoji: p?.emoji || '📌',
        total, percent: (total / catTotalAll) * 100,
        moverPct: prev > 0 ? ((total - prev) / prev) * 100 : null,
      };
    })
    .sort((a, b) => b.total - a.total);

  // ── Raw-only sections (daily / payment methods / groups / biggest / txn list) ──
  let daily = null, peakDay = null, noSpendDays = null, weekdayAvg = null, weekendAvg = null;
  let biggest = null, paymentMethods = null, merchants = null, subscriptions = [], subscriptionTotal = 0;
  let groupSpend = [];
  let txnList = null;

  if (hasRaw) {
    const perDay = Array.from({ length: daysInMonth }, () => 0);
    const payMap = {};
    const grpMap = {};
    rawKept.forEach((t) => {
      // Spend that counts this month (expense debit or refund credit); refunds net down.
      if (!countsHere(t)) return;
      const amt = spendContribution(t); // +expense share, −refund
      const d = new Date(t.createdAt);
      const di = d.getDate() - 1;
      if (di >= 0 && di < daysInMonth) perDay[di] += amt;
      const acc = t.accountId || 'cash';
      payMap[acc] = (payMap[acc] || 0) + amt;
      if (includeGroups && t.groupId) {
        const gm = grpMap[t.groupId] || (grpMap[t.groupId] = { total: 0, count: 0 });
        gm.total += amt; gm.count += 1;
      }
      // "Biggest expense" is a real outflow — refunds (amt<0) never qualify.
      if (amt > 0 && (!biggest || amt > biggest.amount)) biggest = { amount: amt, merchant: t.merchant || 'Expense', day: d.getDate() };
    });

    // A day/account net-negative from refunds reads as 0 spend (not a negative bar).
    for (let i = 0; i < perDay.length; i++) if (perDay[i] < 0) perDay[i] = 0;

    // Per-group spend (your counted share this month) — non-private groups only.
    groupSpend = includeGroups ? Object.entries(grpMap)
      .map(([gid, v]) => {
        const g = (state.groups || []).find((x) => x.id === gid);
        return { id: gid, name: g?.name || 'Group', emoji: g?.emoji || '👥', color: g?.color || '#6366F1', type: g?.type || null, total: v.total, count: v.count };
      })
      .filter((x) => x.total > 0)
      .sort((a, b) => b.total - a.total) : [];
    daily = perDay.slice(0, lastDay).map((amount, i) => ({ day: i + 1, amount }));
    const peak = daily.reduce((mx, d) => (d.amount > (mx ? mx.amount : 0) ? d : mx), null);
    peakDay = (peak && peak.amount > 0)
      ? { day: peak.day, amount: peak.amount, weekday: new Date(y, m - 1, peak.day).toLocaleDateString('en-IN', { weekday: 'short' }) }
      : null;
    noSpendDays = daily.filter((d) => d.amount === 0).length;
    let wkTot = 0, wkN = 0, weTot = 0, weN = 0;
    for (let i = 0; i < lastDay; i++) {
      const dow = new Date(y, m - 1, i + 1).getDay();
      if (dow === 0 || dow === 6) { weTot += perDay[i]; weN++; } else { wkTot += perDay[i]; wkN++; }
    }
    weekdayAvg = wkN ? wkTot / wkN : 0;
    weekendAvg = weN ? weTot / weN : 0;

    paymentMethods = Object.entries(payMap)
      .map(([id, total]) => {
        const a = (state.accounts || []).find((x) => x.id === id);
        const label = a
          ? (a.bankName ? `${a.bankName}${a.mask ? ' ··' + a.mask : ''}` : (a.name || a.type))
          : 'Cash';
        return { id, label, total: Math.max(0, total), color: a?.color || '#9CA3AF' };
      })
      .filter((p) => p.total > 0)
      .sort((x, z) => z.total - x.total);

    // Merchants/subscriptions scan the whole history; respect the private toggle
    // by pre-filtering (both helpers already skip isIgnored internally).
    const scanList = state.transactions.filter(keepHidden);
    merchants = getMerchantBubbles(scanList, monthDate)
      .slice(0, 6)
      .map((mb) => ({ name: mb.name, amount: mb.volume, count: mb.frequency }));

    subscriptions = detectSubscriptions(scanList.filter((t) => !isGroupExcluded(t, state.groups)))
      .map((su) => ({ merchant: su.merchant, amount: su.amount, priceHike: !!su.priceHike, hikeFrom: su.hikeFrom, hikeTo: su.hikeTo }));
    subscriptionTotal = subscriptions.reduce((s, x) => s + (x.amount || 0), 0);

    // Optional expense ledger (appended to the PDF) — every kept expense + refund
    // this month, newest first. Refund rows carry a negative amount + a flag.
    if (includeTxnList) {
      txnList = rawKept
        .filter(countsHere)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map((t) => {
          const p = findParentById(parentCatId(t));
          const acc = (state.accounts || []).find((x) => x.id === t.accountId);
          return {
            day: new Date(t.createdAt).getDate(),
            dateLabel: new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
            merchant: t.merchant || '—',
            category: p?.label || 'Other',
            amount: spendContribution(t), // +expense, −refund
            account: acc ? (acc.mask ? `··${acc.mask}` : (acc.name || acc.type || '')) : (t.accountId ? '' : 'Cash'),
            isPrivate: !!t.isHidden,
            isRefund: isRefundCredit(t),
          };
        });
    }
  }

  // ── Highlights ──
  const highlights = [];
  if (budget && budget.saved > 0) highlights.push({ kind: 'pos', icon: '💰', text: `Saved ${money(budget.saved)} under budget` });
  else if (budget && budget.overshoot > 0) highlights.push({ kind: 'neg', icon: '⚠️', text: `Over budget by ${money(budget.overshoot)}` });
  if (noSpendDays != null && noSpendDays > 0) highlights.push({ kind: '', icon: '🧊', text: `${noSpendDays} no-spend day${noSpendDays > 1 ? 's' : ''}` });
  const hiked = subscriptions.find((s) => s.priceHike);
  if (hiked) highlights.push({ kind: 'neg', icon: '🔺', text: `${hiked.merchant} hiked to ${money(hiked.hikeTo)}` });
  if (categories[0]) highlights.push({ kind: '', icon: categories[0].emoji, text: `${categories[0].name} was your top category` });
  if (spendDeltaPct != null) {
    const down = spendDeltaPct < 0;
    highlights.push({ kind: down ? 'pos' : 'neg', icon: down ? '📉' : '📈', text: `Spending ${down ? 'down' : 'up'} ${Math.abs(Math.round(spendDeltaPct))}% vs last month` });
  }
  if (biggest) highlights.push({ kind: '', icon: '🧾', text: `Biggest: ${money(biggest.amount)} · ${biggest.merchant}` });
  if (refunds > 0) highlights.push({ kind: 'pos', icon: '↩️', text: `${money(refunds)} refunded / adjusted` });
  if (groupSpend[0]) highlights.push({ kind: '', icon: groupSpend[0].emoji || '👥', text: `${groupSpend[0].name}: ${money(groupSpend[0].total)}` });

  // ── Next-month suggestion (avg of up to 3 recent months' spend) ──
  const spends = [];
  for (let k = 0; k < 3; k++) {
    const sp = state.getMonthlySpend(new Date(y, m - 1 - k, 15));
    if (sp > 0) spends.push(sp);
  }
  const avgSpend = spends.length ? spends.reduce((s, v) => s + v, 0) / spends.length : spent;
  const suggestedBudget = Math.round(avgSpend / 500) * 500;
  const watchCategories = budget ? budget.rows.filter((r) => r.over).map((r) => r.name) : [];

  return {
    monthKey: mk, monthLabel, shortLabel, daysInMonth, isCurrent,
    cashflow: { spent, income, net, savingsRate, prevSpent, spendDeltaPct, refunds },
    budget,
    categories,
    daily, peakDay, noSpendDays, weekdayAvg, weekendAvg, biggest,
    merchants, subscriptions, subscriptionTotal, paymentMethods, groupSpend,
    txnList,
    highlights,
    plan: { suggestedBudget, avgSpend, watchCategories },
    hasRaw,
  };
};

/**
 * ePurse net worth — real money currently held across all accounts.
 * Excludes ignored transactions (user-dismissed noise) and LB-category txns
 * (tracked separately in the lent/borrowed ledger). Private transactions are
 * counted because they reflect actual money movement; the privacy flag is a
 * display preference, not a "this didn't happen" flag.
 *
 * Computed as: assets − credit-card liabilities.
 *   • Bank / Cash / Wallet / Debit Card balances ADD as assets (a debit card is
 *     unified into its bank via aliasMasks, so it isn't a separate pool — see
 *     linkDebitCardToBank; an unlinked card still adds, same as before).
 *   • A Credit Card's outstanding SUBTRACTS as a liability. Its `balance` runs
 *     negative as you spend (applyDelta debit = −amount), so summing it already
 *     subtracts; we clamp to `min(balance, 0)` so a positive/zero CC balance
 *     (overpaid or freshly true'd-up) never inflates net worth as if it were cash.
 * The per-account balance is kept in sync via applyDelta on every txn insert /
 * undo; ignored txns are reversed at the insert/toggle path.
 */
export const selectEPurseNetWorth = (s) =>
  (s.accounts || []).reduce((sum, a) => {
    const bal = a.balance ?? 0;
    if (a.type === ACCOUNT_TYPES.CREDIT_CARD) return sum + Math.min(bal, 0);
    return sum + bal;
  }, 0);

/**
 * Debit-card↔bank merge SUGGESTIONS — pairs we think are the same money.
 * Derived (not stored): scans transactions for a `coAccountMask` co-reference
 * (one SMS named both a card and the a/c it draws from — see the parser), then
 * keeps a pair only when BOTH accounts exist, exactly one is a Debit Card and the
 * other a Bank, they aren't already linked (alias), and the user hasn't declined it.
 * Returns [{ cardId, cardMask, cardName, bankId, bankMask, bankName }].
 * Powers the onboarding prompt + the Accounts-screen suggestion card.
 */
export const selectAccountLinkSuggestions = (s) => {
  const accounts = s.accounts || [];
  if (accounts.length < 2) return [];
  const declined = new Set(s.declinedAccountLinks || []);
  const byMask = new Map();
  accounts.forEach((a) => {
    if (a.mask) byMask.set(a.mask, a);
  });

  const seen = new Set();
  const out = [];
  // Recent raw txns carry coAccountMask; archived/compacted ones may too (harmless).
  const scan = [...(s.transactions || []), ...(s.archivedTransactions || [])];
  for (const t of scan) {
    const primary = t.accountMask;
    const co = t.coAccountMask;
    if (!primary || !co || primary === co) continue;
    const a1 = byMask.get(primary);
    const a2 = byMask.get(co);
    if (!a1 || !a2) continue;

    // Exactly one Debit Card + one Bank.
    let card = null;
    let bank = null;
    if (a1.type === ACCOUNT_TYPES.DEBIT_CARD && a2.type === ACCOUNT_TYPES.BANK) { card = a1; bank = a2; }
    else if (a2.type === ACCOUNT_TYPES.DEBIT_CARD && a1.type === ACCOUNT_TYPES.BANK) { card = a2; bank = a1; }
    if (!card || !bank) continue;

    // Already linked (card mask folded into the bank) → nothing to suggest.
    if ((bank.aliasMasks || []).includes(card.mask)) continue;

    const key = linkKey(card.mask, bank.mask);
    if (declined.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      cardId: card.id, cardMask: card.mask, cardName: card.name,
      bankId: bank.id, bankMask: bank.mask, bankName: bank.bankName || bank.name,
    });
  }
  return out;
};

/**
 * Show the "set your real balances" onboarding card on the Accounts screen
 * when ALL of the following hold:
 *   • The user has at least one account (otherwise the empty state takes over).
 *   • No account has been anchored yet (no `anchoredAt` timestamp).
 *   • The user hasn't explicitly dismissed the card.
 *
 * Setting an anchor on any single account auto-hides the nudge — anchoring
 * the rest is then discoverable via the existing hint text below the cards.
 */
export const selectShouldShowAnchorNudge = (s) => {
  if (s.anchorNudgeDismissed) return false;
  const accounts = s.accounts || [];
  if (accounts.length === 0) return false;
  return !accounts.some((a) => a.anchoredAt);
};
