// =============================================================================
// bellFeed.ts — what the bell's NotificationsSheet shows, and whether the bell
// dot is lit. Pure, so test:bellFeed pins it headlessly.
//
//   Money Due  — LIVE: open card bills from `ccBills` (cleared on payment) +
//                the card-payment review question. Never stale.
//   Days       — Today / Yesterday / Earlier: feed entries + bill payments
//                read from each card's `paymentHistory`.
//   Rewards    — every reward kind folds into ONE row; never lights the bell.
// =============================================================================

import type { NotificationEntry, NotificationKind } from '../store/useNotificationStore';
import { openCcBills } from './homeCards';
import { formatCurrency } from '../utils/format';
import { NOTIFICATION_MAX_AGE_MS } from '../constants/retention';
import { ACCOUNT_TYPES } from '../constants/categories';

export const REWARD_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  'aware_check_in', 'aware_streak_reset', 'aware_savings_ready', 'aware_savings_claimed', 'level_up',
]);

/** Kinds the Money Due section shows from live state instead. */
const DUE_KINDS: ReadonlySet<NotificationKind> = new Set<NotificationKind>(['cc_due', 'cc_payment_review']);

const CC_DUE_PREFIX = 'cc_due:';

export interface DueRow {
  id:         string;
  type:       'bill' | 'review';
  title:      string;
  body:       string;
  trailing:   string | null;
  /** Due date passed or due today. */
  urgent:     boolean;
  cardLast4?: string | null;
  /** The feed entry this row stands for, marked read on tap. */
  entryId?:   string;
  isRead:     boolean;
}

export interface FeedRow {
  id:         string;
  kind:       NotificationKind | 'cc_bill_paid';
  title:      string;
  body:       string;
  trailing:   string | null;
  at:         number;
  isRead:     boolean;
  entry?:     NotificationEntry;
  accountId?: string;
}

export type DayLabel = 'Today' | 'Yesterday' | 'Earlier';

export interface BellFeed {
  due:     DueRow[];
  days:    { label: DayLabel; rows: FeedRow[] }[];
  rewards: NotificationEntry[];
}

interface CardAccount {
  id: string;
  type?: string;
  name?: string;
  bankName?: string;
  mask?: string;
  paymentHistory?: { date: number; amount: number; remainingAfter?: number | null }[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The figure a row shows on the right, read from the entry's meta. */
export const trailingFor = (e: NotificationEntry): string | null => {
  const m = e.meta || {};
  if (e.kind === 'budget_breach') {
    const actual = num(m.actual), cap = num(m.cap);
    return actual != null && cap != null ? `${formatCurrency(actual)} / ${formatCurrency(cap)}` : null;
  }
  if (e.kind === 'subscription_hike') {
    const from = num(m.hikeFrom), to = num(m.hikeTo);
    return from != null && to != null ? `${formatCurrency(from)} → ${formatCurrency(to)}` : null;
  }
  if (e.kind === 'cc_payment_review') {
    const amount = num(m.amount);
    return amount != null ? formatCurrency(amount) : null;
  }
  return null;
};

const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const dayLabel = (at: number, nowMs: number): DayLabel => {
  const today = startOfDay(nowMs);
  if (at >= today) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  return at >= yesterday.getTime() ? 'Yesterday' : 'Earlier';
};

const cardLabel = (a: CardAccount): string =>
  a.mask ? `${a.bankName || a.name || 'Credit card'} •• ${a.mask}` : (a.bankName || a.name || 'Credit card');

const paidRows = (accounts: CardAccount[], nowMs: number): FeedRow[] => {
  const cutoff = nowMs - NOTIFICATION_MAX_AGE_MS;
  return accounts.flatMap((a) =>
    (a.paymentHistory || [])
      .filter((p) => num(p.date) != null && p.date >= cutoff && p.amount > 0)
      .map((p) => {
        const left = num(p.remainingAfter);
        return {
          id:        `paid:${a.id}:${p.date}`,
          kind:      'cc_bill_paid' as const,
          title:     `${cardLabel(a)} ${left != null && left > 0 ? 'part paid' : 'bill paid'}`,
          body:      left != null && left > 0 ? `${formatCurrency(left)} still due.` : 'Bill cleared.',
          trailing:  formatCurrency(p.amount),
          at:        p.date,
          isRead:    true,
          accountId: a.id,
        };
      }),
  );
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const buildBellFeed = ({
  entries, ccBills, accounts, nowMs,
}: {
  entries:  NotificationEntry[];
  ccBills:  Record<string, unknown> | null | undefined;
  accounts: CardAccount[] | null | undefined;
  nowMs:    number;
}): BellFeed => {
  const byKey = new Map(entries.map((e) => [e.dedupeKey, e]));

  const due: DueRow[] = [];
  const review = entries.find((e) => e.kind === 'cc_payment_review');
  if (review) {
    due.push({
      id: review.id, type: 'review', title: review.title, body: review.body,
      trailing: trailingFor(review), urgent: false, entryId: review.id, isRead: review.isRead,
    });
  }
  for (const b of openCcBills(ccBills, nowMs)) {
    const when = b.when ?? (b.dueDate ? `due ${b.dueDate}` : 'bill received');
    const entry = byKey.get(`${CC_DUE_PREFIX}${b.key}`);
    due.push({
      id:        `bill:${b.key}`,
      type:      'bill',
      title:     b.card,
      body:      capitalise(b.partlyPaid ? `part paid, ${when}` : when),
      trailing:  formatCurrency(b.owed),
      urgent:    b.days != null && b.days <= 0,
      cardLast4: b.cardLast4 ?? null,
      entryId:   entry?.id,
      isRead:    entry ? entry.isRead : true,
    });
  }

  const rows: FeedRow[] = [
    ...entries
      .filter((e) => !REWARD_KINDS.has(e.kind) && !DUE_KINDS.has(e.kind))
      .map((e) => ({
        id: e.id, kind: e.kind, title: e.title, body: e.body,
        trailing: trailingFor(e), at: e.createdAt, isRead: e.isRead, entry: e,
      })),
    ...paidRows((accounts || []).filter((a) => a.type === ACCOUNT_TYPES.CREDIT_CARD), nowMs),
  ].sort((a, b) => b.at - a.at);

  const days: BellFeed['days'] = [];
  for (const row of rows) {
    const label = dayLabel(row.at, nowMs);
    const last = days[days.length - 1];
    if (last?.label === label) last.rows.push(row);
    else days.push({ label, rows: [row] });
  }

  return { due, days, rewards: entries.filter((e) => REWARD_KINDS.has(e.kind)) };
};

/**
 * Bell dot: unread money entries only. Rewards never light it, and a bill
 * entry stops counting once the bill is paid (its live row is gone).
 */
export const bellHasUnread = (
  entries: NotificationEntry[],
  ccBills: Record<string, unknown> | null | undefined,
  nowMs: number,
): boolean => {
  const open = new Set(openCcBills(ccBills, nowMs).map((b) => `${CC_DUE_PREFIX}${b.key}`));
  return entries.some((e) =>
    !e.isRead && !REWARD_KINDS.has(e.kind) && (e.kind !== 'cc_due' || open.has(e.dedupeKey)));
};
