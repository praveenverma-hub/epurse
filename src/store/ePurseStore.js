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

import { DEFAULT_CATEGORIES, ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';
import { findParentByLabel } from '../constants/twoTierCategories';
import { DEFAULT_THEME_ID } from '../constants/themes';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { parseMessageDetailed } from '../utils/messageParser';
import { isSameMonth, monthKey } from '../utils/format';
import { fireBudgetBreachNotification, fireMidmonthNudgeNotification } from '../utils/notifications';
import { useNotificationStore } from './useNotificationStore';
import {
  computeEqualSplit,
  computePercentSplit,
  canSplitTransaction,
  debitDisplayAmount,
} from '../utils/split';

// =============================================================================
// Constants
// =============================================================================
const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_RETENTION_MS  = 90  * DAY_MS;  // 3 months of raw transactions
const AGG_RETENTION_MS  = 730 * DAY_MS;  // 24 months of aggregates
const COMPACT_THROTTLE  = 6   * 60 * 60 * 1000; // run at most every 6 hrs
const REQUIRED_CATEGORY_IDS = ['lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'self'];

/** Outstanding lend/borrow categories — all matching txns (SMS/manual) skip the 3-mo→aggregate path. */
const LB_OUTSTANDING_CATS = new Set(['lent', 'borrowed']);
/** Settled categories — same; kept raw ≤ 1 yr then dropped, never merged into monthly aggregates. */
const LB_SETTLED_CATS = new Set(['lent_settled', 'borrow_repaid']);
const LB_SETTLED_RETENTION_MS = 365 * DAY_MS;

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

/**
 * Best-fit account for a parsed transaction.
 * 1. exact mask match
 * 2. fall back to account-type match
 */
const matchAccount = (accounts, parsed) => {
  if (!parsed) return null;
  if (parsed.accountMask) {
    // Specific mask given — only match by mask, never fall back to type.
    // A type-only fallback would attach the txn to a different card of the same type.
    return accounts.find((a) => a.mask === parsed.accountMask) || null;
  }
  return accounts.find((a) => a.type === parsed.accountType) || null;
};

/** Auto-create an account when an SMS references a mask we haven't seen. */
const ensureAccountForParsed = (accounts, parsed) => {
  if (!parsed) return { accounts, account: null };
  const existing = matchAccount(accounts, parsed);
  if (existing) return { accounts, account: existing };
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

// ── Self-transfer detection ──────────────────────────────────────────────────
// A "self" transfer moves money between the user's OWN accounts (or to their own
// linked mobile). It still adjusts account balances, but is neither income nor
// expense, so it's tagged categoryId='self' and excluded from all totals.
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

/** Two masks match if one is a suffix of the other (≥3 shared trailing digits). */
const maskMatch = (a, b) => {
  const x = onlyDigits(a);
  const y = onlyDigits(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.endsWith(y) || y.endsWith(x);
};
const maskInList = (mask, masks) => !!mask && masks.some((m) => maskMatch(mask, m));

/** A counterparty phone is the user's if a stored number shares ≥4 trailing digits. */
const phoneIsUser = (cp, userPhones) => {
  const c = onlyDigits(cp);
  if (c.length < 4) return false;
  return (userPhones || []).some((p) => {
    const x = onlyDigits(p);
    return x.length >= 4 && (x.endsWith(c) || c.endsWith(x));
  });
};

/**
 * True when a parsed transaction is a transfer between the user's OWN accounts:
 *   (a) a dual-leg SMS where BOTH the debited and credited masks are user
 *       accounts ("Acct XX171 debited … & Acct XX532 credited"), or
 *   (b) money landing on a user account "by a/c linked to mobile …" that is the
 *       user's own registered number.
 * `userMasks` is the list of masks for every known account (all the user's own).
 */
const isSelfTransfer = (txn, userMasks, userPhones) => {
  if (!txn) return false;
  if (!maskInList(txn.accountMask, userMasks)) return false; // own leg must be a user account
  if (txn.selfDualLeg && maskInList(txn.counterpartyMask, userMasks)) return true;
  if (txn.counterpartyPhone && phoneIsUser(txn.counterpartyPhone, userPhones)) return true;
  return false;
};

const SELF_TXN_FIELDS = {
  categoryId: 'self',
  parentCategory: 'Transfers',
  childCategory: 'Self',
  isSelfTransfer: true,
};

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

/** Lent/borrow category ids — excluded from normal spend/income totals. */
const LB_ALL_CATS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid']);

/**
 * Categories excluded from every spend/income total and budget calculation.
 * Lent/borrow are tracked per-person in the LB ledger. `self` covers transfers
 * between the user's OWN accounts (or to their own linked mobile) — real money
 * moved, so account balances are still adjusted via applyDelta, but it is
 * neither income nor expense and must not skew totals.
 */
const NON_SPEND_CATS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'self']);

// ─────────────────────────────────────────────────────────────────────────────
// Budget = FIRST-LEVEL (parent) categories. Children roll up into their parent,
// so a Groceries spend counts against the Food & Dining budget (no separate
// "groceries" budget line). Keys are legacy parent ids that also exist in
// DEFAULT_CATEGORIES, so name/emoji/colour resolve for free.
// ─────────────────────────────────────────────────────────────────────────────
const BUDGETABLE_PARENT_IDS = new Set([
  'food', 'travel', 'bills', 'shopping', 'entertainment', 'health', 'fuel', 'investments', 'education',
]);

// Two-tier parent LABEL → legacy parent id.
const PARENT_LABEL_TO_ID = {
  'Food & Dining':     'food',
  'Travel & Commute':  'travel',
  'Bills & Utilities': 'bills',
  'Shopping':          'shopping',
  'Entertainment':     'entertainment',
  'Health & Fitness':  'health',
  'Fuel':              'fuel',
  'Investments':       'investments',
  'Education':         'education',
  'Transfers':         'transfers',
  'Income':            'income',
  'Unassigned':        'other',
};

// Legacy flat categoryId → legacy parent id (children fold into parents).
const LEGACY_TO_PARENT = {
  food: 'food', groceries: 'food',
  travel: 'travel', fuel: 'fuel',
  bills: 'bills', shopping: 'shopping',
  entertainment: 'entertainment', health: 'health',
  education: 'education', investments: 'investments',
  salary: 'income', transfer: 'transfers',
  lent: 'transfers', borrowed: 'transfers',
  lent_settled: 'transfers', borrow_repaid: 'transfers',
  self: 'transfers', other: 'other',
};

/** Resolve a transaction to its first-level (parent) budget category id. */
const parentCatId = (t) => {
  if (t.parentCategory && PARENT_LABEL_TO_ID[t.parentCategory]) {
    return PARENT_LABEL_TO_ID[t.parentCategory];
  }
  return LEGACY_TO_PARENT[t.categoryId] || 'other';
};

/** Sum of category caps — the budget total is always derived from this. */
const sumCaps = (perCategory) =>
  Object.values(perCategory || {}).reduce((a, b) => a + (Number(b) || 0), 0);

/**
 * Produce monthly aggregates from a list of transactions.
 * Returns `{ '2025-12': { totalSpend, totalIncome, byCategory, byAccount } }`.
 * Lent/borrow categories are stored in byCategory for reference but excluded
 * from totalSpend/totalIncome so they don't skew normal expense tracking.
 */
const aggregate = (transactions) => {
  const out = {};
  transactions.forEach((t) => {
    if (t.isIgnored) return;
    const key = monthKey(t.createdAt);
    if (!out[key]) {
      out[key] = { totalSpend: 0, totalIncome: 0, byCategory: {}, byAccount: {} };
    }
    const a = out[key];
    if (t.type === TRANSACTION_TYPES.DEBIT) {
      const spend = debitDisplayAmount(t);
      a.byCategory[t.categoryId] = (a.byCategory[t.categoryId] || 0) + spend;
      if (!NON_SPEND_CATS.has(t.categoryId)) a.totalSpend += spend;
      if (t.accountId) a.byAccount[t.accountId] = (a.byAccount[t.accountId] || 0) - t.amount;
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
      transactions: [],      // raw, max 3 months
      monthlyAggregates: {}, // { 'YYYY-MM': { totalSpend, totalIncome, byCategory, byAccount } }
      categories: DEFAULT_CATEGORIES,
      lentBorrowed: [],

      userName: '',
      // The user's own mobile number(s) linked to their bank accounts / UPI.
      // Used to detect self transfers when money lands "by a/c linked to mobile …".
      userPhones: [],
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

      // Notification IDs: { [personKey]: notificationId }  — used to cancel/update reminders
      notificationIds: {},

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

      // Set when a CC payment SMS arrives on an untracked card.
      // Shape: { amount, accountId, accountMask, bankName }
      // Cleared by confirmCCTrueUp or dismissCCPaymentPrompt.
      pendingCCPayment: null,

      // Per-cycle dedup for the mid-month nudge (one notification per cycle).
      lastMidmonthNudgeMonth: null,

      // ─── Daily Queue / XP ───────────────────────────────────────────────────
      // `xp` accumulates across all-time approvals (10 XP per reviewed card).
      // `reviewStreak` tracks consecutive calendar days with at least one review.
      xp: 0,
      reviewStreak: { current: 0, best: 0, lastReviewDate: null },

      // Two-tier user-defined automation rules — keyed by SCREAMING_SNAKE_CASE merchant.
      userCustomRules: {},

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
      setSmsPermissionGranted: (v) => set({ smsPermissionGranted: !!v }),
      setContactsPermissionGranted: (v) => set({ contactsPermissionGranted: !!v }),

      // ----- theme setters ----------------------------------------------
      setThemeId: (id) => set({ themeId: id || DEFAULT_THEME_ID }),
      setDarkMode: (v) => set({ darkMode: !!v }),

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
        const parentId = LEGACY_TO_PARENT[categoryId] || categoryId;
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
          const perCategorySnapshot = {};
          Object.entries(s.budget.perCategory).forEach(([catId, cap]) => {
            perCategorySnapshot[catId] = { cap, actual: prevAgg?.byCategory?.[catId] || 0 };
          });

          const totalActual = prevAgg?.totalSpend || 0;
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
          return {
            transactions: [newTxn, ...s.transactions],
            accounts: applyDelta(resolvedAccounts, resolvedAccountId, newTxn),
            lentBorrowed: nextLent,
            ...(useProvidedId ? {} : { manualTxnSeq: nextSeq }),
          };
        });
        // Budget breach detection runs after the state commits — fire-and-forget.
        if (txn?.categoryId) get().checkBudgetBreach(txn.categoryId);
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
      applyCCPayment: ({ amount, accountMask, bankName }) => {
        if (!amount || amount <= 0 || amount > MAX_ALLOWED_AMOUNT) return null;
        const state = get();
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

        // ── ALWAYS-ASK MODE ──────────────────────────────────────────────
        // Every detected CC payment surfaces the prompt. User picks
        // "True-up to Zero" → confirmCCTrueUp() OR "Skip" → balance unchanged.
        set({
          accounts: accountsWithMatch,
          pendingCCPayment: {
            amount,
            accountId:   account.id,
            accountMask: account.mask  || accountMask || null,
            bankName:    account.bankName || bankName || null,
          },
        });
        return { ccPayment: 'pending', accountId: account.id };

        // ── PREVIOUS BEHAVIOUR (kept for re-enable) ──────────────────────
        // Asked only on the FIRST payment per card, then auto-applied the
        // delta on subsequent payments. Uncomment this block (and remove the
        // unconditional set above) to restore it.
        //
        // if (!account.ccPaymentsTracked) {
        //   set({
        //     accounts: accountsWithMatch,
        //     pendingCCPayment: {
        //       amount,
        //       accountId:   account.id,
        //       accountMask: account.mask  || accountMask || null,
        //       bankName:    account.bankName || bankName || null,
        //     },
        //   });
        //   return { ccPayment: 'pending', accountId: account.id };
        // }
        //
        // // Already tracking — apply the payment delta automatically.
        // const nextAccounts = applyDelta(accountsWithMatch, account.id, pseudoTxn);
        // set({ accounts: nextAccounts });
        // return { ccPayment: true, accountId: account.id, amount };
      },

      // User tapped "True-up to Zero" — zero out the CC account and start tracking.
      confirmCCTrueUp: () => {
        const { pendingCCPayment, accounts } = get();
        if (!pendingCCPayment) return;
        set({
          accounts: accounts.map((a) =>
            a.id === pendingCCPayment.accountId
              ? { ...a, balance: 0, ccPaymentsTracked: true, anchoredAt: Date.now() }
              : a
          ),
          pendingCCPayment: null,
        });
      },

      // User tapped "Skip" — discard without changing the account.
      dismissCCPaymentPrompt: () => set({ pendingCCPayment: null }),

      ingestMessage: (rawMessage, opts = {}) => {
        const parsedResult = parseMessageDetailed(rawMessage, opts);
        if (!parsedResult?.ok) {
          if (
            parsedResult?.error?.code === 'credit_card_payment_notification' &&
            parsedResult.ccPayment
          ) {
            get().applyCCPayment(parsedResult.ccPayment);
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
        let nextAccounts = [...state.accounts];
        const added = [];

        parsedTxns.forEach((txn, idx) => {
          if (!txn?.amount || txn.amount <= 0 || txn.amount > MAX_ALLOWED_AMOUNT) return;
          const smsId = smsBaseId
            ? (parsedTxns.length > 1 ? `${smsBaseId}:${idx + 1}` : smsBaseId)
            : null;

          const candidate = { ...txn, isReviewed: false };
          if (smsId) candidate.smsId = smsId;
          if (isDuplicate(nextTransactions, candidate, smsId, state.suppressedSmsIds || [])) return;

          const { accounts: accountsWithMatch, account } = ensureAccountForParsed(nextAccounts, candidate);
          candidate.accountId = account?.id || null;

          // Tag transfers between the user's own accounts as `self` so they're
          // excluded from spend/income totals (balances still update below).
          const userMasks = accountsWithMatch.map((a) => a.mask).filter(Boolean);
          if (isSelfTransfer(candidate, userMasks, state.userPhones)) {
            Object.assign(candidate, SELF_TXN_FIELDS);
          }

          // Skip balance delta for transactions older than a manual anchor — the
          // anchor already reflects the correct balance up to that point.
          const anchoredAt = account?.anchoredAt ?? 0;
          const txnTime    = new Date(candidate.createdAt || Date.now()).getTime();
          nextAccounts = (anchoredAt && txnTime < anchoredAt)
            ? accountsWithMatch
            : applyDelta(accountsWithMatch, account?.id, candidate);
          nextTransactions = [candidate, ...nextTransactions];
          added.push(candidate);
        });

        if (added.length === 0) return null;

        // Reconcile self-transfer tags: a dual-leg transfer's counterpart account
        // is often only learned from its OWN later SMS, so re-check earlier
        // candidates against the now-grown account set. Re-tagging only changes
        // the category (balances already applied), so it's safe to run anytime.
        // User-edited / LB-locked transactions are left untouched.
        const finalMasks = nextAccounts.map((a) => a.mask).filter(Boolean);
        const userPhones = state.userPhones || [];
        nextTransactions = nextTransactions.map((t) => {
          if (!t || t.userEditedCategory || t.lbLocked || t.categoryId === 'self') return t;
          if (!t.selfDualLeg && !t.counterpartyPhone) return t;
          return isSelfTransfer(t, finalMasks, userPhones)
            ? { ...t, ...SELF_TXN_FIELDS }
            : t;
        });

        set({ transactions: nextTransactions, accounts: nextAccounts });

        // Check budget breach for each unique category affected by this ingest.
        const affectedCats = new Set();
        added.forEach((t) => { if (t.categoryId) affectedCats.add(t.categoryId); });
        affectedCats.forEach((catId) => get().checkBudgetBreach(catId));

        return added[0];
      },

      deleteTransaction: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn) return s;
          // Already reversed when ignored — only drop the row.
          if (txn.isIgnored) {
            return {
              transactions: s.transactions.filter((t) => t.id !== id),
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
          const reverse = {
            ...txn,
            type: txn.type === TRANSACTION_TYPES.DEBIT
              ? TRANSACTION_TYPES.CREDIT
              : TRANSACTION_TYPES.DEBIT,
          };
          return {
            transactions: s.transactions.filter((t) => t.id !== id),
            accounts: applyDelta(s.accounts, txn.accountId, reverse),
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
          const reverse = {
            ...txn,
            type: txn.type === TRANSACTION_TYPES.DEBIT
              ? TRANSACTION_TYPES.CREDIT
              : TRANSACTION_TYPES.DEBIT,
          };
          return {
            transactions: s.transactions.map((t) =>
              t.id === id ? { ...t, isIgnored: true } : t
            ),
            accounts: applyDelta(s.accounts, txn.accountId, reverse),
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
          const nextAccounts = applyDelta(s.accounts, txn.accountId, txn);
          const suppressedSmsIds = txn.smsId
            ? (s.suppressedSmsIds || []).filter((sid) => sid !== txn.smsId)
            : s.suppressedSmsIds || [];
          return {
            transactions: s.transactions.map((t) =>
              t.id === id ? { ...t, isIgnored: false } : t
            ),
            accounts: nextAccounts,
            ...(txn.smsId ? { suppressedSmsIds } : {}),
          };
        }),

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
          // Map two-tier (parent, child) → legacy categoryId that DEFAULT_CATEGORIES
          // and budget calculations rely on. PARENT_CATEGORIES uses different ids
          // ('income', 'transfers') from DEFAULT_CATEGORIES ('salary', 'transfer'),
          // so we resolve child-level first, then fall back to a parent-level alias.
          const childToLegacy = {
            // Income children
            Salary:          'salary',
            Freelance:       'salary',
            // Transfer children
            'P2P Transfer':  'transfer',
            Self:            'self',
            Lent:            'lent',
            Borrowed:        'borrowed',
          };
          const parentToLegacy = {
            Income:    'salary',
            Transfers: 'transfer',
          };
          const parentId = findParentByLabel(parentCategory)?.id;
          const legacyCategoryId =
            childToLegacy[childCategory] ||
            parentToLegacy[parentCategory] ||
            parentId;

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

      setTransactionHidden: (id, hidden) =>
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, isHidden: !!hidden } : t
          ),
        })),

      // ----- categories --------------------------------------------------
      addCategory: (cat) =>
        set((s) => ({
          categories: [
            ...s.categories,
            { id: `cat_${Date.now()}`, color: '#6B7280', emoji: '📌', ...cat },
          ],
        })),

      removeCategory: (id) =>
        set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),

      // ----- lent / borrowed --------------------------------------------
      /**
       * Add a manual lent/borrow entry.
       * entry: { kind, person, amount, note?, contactId?, phone? }
       * kind can be 'lent', 'borrowed', 'lent_settled', or 'borrow_repaid'.
       * Balance is calculated additively: net = Σlent - Σlent_settled - Σborrowed + Σborrow_repaid
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
      settlePersonBalance: (personKey) => {
        const person = get().getPersonBalances().find((p) => p.personKey === personKey);
        if (!person || person.net === 0) return;
        const netAmt = Math.abs(person.net);
        const kind   = person.net > 0 ? 'lent_settled' : 'borrow_repaid';
        const now    = new Date().toISOString();
        set((s) => ({
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
          const newAggs = aggregate(toAggregate);
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

          return {
            transactions: stillRaw,
            lentBorrowed: lentBorrowedPruned,
            monthlyAggregates: merged,
            lastCompactedAt: now,
          };
        });
      },

      // ----- derived selectors ------------------------------------------
      getTotalBalance: () => get().accounts.reduce((sum, a) => sum + (a.balance || 0), 0),

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
      getMonthlySpend: (date = new Date()) => {
        const txns = get().transactions.filter(
          (t) =>
            !t.isIgnored &&
            t.type === TRANSACTION_TYPES.DEBIT &&
            !NON_SPEND_CATS.has(t.categoryId) &&
            isSameMonth(t.createdAt, date)
        );
        if (txns.length > 0) {
          return txns.reduce((sum, t) => sum + debitDisplayAmount(t), 0);
        }
        return get().monthlyAggregates[monthKey(date)]?.totalSpend || 0;
      },

      getMonthlyIncome: (date = new Date()) => {
        const txns = get().transactions.filter(
          (t) =>
            !t.isIgnored &&
            t.type === TRANSACTION_TYPES.CREDIT &&
            !NON_SPEND_CATS.has(t.categoryId) &&
            isSameMonth(t.createdAt, date)
        );
        if (txns.length > 0) return txns.reduce((s, t) => s + t.amount, 0);
        return get().monthlyAggregates[monthKey(date)]?.totalIncome || 0;
      },

      /**
       * Category breakdown for a month.
       * If raw transactions exist for that month, use them. Otherwise build
       * the breakdown from the stored aggregate.
       */
      getCategoryBreakdown: (date = new Date()) => {
        const cats = get().categories;
        const month = monthKey(date);
        const raw = get().transactions.filter(
          (t) =>
            !t.isIgnored &&
            t.type === TRANSACTION_TYPES.DEBIT &&
            !NON_SPEND_CATS.has(t.categoryId) &&
            isSameMonth(t.createdAt, date)
        );

        let totals;
        let grandTotal;
        if (raw.length > 0) {
          totals = {};
          raw.forEach((t) => {
            totals[t.categoryId] = (totals[t.categoryId] || 0) + debitDisplayAmount(t);
          });
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
          if (t.type !== TRANSACTION_TYPES.DEBIT) return;
          if (NON_SPEND_CATS.has(t.categoryId)) return; // self + lent/borrow
          const amt = debitDisplayAmount(t);
          allExpense += amt;
          const pid = parentCatId(t);
          if (BUDGETABLE_PARENT_IDS.has(pid)) byParent[pid] = (byParent[pid] || 0) + amt;
        });

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
            if (LEGACY_TO_PARENT[cid] === parentId) { monthSum += amt; has = true; }
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
          if (t.type !== TRANSACTION_TYPES.DEBIT) return;
          if (NON_SPEND_CATS.has(t.categoryId)) return;
          if (!isSameMonth(t.createdAt, date)) return;
          if (parentCatId(t) !== parentId) return;
          const label = t.childCategory || catName(t.categoryId) || 'Other';
          rows[label] = (rows[label] || 0) + debitDisplayAmount(t);
        });
        return Object.entries(rows)
          .map(([label, total]) => ({ label, total }))
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
          if (t.type !== TRANSACTION_TYPES.DEBIT) return;
          if (NON_SPEND_CATS.has(t.categoryId)) return;
          if (!isSameMonth(t.createdAt, date)) return;
          const pid = parentCatId(t);
          if (budgeted.has(pid)) return; // already tracked by a budget line
          const label = labelFor(pid);
          rows[label] = (rows[label] || 0) + debitDisplayAmount(t);
        });
        return Object.entries(rows)
          .map(([label, total]) => ({ label, total }))
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
       * Grouping uses UNION-FIND across THREE identifiers — contactId, normalised
       * phone, and lowercased name — because legacy entries may carry only a
       * subset of identifiers (e.g. an old manual "Lend to someone" form may
       * have stored only `phone`, while a later settlement coming through the
       * contact-picker carries both `phone` and `contactId`). Falling back to a
       * single-priority key (the previous implementation) split such entries
       * into separate "persons", causing settlements to appear as the OPPOSITE
       * kind in totals (lent_settled with no matching prior `lent` makes net
       * negative → contributes to "borrowed" total).
       *
       * Returns array of { personKey, person, contactId, phone, lent, borrowed,
       * net, entries } sorted by absolute net (largest first).
       */
      getPersonBalances: () => {
        const entries = get().lentBorrowed;

        // Normalise to canonical strings for matching. Strips non-digits from
        // phone numbers so "+91 99999 12345" matches "9999912345".
        const normPhone = (p) => {
          const d = (p || '').replace(/\D/g, '');
          return d.length ? d : null;
        };
        const normName  = (n) => {
          const t = (n || '').trim().toLowerCase();
          return t.length ? t : null;
        };

        // ─── Union-find over identifier tokens ──────────────────────────
        // Each unique identifier (contactId/phone/name) is a node. Two
        // identifiers from the same entry get unioned. Two entries that
        // share any identifier are therefore in the same component.
        const parent = new Map(); // token → its parent token
        const makeSet = (x) => { if (!parent.has(x)) parent.set(x, x); };
        const find = (x) => {
          let r = x;
          while (parent.get(r) !== r) r = parent.get(r);
          // Path compression
          let cur = x;
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

        // First pass — register all tokens and link the ones that co-occur
        // on the same entry. Use a per-entry fallback token so entries with
        // zero identifiers still get a unique group.
        const entryToken = new Array(entries.length);
        entries.forEach((e, i) => {
          const tokens = [];
          if (e.contactId)               tokens.push(`cid:${e.contactId}`);
          const ph = normPhone(e.phone); if (ph) tokens.push(`ph:${ph}`);
          const nm = normName(e.person); if (nm) tokens.push(`nm:${nm}`);
          if (tokens.length === 0) tokens.push(`anon:${i}`);

          tokens.forEach(makeSet);
          entryToken[i] = tokens[0];
          // Union all tokens of this entry into one component.
          for (let t = 1; t < tokens.length; t++) union(tokens[0], tokens[t]);
        });

        // ─── Second pass — aggregate per component root ────────────────
        const groups = new Map(); // root token → record
        entries.forEach((e, i) => {
          const root = find(entryToken[i]);
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
          }
          const rec = groups.get(root);
          // Promote the richest contact info we've seen in this group.
          if (e.contactId && !rec.contactId) rec.contactId = e.contactId;
          if (e.phone && !rec.phone)         rec.phone     = e.phone;
          if (e.person && (!rec.person || rec.person.length < e.person.length)) {
            rec.person = e.person;
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
          manualTxnSeq: 0,
          userName: '',
          userPhones: [],
          hasOnboarded: false,
          smsPermissionGranted: false,
          contactsPermissionGranted: false,
          themeId: DEFAULT_THEME_ID,
          darkMode: false,
          notificationIds: {},
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
      version: 18,
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
              const pid = LEGACY_TO_PARENT[cid] || cid;
              if (!BUDGETABLE_PARENT_IDS.has(pid)) return; // drop transfers/income/etc
              remapped[pid] = (remapped[pid] || 0) + (Number(cap) || 0);
            });
            const caps = sumCaps(remapped);
            nextBudget = { ...nextBudget, perCategory: remapped, totalCap: caps > 0 ? caps : null };
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

        return state;
      },
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        accounts: state.accounts,
        transactions: state.transactions,
        monthlyAggregates: state.monthlyAggregates,
        categories: state.categories,
        lentBorrowed: state.lentBorrowed,
        smsAutoImport: state.smsAutoImport,
        lastSmsSync: state.lastSmsSync,
        lastSmsDate: state.lastSmsDate,
        suppressedSmsIds: state.suppressedSmsIds,
        manualTxnSeq: state.manualTxnSeq,
        lastCompactedAt: state.lastCompactedAt,
        userName: state.userName,
        userPhones: state.userPhones,
        hasOnboarded: state.hasOnboarded,
        smsPermissionGranted: state.smsPermissionGranted,
        contactsPermissionGranted: state.contactsPermissionGranted,
        themeId: state.themeId,
        darkMode: state.darkMode,
        notificationIds: state.notificationIds,
        budget: state.budget,
        lastBudgetPlan: state.lastBudgetPlan,
        budgetHistory: state.budgetHistory,
        budgetStreak: state.budgetStreak,
        budgetBreachNotified: state.budgetBreachNotified,
        pendingCelebration:    state.pendingCelebration,
        pendingCCPayment:      state.pendingCCPayment      ?? null,
        lastMidmonthNudgeMonth: state.lastMidmonthNudgeMonth,
        xp: state.xp,
        reviewStreak: state.reviewStreak,
        userCustomRules: state.userCustomRules,
        anchorNudgeDismissed: state.anchorNudgeDismissed,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
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
const LB_CATEGORY_IDS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid']);
// Dashboard header/chip exclusions: LB ledger + self transfers between own accounts.
const NON_SPEND_CATEGORY_IDS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'self']);

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

  // For the chips/header, also exclude private + Lent/Borrowed + self transfers.
  const eligible = inPeriod.filter(
    (t) => !t.isHidden && !NON_SPEND_CATEGORY_IDS.has(t.categoryId)
  );

  const rawDebits = eligible
    .filter((t) => t.type === TRANSACTION_TYPES.DEBIT)
    .reduce((s, t) => s + debitDisplayAmount(t), 0);
  const rawCredits = eligible
    .filter((t) => t.type === TRANSACTION_TYPES.CREDIT)
    .reduce((s, t) => s + t.amount, 0);

  let aggDebits = 0;
  let aggCredits = 0;
  if (period === 'Y') {
    const yearStr   = String(now.getFullYear());
    const cutoffDt  = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const cutoffKey = `${cutoffDt.getFullYear()}-${String(cutoffDt.getMonth() + 1).padStart(2, '0')}`;
    Object.entries(state.monthlyAggregates || {}).forEach(([k, v]) => {
      if (k.startsWith(yearStr) && k < cutoffKey) {
        aggDebits  += v.totalSpend  || 0;
        aggCredits += v.totalIncome || 0;
      }
    });
  }

  const debits  = rawDebits  + aggDebits;
  const credits = rawCredits + aggCredits;

  // The visible list (transaction cards) follows the same eligibility rules
  // as the chips — private and LB items are hidden from the default home view.
  const recent = [...eligible]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);

  return {
    debits,
    credits,
    net: debits - credits,
    count: eligible.length,
    recent,
  };
};

/**
 * ePurse net worth — real money currently held across all accounts.
 * Excludes ignored transactions (user-dismissed noise) and LB-category txns
 * (tracked separately in the lent/borrowed ledger). Private transactions are
 * counted because they reflect actual money movement; the privacy flag is a
 * display preference, not a "this didn't happen" flag.
 *
 * Computed as: sum over accounts of (currentStoredBalance) — the per-account
 * balance is already kept in sync via applyDelta on every txn insert / undo,
 * which is itself driven by all non-ignored transactions. Treating ignored
 * txns is handled at the insert/toggle path (balance is reversed on ignore).
 */
export const selectEPurseNetWorth = (s) =>
  (s.accounts || []).reduce((sum, a) => sum + (a.balance ?? 0), 0);

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
