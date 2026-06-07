// =============================================================================
// twoTierCategories.ts — Category tree powering the two-step selection UI
// =============================================================================

export interface ChildCat {
  id: string;
  label: string;
  emoji: string;
}

export interface ParentCat {
  id: string;
  label: string;
  emoji: string;
  /** Hex accent colour used for chip fill and tint. */
  color: string;
  children: ChildCat[];
}

export const PARENT_CATEGORIES: ParentCat[] = [
  {
    id: 'food',
    label: 'Food & Dining',
    emoji: '🍔',
    color: '#FF5A1F',
    children: [
      { id: 'food_delivery',  label: 'Food Delivery',          emoji: '🛵' },
      { id: 'fast_food',      label: 'Fast Food & Cafes',       emoji: '☕' },
      { id: 'groceries',      label: 'Groceries',               emoji: '🥬' },
      { id: 'restaurants',    label: 'Restaurants',             emoji: '🍽️' },
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Commute',
    emoji: '🚕',
    color: '#3B82F6',
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
    children: [
      { id: 'movies', label: 'Movies & Events', emoji: '🎟️' },
    ],
  },
  {
    id: 'health',
    label: 'Health & Fitness',
    emoji: '💊',
    color: '#EF4444',
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
    children: [
      { id: 'petrol', label: 'Petrol & Diesel', emoji: '⛽' },
    ],
  },
  {
    id: 'investments',
    label: 'Investments',
    emoji: '📈',
    color: '#14B8A6',
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
    children: [
      { id: 'p2p',      label: 'P2P Transfer', emoji: '👤' },
      { id: 'self',     label: 'Self',          emoji: '🔄' },
      { id: 'lent',     label: 'Lent',          emoji: '🤝' },
      { id: 'borrowed', label: 'Borrowed',      emoji: '🧾' },
    ],
  },
  {
    id: 'education',
    label: 'Education',
    emoji: '🎓',
    color: '#0EA5E9',
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
    children: [
      { id: 'salary',    label: 'Salary',    emoji: '💰' },
      { id: 'freelance', label: 'Freelance', emoji: '💼' },
    ],
  },
];

export const findParentByLabel = (label: string): ParentCat | undefined =>
  PARENT_CATEGORIES.find((p) => p.label === label);
