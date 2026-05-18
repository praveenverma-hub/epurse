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
import { DEFAULT_THEME_ID } from '../constants/themes';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { parseMessageDetailed } from '../utils/messageParser';
import { isSameMonth, monthKey } from '../utils/format';
import { fireBudgetBreachNotification, fireMidmonthNudgeNotification } from '../utils/notifications';
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
const REQUIRED_CATEGORY_IDS = ['lent', 'borrowed', 'lent_settled', 'borrow_repaid'];

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
      if (!LB_ALL_CATS.has(t.categoryId)) a.totalSpend += spend;
      if (t.accountId) a.byAccount[t.accountId] = (a.byAccount[t.accountId] || 0) - t.amount;
    } else if (t.type === TRANSACTION_TYPES.CREDIT) {
      a.byCategory[t.categoryId] = (a.byCategory[t.categoryId] || 0) + t.amount;
      if (!LB_ALL_CATS.has(t.categoryId)) a.totalIncome += t.amount;
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

      /** Persisted: blocks inbox re-import after user deletes / ignores an SMS-backed txn. */
      suppressedSmsIds: [],

      /** Persisted: last assigned manual reference number (next txn → IdM + zero-padded). */
      manualTxnSeq: 0,

      hasOnboarded: false,
      smsPermissionGranted: false,
      contactsPermissionGranted: false,

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

      // Per-month dedup so we only fire one breach notification per category
      // (and one for the overall total) — { '2026-05': ['shopping', '__total__'] }
      budgetBreachNotified: {},

      // When a month rollover commits a snapshot, we stash the result here so the
      // dashboard can pop a celebration modal on the user's next visit. Cleared
      // after the modal is dismissed.
      //   { monthKey, totalActual, totalCap, status, overshoot, streakAfter, savedAmount }
      pendingCelebration: null,

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
          return {
            budget: {
              monthKey: monthKey(new Date()),
              totalCap: plan?.totalCap ?? null,
              perCategory: plan?.perCategory ? { ...plan.perCategory } : {},
              startDay: 1, // calendar month for Phase 1 — settings hook later
              createdAt: s.budget?.createdAt || nowIso,
              lastEditedAt: nowIso,
            },
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
          return {
            budget: {
              ...current,
              perCategory: { ...current.perCategory, [categoryId]: Number(cap) || 0 },
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
          return {
            budget: { ...s.budget, perCategory: next, lastEditedAt: new Date().toISOString() },
            budgetBreachNotified: { ...s.budgetBreachNotified, [currentMonth]: breachMonth },
          };
        }),

      setBudgetTotalCap: (cap) =>
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
          return {
            budget: { ...current, totalCap: cap == null ? null : Number(cap) || 0, lastEditedAt: nowIso },
          };
        }),

      clearBudget: () => set({ budget: null, budgetBreachNotified: {} }),

      /** Dismisses the celebration modal — called when the user closes it. */
      clearPendingCelebration: () => set({ pendingCelebration: null }),

      // ─── Daily Queue / XP actions ───────────────────────────────────────────
      addXP: (amount) =>
        set((s) => ({ xp: (s.xp || 0) + Math.max(0, Number(amount) || 0) })),

      /**
       * Mark a transaction as reviewed.
       * Awards +10 XP and updates the daily review streak.
       * No-op if already reviewed.
       */
      markReviewed: (id) =>
        set((s) => {
          const txn = s.transactions.find((t) => t.id === id);
          if (!txn || txn.isReviewed) return s;

          const newXp = (s.xp || 0) + 10;
          const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
          const streak = s.reviewStreak || { current: 0, best: 0, lastReviewDate: null };
          let { current, best } = streak;
          let isNewStreakDay = false;

          if (streak.lastReviewDate !== todayStr) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().slice(0, 10);
            current = streak.lastReviewDate === yesterdayStr ? current + 1 : 1;
            if (current > best) best = current;
            isNewStreakDay = true;
          }

          // Reward economy: 5 coins per review, plus streak milestone bonuses.
          // Lazy import to avoid circular dep at module load.
          try {
            const { useRewardStore } = require('./useRewardStore');
            const awardCoins = useRewardStore.getState().awardCoins;
            awardCoins(5);
            if (isNewStreakDay) {
              if (current === 3)  awardCoins(20);
              if (current === 7)  awardCoins(50);
              if (current === 30) awardCoins(200);
            }
          } catch {/* reward store not loaded yet — skip silently */}

          return {
            transactions: s.transactions.map((t) =>
              t.id === id ? { ...t, isReviewed: true } : t
            ),
            xp: newXp,
            reviewStreak: { current, best, lastReviewDate: todayStr },
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
        if (categoryId && s.budget.perCategory[categoryId] != null) {
          const cat = usage.perCategory[categoryId];
          if (cat?.over && !notifiedList.includes(categoryId)) {
            toMark.push(categoryId);
            const meta = s.categories.find((c) => c.id === categoryId);
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
            budget: { ...s.budget, monthKey: currentMonth, lastEditedAt: new Date().toISOString() },
            budgetHistory: { ...s.budgetHistory, [prevMonth]: historyEntry },
            budgetStreak: { current, best, lastResetMonth },
            // Drop old months' dedup — keep only the new (current) month
            budgetBreachNotified: { [currentMonth]: [] },
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
          const { splitOthers, ...txnRest } = txn;
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
          if (!txn?.amount || txn.amount <= 0 || txn.amount > MAX_ALLOWED_AMOUNT) return;
          const smsId = smsBaseId
            ? (parsedTxns.length > 1 ? `${smsBaseId}:${idx + 1}` : smsBaseId)
            : null;

          const candidate = { ...txn, isReviewed: false };
          if (smsId) candidate.smsId = smsId;
          if (isDuplicate(nextTransactions, candidate, smsId, state.suppressedSmsIds || [])) return;

          const { accounts: accountsWithMatch, account } = ensureAccountForParsed(nextAccounts, candidate);
          candidate.accountId = account?.id || null;
          nextAccounts = applyDelta(accountsWithMatch, account?.id, candidate);
          nextTransactions = [candidate, ...nextTransactions];
          added.push(candidate);
        });

        if (added.length === 0) return null;
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
        set((s) => ({
          transactions: s.transactions.map((t) =>
            t.id === id
              ? { ...t, parentCategory, childCategory, userEdited: true, userEditedCategory: true }
              : t
          ),
        })),

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

            if (ts >= rawCutoff) stillRaw.push(t);
            else toAggregate.push(t);
          });

          const lentBorrowedPruned = (s.lentBorrowed || []).filter((l) => {
            if (!l.settledAt) return true;
            return new Date(l.settledAt).getTime() >= now - LB_SETTLED_RETENTION_MS;
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
            !LB_ALL_CATS.has(t.categoryId) &&
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
            !LB_ALL_CATS.has(t.categoryId) &&
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
            !LB_ALL_CATS.has(t.categoryId) &&
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
            if (!LB_ALL_CATS.has(catId)) totals[catId] = val;
          });
          grandTotal = agg.totalSpend || 1;
        }

        return cats
          .filter((c) => !LB_ALL_CATS.has(c.id))
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

        const byCategory = {};
        let totalActual = 0;
        s.transactions.forEach((t) => {
          if (t.isIgnored) return;
          if (new Date(t.createdAt).getTime() < monthStart) return;
          if (t.type !== TRANSACTION_TYPES.DEBIT) return;
          const spend = debitDisplayAmount(t);
          byCategory[t.categoryId] = (byCategory[t.categoryId] || 0) + spend;
          if (!LB_ALL_CATS.has(t.categoryId)) totalActual += spend;
        });

        const totalCap = s.budget.totalCap;
        const perCategory = {};
        Object.entries(s.budget.perCategory).forEach(([catId, cap]) => {
          const actual = byCategory[catId] || 0;
          perCategory[catId] = {
            cap,
            actual,
            pct:       cap > 0 ? (actual / cap) * 100 : 0,
            remaining: Math.max(0, cap - actual),
            over:      actual > cap,
            overshoot: Math.max(0, actual - cap),
          };
        });

        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dayOfMonth     = now.getDate();
        const daysLeftInMonth = lastDayOfMonth - dayOfMonth;
        const daysElapsedPct  = (dayOfMonth / lastDayOfMonth) * 100;

        return {
          monthKey: monthKey(now),
          total: {
            cap: totalCap,
            actual: totalActual,
            pct: totalCap > 0 ? (totalActual / totalCap) * 100 : 0,
            remaining: totalCap != null ? Math.max(0, totalCap - totalActual) : null,
            over: totalCap != null && totalActual > totalCap,
            overshoot: (totalCap != null && totalActual > totalCap) ? (totalActual - totalCap) : 0,
          },
          perCategory,
          daysLeftInMonth,
          daysElapsedPct,
          dayOfMonth,
          lastDayOfMonth,
        };
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
            if (LB_ALL_CATS.has(catId)) return;
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
       * Groups by contactId > phone > lowercased name.
       * Returns array of { personKey, person, contactId, phone, lent, borrowed, net, entries }
       * sorted by absolute net (largest first).
       */
      getPersonBalances: () => {
        const map = new Map();

        get().lentBorrowed.forEach((l) => {
          const key = l.contactId || l.phone || (l.person || '').trim().toLowerCase();
          if (!map.has(key)) {
            map.set(key, {
              personKey: key,
              person: l.person,
              contactId: l.contactId || null,
              phone: l.phone || null,
              lent: 0,
              borrowed: 0,
              entries: [],
            });
          }
          const rec = map.get(key);
          // Additive formula — every entry contributes to net:
          //   net = Σlent - Σlent_settled - Σborrowed + Σborrow_repaid
          if (l.kind === 'lent')          rec.lent     += l.amount;
          if (l.kind === 'lent_settled')  rec.lent     -= l.amount;
          if (l.kind === 'borrowed')      rec.borrowed += l.amount;
          if (l.kind === 'borrow_repaid') rec.borrowed -= l.amount;
          rec.entries.push(l);
        });

        return [...map.values()]
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
      version: 14,
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
        hasOnboarded: state.hasOnboarded,
        smsPermissionGranted: state.smsPermissionGranted,
        contactsPermissionGranted: state.contactsPermissionGranted,
        themeId: state.themeId,
        darkMode: state.darkMode,
        notificationIds: state.notificationIds,
        budget: state.budget,
        budgetHistory: state.budgetHistory,
        budgetStreak: state.budgetStreak,
        budgetBreachNotified: state.budgetBreachNotified,
        pendingCelebration: state.pendingCelebration,
        lastMidmonthNudgeMonth: state.lastMidmonthNudgeMonth,
        xp: state.xp,
        reviewStreak: state.reviewStreak,
        userCustomRules: state.userCustomRules,
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
