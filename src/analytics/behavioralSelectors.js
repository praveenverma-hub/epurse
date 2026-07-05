// =============================================================================
// behavioralSelectors.js — pure computation functions for behavioral analytics
// No React, no hooks. All three functions filter out isIgnored and LB cats.
// =============================================================================

import { TRANSACTION_TYPES, NON_SPEND_CATEGORY_IDS } from '../constants/categories';
import { debitDisplayAmount } from '../utils/split';

// Excluded from behavioral spend analytics: the app-wide non-spend set (LB
// ledger, self transfers, CC-bill payments) — real money movement, but neither
// income nor expense. Shared with the store so pace/bubbles/subscriptions match
// the Spent/Earned summary exactly and can never drift.
const LB_CATS = NON_SPEND_CATEGORY_IDS;

/**
 * Computes day-by-day cumulative debit spend for targetDate's month (current)
 * and the previous calendar month (ghost). Both arrays are 1-indexed (index 0 = 0).
 * Returns { current, ghost, daysInMonth, daysInPrevMonth, maxDay, isCurrentMonth }
 */
export function getDailyCumulative(transactions, targetDate = new Date()) {
  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  const prevDate = new Date(y, m - 1, 1);
  const py = prevDate.getFullYear();
  const pm = prevDate.getMonth();
  const daysInPrevMonth = new Date(py, pm + 1, 0).getDate();

  const now = new Date();
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
  const maxDay = isCurrentMonth ? now.getDate() : daysInMonth;

  const curDaily = new Array(daysInMonth + 1).fill(0);
  const ghostDaily = new Array(daysInPrevMonth + 1).fill(0);

  transactions.forEach((t) => {
    if (t.isIgnored || t.type !== TRANSACTION_TYPES.DEBIT || LB_CATS.has(t.categoryId)) return;
    const d = new Date(t.createdAt);
    const ty = d.getFullYear();
    const tm = d.getMonth();
    const td = d.getDate();
    const amt = debitDisplayAmount(t);
    if (ty === y && tm === m && td >= 1 && td <= daysInMonth) {
      curDaily[td] += amt;
    } else if (ty === py && tm === pm && td >= 1 && td <= daysInPrevMonth) {
      ghostDaily[td] += amt;
    }
  });

  const current = [0];
  for (let i = 1; i <= daysInMonth; i++) current.push(current[i - 1] + curDaily[i]);

  const ghost = [0];
  for (let i = 1; i <= daysInPrevMonth; i++) ghost.push(ghost[i - 1] + ghostDaily[i]);

  return { current, ghost, daysInMonth, daysInPrevMonth, maxDay, isCurrentMonth };
}

/**
 * Category breakdown for an ARBITRARY transaction list (e.g. one group's txns),
 * mirroring the store's getCategoryBreakdown but on data the caller pre-filters.
 * Pools the user's personal share (debitDisplayAmount) so split/group rows count
 * only your portion. Excludes non-spend cats. Returns [] when nothing qualifies.
 * Each row: { ...category, total, percent } sorted desc — shape BarChart/rings expect.
 */
export function buildCategoryBreakdown(transactions, categories) {
  const totals = {};
  let grand = 0;
  for (const t of transactions) {
    if (t.isIgnored || t.type !== TRANSACTION_TYPES.DEBIT || LB_CATS.has(t.categoryId)) continue;
    const share = debitDisplayAmount(t);
    if (share <= 0) continue;
    totals[t.categoryId] = (totals[t.categoryId] || 0) + share;
    grand += share;
  }
  if (grand <= 0) return [];
  return categories
    .filter((c) => !LB_CATS.has(c.id))
    .map((c) => ({ ...c, total: totals[c.id] || 0, percent: ((totals[c.id] || 0) / grand) * 100 }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
}

/**
 * Groups debit transactions in targetDate's month by normalized merchant name.
 * Returns merchants with >= 2 transactions, sorted by total volume desc, capped at 18.
 * Each entry: { key, name, frequency, volume, avgAmount }
 */
export function getMerchantBubbles(transactions, targetDate = new Date()) {
  const y = targetDate.getFullYear();
  const m = targetDate.getMonth();
  const map = new Map();

  transactions.forEach((t) => {
    if (t.isIgnored || t.type !== TRANSACTION_TYPES.DEBIT || LB_CATS.has(t.categoryId)) return;
    const d = new Date(t.createdAt);
    if (d.getFullYear() !== y || d.getMonth() !== m) return;
    const raw = (t.merchant || '').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!map.has(key)) map.set(key, { key, name: raw, frequency: 0, volume: 0 });
    const rec = map.get(key);
    rec.frequency += 1;
    rec.volume += debitDisplayAmount(t);
  });

  return [...map.values()]
    .map((b) => ({ ...b, avgAmount: b.volume / b.frequency }))
    .filter((b) => b.frequency >= 2)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 18);
}

/**
 * Detects recurring subscription-like patterns across all raw transactions.
 * Criteria: same merchant in >= 2 distinct months, amount consistent (±15% of median),
 * day-of-month consistent (±4 days, 65%+ of occurrences).
 * Returns entries sorted by amount desc with priceHike flag if latest > prev by 5%+.
 * Each entry: { merchant, merchantKey, amount, dayOfMonth, months, priceHike, hikeFrom, hikeTo, lastDate, categoryId }
 */
export function detectSubscriptions(transactions) {
  const byMerchant = new Map();

  transactions.forEach((t) => {
    if (t.isIgnored || t.type !== TRANSACTION_TYPES.DEBIT || LB_CATS.has(t.categoryId)) return;
    const key = (t.merchant || '').trim().toLowerCase();
    if (!key) return;
    if (!byMerchant.has(key)) byMerchant.set(key, []);
    byMerchant.get(key).push(t);
  });

  const subscriptions = [];

  byMerchant.forEach((txns, key) => {
    if (txns.length < 2) return;

    const byMonth = new Map();
    txns.forEach((t) => {
      const d = new Date(t.createdAt);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(mk)) byMonth.set(mk, []);
      byMonth.get(mk).push(t);
    });
    if (byMonth.size < 2) return;

    const allAmounts = txns.map((t) => debitDisplayAmount(t)).sort((a, b) => a - b);
    const median = allAmounts[Math.floor(allAmounts.length / 2)];
    if (median <= 0) return;
    const consistentAmt = allAmounts.filter((a) => Math.abs(a - median) / median < 0.15);
    if (consistentAmt.length / allAmounts.length < 0.65) return;

    const days = txns.map((t) => new Date(t.createdAt).getDate()).sort((a, b) => a - b);
    const medianDay = days[Math.floor(days.length / 2)];
    const consistentDay = days.filter((d) => Math.abs(d - medianDay) <= 4);
    if (consistentDay.length / days.length < 0.65) return;

    const sortedMonths = [...byMonth.keys()].sort();
    const latestMk = sortedMonths[sortedMonths.length - 1];
    const prevMk = sortedMonths[sortedMonths.length - 2];
    const latestAmt = debitDisplayAmount(byMonth.get(latestMk)[0]);
    const prevAmt = debitDisplayAmount(byMonth.get(prevMk)[0]);
    const priceHike = latestAmt > prevAmt * 1.05;

    const latest = [...txns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    subscriptions.push({
      merchant: latest.merchant || key,
      merchantKey: key,
      amount: latestAmt,
      dayOfMonth: medianDay,
      months: byMonth.size,
      priceHike,
      hikeFrom: priceHike ? prevAmt : null,
      hikeTo: priceHike ? latestAmt : null,
      lastDate: latest.createdAt,
      categoryId: latest.categoryId,
    });
  });

  return subscriptions.sort((a, b) => b.amount - a.amount);
}
