// =============================================================================
// ePurse — centralised state
// -----------------------------------------------------------------------------
// Single source of truth for:
//   • accounts             — created on the fly from incoming SMSes
//   • transactions         — auto-parsed (SMS) + manual entries
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
//   • 0 – 3 months  → raw transactions
//   • 3 – 24 months → only monthly aggregates per category & account
//   • > 24 months   → dropped entirely
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CATEGORIES, ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';
import { parseMessageDetailed } from '../utils/messageParser';
import { isSameMonth, monthKey } from '../utils/format';

// =============================================================================
// Constants
// =============================================================================
const DAY_MS = 24 * 60 * 60 * 1000;
const RAW_RETENTION_MS  = 90  * DAY_MS;  // 3 months of raw transactions
const AGG_RETENTION_MS  = 730 * DAY_MS;  // 24 months of aggregates
const COMPACT_THROTTLE  = 6   * 60 * 60 * 1000; // run at most every 6 hrs
const REQUIRED_CATEGORY_IDS = ['lent', 'borrowed', 'lent_settled', 'borrow_repaid'];

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
    const m = accounts.find((a) => a.mask === parsed.accountMask);
    if (m) return m;
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
    [ACCOUNT_TYPES.WALLET]: '#10B981',
    [ACCOUNT_TYPES.CASH]: '#F59E0B',
  };
  const auto = {
    id: `acct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type: parsed.accountType,
    name: `${parsed.accountType} ··${parsed.accountMask}`,
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
const isDuplicate = (transactions, parsed, smsId = null) => {
  // Tier 1 — authoritative SMS ID check
  if (smsId) {
    if (transactions.some((t) => t.smsId === smsId)) return true;
  }

  // Tier 2 — near-time content fingerprint (for messages without smsId)
  const candidateTs = new Date(parsed.createdAt || Date.now()).getTime();
  const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
  return transactions.some(
    (t) => {
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
 * Produce monthly aggregates from a list of transactions.
 * Returns `{ '2025-12': { totalSpend, totalIncome, byCategory, byAccount } }`.
 */
const aggregate = (transactions) => {
  const out = {};
  transactions.forEach((t) => {
    const key = monthKey(t.createdAt);
    if (!out[key]) {
      out[key] = { totalSpend: 0, totalIncome: 0, byCategory: {}, byAccount: {} };
    }
    const a = out[key];
    if (t.type === TRANSACTION_TYPES.DEBIT) {
      a.totalSpend += t.amount;
      a.byCategory[t.categoryId] = (a.byCategory[t.categoryId] || 0) + t.amount;
      if (t.accountId) a.byAccount[t.accountId] = (a.byAccount[t.accountId] || 0) - t.amount;
    } else if (t.type === TRANSACTION_TYPES.CREDIT) {
      a.totalIncome += t.amount;
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
      smsAutoImport: false,
      lastSmsSync: null,   // wall-clock time of last sync run (legacy, kept for compat)
      lastSmsDate: null,   // max SMS `date` field (epoch ms) we have ever ingested —
                           // used as the minDate filter for the next inbox sweep so we
                           // never re-read an SMS that was already processed
      lastCompactedAt: null,

      hasOnboarded: false,
      smsPermissionGranted: false,

      hydrated: false,

      // ----- onboarding setters -----------------------------------------
      setUserName: (name) => set({ userName: (name || '').trim() }),
      setHasOnboarded: (v) => set({ hasOnboarded: !!v }),
      setSmsPermissionGranted: (v) => set({ smsPermissionGranted: !!v }),

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

      // ----- transactions ------------------------------------------------
      /** Manual entry from the FAB. */
      addTransaction: (txn) =>
        set((s) => {
          const newTxn = {
            id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            isSplit: false,
            splitWith: [],
            source: 'manual',
            ...txn,
          };
          // Manual entries are allowed without category — caller picks one.
          const { accounts: nextAccounts, account } = ensureAccountForParsed(s.accounts, newTxn);
          newTxn.accountId = account?.id || null;
          return {
            transactions: [newTxn, ...s.transactions],
            accounts: applyDelta(nextAccounts, account?.id, newTxn),
          };
        }),

      /**
       * Single canonical SMS / notification ingestion path.
       * opts: { sender, receivedAt, smsId }
       *   smsId — the Android SMS content-provider _id (string). When present
       *           it is stored on the transaction and used as the primary
       *           deduplication key so the same SMS can never be ingested twice
       *           regardless of timing.
       * Returns the parsed object, or null if not financial / duplicate.
       */
      ingestMessage: (rawMessage, opts = {}) => {
        const parsedResult = parseMessageDetailed(rawMessage, opts);
        if (!parsedResult?.ok) return null;

        const parsedTxns = parsedResult.transactions || [parsedResult.transaction];
        const smsBaseId = opts.smsId ? String(opts.smsId) : null;
        const state = get();

        let nextTransactions = [...state.transactions];
        let nextAccounts = [...state.accounts];
        const added = [];

        parsedTxns.forEach((txn, idx) => {
          const smsId = smsBaseId
            ? (parsedTxns.length > 1 ? `${smsBaseId}:${idx + 1}` : smsBaseId)
            : null;

          const candidate = { ...txn };
          if (smsId) candidate.smsId = smsId;
          if (isDuplicate(nextTransactions, candidate, smsId)) return;

          const { accounts: accountsWithMatch, account } = ensureAccountForParsed(nextAccounts, candidate);
          candidate.accountId = account?.id || null;
          nextAccounts = applyDelta(accountsWithMatch, account?.id, candidate);
          nextTransactions = [candidate, ...nextTransactions];
          added.push(candidate);
        });

        if (added.length === 0) return null;
        set({ transactions: nextTransactions, accounts: nextAccounts });
        return added[0];
      },

      deleteTransaction: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn) return s;
          const reverse = {
            ...txn,
            type: txn.type === TRANSACTION_TYPES.DEBIT
              ? TRANSACTION_TYPES.CREDIT
              : TRANSACTION_TYPES.DEBIT,
          };
          return {
            transactions: s.transactions.filter((t) => t.id !== id),
            accounts: applyDelta(s.accounts, txn.accountId, reverse),
          };
        }),

      toggleSplit: (id, splitWith = []) =>
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, isSplit: !t.isSplit, splitWith } : t
          ),
        })),

      updateTransactionCategory: (id, categoryId) =>
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id ? { ...t, categoryId } : t
          ),
        })),

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
      addLentBorrowed: (entry) =>
        set((s) => ({
          lentBorrowed: [
            { id: `lb_${Date.now()}`, date: new Date().toISOString(), ...entry },
            ...s.lentBorrowed,
          ],
        })),

      settleLentBorrowed: (id) =>
        set((s) => ({ lentBorrowed: s.lentBorrowed.filter((l) => l.id !== id) })),

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
       *   • compute aggregates for any transaction ≥ 3 months old
       *   • drop those raw transactions
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
            if (ts >= rawCutoff) stillRaw.push(t);
            else toAggregate.push(t);
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
            monthlyAggregates: merged,
            lastCompactedAt: now,
          };
        });
      },

      // ----- derived selectors ------------------------------------------
      getTotalBalance: () => get().accounts.reduce((sum, a) => sum + (a.balance || 0), 0),

      getTotalLent: () =>
        get().lentBorrowed.filter((l) => l.kind === 'lent').reduce((s, l) => s + l.amount, 0) +
        get().transactions
          .filter((t) => t.categoryId === 'lent')
          .reduce((s, t) => s + (t.amount || 0), 0) -
        get().transactions
          .filter((t) => t.categoryId === 'lent_settled')
          .reduce((s, t) => s + (t.amount || 0), 0),

      getTotalBorrowed: () =>
        get().lentBorrowed.filter((l) => l.kind === 'borrowed').reduce((s, l) => s + l.amount, 0) +
        get().transactions
          .filter((t) => t.categoryId === 'borrowed')
          .reduce((s, t) => s + (t.amount || 0), 0) -
        get().transactions
          .filter((t) => t.categoryId === 'borrow_repaid')
          .reduce((s, t) => s + (t.amount || 0), 0),

      /**
       * Monthly spend — uses raw transactions if any are present for that
       * month, otherwise falls back to the aggregate.
       */
      getMonthlySpend: (date = new Date()) => {
        const txns = get().transactions.filter(
          (t) => t.type === TRANSACTION_TYPES.DEBIT && isSameMonth(t.createdAt, date)
        );
        if (txns.length > 0) return txns.reduce((s, t) => s + t.amount, 0);
        return get().monthlyAggregates[monthKey(date)]?.totalSpend || 0;
      },

      getMonthlyIncome: (date = new Date()) => {
        const txns = get().transactions.filter(
          (t) => t.type === TRANSACTION_TYPES.CREDIT && isSameMonth(t.createdAt, date)
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
          (t) => t.type === TRANSACTION_TYPES.DEBIT && isSameMonth(t.createdAt, date)
        );

        let totals;
        let grandTotal;
        if (raw.length > 0) {
          totals = {};
          raw.forEach((t) => {
            totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
          });
          grandTotal = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
        } else {
          const agg = get().monthlyAggregates[month];
          if (!agg) return [];
          totals = agg.byCategory || {};
          grandTotal = agg.totalSpend || 1;
        }

        return cats
          .map((c) => ({ ...c, total: totals[c.id] || 0, percent: ((totals[c.id] || 0) / grandTotal) * 100 }))
          .filter((c) => c.total > 0)
          .sort((a, b) => b.total - a.total);
      },

      getRecentTransactions: (limit = 5) =>
        [...get().transactions]
          .filter((t) => !t.isHidden)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, limit),

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
          userName: '',
          hasOnboarded: false,
          smsPermissionGranted: false,
        }),
    }),
    {
      name: '@ePurse:store',
      // Bump this whenever the schema changes in a way that requires a wipe.
      // The migration below kills any stale demo / seed data that an older
      // build might have written to AsyncStorage before we removed the seeds.
      version: 4,
      migrate: (persistedState, version) => {
        // Earlier versions seeded dummy accounts, transactions and IOUs.
        // Wipe those so users coming from those builds start clean.
        if (!persistedState || version < 2) {
          return {
            ...(persistedState || {}),
            accounts: [],
            transactions: [],
            lentBorrowed: [],
            monthlyAggregates: {},
            lastSmsSync: null,
            lastSmsDate: null,
            lastCompactedAt: null,
            // Keep userName/hasOnboarded/smsPermissionGranted if present so
            // the user isn't bounced back into onboarding after the wipe.
          };
        }
        if (version < 4) {
          return {
            ...persistedState,
            categories: ensureRequiredCategories(persistedState.categories || []),
          };
        }
        return persistedState;
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
        lastCompactedAt: state.lastCompactedAt,
        userName: state.userName,
        hasOnboarded: state.hasOnboarded,
        smsPermissionGranted: state.smsPermissionGranted,
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
export const selectVisibleTransactions = (s) => s.transactions.filter((t) => !t.isHidden);
export const selectCategories = (s) => s.categories;
export const selectLentBorrowed = (s) => s.lentBorrowed;
