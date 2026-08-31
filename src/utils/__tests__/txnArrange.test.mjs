// =============================================================================
// ACTIVITY LIST ARRANGEMENT — ordering and sectioning
// -----------------------------------------------------------------------------
//   npm run test:arrange
//
// Three rules that all look identical in a screenshot and are all wrong in a
// different way if broken:
//   1. a month divider is only meaningful while the list is chronological;
//   2. a month divider marks a BOUNDARY, a group header LABELS its group — so one
//      is never emitted above the first row and the other always is;
//   3. grouping must agree with FILTERING about which account a transaction is
//      on, which is why both go through `resolveTxnAccount`.
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const mod = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/txnArrange.js');
const {
  SORTS, GROUPS, DEFAULT_SORT, DEFAULT_GROUP, normalizeSort, normalizeGroup,
  isChronological, sortTransactions, monthKeyOf, buildListRows, makeGrouper,
  isArranged, UNGROUPED_LABEL,
} = mod;

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

// ── Fixtures ────────────────────────────────────────────────────────────────
// Field names matter: accounts carry `mask` / `bankName`, transactions carry
// `accountMask` / `bankName`. My first fixtures used `accountNumber` / `bank`,
// so `resolveTxnAccount` matched nothing and the two same-last-4 cases below
// both returned "Unassigned" — passing the "no resolvable account" checks while
// silently testing nothing about the account rule.
const ACCOUNTS = [
  { id: 'acc_hdfc',  name: 'HDFC Savings', bankName: 'HDFC Bank',  type: 'Bank',        mask: '1234' },
  { id: 'acc_icici', name: 'ICICI Card',   bankName: 'ICICI Bank', type: 'Credit Card', mask: '1234' },
  { id: 'acc_cash',  name: 'Cash',         bankName: '',           type: 'Cash',        mask: '' },
];
const txn = (id, iso, amt, extra = {}) => ({ id, createdAt: iso, amount: amt, type: 'debit', ...extra });

const LIST = [
  txn('t1', '2026-08-20T10:00:00Z', 500,  { accountId: 'acc_hdfc',  categoryId: 'food' }),
  txn('t2', '2026-08-05T10:00:00Z', 2500, { accountId: 'acc_icici', categoryId: 'travel' }),
  txn('t3', '2026-07-28T10:00:00Z', 100,  { accountId: 'acc_hdfc',  categoryId: 'food' }),
  txn('t4', '2026-07-02T10:00:00Z', 9000, { accountId: 'acc_cash',  categoryId: 'rent' }),
];
const CAT = { food: 'Food & Dining', travel: 'Travel', rent: 'Rent' };
const grouper = makeGrouper({ accounts: ACCOUNTS, categoryLabel: (t) => CAT[t.categoryId] });
// Stands in for the screen's `computeLedgerTotals` wrapper: debit leads, income
// only when there is no spend, null when the group is worth nothing.
const groupTotal = (rows) => {
  const debit = rows.filter((t) => t.type === 'debit').reduce((n, t) => n + t.amount, 0);
  const credit = rows.filter((t) => t.type === 'credit').reduce((n, t) => n + t.amount, 0);
  if (debit) return { value: debit, income: false };
  if (credit) return { value: credit, income: true };
  return null;
};
const ids = (rows) => rows.filter((r) => !r._divider).map((r) => r.id);
const dividers = (rows) => rows.filter((r) => r._divider);

console.log(`\n${C.bold}══════ Activity arrangement ══════${C.reset}`);

console.log('\n── ordering ──');
check('newest first is the default', DEFAULT_SORT === 'newest' && normalizeSort(undefined) === 'newest');
check('newest first', ids(sortTransactions(LIST, 'newest')).join() === 't1,t2,t3,t4');
check('oldest first', ids(sortTransactions(LIST, 'oldest')).join() === 't4,t3,t2,t1');
check('highest amount', ids(sortTransactions(LIST, 'high')).join() === 't4,t2,t1,t3');
check('lowest amount', ids(sortTransactions(LIST, 'low')).join() === 't3,t1,t2,t4');
check('an unknown sort id falls back rather than throwing',
  ids(sortTransactions(LIST, 'nonsense')).join() === 't1,t2,t3,t4');
check('the input array is not mutated',
  (() => { const before = LIST.map((t) => t.id).join(); sortTransactions(LIST, 'low'); return LIST.map((t) => t.id).join() === before; })());
// A partial order lets two equal rows swap between renders, which reads as the
// list reshuffling itself when something unrelated changes.
{
  const tie = [txn('a', '2026-08-01T00:00:00Z', 500), txn('b', '2026-08-09T00:00:00Z', 500)];
  check('equal amounts break the tie by date, so the order is TOTAL',
    ids(sortTransactions(tie, 'high')).join() === 'b,a'
    && ids(sortTransactions([...tie].reverse(), 'high')).join() === 'b,a',
    'without a tie-break the result depends on input order');
}
check('a negative or string amount is still ordered by magnitude',
  ids(sortTransactions([txn('x', '2026-08-01T00:00:00Z', -900), txn('y', '2026-08-01T00:00:00Z', '20')], 'high')).join() === 'x,y');

console.log('\n── month dividers belong to CHRONOLOGICAL lists only ──');
check('date sorts are chronological', isChronological('newest') && isChronological('oldest'));
check('amount sorts are not', !isChronological('high') && !isChronological('low'));
{
  const rows = buildListRows(LIST, { sortId: 'newest', groupId: 'none', grouper });
  check('newest-first gets one divider, at the Aug→Jul boundary',
    dividers(rows).length === 1 && dividers(rows)[0].monthKey === '2026-07');
  check('…and never above the first row', !rows[0]._divider,
    'a boundary marker above the first row marks nothing');
  const amt = buildListRows(LIST, { sortId: 'high', groupId: 'none', grouper });
  check('an amount-sorted list gets NO dividers', dividers(amt).length === 0,
    'a month rule between two unrelated rows claims a boundary that does not exist');
  check('…but keeps every transaction', ids(amt).length === LIST.length);
  const oneMonth = buildListRows(LIST.slice(0, 2), { sortId: 'newest', groupId: 'none', grouper });
  check('a single-month list gets no divider', dividers(oneMonth).length === 0);
  check('oldest-first divides at the same boundary, the other way round',
    (() => {
      const r = buildListRows(LIST, { sortId: 'oldest', groupId: 'none', grouper });
      return dividers(r).length === 1 && dividers(r)[0].monthKey === '2026-08';
    })());
}
check('monthKeyOf pads the month', monthKeyOf(txn('z', '2026-07-02T00:00:00Z', 1)) === '2026-07');
check('a broken date does not produce a garbage key', monthKeyOf({ createdAt: 'nope' }) === '');

console.log('\n── group headers LABEL, they do not mark boundaries ──');
{
  const rows = buildListRows(LIST, { sortId: 'newest', groupId: 'account', grouper });
  check('every group gets a header, INCLUDING the first',
    rows[0]._divider === true && !!rows[0].label,
    'skipping the first would leave exactly one unnamed group');
  check('one header per distinct account', dividers(rows).length === 3,
    dividers(rows).map((d) => d.label).join(' | '));
  check('no transaction is lost or duplicated',
    ids(rows).slice().sort().join() === LIST.map((t) => t.id).sort().join());
  check('a header carries no amount when none is supplied',
    dividers(rows).every((d) => d.total === undefined),
    'the total is injected, not summed here');
  check('group ORDER follows the sort — the newest account leads',
    dividers(rows)[0]?.label === 'HDFC Savings', String(dividers(rows)[0]?.label));
  check('…and reverses with the sort',
    buildListRows(LIST, { sortId: 'oldest', groupId: 'account', grouper })
      .filter((r) => r._divider)[0]?.label === 'Cash');
  check('rows inside a group keep the sort order',
    (() => {
      const r = buildListRows(LIST, { sortId: 'newest', groupId: 'account', grouper });
      const start = r.findIndex((x) => x._divider && x.label === 'HDFC Savings');
      return start >= 0 && r[start + 1]?.id === 't1' && r[start + 2]?.id === 't3';
    })());
  check('grouping is allowed under an amount sort (unlike month dividers)',
    buildListRows(LIST, { sortId: 'high', groupId: 'account', grouper }).some((r) => r._divider),
    'a header names its rows, so it stays true whatever the order');
  check('no month dividers leak in while grouped',
    buildListRows(LIST, { sortId: 'newest', groupId: 'account', grouper })
      .every((r) => !r._divider || r.monthKey === undefined),
    'two divider kinds in one list would look like the same thing meaning two');
}
{
  const rows = buildListRows(LIST, { sortId: 'newest', groupId: 'type', grouper });
  check('group by account TYPE buckets by the account\'s own type',
    dividers(rows).map((d) => d.label).sort().join() === 'Bank,Cash,Credit Card',
    dividers(rows).map((d) => d.label).join());
}
{
  const rows = buildListRows(LIST, { sortId: 'newest', groupId: 'category', grouper });
  check('group by category uses the INJECTED labels',
    dividers(rows).map((d) => d.label).sort().join() === 'Food & Dining,Rent,Travel');
  check('…and merges the two Food rows into one group',
    (() => {
      const r = buildListRows(LIST, { sortId: 'newest', groupId: 'category', grouper, groupTotal });
      // ₹500 + ₹100 — the two Food rows and nothing else.
      return r.filter((x) => x._divider).find((d) => d.label === 'Food & Dining')?.total === 600;
    })(),
    'optional-chained on purpose: a missing header should FAIL this check, not throw and take the rest of the suite with it');
}

console.log('\n── grouping agrees with FILTERING about the account ──');
// The two ··1234 accounts are the case that broke the Method filter: a bare mask
// Set put an HDFC transaction under an ICICI card. Grouping must not reintroduce
// its own rule.
{
  const byMask = [
    txn('m1', '2026-08-10T00:00:00Z', 100, { accountMask: '1234', bankName: 'HDFC Bank' }),
    txn('m2', '2026-08-09T00:00:00Z', 200, { accountMask: '1234', bankName: 'ICICI Bank' }),
  ];
  const rows = buildListRows(byMask, { sortId: 'newest', groupId: 'account', grouper });
  const labels = rows.filter((r) => r._divider).map((d) => d.label);
  check('same-last-4 cards at different banks group SEPARATELY',
    labels.length === 2, labels.join(' | '));
  check('…and each under its own bank',
    labels.includes('HDFC Savings') && labels.includes('ICICI Card'), labels.join(' | '));
}
// Keying a group by NAME passes every fixture where the names happen to differ —
// which is why this one exists. Two accounts sharing a display name is ordinary
// (two "Savings", or two cards a user named after the same bank), and merging them
// would put one account's spending under another's header.
{
  const twins = [
    { id: 'acc_a', name: 'Savings', bankName: 'HDFC Bank',  type: 'Bank', mask: '1111' },
    { id: 'acc_b', name: 'Savings', bankName: 'ICICI Bank', type: 'Bank', mask: '2222' },
  ];
  const g = makeGrouper({ accounts: twins, categoryLabel: () => null });
  const rows = buildListRows(
    [txn('w1', '2026-08-10T00:00:00Z', 10, { accountId: 'acc_a' }),
     txn('w2', '2026-08-09T00:00:00Z', 20, { accountId: 'acc_b' })],
    { sortId: 'newest', groupId: 'account', grouper: g },
  );
  check('two accounts with the SAME name stay separate groups',
    dividers(rows).length === 2,
    'grouped by name they would merge and one account\'s rows would hide under the other');
  check('…keyed by account id, so the keys differ even when the labels do not',
    new Set(dividers(rows).map((d) => d.id)).size === 2
    && new Set(dividers(rows).map((d) => d.label)).size === 1);
}

check('a transaction with no resolvable account gets a named group, not a blank one',
  (() => {
    const rows = buildListRows([txn('n1', '2026-08-01T00:00:00Z', 50)], { sortId: 'newest', groupId: 'account', grouper });
    return rows[0].label === UNGROUPED_LABEL;
  })());
check('an uncategorised transaction likewise',
  (() => {
    const rows = buildListRows([txn('n2', '2026-08-01T00:00:00Z', 50, { categoryId: 'zzz' })], { sortId: 'newest', groupId: 'category', grouper });
    return rows[0].label === UNGROUPED_LABEL;
  })());

console.log('\n── a group header shows its MONEY, from the injected total ──');
// Summing `t.amount` locally would be a second opinion about what a transaction
// is worth. The screen passes `computeLedgerTotals`, so a group's number is the
// same number the footer would give for those rows.
{
  const rows = buildListRows(LIST, { sortId: 'newest', groupId: 'account', grouper, groupTotal });
  const byLabel = Object.fromEntries(dividers(rows).map((d) => [d.label, d]));
  check('every group carries a total', dividers(rows).every((d) => typeof d.total === 'number'));
  check('HDFC groups ₹500 + ₹100 = ₹600', byLabel['HDFC Savings']?.total === 600);
  check('Cash groups ₹9000', byLabel.Cash?.total === 9000);
  check('the group totals sum to the list total',
    dividers(rows).reduce((n, d) => n + (d.total || 0), 0) === 12100);
  check('spend is not flagged as income', dividers(rows).every((d) => d.income === false));

  const income = [
    txn('i1', '2026-08-11T00:00:00Z', 40000, { accountId: 'acc_hdfc', type: 'credit' }),
  ];
  const ir = buildListRows(income, { sortId: 'newest', groupId: 'account', grouper, groupTotal });
  check('a group with no spend shows its INCOME instead, flagged',
    ir[0].total === 40000 && ir[0].income === true,
    'a salary-only group would otherwise read as a misleading zero');

  // A group whose rows are all non-spend (a self-transfer, a settlement) is worth
  // nothing, and "₹0" on a header is noise.
  const zero = buildListRows(
    [txn('z1', '2026-08-01T00:00:00Z', 9000, { accountId: 'acc_hdfc' })],
    { sortId: 'newest', groupId: 'account', grouper, groupTotal: () => null },
  );
  check('a group worth nothing carries no amount at all',
    zero[0].total === undefined && zero[0].income === undefined,
    'a ₹0 pill is clutter, not information');
  check('…and its rows are still there', ids(zero).length === 1);

  // Month dividers never carry one — they mark a boundary, they do not summarise.
  const months = buildListRows(LIST, { sortId: 'newest', groupId: 'none', grouper, groupTotal });
  check('a month boundary carries no amount',
    dividers(months).every((d) => d.total === undefined));
}

console.log('\n── defaults and degenerate input ──');
check('no grouping is the default', DEFAULT_GROUP === 'none' && normalizeGroup(undefined) === 'none');
check('an unknown group id falls back', normalizeGroup('bank-type') === 'none');
check('the default arrangement is not flagged as arranged', !isArranged(DEFAULT_SORT, DEFAULT_GROUP));
check('changing either axis flags it',
  isArranged('high', 'none') && isArranged('newest', 'account') && isArranged('low', 'category'));
check('an empty list produces no rows and no dividers',
  buildListRows([], { sortId: 'newest', groupId: 'account', grouper }).length === 0);
check('a null list does not throw', buildListRows(null, { sortId: 'newest', groupId: 'none' }).length === 0);
check('a missing grouper still produces one labelled group',
  (() => {
    const r = buildListRows(LIST, { sortId: 'newest', groupId: 'account' });
    return r.filter((x) => x._divider).length === 1 && r.filter((x) => x._divider)[0].label === UNGROUPED_LABEL;
  })(), 'it must not crash or silently drop rows');
check('every SORTS / GROUPS entry has an id, a label and a short label',
  [...SORTS, ...GROUPS].every((o) => o.id && o.label && o.short));
check('divider ids are unique within a list',
  (() => {
    const d = dividers(buildListRows(LIST, { sortId: 'newest', groupId: 'account', grouper })).map((x) => x.id);
    return new Set(d).size === d.length;
  })(), 'a duplicate key makes FlatList drop a row');

console.log('\n── the two filter rows must not contradict each other ──');
// The bug: the quick chips were a SECOND filter axis, ANDed with the sheet's. So
// "Credit Cards" + Method "HDFC Savings" returned nothing while both controls
// showed a selection, and so did "This Month" + Date Range "Last month".
{
  const { readFileSync } = await import('node:fs');
  const SRC = '/Users/praveenverma/Desktop/pvn/ePurse/src';
  // Comments are prose — a scan that reads them can pass while the code says
  // nothing of the kind (this has bitten the header suite three times).
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const screen = code(readFileSync(`${SRC}/screens/TransactionsScreen.js`, 'utf8'));
  const raw = readFileSync(`${SRC}/screens/TransactionsScreen.js`, 'utf8');

  check('the quick chips are hidden once a sheet filter is applied',
    /activeFilterCount === 0 && \(/.test(screen),
    'two filter rows ANDed together is how a dead end with two active controls happens');
  check('…and the chip RESETS as the sheet takes over',
    /if \(Object\.values\(draft\)\.some\(\(set\) => set\.size > 0\)\) setQuickChip\('all'\);/.test(screen),
    'a chip left set while hidden is an invisible filter');
  check('the account deep-link resets it too',
    /setApplied\(\(prev\) => \(\{ \.\.\.prev, method: new Set\(\[id\]\) \}\)\);\s*\n\s*setQuickChip\('all'\);/.test(screen),
    'it applies a Method filter without going through the sheet');

  // Sort/Group are NOT filters, so they must stay reachable either way. Checked
  // STRUCTURALLY, not by a lazy regex: the chips block now sits BEFORE the
  // dropdowns, so "is there an InlineDropdown after `activeFilterCount === 0`"
  // is true either way. Walk the conditional's own parentheses instead.
  {
    const at = screen.indexOf('{activeFilterCount === 0 && (');
    let depth = 0, end = at;
    for (let i = screen.indexOf('(', at + 28); i < screen.length; i++) {
      if (screen[i] === '(') depth++;
      else if (screen[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    const conditional = screen.slice(at, end);
    check('the filter presets ARE gated on the filter count',
      at >= 0 && /QUICK_CHIPS\.map/.test(conditional));
    check('Sort and Group are NOT — they stay available either way',
      !/InlineDropdown/.test(conditional),
      'they arrange the same rows; there is no reason to hide them');
    check('the separator vanishes with the chips, not with the dropdowns',
      /controlRowSep/.test(conditional),
      'a leading rule on a row starting with Sort looks like something was cut off');
  }

  // Presets lead the row; arrange controls follow.
  check('the row reads filter-presets first, then Sort/Group',
    screen.indexOf('QUICK_CHIPS.map') < screen.indexOf('label="Sort"')
    && screen.indexOf('label="Sort"') < screen.indexOf('label="Group"'));

  // The account chips were REMOVED rather than repaired: they duplicated the
  // sheet's Method panel at a coarser grain, and their own account rule was the
  // fourth hand-rolled copy in the app.
  check('no quick chip filters by account any more',
    !/quickChip === 'bank'|quickChip === 'cc'/.test(screen)
    && !/t\.accountType === '/.test(screen),
    'a coarse account chip beside a per-account panel is a duplicate axis');
  check('the screen has exactly ONE account rule left — the shared resolver',
    (screen.match(/resolveTxnAccount\(/g) || []).length === 1,
    'every extra copy of "which account is this on" has disagreed with the others');
  check('and `accounts` is still a dependency of the filtered memo',
    /\}, \[transactions, accounts, quickChip, search, applied, appliedCustom, isNotCounted\]\);/.test(screen),
    'the Method filter resolves accounts, so a rename or retype must re-filter');

  // `exportFilterCtx.timeframe` is the chip id, and exportService's type is
  // `week | month | year | all`. 'bank' / 'cc' fell through to the "All Time"
  // label, so an export of a card-filtered list was captioned as everything.
  {
    const TIMEFRAMES = new Set(['week', 'month', 'year', 'all']);
    // Sliced to the QUICK_CHIPS array: FILTER_PANELS has the same
    // `{ id, label, icon }` shape, and a loose match picked up its ids too.
    const block = screen.slice(screen.indexOf('const QUICK_CHIPS = ['));
    const ids = [...block.slice(0, block.indexOf('];')).matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
    check(`every quick chip id is a real timeframe (${ids.join(', ')})`,
      ids.length > 0 && ids.every((id) => TIMEFRAMES.has(id)),
      'the id is passed straight to exportService as `timeframe`');
  }

  // The row existed TWICE, kept in sync by hand. Adding two more controls would
  // have made that three things to keep aligned.
  check('the control row is rendered from ONE function, not two copies',
    (raw.match(/QUICK_CHIPS\.map/g) || []).length === 1,
    'the sticky ribbon and the inline one were separate copies of the same JSX');
  check('both call sites use it',
    (screen.match(/renderControlRow\(\)/g) || []).length === 2);

  // Divider rendering: one component, two meanings, and the screen must pass both.
  check('the divider row forwards a month key, a group label AND the amount',
    /monthKey=\{item\.monthKey\}/.test(screen)
    && /label=\{item\.label\}/.test(screen)
    && /total=\{item\.total\}/.test(screen)
    && /income=\{item\.income\}/.test(screen));
  check('the screen no longer builds its own month dividers',
    !/_divider: true/.test(screen),
    'that logic is in utils/txnArrange, where the rules can be tested');
  check('the list rows come from the pure builder',
    /buildListRows\(filtered, \{ sortId, groupId, grouper, groupTotal \}\)/.test(screen));
  check('a group header\'s amount comes from the SHARED totals helper',
    /const \{ debit, credit \} = computeLedgerTotals\(rows, groups, spendExcluded\);/.test(screen),
    'a local reduce over t.amount is the drift ledgerTotals was extracted to stop');
  // The fixture above MODELS "debit leads, income only when there is no spend".
  // Nothing checked that the screen agrees — flipping its `income: true` to
  // `false` left the suite green while a salary group read as spend.
  check('the screen puts spend first and flags income as income',
    /if \(debit\) return \{ value: debit, income: false \};\s*\n\s*if \(credit\) return \{ value: credit, income: true \};\s*\n\s*return null;/.test(screen),
    'debit-first, credit-flagged, and null when the group is worth nothing');
  check('…and the divider prefixes a flagged total with +',
    /\{income \? '\+' : ''\}\{formatCompact\(total as number\)\}/
      .test(readFileSync(`${SRC}/components/MonthDivider.tsx`, 'utf8')),
    'unprefixed, an income group is indistinguishable from spend');
  check('…and the screen does not sum amounts itself anywhere',
    !/reduce\(\([\w, ]*\) => [\w. +]*\.amount/.test(screen),
    'refund netting, your-share-only and the non-spend categories all live in the helper');
  check('the header total is rendered QUIETLY',
    /muted\s*\n\s*\/>/.test(screen) || /muted$/m.test(screen),
    'the group is what you are scanning for; the money is context');
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
