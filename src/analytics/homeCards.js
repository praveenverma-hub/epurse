// =============================================================================
// homeCards — what the Dashboard carousel shows, and in what order.
// -----------------------------------------------------------------------------
// The carousel used to be five hardcoded feature banners in a fixed sequence.
// Once someone knows the app those stop earning the slot, so the strip now
// carries LIVE facts pulled from across the app, ranked by urgency.
//
// ── Why the promos are still here ───────────────────────────────────────────
// They're the EMPTY STATE. Cards come from a ranked pool and a card only exists
// when it has real data to state; the promos sit in the lowest tier as fillers.
// A brand-new user has no data, so they see promos — which is exactly when a
// promo works. As real data accumulates, real cards outrank them and push them
// out on their own. That's deliberately instead of "mark a feature as used and
// hide its banner": no per-banner dismissal flags, no usage tracking, nothing to
// keep in sync, and no way for the strip to end up empty.
//
// ── Ranking, not ordering ──────────────────────────────────────────────────
// A card bill due in two days must outrank "your top category is Food", and next
// week it shouldn't exist at all. So: build every candidate, drop the ones with
// no data, sort by tier, take the top few.
//
// PURE and dependency-free on purpose — it takes plain facts rather than the
// store, so `homeCards.test.mjs` can pin the ranking headlessly. The Dashboard
// assembles the facts; this file decides what they mean. Same split as
// `ledgerTotals.js` and `dateRange.js`.
// =============================================================================

import { formatCompact } from '../utils/format';
import { daysUntilDue } from '../utils/dueDate';

/** How many cards the strip shows at most. Promos backfill any spare slots. */
export const HOME_CARD_LIMIT = 5;

/**
 * Feature education — the carousel's EMPTY STATE, not its content.
 *
 * Ordered by how much each changes day-to-day use, not by how clever it is:
 * auto-capture first because it's why the app needs no daily data entry, backup
 * last because it matters most to people who already have data in here. They
 * live in this module rather than in the carousel because `buildHomeCards` is
 * what decides whether they appear at all.
 */
export const PROMO_CARDS = [
  {
    id: 'promo_sms',
    icon: 'flash-outline',
    eyebrow: 'No typing',
    title: 'Your bank SMS,\nread automatically',
    body: 'Every debit and credit, caught and sorted as it lands.',
    cta: 'See today’s activity',
    target: ['Transactions'],
  },
  {
    id: 'promo_split',
    icon: 'people-outline',
    eyebrow: 'Shared spending',
    title: 'Split a bill,\nsettle just once',
    body: 'Trips, groups and one-off splits net to one balance each.',
    cta: 'Open groups',
    target: ['Groups'],
  },
  {
    id: 'promo_lb',
    icon: 'swap-horizontal-outline',
    eyebrow: 'Never forget',
    title: 'Who owes you,\nkept straight',
    body: 'Lent, borrowed and repaid — one net figure per person.',
    cta: 'Open the ledger',
    target: ['LentBorrowed', { kind: 'lent' }],
  },
  {
    id: 'promo_budget',
    icon: 'options-outline',
    eyebrow: 'Your rules',
    title: 'Budgets that count\nwhat you say counts',
    body: 'You choose what counts. Transfers and repayments stay out.',
    cta: 'Set a budget',
    target: ['Insights', { defaultTab: 'budget' }],
  },
  {
    id: 'promo_backup',
    icon: 'shield-checkmark-outline',
    eyebrow: 'Private by design',
    title: 'Encrypted backup,\nonly you hold the key',
    body: 'Your own Google Drive, locked with a password you hold.',
    cta: 'Set up backup',
    target: ['Backup'],
  },
];

/**
 * Urgency tiers. Lower sorts first, and this is the ONLY ranking input — within
 * a tier, order comes from the builder list in `buildHomeCards`.
 * Kept as named constants so a new card has to state which kind of thing it is
 * rather than being slotted in by feel.
 */
export const TIER = {
  /** Time-boxed — true now, false next week, costs money to ignore. */
  URGENT: 1,
  /** A moment worth marking (a week closed, a recap is ready). */
  MOMENT: 2,
  /** A standing fact about how money is moving. */
  INSIGHT: 3,
  /** Housekeeping that protects the data. */
  HYGIENE: 4,
  /** Feature education — the empty state. See the header. */
  PROMO: 5,
};

/**
 * `tone` selects the accent a card is drawn in; the carousel maps it to a theme
 * colour. Urgency should be visible before the text is read, but keep it rare —
 * if three cards are red, none of them is.
 */
const TONE = { ACCENT: 'accent', DANGER: 'danger', SUCCESS: 'success' };

// ── Card builders ───────────────────────────────────────────────────────────
// One function per card. Each returns a card or `null`, and `null` means "there
// is nothing true to say here" — never a card with a zero or an empty value in
// it. Order WITHIN a tier is the order of the builder list in `buildHomeCards`,
// preserved by the stable sort; reordering that list reorders the strip, so a
// test pins the current within-tier sequence.

/**
 * How long an overdue bill keeps warning. A bill 1-3 days past due is worth
 * flagging — the payment may genuinely have been missed. Beyond that, silence:
 * it was almost certainly paid without a payment SMS we could match, and a card
 * that scolds you about a bill you settled a week ago teaches you to ignore the
 * strip. The next cycle's bill replaces the entry anyway.
 */
const OVERDUE_GRACE_DAYS = 3;
/** How far ahead a bill becomes worth interrupting for. */
const DUE_SOON_DAYS = 7;

/**
 * The nearest credit-card bill that's actually actionable.
 *
 * `ccBills` is a map keyed by card, so at most one bill per card; this picks the
 * SOONEST due inside the window rather than showing several, because the strip
 * has a handful of slots and two bill cards would crowd out everything else.
 */
const ccBillCard = (ccBills, nowMs) => {
  const bills = Object.values(ccBills || {});
  if (bills.length === 0) return null;

  const dated = bills
    .map((b) => ({ ...b, days: daysUntilDue(b.dueDate, nowMs) }))
    // A bill with an unparseable date can't say "due in N days", and a vague
    // "you have a bill" isn't worth a slot.
    .filter((b) => b.days != null && b.amount > 0)
    .filter((b) => b.days <= DUE_SOON_DAYS && b.days >= -OVERDUE_GRACE_DAYS)
    .sort((a, b) => a.days - b.days);

  const bill = dated[0];
  if (!bill) return null;

  const card = bill.cardLast4
    ? `${bill.bankName || 'Credit card'} •• ${bill.cardLast4}`
    : (bill.bankName || 'Credit card');

  const when = bill.days < 0
    ? `${Math.abs(bill.days)} ${Math.abs(bill.days) === 1 ? 'day' : 'days'} overdue`
    : bill.days === 0 ? 'due today'
    : bill.days === 1 ? 'due tomorrow'
    : `due in ${bill.days} days`;

  return {
    id: 'cc_bill_due',
    tier: TIER.URGENT,
    tone: TONE.DANGER,
    icon: 'card-outline',
    eyebrow: bill.days < 0 ? 'Overdue' : 'Card bill',
    title: `${formatCompact(bill.amount)} ${when}`,
    body: bill.days < 0
      ? `${card} — late fees may already apply.`
      : `${card} — pay in full to avoid interest.`,
    cta: 'Open accounts',
    target: ['Accounts'],
  };
};

/** Over the monthly cap, or running hot enough that it's about to be. */
const budgetCard = (budget) => {
  if (!budget?.total || budget.total.cap == null) return null;
  const { over, overshoot, pct, remaining } = budget.total;
  const daysLeft = budget.daysLeftInMonth ?? 0;

  if (over) {
    return {
      id: 'budget_over',
      tier: TIER.URGENT,
      tone: TONE.DANGER,
      icon: 'alert-circle-outline',
      eyebrow: 'Over budget',
      title: `${formatCompact(overshoot)} past your cap`,
      body: daysLeft > 0
        ? `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} still to go this month.`
        : 'The month is closing out over plan.',
      cta: 'Review the budget',
      target: ['Insights', { defaultTab: 'budget' }],
    };
  }

  // "Running hot" only means something while there's still month left to change
  // course in — on the 30th it's just a restatement of the total, and the user
  // can't act on it.
  if (daysLeft >= 5 && pct >= 80) {
    return {
      id: 'budget_pace',
      tier: TIER.URGENT,
      tone: TONE.DANGER,
      icon: 'speedometer-outline',
      eyebrow: 'Running hot',
      title: `${Math.round(pct)}% of your budget used`,
      body: `${formatCompact(remaining)} left with ${daysLeft} days to go.`,
      cta: 'See where it went',
      target: ['Insights', { defaultTab: 'budget' }],
    };
  }
  return null;
};

/** A recurring charge that went up — the thing nobody notices on a statement. */
const subscriptionHikeCard = (subscriptions) => {
  const hiked = (subscriptions || []).filter((s) => s.priceHike && s.hikeTo > s.hikeFrom);
  if (hiked.length === 0) return null;
  // Biggest rise first — that's the one worth interrupting for.
  const worst = [...hiked].sort(
    (a, b) => (b.hikeTo - b.hikeFrom) - (a.hikeTo - a.hikeFrom),
  )[0];
  const delta = worst.hikeTo - worst.hikeFrom;
  return {
    id: 'sub_hike',
    tier: TIER.URGENT,
    tone: TONE.DANGER,
    icon: 'trending-up-outline',
    eyebrow: 'Price went up',
    title: `${worst.merchant} rose by ${formatCompact(delta)}`,
    body: `Now ${formatCompact(worst.hikeTo)}, up from ${formatCompact(worst.hikeFrom)}.`,
    cta: 'See subscriptions',
    target: ['Insights'],
  };
};

/**
 * How this week is going.
 *
 * Shows the running total and the per-day average — NOT the week-over-week
 * delta. `selectWeeklySummary`'s `prevTotal` is a COMPLETE week, so comparing a
 * partial week against it flatters you every Monday and alarms you every Sunday.
 * The recap modal can use the delta because it runs on a finished week.
 */
const weekCard = (week) => {
  if (!week || week.total <= 0) return null;
  return {
    id: 'week_pace',
    tier: TIER.MOMENT,
    tone: TONE.ACCENT,
    icon: 'calendar-outline',
    eyebrow: 'This week',
    title: `${formatCompact(week.total)} so far`,
    body: `${formatCompact(week.dailyAvg)} a day over ${week.daysElapsed} ${
      week.daysElapsed === 1 ? 'day' : 'days'
    }.`,
    cta: 'See the breakdown',
    target: ['Insights'],
  };
};

/** Where the money actually went this month. */
const topCategoryCard = (topCategory) => {
  if (!topCategory || !(topCategory.total > 0)) return null;
  // Below ~20% there is no "top" category worth naming — it's just the first row
  // of a flat list, and calling it out implies a concentration that isn't there.
  if ((topCategory.percent ?? 0) < 20) return null;
  return {
    id: 'top_category',
    tier: TIER.INSIGHT,
    tone: TONE.ACCENT,
    icon: 'pie-chart-outline',
    eyebrow: 'Biggest slice',
    title: `${topCategory.emoji || ''} ${topCategory.name}`.trim(),
    body: `${formatCompact(topCategory.total)} — ${Math.round(topCategory.percent)}% of this month.`,
    cta: 'See all categories',
    target: ['Insights'],
  };
};

/**
 * Total recurring commitment.
 *
 * `amount` on a detected subscription is its LATEST charge, and detection
 * requires a consistent amount across months — so summing them is a monthly
 * run-rate, which is the useful framing ("this much leaves every month before I
 * decide anything") rather than "charged so far this month".
 */
const subscriptionsCard = (subscriptions) => {
  const subs = subscriptions || [];
  if (subs.length < 2) return null;   // one subscription isn't a commitment worth a card
  const monthly = subs.reduce((sum, s) => sum + (s.amount || 0), 0);
  if (monthly <= 0) return null;
  return {
    id: 'subscriptions',
    tier: TIER.INSIGHT,
    tone: TONE.ACCENT,
    icon: 'repeat-outline',
    eyebrow: 'Every month',
    title: `${formatCompact(monthly)} in subscriptions`,
    body: `${subs.length} recurring payments, before anything else.`,
    cta: 'See subscriptions',
    target: ['Insights'],
  };
};

/** Spend that has no real category yet, so it can't appear in any breakdown. */
const uncategorisedCard = (uncategorised) => {
  if (!uncategorised || !(uncategorised.amount > 0) || !(uncategorised.count > 0)) return null;
  return {
    id: 'uncategorised',
    tier: TIER.INSIGHT,
    tone: TONE.ACCENT,
    icon: 'help-circle-outline',
    eyebrow: 'Unlabelled',
    title: `${formatCompact(uncategorised.amount)} not categorised`,
    // Short enough for two lines at the centred card's width (see
    // CARD_BODY_MAX_CHARS), and the dash form keeps the count without needing a
    // verb that has to agree with it.
    body: `${uncategorised.count} ${
      uncategorised.count === 1 ? 'transaction' : 'transactions'
    } — invisible in your breakdown.`,
    cta: 'Categorise them',
    target: ['Transactions'],
  };
};

/**
 * Build the ranked card list for the Dashboard carousel.
 *
 * @param {object} facts            live numbers, all optional — a missing fact
 *                                  simply means that card doesn't appear.
 * @param {object|null} facts.budget        `getBudgetUsage()` result
 * @param {object|null} facts.topCategory   top row of `getCategoryBreakdown()`
 * @param {Array}       facts.subscriptions `detectSubscriptions()` result
 * @param {object|null} facts.uncategorised `{ amount, count }` for this month
 * @param {object|null} facts.week          `selectWeeklySummary()` result
 * @param {object|null} facts.ccBills       store `ccBills` map, keyed by card
 * @param {number}      facts.now           epoch ms — INJECTED so the due-date
 *                                          window is testable; don't call
 *                                          Date.now() inside a builder
 * @param {Array}  promos                   feature banners, used as the empty state
 * @param {number} limit                    max cards to return
 * @returns {Array<object>} ranked cards, at most `limit`
 */
export function buildHomeCards(facts = {}, promos = [], limit = HOME_CARD_LIMIT) {
  // Grouped by SUBJECT so this list stays readable as it grows — deliberately
  // NOT in tier order. Display order comes from the sort below and nowhere else,
  // so adding a builder here can never quietly change what the user sees first.
  // (An earlier version listed these in tier order, which made the sort a no-op:
  // deleting it changed nothing and no test noticed. Ranking has to be the only
  // thing that ranks.)
  const live = [
    // A dated obligation outranks everything else in its tier — being over budget
    // is a fact about the past, a bill due tomorrow costs money if ignored. Within
    // a tier this list IS the order (see the sort below), so position matters.
    ccBillCard(facts.ccBills, facts.now),
    budgetCard(facts.budget),
    weekCard(facts.week),
    topCategoryCard(facts.topCategory),
    subscriptionsCard(facts.subscriptions),
    subscriptionHikeCard(facts.subscriptions),
    uncategorisedCard(facts.uncategorised),
  ].filter(Boolean);

  // Tier decides everything. Array#sort is stable on Hermes and in Node, so cards
  // sharing a tier keep the order of the builder list above — which is therefore
  // the within-tier ranking, and is pinned by a test. There is deliberately no
  // second `weight` field: it existed briefly, every within-tier order already
  // matched builder order, so it enforced nothing while implying it did.
  live.sort((a, b) => a.tier - b.tier);

  if (live.length >= limit) return live.slice(0, limit);

  // Backfill with promos — the empty state. Tagged with the PROMO tier so the
  // carousel (and any test) can tell education from live data.
  const fillers = (promos || [])
    .map((p) => ({ tone: TONE.ACCENT, ...p, tier: TIER.PROMO }))
    .slice(0, limit - live.length);

  return [...live, ...fillers];
}
