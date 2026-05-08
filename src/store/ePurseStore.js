// =============================================================================
// ePurse — centralised state
// -----------------------------------------------------------------------------
// Single source of truth for:
//   • accounts        — Bank / Credit Card / Wallet / Cash (simulated)
//   • transactions    — auto-parsed (SMS) + manual entries
//   • categories      — defaults + custom user-added
//   • lentBorrowed    — informal IOUs ("you lent ₹500 to Rohit")
//   • smsAutoImport   — toggle for the live Android SMS listener
//   • lastSmsSync     — timestamp of the last successful sync
//
// Persistence:        AsyncStorage via the `persist` middleware (free, on-device)
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CATEGORIES, ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';
import { parseMessage, buildSampleTransactions } from '../utils/messageParser';
import { isSameMonth } from '../utils/format';

// =============================================================================
// Seed data — used on first run and on "Reset all data".
// =============================================================================
const seedAccounts = () => [
  { id: 'bank_01',   type: ACCOUNT_TYPES.BANK,        name: 'HDFC Savings',   mask: '1234', balance: 42310, color: '#1E40AF' },
  { id: 'cc_01',     type: ACCOUNT_TYPES.CREDIT_CARD, name: 'HDFC Millennia', mask: '4321', balance: -8420, creditLimit: 150000, color: '#6D28D9' },
  { id: 'wallet_01', type: ACCOUNT_TYPES.WALLET,      name: 'Paytm Wallet',   mask: '••••', balance: 480,   color: '#10B981' },
  { id: 'cash_01',   type: ACCOUNT_TYPES.CASH,        name: 'Cash in hand',   mask: '',     balance: 1500,  color: '#F59E0B' },
];

const seedTransactions = () => buildSampleTransactions();

const seedLentBorrowed = () => [
  { id: 'lb_1', kind: 'lent',     person: 'Rohit', amount: 500,  note: 'Movie tickets', date: new Date().toISOString() },
  { id: 'lb_2', kind: 'borrowed', person: 'Aman',  amount: 1200, note: 'Petrol',        date: new Date().toISOString() },
];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find the account that best matches a parsed transaction.
 * Strategy: exact mask match first, then fall back to account-type match.
 */
const matchAccount = (accounts, parsed) => {
  if (!parsed) return null;
  if (parsed.accountMask) {
    const m = accounts.find((a) => a.mask === parsed.accountMask);
    if (m) return m;
  }
  return accounts.find((a) => a.type === parsed.accountType) || null;
};

/**
 * Apply a debit/credit delta to an account.
 * Credit cards behave inversely: a "spend" makes the outstanding *more* negative.
 * For all other account types: debit → balance goes down, credit → balance goes up.
 */
const applyDelta = (accounts, accountId, parsed) => {
  if (!accountId) return accounts;
  const sign = parsed.type === TRANSACTION_TYPES.DEBIT ? -1 : 1;
  return accounts.map((a) =>
    a.id === accountId ? { ...a, balance: a.balance + sign * parsed.amount } : a
  );
};

/**
 * Detect a near-duplicate transaction within the last 5 minutes —
 * prevents double-counting if both the SMS listener and the user's manual
 * paste end up feeding the same message.
 */
const isDuplicate = (transactions, parsed) => {
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  return transactions.some(
    (t) =>
      t.amount === parsed.amount &&
      (t.accountMask || null) === (parsed.accountMask || null) &&
      (t.merchant || '').toLowerCase() === (parsed.merchant || '').toLowerCase() &&
      new Date(t.createdAt).getTime() > fiveMinAgo
  );
};

// =============================================================================
// Store
// =============================================================================
export const useEPurseStore = create(
  persist(
    (set, get) => ({
      // ----- state -------------------------------------------------------
      accounts: seedAccounts(),
      transactions: seedTransactions(),
      categories: DEFAULT_CATEGORIES,
      lentBorrowed: seedLentBorrowed(),

      // SMS auto-import (Android only)
      smsAutoImport: false,
      lastSmsSync: null,

      // Onboarding / permissions
      hasOnboarded: false,           // true after first-launch permission screen is dismissed
      smsPermissionGranted: false,   // true after user grants READ_SMS + RECEIVE_SMS

      hydrated: false,

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
      /**
       * Add a fully-formed transaction (e.g. from the manual-entry FAB).
       * Also applies the delta to the matching account.
       */
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
          const acct = matchAccount(s.accounts, newTxn);
          newTxn.accountId = acct?.id || null;
          return {
            transactions: [newTxn, ...s.transactions],
            accounts: applyDelta(s.accounts, acct?.id, newTxn),
          };
        }),

      /**
       * Parse a raw SMS / notification, dedupe, store the transaction, and
       * apply the +/- delta to the matched account. Used by *both* the
       * "Simulate SMS" button and the real Android SMS listener.
       *
       * @returns the parsed object, or null if not financial / duplicate.
       */
      ingestMessage: (rawMessage, opts = {}) => {
        const parsed = parseMessage(rawMessage, opts);
        if (!parsed) return null;

        const state = get();
        if (isDuplicate(state.transactions, parsed)) return null;

        const acct = matchAccount(state.accounts, parsed);
        parsed.accountId = acct?.id || null;

        set({
          transactions: [parsed, ...state.transactions],
          accounts: applyDelta(state.accounts, acct?.id, parsed),
        });
        return parsed;
      },

      deleteTransaction: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn) return s;
          // reverse the original delta so deleting a txn restores the balance
          const reverse = {
            ...txn,
            type:
              txn.type === TRANSACTION_TYPES.DEBIT
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

      // ----- SMS auto-import flags --------------------------------------
      setSmsAutoImport: (val) => set({ smsAutoImport: !!val }),
      setLastSmsSync: (ts) => set({ lastSmsSync: ts || Date.now() }),
      setHasOnboarded: (val) => set({ hasOnboarded: !!val }),
      setSmsPermissionGranted: (val) => set({ smsPermissionGranted: !!val, smsAutoImport: !!val }),

      // ----- derived selectors ------------------------------------------
      getTotalBalance: () => get().accounts.reduce((sum, a) => sum + (a.balance || 0), 0),

      getTotalLent: () =>
        get().lentBorrowed.filter((l) => l.kind === 'lent').reduce((s, l) => s + l.amount, 0),

      getTotalBorrowed: () =>
        get().lentBorrowed.filter((l) => l.kind === 'borrowed').reduce((s, l) => s + l.amount, 0),

      getMonthlySpend: (date = new Date()) =>
        get()
          .transactions.filter((t) => t.type === TRANSACTION_TYPES.DEBIT && isSameMonth(t.createdAt, date))
          .reduce((s, t) => s + t.amount, 0),

      getMonthlyIncome: (date = new Date()) =>
        get()
          .transactions.filter((t) => t.type === TRANSACTION_TYPES.CREDIT && isSameMonth(t.createdAt, date))
          .reduce((s, t) => s + t.amount, 0),

      getCategoryBreakdown: (date = new Date()) => {
        const cats = get().categories;
        const txns = get().transactions.filter(
          (t) => t.type === TRANSACTION_TYPES.DEBIT && isSameMonth(t.createdAt, date)
        );
        const totals = {};
        txns.forEach((t) => {
          totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
        });
        const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
        return cats
          .map((c) => ({ ...c, total: totals[c.id] || 0, percent: ((totals[c.id] || 0) / grandTotal) * 100 }))
          .filter((c) => c.total > 0)
          .sort((a, b) => b.total - a.total);
      },

      getRecentTransactions: (limit = 5) =>
        [...get().transactions]
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, limit),

      // ----- danger zone -------------------------------------------------
      resetAll: () =>
        set({
          accounts: seedAccounts(),
          transactions: seedTransactions(),
          categories: DEFAULT_CATEGORIES,
          lentBorrowed: seedLentBorrowed(),
          smsAutoImport: false,
          lastSmsSync: null,
        }),
    }),
    {
      name: '@ePurse:store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        accounts: state.accounts,
        transactions: state.transactions,
        categories: state.categories,
        lentBorrowed: state.lentBorrowed,
        smsAutoImport: state.smsAutoImport,
        lastSmsSync: state.lastSmsSync,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    }
  )
);

export const selectAccounts = (s) => s.accounts;
export const selectTransactions = (s) => s.transactions;
export const selectCategories = (s) => s.categories;
export const selectLentBorrowed = (s) => s.lentBorrowed;
