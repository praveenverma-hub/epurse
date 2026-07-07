// =============================================================================
// twoTierCategories.ts — SINGLE SOURCE OF TRUTH for the two-step category system.
// -----------------------------------------------------------------------------
// The tree below drives every category picker AND carries each node's legacy flat
// `categoryId`. All two-tier ↔ legacy conversions (used by the store for totals,
// budgets, ingestion, and by the screens for saving) DERIVE from this file — so a
// category is added/renamed/remapped in ONE place and it reflects everywhere.
//
// Do NOT re-declare PARENT_TO_LEGACY / CHILD_TO_LEGACY / LEGACY_TO_PARENT maps in
// screens or the store. Import the helpers below instead.
// =============================================================================

export interface ChildCat {
  id: string;
  label: string;
  emoji: string;
  /** Legacy flat categoryId this child resolves to. Defaults to the parent's legacyId. */
  legacyId?: string;
}

export interface ParentCat {
  id: string;
  label: string;
  emoji: string;
  /** Hex accent colour used for chip fill and tint. */
  color: string;
  /** Legacy flat categoryId this parent resolves to (usually === id; e.g. Transfers→'transfer', Income→'salary'). */
  legacyId: string;
  children: ChildCat[];
}

export const PARENT_CATEGORIES: ParentCat[] = [
  {
    id: 'food',
    label: 'Food & Dining',
    emoji: '🍔',
    color: '#FF5A1F',
    legacyId: 'food',
    children: [
      { id: 'food_delivery',  label: 'Food Delivery',          emoji: '🛵' },
      { id: 'fast_food',      label: 'Fast Food & Cafes',       emoji: '☕' },
      { id: 'groceries',      label: 'Groceries',               emoji: '🥬', legacyId: 'groceries' },
      { id: 'restaurants',    label: 'Restaurants',             emoji: '🍽️' },
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Commute',
    emoji: '🚕',
    color: '#3B82F6',
    legacyId: 'travel',
    children: [
      { id: 'daily_commute',  label: 'Daily Commute',           emoji: '🏙️' },
      { id: 'long_distance',  label: 'Long Distance',           emoji: '✈️' },
    ],
  },
  {
    id: 'bills',
    label: 'Bills & Utilities',
    emoji: '💡',
    color: '#8B5CF6',
    legacyId: 'bills',
    children: [
      { id: 'fixed_sub',       label: 'Fixed Subscriptions',    emoji: '📺' },
      { id: 'variable_util',   label: 'Variable Utilities',     emoji: '⚡' },
      { id: 'mobile_internet', label: 'Mobile & Internet',      emoji: '📱' },
      { id: 'insurance_emi',   label: 'Insurance & EMI',        emoji: '🛡️' },
    ],
  },
  {
    id: 'shopping',
    label: 'Shopping',
    emoji: '🛍️',
    color: '#EC4899',
    legacyId: 'shopping',
    children: [
      { id: 'online',      label: 'Online Shopping',            emoji: '📦' },
      { id: 'beauty',      label: 'Beauty & Care',              emoji: '💄' },
      { id: 'electronics', label: 'Electronics',                emoji: '💻' },
      { id: 'sports',      label: 'Sports & Outdoors',          emoji: '🏃' },
    ],
  },
  {
    id: 'entertainment',
    label: 'Entertainment',
    emoji: '🎬',
    color: '#F59E0B',
    legacyId: 'entertainment',
    children: [
      { id: 'movies', label: 'Movies & Events', emoji: '🎟️' },
    ],
  },
  {
    id: 'health',
    label: 'Health & Fitness',
    emoji: '💊',
    color: '#EF4444',
    legacyId: 'health',
    children: [
      { id: 'pharmacy',    label: 'Pharmacy & Meds',   emoji: '💊' },
      { id: 'consult',     label: 'Consultations',     emoji: '🩺' },
      { id: 'gym_fitness', label: 'Gym & Fitness',     emoji: '🏋️' },
    ],
  },
  {
    id: 'fuel',
    label: 'Fuel',
    emoji: '⛽',
    color: '#F97316',
    legacyId: 'fuel',
    children: [
      { id: 'petrol', label: 'Petrol & Diesel', emoji: '⛽' },
    ],
  },
  {
    id: 'investments',
    label: 'Investments',
    emoji: '📈',
    color: '#14B8A6',
    legacyId: 'investments',
    children: [
      { id: 'stocks', label: 'Stocks & Trading', emoji: '📊' },
      { id: 'mf',     label: 'Mutual Funds',      emoji: '💹' },
    ],
  },
  {
    id: 'transfers',
    label: 'Transfers',
    emoji: '🔁',
    color: '#6B7280',
    legacyId: 'transfer',
    children: [
      { id: 'p2p',       label: 'P2P Transfer', emoji: '👤' },
      { id: 'self',      label: 'Self',         emoji: '🔄', legacyId: 'self' },
      { id: 'lent',      label: 'Lent',         emoji: '🤝', legacyId: 'lent' },
      { id: 'borrowed',  label: 'Borrowed',     emoji: '🧾', legacyId: 'borrowed' },
      { id: 'repayment', label: 'Repayment',    emoji: '💸', legacyId: 'repayment' },
    ],
  },
  {
    id: 'education',
    label: 'Education',
    emoji: '🎓',
    color: '#0EA5E9',
    legacyId: 'education',
    children: [
      { id: 'online_courses', label: 'Online Courses', emoji: '💻' },
      { id: 'school_fees',    label: 'School Fees',    emoji: '🏫' },
    ],
  },
  {
    id: 'income',
    label: 'Income',
    emoji: '💰',
    color: '#059669',
    legacyId: 'salary',
    children: [
      { id: 'salary',    label: 'Salary',    emoji: '💰' },
      { id: 'freelance', label: 'Freelance', emoji: '💼' },
    ],
  },
];

// ─── Custom (user-created) categories ────────────────────────────────────────
// Users can add sub-categories under any parent and create new top-level parents.
// These persist in the store and merge with the built-ins via buildCategoryTree().
export interface CustomChild extends ChildCat { parentId: string; }
export type CustomParent = Omit<ParentCat, 'children'> & { children?: ChildCat[] };

/**
 * Merge user-created custom parents/children into the built-in tree.
 * Custom children attach to their `parentId` (built-in OR custom); each custom
 * node's legacyId defaults to its own id, so it becomes its own flat category.
 */
export const buildCategoryTree = (
  customParents: CustomParent[] = [],
  customChildren: CustomChild[] = [],
): ParentCat[] => {
  const extraChildrenByParent: Record<string, ChildCat[]> = {};
  for (const c of customChildren) {
    (extraChildrenByParent[c.parentId] ||= []).push({
      id: c.id, label: c.label, emoji: c.emoji, legacyId: c.legacyId ?? c.id,
    });
  }
  const merged: ParentCat[] = PARENT_CATEGORIES.map((p) => ({
    ...p,
    children: [...p.children, ...(extraChildrenByParent[p.id] || [])],
  }));
  for (const cp of customParents) {
    merged.push({
      ...cp,
      legacyId: cp.legacyId ?? cp.id,
      children: [...(cp.children || []), ...(extraChildrenByParent[cp.id] || [])],
    });
  }
  return merged;
};

// ─── Legacy mapping — derived from a tree (built-in by default) ───────────────
export interface CategoryMaps {
  parentLabelToId:     Record<string, string>;
  parentLabelToLegacy: Record<string, string>;
  childLabelToLegacy:  Record<string, string>;
  legacyToParentId:    Record<string, string>;
}

/** Build the two-tier ↔ legacy lookup maps for a given tree. */
export const buildLegacyMaps = (tree: ParentCat[]): CategoryMaps => {
  const parentLabelToId: Record<string, string>     = {};
  const parentLabelToLegacy: Record<string, string> = {};
  const childLabelToLegacy: Record<string, string>  = {};
  const legacyToParentId: Record<string, string>    = {};

  for (const p of tree) {
    parentLabelToId[p.label]     = p.id;
    parentLabelToLegacy[p.label] = p.legacyId;
    legacyToParentId[p.legacyId] = p.id;
    for (const c of p.children) {
      const legacy = c.legacyId ?? p.legacyId;
      childLabelToLegacy[c.label] = legacy;
      legacyToParentId[legacy]    = p.id;
    }
  }
  // Aliases / flat categories that don't live in the tree.
  parentLabelToId['Unassigned'] = 'other';
  Object.assign(legacyToParentId, {
    lent_settled:  'transfers',
    borrow_repaid: 'transfers',
    cc_bill:       'transfers',
    other:         'other',
  });
  return { parentLabelToId, parentLabelToLegacy, childLabelToLegacy, legacyToParentId };
};

/** Default maps for the built-in tree (no custom categories). */
export const DEFAULT_MAPS: CategoryMaps = buildLegacyMaps(PARENT_CATEGORIES);

// Back-compat named exports (built-in only). For custom-aware lookups, pass a
// CategoryMaps built from buildCategoryTree(...) into the helpers below.
export const PARENT_LABEL_TO_ID     = DEFAULT_MAPS.parentLabelToId;
export const PARENT_LABEL_TO_LEGACY = DEFAULT_MAPS.parentLabelToLegacy;
export const CHILD_LABEL_TO_LEGACY  = DEFAULT_MAPS.childLabelToLegacy;
export const LEGACY_TO_PARENT_ID    = DEFAULT_MAPS.legacyToParentId;

// ─── Lent/Borrow + settlement helper sets (flat legacy ids) ──────────────────
/** All lent/borrow legacy categoryIds (the "LB" family). */
export const LB_ALL_CATS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid']);
/** Settlement legacy ids shown as a flat section (not in the tree). */
export const LB_SETTLEMENT_IDS = new Set(['lent_settled', 'borrow_repaid']);
/** Two-tier child LABEL → legacy id for the lent/borrow contact-link intercept. */
export const LB_CHILD_LABEL_TO_ID: Record<string, string> = { Lent: 'lent', Borrowed: 'borrowed' };
/** Two-tier child labels that cannot be split (they become debt records). */
export const SPLIT_BLOCKED_CHILD_LABELS = new Set(['Lent', 'Borrowed']);

// ─── Budgetable parents ──────────────────────────────────────────────────────
// Money-movement parents (Transfers, Income) can't hold a budget; everything else
// can. Derived from the tree so a new built-in spend parent is budgetable for free.
export const NON_BUDGETABLE_PARENT_IDS = new Set(['transfers', 'income']);
export const BUDGETABLE_PARENT_IDS: string[] = PARENT_CATEGORIES
  .filter((p) => !NON_BUDGETABLE_PARENT_IDS.has(p.id))
  .map((p) => p.id);
export const BUDGETABLE_PARENT_ID_SET = new Set(BUDGETABLE_PARENT_IDS);

// ─── Helpers ─────────────────────────────────────────────────────────────────
export const findParentByLabel = (label?: string): ParentCat | undefined =>
  PARENT_CATEGORIES.find((p) => p.label === label);

export const findParentById = (id?: string): ParentCat | undefined =>
  PARENT_CATEGORIES.find((p) => p.id === id);

/** two-tier (parent label + child label) → legacy flat categoryId (child wins). */
export const twoTierToLegacyCatId = (
  parentLabel?: string,
  childLabel?: string,
  maps: CategoryMaps = DEFAULT_MAPS,
): string | null => {
  if (childLabel && maps.childLabelToLegacy[childLabel]) return maps.childLabelToLegacy[childLabel];
  if (parentLabel && maps.parentLabelToLegacy[parentLabel]) return maps.parentLabelToLegacy[parentLabel];
  return null;
};

/** Resolve a transaction to its first-level (parent) category id — used for budget grouping. */
export const parentCatIdForTxn = (
  t: { parentCategory?: string; categoryId?: string },
  maps: CategoryMaps = DEFAULT_MAPS,
): string => {
  if (t.parentCategory && maps.parentLabelToId[t.parentCategory]) return maps.parentLabelToId[t.parentCategory];
  return maps.legacyToParentId[t.categoryId ?? ''] || 'other';
};
