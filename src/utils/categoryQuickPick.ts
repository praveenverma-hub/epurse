// =============================================================================
// categoryQuickPick — the Manage sheet's one-tap category picks + inline search.
//
//   quickPicks()        current category → what THIS merchant was tagged before
//                       (categorySuggest) → most used in the last 45 days →
//                       most used all-time → common defaults to fill empty slots
//   searchCategories()  sub-categories matching typed text (child label first,
//                       then parent label), for the inline results list
//
// Pure: callers pass the tree + transactions. Tests: test:categoryQuickPick.
// =============================================================================
import type { ParentCat, ChildCat } from '../constants/twoTierCategories';

export interface CategoryPick {
  parent: ParentCat;
  child: ChildCat;
}

interface TxnLike {
  parentCategory?: string;
  childCategory?: string;
  isIgnored?: boolean;
  createdAt?: string;
}

/** "Most used" favours recent habits: this window ranks first. */
export const RECENT_USE_DAYS = 45;

// Resolve stable IDs against the live tree so renamed labels stay up to date
// and removed categories never reappear as shortcuts.
const COMMON_PICKS = [
  ['food', 'groceries'],
  ['food', 'food_delivery'],
  ['travel', 'daily_commute'],
  ['bills', 'mobile_internet'],
  ['shopping', 'online'],
  ['food', 'restaurants'],
  ['fuel', 'petrol'],
] as const;

const pickKey = (parentLabel: string, childLabel: string) => `${parentLabel}›${childLabel}`;

function findPick(tree: ParentCat[], parentLabel?: string, childLabel?: string): CategoryPick | null {
  if (!parentLabel || !childLabel) return null;
  const parent = tree.find((p) => p.label === parentLabel);
  const child = parent?.children.find((c) => c.label === childLabel);
  return parent && child ? { parent, child } : null;
}

interface QuickPickOptions {
  tree: ParentCat[];
  transactions: TxnLike[];
  /** The transaction's current category — always first when set. */
  current?: { parentCategory?: string; childCategory?: string };
  /** Merchant-based suggestion (categorySuggest) — second. */
  suggestion?: { parentCategory: string; childCategory: string } | null;
  /** Return false to keep a candidate out (e.g. Income on a debit, Lent/Borrowed). */
  allow?: (parent: ParentCat, child: ChildCat) => boolean;
  limit?: number;
  /** Injected for tests. */
  now?: Date;
}

export function quickPicks({ tree, transactions, current, suggestion, allow = () => true, limit = 5, now = new Date() }: QuickPickOptions): CategoryPick[] {
  const out: CategoryPick[] = [];
  const seen = new Set<string>();
  const push = (pick: CategoryPick | null, gate = true) => {
    if (!pick || out.length >= limit) return;
    const key = pickKey(pick.parent.label, pick.child.label);
    if (seen.has(key) || (gate && !allow(pick.parent, pick.child))) return;
    seen.add(key);
    out.push(pick);
  };

  // The current category shows even if `allow` would filter it — it IS the selection.
  push(findPick(tree, current?.parentCategory, current?.childCategory), false);
  push(findPick(tree, suggestion?.parentCategory, suggestion?.childCategory));

  const since = now.getTime() - RECENT_USE_DAYS * 24 * 60 * 60 * 1000;
  const recent = new Map<string, number>();
  const allTime = new Map<string, number>();
  for (const t of transactions || []) {
    if (!t || t.isIgnored || !t.parentCategory || !t.childCategory) continue;
    const key = pickKey(t.parentCategory, t.childCategory);
    allTime.set(key, (allTime.get(key) || 0) + 1);
    const at = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
    if (at >= since) recent.set(key, (recent.get(key) || 0) + 1);
  }
  // Recent habits first; all-time only fills slots a quiet 45 days leaves empty.
  for (const counts of [recent, allTime]) {
    for (const [key] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      if (out.length >= limit) return out;
      const [p, c] = key.split('›');
      push(findPick(tree, p, c));
    }
  }
  for (const [parentId, childId] of COMMON_PICKS) {
    const parent = tree.find((p) => p.id === parentId);
    const child = parent?.children.find((c) => c.id === childId);
    push(parent && child ? { parent, child } : null);
  }
  return out;
}

/** Sub-categories matching `query`: child label starts-with, then contains, then parent label. */
export function searchCategories(tree: ParentCat[], query: string, limit = 6): CategoryPick[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { pick: CategoryPick; score: number }[] = [];
  for (const parent of tree) {
    const parentHit = parent.label.toLowerCase().includes(q);
    for (const child of parent.children) {
      const label = child.label.toLowerCase();
      const words = label.split(/[^a-z0-9]+/);
      const score = label.startsWith(q) ? 0
        : words.some((w) => w.startsWith(q)) ? 1
        : label.includes(q) ? 2
        : parentHit ? 3
        : -1;
      if (score >= 0) scored.push({ pick: { parent, child }, score });
    }
  }
  // Stable within a score: tree order.
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.pick);
}
