// =============================================================================
// BELL FEED TESTS — what the NotificationsSheet shows and what lights the bell.
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs \
//        src/utils/__tests__/bellFeed.test.mjs
// =============================================================================
import { buildBellFeed, bellHasUnread, dayLabel } from '../../analytics/bellFeed.ts';
import { ACCOUNT_TYPES } from '../../constants/categories.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const NOW = new Date(2026, 9, 19, 12, 0).getTime();
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
let n = 0;
const entry = (kind, at, extra = {}) => ({
  id: `e${++n}`, kind, title: `${kind} title`, body: `${kind} body`,
  dedupeKey: `${kind}:${n}`, createdAt: at, isRead: false, ...extra,
});
const dueIn = (days) => {
  const d = new Date(NOW + days * DAY);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

// ── Day labels ───────────────────────────────────────────────────────────────
check('same calendar day → Today', dayLabel(NOW - 11 * HOUR, NOW) === 'Today');
check('previous calendar day → Yesterday', dayLabel(NOW - 13 * HOUR, NOW) === 'Yesterday');
check('two days back → Earlier', dayLabel(NOW - 2 * DAY, NOW) === 'Earlier');

// ── Rewards never pile into the feed ─────────────────────────────────────────
{
  const entries = [
    ...[1, 2, 3, 4, 5].map((d) => entry('aware_check_in', NOW - d * DAY)),
    entry('aware_savings_claimed', NOW - HOUR),
    entry('level_up', NOW - 2 * HOUR),
    entry('budget_breach', NOW - 3 * HOUR, { meta: { actual: 8200, cap: 8000 } }),
  ];
  const feed = buildBellFeed({ entries, ccBills: {}, accounts: [], nowMs: NOW });
  const rows = feed.days.flatMap((d) => d.rows);
  check('reward kinds are folded out of the day groups', rows.length === 1 && rows[0].kind === 'budget_breach',
    JSON.stringify(rows.map((r) => r.kind)));
  check('…and handed to the one Rewards row', feed.rewards.length === 7);
  check('budget breach shows actual / cap on the right', rows[0].trailing === '₹8,200 / ₹8,000', rows[0].trailing);
  check('unread rewards alone never light the bell',
    !bellHasUnread(entries.filter((e) => e.kind !== 'budget_breach'), {}, NOW));
  check('an unread money alert does', bellHasUnread(entries, {}, NOW));
}

// ── Money Due is live from ccBills ───────────────────────────────────────────
{
  const ccBills = {
    '8907': { amount: 12400, remaining: null, cardLast4: '8907', bankName: 'HDFC', dueDate: dueIn(3) },
    '1111': { amount: 5000, remaining: 0, cardLast4: '1111', bankName: 'SBI', dueDate: dueIn(2) },
    '2222': { amount: 9000, remaining: 4000, cardLast4: '2222', bankName: 'ICICI', dueDate: dueIn(0) },
  };
  const ccDue = entry('cc_due', NOW - DAY, { dedupeKey: 'cc_due:8907' });
  const paidDue = entry('cc_due', NOW - DAY, { dedupeKey: 'cc_due:1111' });
  const feed = buildBellFeed({ entries: [ccDue, paidDue], ccBills, accounts: [], nowMs: NOW });
  check('paid bills (remaining 0) are not in Money Due', feed.due.length === 2, JSON.stringify(feed.due.map((d) => d.title)));
  check('soonest due first', feed.due[0].title === 'ICICI •• 2222');
  check('part-paid bill shows what is left', feed.due[0].trailing === '₹4,000' && /^Part paid, due today$/.test(feed.due[0].body), feed.due[0].body);
  check('due today is urgent', feed.due[0].urgent && !feed.due[1].urgent);
  check('bill row carries its feed entry so a tap marks it read', feed.due[1].entryId === ccDue.id && !feed.due[1].isRead);
  check('cc_due entries never repeat in the day groups', feed.days.length === 0);
  check('an unread bill lights the bell while it is open', bellHasUnread([ccDue], ccBills, NOW));
  check('…and stops once the bill is paid', !bellHasUnread([paidDue], ccBills, NOW));
}

// ── Payment review sits in Money Due ─────────────────────────────────────────
{
  const review = entry('cc_payment_review', NOW - HOUR, { meta: { count: 1, amount: 3000 } });
  const feed = buildBellFeed({ entries: [review], ccBills: {}, accounts: [], nowMs: NOW });
  check('card payment review is a Money Due row with its amount',
    feed.due.length === 1 && feed.due[0].type === 'review' && feed.due[0].trailing === '₹3,000');
}

// ── Paid bills stay on record ────────────────────────────────────────────────
{
  const accounts = [
    { id: 'cc1', type: ACCOUNT_TYPES.CREDIT_CARD, bankName: 'HDFC', mask: '8907',
      paymentHistory: [
        { date: NOW - 2 * HOUR, amount: 12400, remainingAfter: 0 },
        { date: NOW - 40 * DAY, amount: 999, remainingAfter: 0 },
      ] },
    { id: 'cc2', type: ACCOUNT_TYPES.CREDIT_CARD, bankName: 'ICICI', mask: '2222',
      paymentHistory: [{ date: NOW - DAY, amount: 5000, remainingAfter: 4000 }] },
    { id: 'b1', type: 'Bank', paymentHistory: [{ date: NOW - HOUR, amount: 1, remainingAfter: 0 }] },
  ];
  const feed = buildBellFeed({ entries: [], ccBills: {}, accounts, nowMs: NOW });
  const rows = feed.days.flatMap((d) => d.rows);
  check('payments inside the feed window become paid rows; older ones and non-cards do not',
    rows.length === 2, JSON.stringify(rows.map((r) => r.id)));
  check('full payment reads "bill paid" under Today', feed.days[0].label === 'Today'
    && rows[0].title === 'HDFC •• 8907 bill paid' && rows[0].trailing === '₹12,400');
  check('partial payment says what is still due', rows[1].title === 'ICICI •• 2222 part paid'
    && rows[1].body === '₹4,000 still due.' && feed.days[1].label === 'Yesterday');
  check('paid rows are history, never unread', rows.every((r) => r.isRead));
}

console.log(`\n──────────────────────────────────`);
console.log(`  ${fail ? C.red : C.green}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
