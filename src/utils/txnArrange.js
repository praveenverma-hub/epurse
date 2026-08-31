// =============================================================================
// txnArrange — how the Activity list is ORDERED and SECTIONED.
//
// Split out from TransactionsScreen because it is list arithmetic with several
// interacting rules, and every one of them is invisible in a screenshot:
//   • a month divider is only meaningful while the list is CHRONOLOGICAL. Sort by
//     amount and the same divider claims a boundary that isn't one.
//   • a month divider marks a BOUNDARY (never above the first row); a group
//     header LABELS its group (always above the first row, or the first group is
//     the only unnamed one). They look alike and behave differently.
//   • grouping must agree with FILTERING about which account a transaction is on,
//     or the same transaction lands under a different account in the two.
//
// Pure and dependency-light so `txnArrange.test.mjs` can pin all of it.
//
// The ONE import is `resolveTxnAccount`, deliberately: it is the app's single
// answer to "which account is this transaction on", shared with ingest, the
// account ledger, analytics and this screen's own Method filter. Re-deriving it
// here is exactly the bug that put an HDFC ··1234 transaction under an ICICI
// ··1234 card. Category labels, which depend on the user's own tree, are
// INJECTED instead.
// =============================================================================
import { resolveTxnAccount } from './accountMatch';

/** Ordering options, in menu order. `id` is what the screen persists in state. */
export const SORTS = [
  { id: 'newest', label: 'Newest first',  short: 'Newest' },
  { id: 'oldest', label: 'Oldest first',  short: 'Oldest' },
  { id: 'high',   label: 'Highest amount', short: 'Highest' },
  { id: 'low',    label: 'Lowest amount',  short: 'Lowest' },
];

/**
 * Sectioning options. `none` is not "off" so much as "the list's natural
 * sectioning", which for a chronological list is by month.
 */
export const GROUPS = [
  { id: 'none',     label: 'No grouping',   short: 'None'     },
  { id: 'account',  label: 'Account',       short: 'Account'  },
  { id: 'type',     label: 'Account type',  short: 'Type'     },
  { id: 'category', label: 'Category',      short: 'Category' },
];

export const DEFAULT_SORT = 'newest';
export const DEFAULT_GROUP = 'none';

const sortIds = new Set(SORTS.map((s) => s.id));
const groupIds = new Set(GROUPS.map((g) => g.id));
/** Unknown ids fall back rather than throwing — state can outlive a rename. */
export const normalizeSort = (id) => (sortIds.has(id) ? id : DEFAULT_SORT);
export const normalizeGroup = (id) => (groupIds.has(id) ? id : DEFAULT_GROUP);

/**
 * Is the list in date order? Month dividers are ONLY valid when it is — under an
 * amount sort a "June 2026" rule would sit between two unrelated rows and claim
 * a boundary that does not exist.
 */
export const isChronological = (sortId) => normalizeSort(sortId) !== 'high' && normalizeSort(sortId) !== 'low';

const time = (t) => new Date(t?.createdAt ?? 0).getTime() || 0;
const amount = (t) => Math.abs(Number(t?.amount) || 0);

/**
 * A new, sorted array. Every comparator falls back to time-descending so the
 * order is TOTAL: two ₹500 rows must not swap places between renders, or the
 * list visibly reshuffles when an unrelated bit of state changes.
 */
export const sortTransactions = (list, sortId) => {
  const id = normalizeSort(sortId);
  const out = [...(list ?? [])];
  const byTimeDesc = (a, b) => time(b) - time(a);
  if (id === 'oldest') return out.sort((a, b) => time(a) - time(b) || byTimeDesc(a, b));
  if (id === 'high')   return out.sort((a, b) => amount(b) - amount(a) || byTimeDesc(a, b));
  if (id === 'low')    return out.sort((a, b) => amount(a) - amount(b) || byTimeDesc(a, b));
  return out.sort(byTimeDesc);
};

/** 'YYYY-MM' for a transaction's own date. Mirrors the screen's monthKey. */
export const monthKeyOf = (txn) => {
  const d = new Date(txn?.createdAt ?? 0);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Shown when a transaction has nothing to group it by — never a blank header. */
export const UNGROUPED_LABEL = 'Unassigned';

/**
 * Builds the `(txn, groupId) → { key, label }` function.
 *
 * @param {object} deps
 * @param {Array}  deps.accounts       the store's accounts, for `resolveTxnAccount`
 * @param {(txn) => string} deps.categoryLabel resolves a txn's category name
 */
export const makeGrouper = ({ accounts = [], categoryLabel } = {}) => (txn, groupId) => {
  const id = normalizeGroup(groupId);
  if (id === 'account') {
    const acct = resolveTxnAccount(txn, accounts);
    // Keyed by ID, not by name: two accounts can share a display name, and the
    // whole point of the shared resolver is that identity is the account.
    return acct
      ? { key: `a:${acct.id}`, label: acct.name || acct.bank || UNGROUPED_LABEL }
      : { key: 'a:none', label: UNGROUPED_LABEL };
  }
  if (id === 'type') {
    const acct = resolveTxnAccount(txn, accounts);
    const type = acct?.type;
    return type ? { key: `t:${type}`, label: type } : { key: 't:none', label: UNGROUPED_LABEL };
  }
  if (id === 'category') {
    const label = categoryLabel?.(txn);
    return label
      ? { key: `c:${label}`, label }
      : { key: 'c:none', label: UNGROUPED_LABEL };
  }
  return null;
};

/**
 * Sort, then section. Returns the FlatList rows: transactions interleaved with
 * `{ _divider: true, id, monthKey? , label? }`.
 *
 * Two divider shapes on purpose, and they are not interchangeable:
 *   • `monthKey` — a BOUNDARY between months. Emitted only between two different
 *     months, so a single-month list has none, and only while chronological.
 *   • `label` — a group HEADER. Emitted above every group INCLUDING the first,
 *     because a header names the rows under it; skipping the first one would
 *     leave exactly one unnamed group.
 *
 * `groupTotal(rows)` is INJECTED and must return `{ value, income } | null`. It is
 * not a sum done here on purpose: a group's money has to be the same number the
 * screen's own footer would give for those rows — refund-netted, your-share-only,
 * with ignored rows and non-spend categories out — and that lives in
 * `computeLedgerTotals`. A local `rows.reduce((n, t) => n + t.amount)` would be a
 * new, quietly different opinion about what a transaction is worth.
 */
export const buildListRows = (list, { sortId, groupId, grouper, groupTotal } = {}) => {
  const sorted = sortTransactions(list, sortId);
  const gid = normalizeGroup(groupId);

  if (gid === 'none') {
    // Amount-sorted lists get no dividers at all rather than wrong ones.
    if (!isChronological(sortId)) return sorted;
    const out = [];
    let last = null;
    for (const t of sorted) {
      const mk = monthKeyOf(t);
      if (last !== null && mk !== last) out.push({ _divider: true, id: `div-${mk}`, monthKey: mk });
      last = mk;
      out.push(t);
    }
    return out;
  }

  // Grouped: bucket by key, keeping each group's FIRST-SEEN order so the sort
  // still decides which group leads (newest-first puts the most recent account
  // on top). Rows inside a group also keep the sort order.
  const order = [];
  const buckets = new Map();
  for (const t of sorted) {
    const g = grouper?.(t, gid) ?? { key: 'x', label: UNGROUPED_LABEL };
    if (!buckets.has(g.key)) { buckets.set(g.key, { label: g.label, rows: [] }); order.push(g.key); }
    buckets.get(g.key).rows.push(t);
  }
  const out = [];
  for (const key of order) {
    const b = buckets.get(key);
    // A zero group gets no number rather than a "₹0" — every group with only
    // non-spend rows (a self-transfer, a settlement) would otherwise carry one.
    const t = groupTotal?.(b.rows) ?? null;
    out.push({
      _divider: true,
      id: `grp-${key}`,
      label: b.label,
      ...(t && t.value ? { total: t.value, income: !!t.income } : {}),
    });
    out.push(...b.rows);
  }
  return out;
};

/** True when the arrangement is not the default — used to badge the controls. */
export const isArranged = (sortId, groupId) =>
  normalizeSort(sortId) !== DEFAULT_SORT || normalizeGroup(groupId) !== DEFAULT_GROUP;
