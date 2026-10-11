// =============================================================================
// notificationPolicy — which notifications may go out, where, and when.
// -----------------------------------------------------------------------------
// Pure, so `notificationPolicy.test.mjs` pins it headlessly (same split as
// `autoModals.ts`). Every push the app decides to send on its own passes through
// `decide`, so the daily cap, quiet hours and back-off live in one place.
// The carousel is NOT routed through here: it rebuilds from live state on every
// render (homeCards.js) and shares trigger rules via `analytics/nudgeFacts.ts`.
// =============================================================================

export type NotificationKind =
  | 'ccBillDue'
  | 'budgetBreach'
  | 'subscriptionHike'
  | 'monthlyRecap'
  | 'budgetPlan'
  | 'goalBehind'
  | 'reviewReminder'
  | 'weeklyRecap'
  | 'midmonthNudge'
  | 'ccCycleHeadsUp'
  | 'ccPayment';

interface ChannelRule {
  /** Writes an entry to the in-app bell feed (never silenced by the push switch). */
  bell: boolean;
  push: boolean;
  /** A money deadline: never capped and never paused by back-off. */
  essential?: boolean;
  /** Push switch state when the user never touched it. */
  defaultOn: boolean;
}

export const CHANNELS: Record<NotificationKind, ChannelRule> = {
  ccBillDue:        { bell: true,  push: true, essential: true, defaultOn: true },
  budgetBreach:     { bell: true,  push: true, defaultOn: true },
  subscriptionHike: { bell: true,  push: true, defaultOn: true },
  monthlyRecap:     { bell: true,  push: true, defaultOn: true },
  budgetPlan:       { bell: false, push: true, defaultOn: true },
  goalBehind:       { bell: false, push: true, defaultOn: true },
  reviewReminder:   { bell: false, push: true, defaultOn: false },
  weeklyRecap:      { bell: true,  push: true, defaultOn: true },
  midmonthNudge:    { bell: true,  push: true, defaultOn: true },
  ccCycleHeadsUp:   { bell: true,  push: true, defaultOn: true },
  // The payment prompt already writes its own `cc_payment_review` bell entry.
  ccPayment:        { bell: false, push: true, defaultOn: true },
};

/**
 * Highest first. When more pushes want a day than the cap allows, earlier ones
 * win. Kinds that also have a carousel card must keep the same relative order
 * there — the test checks it against `CAROUSEL_CARD`.
 */
export const PUSH_PRIORITY: NotificationKind[] = [
  'ccBillDue',
  'budgetBreach',
  'subscriptionHike',
  'monthlyRecap',
  'budgetPlan',
  'goalBehind',
  'reviewReminder',
  'weeklyRecap',
  'midmonthNudge',
  'ccCycleHeadsUp',
  'ccPayment',
];

/** The homeCards.js card a kind shares a subject with, where one exists. */
export const CAROUSEL_CARD: Partial<Record<NotificationKind, string>> = {
  ccBillDue: 'cc_bill_due',
  budgetBreach: 'budget_over',
  subscriptionHike: 'sub_hike',
  goalBehind: 'goal_pace',
};

export const DAILY_PUSH_CAP = 2;
/** Local time, minutes after midnight. The window wraps past midnight. */
export const QUIET_START_MIN = 21 * 60 + 30;
export const QUIET_END_MIN = 8 * 60 + 30;
/**
 * This many pushes of one kind with no app open since → that kind pauses until
 * the app is next opened. Not time-based: a 7-day pause never skipped a weekly.
 */
export const BACKOFF_UNSEEN = 3;

export interface PushLogEntry {
  /** Stable event id, e.g. `budget_missing:2026-10`. */
  key: string;
  kind: NotificationKind;
  /** When it fires (or fired), epoch ms. */
  at: number;
}

export interface PushRequest {
  key: string;
  kind: NotificationKind;
  /** Epoch ms; at or before `now` means "send immediately". */
  fireAt: number;
}

export interface PolicyContext {
  now: number;
  prefs?: Partial<Record<string, boolean>>;
  log: PushLogEntry[];
  /** Last time the app came to the foreground, epoch ms. */
  lastOpenAt: number;
  /** App is in the foreground right now. */
  appActive?: boolean;
}

export type DenyReason = 'noPush' | 'pref' | 'duplicate' | 'foreground' | 'backoff' | 'cap';

export interface Decision {
  bell: boolean;
  push: boolean;
  /** Possibly moved out of quiet hours; null when no push. */
  fireAt: number | null;
  reason?: DenyReason;
}

export const pushEnabled = (prefs: PolicyContext['prefs'], kind: NotificationKind): boolean =>
  prefs?.[kind] ?? CHANNELS[kind].defaultOn;

const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

export const isQuiet = (ms: number): boolean => {
  const m = minuteOfDay(ms);
  return m >= QUIET_START_MIN || m < QUIET_END_MIN;
};

/** `ms` itself, or the end of the quiet window it falls in. */
export const outOfQuiet = (ms: number): number => {
  if (!isQuiet(ms)) return ms;
  const d = new Date(ms);
  if (minuteOfDay(ms) >= QUIET_START_MIN) d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(QUIET_END_MIN / 60), QUIET_END_MIN % 60, 0, 0);
  return d.getTime();
};

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function decide(req: PushRequest, ctx: PolicyContext): Decision {
  const rule = CHANNELS[req.kind];
  const deny = (reason: DenyReason): Decision => ({ bell: rule.bell, push: false, fireAt: null, reason });

  if (!rule.push) return deny('noPush');
  if (!pushEnabled(ctx.prefs, req.kind)) return deny('pref');
  if (ctx.log.some((e) => e.key === req.key)) return deny('duplicate');

  const immediate = req.fireAt <= ctx.now;
  if (immediate && ctx.appActive) return deny('foreground');

  const fireAt = outOfQuiet(Math.max(req.fireAt, ctx.now));

  const unseen = ctx.log.filter((e) => e.kind === req.kind && e.at > ctx.lastOpenAt && e.at <= fireAt).length;
  if (!rule.essential && unseen >= BACKOFF_UNSEEN) return deny('backoff');

  if (!rule.essential) {
    const day = dayKey(fireAt);
    const sameDay = ctx.log.filter((e) => !CHANNELS[e.kind].essential && dayKey(e.at) === day).length;
    if (sameDay >= DAILY_PUSH_CAP) return deny('cap');
  }

  return { bell: rule.bell, push: true, fireAt };
}

/**
 * Plans a batch of scheduled pushes against one shared log: higher priority
 * first, then earliest, each accepted push counting toward the cap of the ones
 * after it. Returns only the accepted pushes, with their final fire times.
 * `ctx.log` must hold only DELIVERED pushes — the previous plan is cancelled
 * and replaced, so including it would make every push a duplicate of itself.
 */
export function planPushes(requests: PushRequest[], ctx: PolicyContext): PushLogEntry[] {
  const rank = (k: NotificationKind) => PUSH_PRIORITY.indexOf(k);
  const ordered = [...requests].sort((a, b) => rank(a.kind) - rank(b.kind) || a.fireAt - b.fireAt);
  const log = [...ctx.log];
  const accepted: PushLogEntry[] = [];
  for (const req of ordered) {
    const d = decide(req, { ...ctx, log, appActive: false });
    if (!d.push || d.fireAt == null) continue;
    const entry = { key: req.key, kind: req.kind, at: d.fireAt };
    log.push(entry);
    accepted.push(entry);
  }
  return accepted.sort((a, b) => a.at - b.at);
}
