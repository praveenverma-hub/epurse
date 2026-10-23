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
      { id: 'insurance_emi',   label: 'Insurance',              emoji: '🛡️' },
      { id: 'loan_emi',        label: 'Loan EMI',               emoji: '🏦' },
      { id: 'rent_housing',    label: 'Rent & Housing',         emoji: '🏠' },
      { id: 'taxes_fees',      label: 'Taxes & Government',     emoji: '🏛️' },
      { id: 'bank_fees',       label: 'Bank Charges & Fees',    emoji: '💸' },
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
      { id: 'clothing',    label: 'Clothing & Footwear',        emoji: '👕' },
      { id: 'beauty',      label: 'Beauty & Care',              emoji: '💄' },
      { id: 'electronics', label: 'Electronics',                emoji: '💻' },
      { id: 'sports',      label: 'Sports & Outdoors',          emoji: '🏃' },
      { id: 'gifts',       label: 'Gifts & Donations',          emoji: '🎁' },
    ],
  },
  {
    id: 'home_family',
    label: 'Home & Family',
    emoji: '🏡',
    color: '#D97706',
    legacyId: 'home_family',
    children: [
      { id: 'household_help',   label: 'Household Help',   emoji: '🧹' },
      { id: 'home_maintenance', label: 'Home Maintenance', emoji: '🛠️' },
      { id: 'family_support',   label: 'Family Support',   emoji: '👪' },
      { id: 'childcare',        label: 'Childcare',        emoji: '🧸' },
      { id: 'pet_care',         label: 'Pet Care',          emoji: '🐾' },
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
    // Was "Fuel" (v44 relabels stored rows); the id and legacy id stay `fuel`.
    id: 'fuel',
    label: 'Vehicle',
    emoji: '🚗',
    color: '#F97316',
    legacyId: 'fuel',
    children: [
      { id: 'petrol',          label: 'Petrol & Diesel',   emoji: '⛽' },
      { id: 'vehicle_service', label: 'Service & Repairs', emoji: '🔧' },
      { id: 'parking_tolls',   label: 'Parking & Tolls',   emoji: '🅿️' },
    ],
  },
  {
    id: 'investments',
    label: 'Investments',
    emoji: '📈',
    color: '#14B8A6',
    legacyId: 'investments',
    children: [
      { id: 'stocks',   label: 'Stocks & Trading',   emoji: '📊' },
      { id: 'mf',       label: 'Mutual Funds',       emoji: '💹' },
      { id: 'deposits', label: 'Deposits & Savings', emoji: '🐷' },
      { id: 'gold',     label: 'Gold',               emoji: '🪙' },
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
      // Settlements live here too (Oct-15-26 — were a separate picker section that kept
      // its own selection): the picker now matches how they count, as Transfers.
      { id: 'received_back', label: 'Received Back', emoji: '✅', legacyId: 'lent_settled' },
      { id: 'repaid',        label: 'Repaid',        emoji: '💳', legacyId: 'borrow_repaid' },
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
      { id: 'interest',  label: 'Interest & Dividends', emoji: '📥' },
      { id: 'reimbursement', label: 'Reimbursements', emoji: '↩️' },
      { id: 'other_income', label: 'Other Income', emoji: '➕' },
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
  /**
   * Child LABEL -> child `id`. A transaction stores `childCategory` as a label
   * (that is what the picker writes), so this is what turns a stored row back
   * into the tree node the user actually chose. Child labels are unique across
   * the whole tree, which is what makes a flat map safe here.
   */
  childLabelToId:      Record<string, string>;
}

/** Build the two-tier ↔ legacy lookup maps for a given tree. */
export const buildLegacyMaps = (tree: ParentCat[]): CategoryMaps => {
  const parentLabelToId: Record<string, string>     = {};
  const parentLabelToLegacy: Record<string, string> = {};
  const childLabelToLegacy: Record<string, string>  = {};
  const legacyToParentId: Record<string, string>    = {};
  const childLabelToId: Record<string, string>      = {};

  for (const p of tree) {
    parentLabelToId[p.label]     = p.id;
    parentLabelToLegacy[p.label] = p.legacyId;
    legacyToParentId[p.legacyId] = p.id;
    for (const c of p.children) {
      const legacy = c.legacyId ?? p.legacyId;
      childLabelToLegacy[c.label] = legacy;
      legacyToParentId[legacy]    = p.id;
      childLabelToId[c.label]     = c.id;
    }
  }
  // Aliases / flat categories that don't live in the tree.
  parentLabelToId['Unassigned'] = 'other';
  Object.assign(legacyToParentId, {
    // A credit-card bill payment is a bill, not a money-movement transfer — it
    // just happens to be rendered via its own "CARD" section in the picker
    // (like the settlement rows above) rather than as a normal tree child,
    // because selecting it opens the card-reconcile sheet instead of simply
    // tagging a category. See CategoryPickerModal's dedicated CARD section,
    // rendered directly under the Bills & Utilities row for the same reason.
    cc_bill:       'bills',
    other:         'other',
  });
  return { parentLabelToId, parentLabelToLegacy, childLabelToLegacy, legacyToParentId, childLabelToId };
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
/** The two settlement kinds (Transfers › Received Back / Repaid). */
export const LB_SETTLEMENT_IDS = new Set(['lent_settled', 'borrow_repaid']);
/** Two-tier child LABEL → legacy id for the lent/borrow contact-link intercept. */
export const LB_CHILD_LABEL_TO_ID: Record<string, string> = {
  Lent: 'lent', Borrowed: 'borrowed', 'Received Back': 'lent_settled', Repaid: 'borrow_repaid',
};
/** Two-tier child labels that cannot be split (they become debt records). */
export const SPLIT_BLOCKED_CHILD_LABELS = new Set(Object.keys(LB_CHILD_LABEL_TO_ID));

/**
 * The lend/borrow options that make sense for a transaction: money OUT can be Lent, or
 * Repaid when I owe someone; money IN can be Borrowed, or Received Back when someone owes
 * me. One already on the transaction always stays (it's what's selected).
 */
export function lbChildAllowed(
  label: string, { type, owesMe, iOwe, current, sharedBill = false }: { type?: string; owesMe: boolean; iOwe: boolean; current?: string; sharedBill?: boolean },
): boolean {
  const id = LB_CHILD_LABEL_TO_ID[label];
  if (!id || id === current) return true;
  if (sharedBill) return false;   // a group / split bill's debts come from its split (isSharedBill)
  const out = type ? type !== 'credit' : null;   // null: direction unknown
  if (id === 'lent') return out !== false;
  if (id === 'borrowed') return out !== true;
  if (id === 'borrow_repaid') return out !== false && iOwe;
  return out !== true && owesMe;   // lent_settled
}

/**
 * The full category for a flat legacy id — every category write goes through this, so a
 * transaction's three fields never disagree: 'lent_settled' → Transfers › Received Back,
 * 'shopping' → Shopping (no child), 'cc_bill' / 'other' → no labels. A stale pair left by a
 * flat write used to WIN (parentCatIdForTxn reads the labels first): a Repaid tagged on a
 * Food › Restaurants txn still counted as Food in budgets and spend rules.
 */
export function categoryFieldsFor(categoryId: string, tree: ParentCat[] = PARENT_CATEGORIES): {
  categoryId: string; parentCategory: string | undefined; childCategory: string | undefined;
} {
  for (const p of tree) {
    const c = p.children.find((x) => x.legacyId === categoryId);
    if (c) return { categoryId, parentCategory: p.label, childCategory: c.label };
  }
  const p = tree.find((x) => x.legacyId === categoryId);
  return { categoryId, parentCategory: p?.label, childCategory: undefined };
}

// ─── Budgetable parents ──────────────────────────────────────────────────────
// Money-movement parents (Transfers, Income) can't hold a budget; everything else
// can. Derived from the tree so a new built-in spend parent is budgetable for free.
export const NON_BUDGETABLE_PARENT_IDS = new Set(['transfers', 'income']);

// ─── Money-IN parents ────────────────────────────────────────────────────────
// Parents whose transactions are CREDITS. Anything that counts spend — Goals'
// auto-funding is the current caller — can never match one of these, because
// `countsForSpend` is debit-or-refund. Offering such a parent as a funding
// source is offering a switch that is wired to nothing.
//
// NOT the same question as `NON_BUDGETABLE_PARENT_IDS`, which is "can this hold
// a budget" and also covers Transfers. Transfers ARE debits, so a self-transfer
// into savings genuinely can fund a goal — keep the two sets apart.
export const CREDIT_ONLY_PARENT_IDS = new Set(['income']);
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
/**
 * txn -> the tree CHILD id the user (or the merchant dictionary) put it in, or
 * '' when the row was never resolved past its parent.
 *
 * Mirrors `parentCatIdForTxn`: the store owns the maps, so callers that need to
 * reason about a transaction's sub-category resolve it here rather than poking
 * at the raw `childCategory` label.
 */
export const childCatIdForTxn = (
  t: { childCategory?: string },
  maps: CategoryMaps = DEFAULT_MAPS,
): string => (t.childCategory ? maps.childLabelToId[t.childCategory] || '' : '');

export const parentCatIdForTxn = (
  t: { parentCategory?: string; categoryId?: string },
  maps: CategoryMaps = DEFAULT_MAPS,
): string => {
  if (t.parentCategory && maps.parentLabelToId[t.parentCategory]) return maps.parentLabelToId[t.parentCategory];
  return maps.legacyToParentId[t.categoryId ?? ''] || 'other';
};

// ─── Store v44 (Oct-24-26): renamed built-ins ────────────────────────────────
// Labels are stored on every transaction and saved merchant rule, so a rename needs this.
// (Insurance & EMI → Insurance / Loan EMI is NOT migrated — pre-launch, user's call: old rows
// keep that label and still count under Bills.)

/** Old built-in labels → today's, for one stored row (txn or merchant rule). Ids never change. */
export function relabelV44<T extends { parentCategory?: string }>(row: T): T {
  return row?.parentCategory === 'Fuel' ? { ...row, parentCategory: 'Vehicle' } : row;
}

/**
 * Store v43 repair: a transaction whose built-in labels name a different category than
 * its `categoryId` — left by flat writes before Oct-15-26 (see categoryFieldsFor). The id
 * was the later choice, so the labels are re-derived from it. A custom parent is left alone.
 */
export function fixStaleCategoryLabels<T extends { categoryId?: string; parentCategory?: string; childCategory?: string }>(t: T): T {
  if (!t?.parentCategory || !t.categoryId || !DEFAULT_MAPS.parentLabelToId[t.parentCategory]) return t;
  if (twoTierToLegacyCatId(t.parentCategory, t.childCategory) === t.categoryId) return t;
  const f = categoryFieldsFor(t.categoryId);
  const next = { ...t };
  if (f.parentCategory) next.parentCategory = f.parentCategory; else delete next.parentCategory;
  if (f.childCategory) next.childCategory = f.childCategory; else delete next.childCategory;
  return next;
}
