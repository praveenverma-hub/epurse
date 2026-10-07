import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// categoryQuickPick — Manage sheet quick picks + inline category search.
//   npm run test:categoryQuickPick
// =============================================================================
const { quickPicks, searchCategories } = await import(`${PROJECT_ROOT}/src/utils/categoryQuickPick.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const labels = (picks) => picks.map((p) => p.child.label);

const tree = [
  { id: 'food', label: 'Food & Dining', emoji: '🍔', color: '#f00', legacyId: 'food', children: [
    { id: 'restaurants', label: 'Restaurants', emoji: '🍽️' },
    { id: 'groceries', label: 'Groceries', emoji: '🛒' },
    { id: 'coffee', label: 'Coffee & Snacks', emoji: '☕' },
  ] },
  { id: 'travel', label: 'Travel', emoji: '✈️', color: '#0f0', legacyId: 'travel', children: [
    { id: 'cab', label: 'Cab & Auto', emoji: '🚕' },
    { id: 'fuel', label: 'Fuel', emoji: '⛽' },
  ] },
  { id: 'income', label: 'Income', emoji: '💰', color: '#00f', legacyId: 'salary', children: [
    { id: 'salary', label: 'Salary', emoji: '💼' },
  ] },
];
const txn = (p, c, extra = {}) => ({ parentCategory: p, childCategory: c, ...extra });
const txns = [
  txn('Travel', 'Fuel'), txn('Travel', 'Fuel'), txn('Travel', 'Fuel'),
  txn('Food & Dining', 'Groceries'), txn('Food & Dining', 'Groceries'),
  txn('Food & Dining', 'Coffee & Snacks'),
  txn('Income', 'Salary'), txn('Income', 'Salary'), txn('Income', 'Salary'), txn('Income', 'Salary'),
  txn('Travel', 'Cab & Auto', { isIgnored: true }), txn('Travel', 'Cab & Auto', { isIgnored: true }),
  txn('Travel', 'Cab & Auto', { isIgnored: true }), txn('Travel', 'Cab & Auto', { isIgnored: true }),
  txn('Travel', 'Cab & Auto', { isIgnored: true }),
  txn('Gone', 'Deleted Category'),
];

const noIncome = (p) => p.label !== 'Income';
let r = quickPicks({ tree, transactions: txns, allow: noIncome });
check('most-used first when nothing else is known', labels(r)[0] === 'Fuel', labels(r).join(','));
check('ignored txns do not count towards usage', !labels(r).includes('Cab & Auto'), labels(r).join(','));
check('`allow` filters candidates (no Income on a debit)', !labels(r).includes('Salary'));
check('unknown categories are skipped, not crashed on', labels(r).every(Boolean));

r = quickPicks({ tree, transactions: txns, allow: noIncome,
  current: { parentCategory: 'Food & Dining', childCategory: 'Restaurants' },
  suggestion: { parentCategory: 'Food & Dining', childCategory: 'Coffee & Snacks' } });
check('order: current → merchant suggestion → most used', labels(r).slice(0, 3).join(',') === 'Restaurants,Coffee & Snacks,Fuel', labels(r).join(','));
check('no duplicates (Coffee is both suggestion and used)', new Set(labels(r)).size === r.length);

r = quickPicks({ tree, transactions: txns, allow: noIncome, current: { parentCategory: 'Income', childCategory: 'Salary' } });
check('the current category shows even if `allow` would filter it', labels(r)[0] === 'Salary');

r = quickPicks({ tree, transactions: txns, limit: 2 });
check('respects the limit', r.length === 2);

// Recency: the last 45 days outrank a bigger all-time habit.
const NOW = new Date('2026-10-08T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();
const dated = [
  ...Array.from({ length: 6 }, () => txn('Travel', 'Fuel', { createdAt: daysAgo(120) })),
  txn('Food & Dining', 'Groceries', { createdAt: daysAgo(3) }),
  txn('Food & Dining', 'Groceries', { createdAt: daysAgo(10) }),
  txn('Food & Dining', 'Coffee & Snacks', { createdAt: daysAgo(44) }),
  txn('Travel', 'Cab & Auto', { createdAt: daysAgo(46) }),
];
r = quickPicks({ tree, transactions: dated, now: NOW, allow: noIncome });
check('recent (45 days) outranks a bigger old habit', labels(r).slice(0, 2).join(',') === 'Groceries,Coffee & Snacks', labels(r).join(','));
check('…all-time fills the remaining slots after', labels(r).slice(2).join(',') === 'Fuel,Cab & Auto', labels(r).join(','));
check('…day 44 counts as recent, day 46 does not', labels(r).indexOf('Coffee & Snacks') < labels(r).indexOf('Fuel') && labels(r).indexOf('Cab & Auto') > labels(r).indexOf('Fuel'));
r = quickPicks({ tree, transactions: [txn('Travel', 'Fuel')], now: NOW });
check('undated txns still count all-time', labels(r).join(',') === 'Fuel');

check('search: child label prefix ranks first', labels(searchCategories(tree, 'gro'))[0] === 'Groceries');
check('search: matches a word inside the label', labels(searchCategories(tree, 'auto')).includes('Cab & Auto'));
check('search: parent label returns its children', labels(searchCategories(tree, 'travel')).join(',') === 'Cab & Auto,Fuel');
check('search: case-insensitive, trimmed', labels(searchCategories(tree, '  FUEL ')).join(',') === 'Fuel');
check('search: empty query → nothing', searchCategories(tree, '  ').length === 0);
check('search: respects the limit', searchCategories(tree, 'a', 2).length === 2);

console.log(`\n${C.bold}${fail ? C.red : C.green}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail ? 1 : 0);
