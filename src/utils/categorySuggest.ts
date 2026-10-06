// =============================================================================
// categorySuggest — guess a two-tier category from what the user TYPES as the
// merchant / description on the manual add forms. Pure (unit-tested by
// `npm run test:categorySuggest`); the forms reach it via useCategorySuggestion.
//
// Layers, most personal first — the first hit wins:
//   1. history   — the category this user last gave the same merchant text
//   2. user_rule — their saved merchant rules (userCustomRules)
//   3. dictionary — known brands (merchantEnricher's GLOBAL_MERCHANT_DICTIONARY)
//   4. keyword   — everyday words people type (MANUAL_CATEGORY_KEYWORDS below)
//
// Layer 1 is what makes this grow without any extra storage: every categorised
// entry teaches the next one. To grow layer 4, add a phrase to the table —
// labels MUST match twoTierCategories.ts exactly (the test checks that).
//
// Typed text is matched on WHOLE WORDS, unlike SMS enrichment's substring
// search: "Coca Cola" must not hit the OLA cab brand, "parent" must not hit rent.
// =============================================================================
import { cleanMerchantName, GLOBAL_MERCHANT_DICTIONARY, type UserRules } from './merchantEnricher';

export type SuggestionSource = 'history' | 'user_rule' | 'dictionary' | 'keyword';

export interface CategorySuggestion {
  parentCategory: string;
  childCategory: string;
  source: SuggestionSource;
}

export type CategoryHistory = Map<string, { parentCategory: string; childCategory: string }>;

const FOOD = 'Food & Dining';
const TRAVEL = 'Travel & Commute';
const BILLS = 'Bills & Utilities';
const SHOP = 'Shopping';
const HEALTH = 'Health & Fitness';
const EDU = 'Education';
const INCOME = 'Income';

/**
 * Everyday words → [parent, child]. Lowercase; multi-word phrases allowed (the
 * longest matching phrase wins, so "movie ticket" beats "ticket"). Deliberately
 * leaves out words that are genuinely ambiguous on their own ("ticket", "water",
 * "oil", "order") — a wrong guess costs more than no guess.
 */
export const MANUAL_CATEGORY_KEYWORDS: Record<string, [string, string]> = {
  // Food & Dining
  dinner: [FOOD, 'Restaurants'], lunch: [FOOD, 'Restaurants'], breakfast: [FOOD, 'Restaurants'],
  brunch: [FOOD, 'Restaurants'], restaurant: [FOOD, 'Restaurants'], buffet: [FOOD, 'Restaurants'],
  biryani: [FOOD, 'Restaurants'], thali: [FOOD, 'Restaurants'], dhaba: [FOOD, 'Restaurants'],
  'dine out': [FOOD, 'Restaurants'], 'eating out': [FOOD, 'Restaurants'],
  coffee: [FOOD, 'Fast Food & Cafes'], tea: [FOOD, 'Fast Food & Cafes'], chai: [FOOD, 'Fast Food & Cafes'],
  cafe: [FOOD, 'Fast Food & Cafes'], snacks: [FOOD, 'Fast Food & Cafes'], snack: [FOOD, 'Fast Food & Cafes'],
  juice: [FOOD, 'Fast Food & Cafes'], 'ice cream': [FOOD, 'Fast Food & Cafes'], icecream: [FOOD, 'Fast Food & Cafes'],
  pizza: [FOOD, 'Fast Food & Cafes'], burger: [FOOD, 'Fast Food & Cafes'], sandwich: [FOOD, 'Fast Food & Cafes'],
  momos: [FOOD, 'Fast Food & Cafes'], samosa: [FOOD, 'Fast Food & Cafes'], bakery: [FOOD, 'Fast Food & Cafes'],
  cake: [FOOD, 'Fast Food & Cafes'], pastry: [FOOD, 'Fast Food & Cafes'], shake: [FOOD, 'Fast Food & Cafes'],
  groceries: [FOOD, 'Groceries'], grocery: [FOOD, 'Groceries'], vegetables: [FOOD, 'Groceries'],
  veggies: [FOOD, 'Groceries'], sabzi: [FOOD, 'Groceries'], fruits: [FOOD, 'Groceries'], fruit: [FOOD, 'Groceries'],
  milk: [FOOD, 'Groceries'], eggs: [FOOD, 'Groceries'], bread: [FOOD, 'Groceries'], kirana: [FOOD, 'Groceries'],
  ration: [FOOD, 'Groceries'], supermarket: [FOOD, 'Groceries'], atta: [FOOD, 'Groceries'],
  'food delivery': [FOOD, 'Food Delivery'], 'online food': [FOOD, 'Food Delivery'],

  // Travel & Commute
  cab: [TRAVEL, 'Daily Commute'], taxi: [TRAVEL, 'Daily Commute'], auto: [TRAVEL, 'Daily Commute'],
  rickshaw: [TRAVEL, 'Daily Commute'], metro: [TRAVEL, 'Daily Commute'], bus: [TRAVEL, 'Daily Commute'],
  toll: [TRAVEL, 'Daily Commute'], parking: [TRAVEL, 'Daily Commute'], commute: [TRAVEL, 'Daily Commute'],
  'bike taxi': [TRAVEL, 'Daily Commute'],
  flight: [TRAVEL, 'Long Distance'], flights: [TRAVEL, 'Long Distance'], train: [TRAVEL, 'Long Distance'],
  airport: [TRAVEL, 'Long Distance'], hotel: [TRAVEL, 'Long Distance'], trip: [TRAVEL, 'Long Distance'],
  travel: [TRAVEL, 'Long Distance'], holiday: [TRAVEL, 'Long Distance'], vacation: [TRAVEL, 'Long Distance'],
  visa: [TRAVEL, 'Long Distance'], 'train ticket': [TRAVEL, 'Long Distance'], 'flight ticket': [TRAVEL, 'Long Distance'],
  'bus ticket': [TRAVEL, 'Long Distance'],

  // Bills & Utilities
  electricity: [BILLS, 'Variable Utilities'], 'electricity bill': [BILLS, 'Variable Utilities'],
  'power bill': [BILLS, 'Variable Utilities'], 'water bill': [BILLS, 'Variable Utilities'],
  'gas bill': [BILLS, 'Variable Utilities'], 'gas cylinder': [BILLS, 'Variable Utilities'],
  cylinder: [BILLS, 'Variable Utilities'], lpg: [BILLS, 'Variable Utilities'], maintenance: [BILLS, 'Variable Utilities'],
  recharge: [BILLS, 'Mobile & Internet'], 'mobile recharge': [BILLS, 'Mobile & Internet'],
  'phone bill': [BILLS, 'Mobile & Internet'], 'mobile bill': [BILLS, 'Mobile & Internet'],
  wifi: [BILLS, 'Mobile & Internet'], internet: [BILLS, 'Mobile & Internet'], broadband: [BILLS, 'Mobile & Internet'],
  dth: [BILLS, 'Mobile & Internet'], postpaid: [BILLS, 'Mobile & Internet'], prepaid: [BILLS, 'Mobile & Internet'],
  subscription: [BILLS, 'Fixed Subscriptions'], ott: [BILLS, 'Fixed Subscriptions'], newspaper: [BILLS, 'Fixed Subscriptions'],
  insurance: [BILLS, 'Insurance & EMI'], premium: [BILLS, 'Insurance & EMI'], emi: [BILLS, 'Insurance & EMI'],
  'loan emi': [BILLS, 'Insurance & EMI'],

  // Shopping
  shopping: [SHOP, 'Online Shopping'], clothes: [SHOP, 'Online Shopping'], clothing: [SHOP, 'Online Shopping'],
  shoes: [SHOP, 'Online Shopping'], shirt: [SHOP, 'Online Shopping'], jeans: [SHOP, 'Online Shopping'],
  dress: [SHOP, 'Online Shopping'], gift: [SHOP, 'Online Shopping'], gifts: [SHOP, 'Online Shopping'],
  salon: [SHOP, 'Beauty & Care'], haircut: [SHOP, 'Beauty & Care'], 'hair cut': [SHOP, 'Beauty & Care'],
  spa: [SHOP, 'Beauty & Care'], parlour: [SHOP, 'Beauty & Care'], parlor: [SHOP, 'Beauty & Care'],
  grooming: [SHOP, 'Beauty & Care'], makeup: [SHOP, 'Beauty & Care'], cosmetics: [SHOP, 'Beauty & Care'],
  laptop: [SHOP, 'Electronics'], headphones: [SHOP, 'Electronics'], earphones: [SHOP, 'Electronics'],
  charger: [SHOP, 'Electronics'], electronics: [SHOP, 'Electronics'], gadget: [SHOP, 'Electronics'],
  'mobile phone': [SHOP, 'Electronics'],
  sports: [SHOP, 'Sports & Outdoors'], cricket: [SHOP, 'Sports & Outdoors'], football: [SHOP, 'Sports & Outdoors'],
  badminton: [SHOP, 'Sports & Outdoors'], bicycle: [SHOP, 'Sports & Outdoors'], trekking: [SHOP, 'Sports & Outdoors'],

  // Entertainment
  movie: ['Entertainment', 'Movies & Events'], movies: ['Entertainment', 'Movies & Events'],
  cinema: ['Entertainment', 'Movies & Events'], film: ['Entertainment', 'Movies & Events'],
  concert: ['Entertainment', 'Movies & Events'], 'movie ticket': ['Entertainment', 'Movies & Events'],
  bowling: ['Entertainment', 'Movies & Events'], gaming: ['Entertainment', 'Movies & Events'],

  // Health & Fitness
  medicine: [HEALTH, 'Pharmacy & Meds'], medicines: [HEALTH, 'Pharmacy & Meds'], pharmacy: [HEALTH, 'Pharmacy & Meds'],
  chemist: [HEALTH, 'Pharmacy & Meds'], medical: [HEALTH, 'Pharmacy & Meds'], tablets: [HEALTH, 'Pharmacy & Meds'],
  doctor: [HEALTH, 'Consultations'], clinic: [HEALTH, 'Consultations'], hospital: [HEALTH, 'Consultations'],
  consultation: [HEALTH, 'Consultations'], dentist: [HEALTH, 'Consultations'], checkup: [HEALTH, 'Consultations'],
  'lab test': [HEALTH, 'Consultations'], 'blood test': [HEALTH, 'Consultations'],
  gym: [HEALTH, 'Gym & Fitness'], fitness: [HEALTH, 'Gym & Fitness'], yoga: [HEALTH, 'Gym & Fitness'],
  workout: [HEALTH, 'Gym & Fitness'], protein: [HEALTH, 'Gym & Fitness'],

  // Fuel
  petrol: ['Fuel', 'Petrol & Diesel'], diesel: ['Fuel', 'Petrol & Diesel'], fuel: ['Fuel', 'Petrol & Diesel'],
  cng: ['Fuel', 'Petrol & Diesel'], 'ev charging': ['Fuel', 'Petrol & Diesel'],

  // Investments
  sip: ['Investments', 'Mutual Funds'], 'mutual fund': ['Investments', 'Mutual Funds'],
  'mutual funds': ['Investments', 'Mutual Funds'], stocks: ['Investments', 'Stocks & Trading'],
  shares: ['Investments', 'Stocks & Trading'],

  // Education
  course: [EDU, 'Online Courses'], 'online course': [EDU, 'Online Courses'], classes: [EDU, 'Online Courses'],
  tuition: [EDU, 'School Fees'], 'school fees': [EDU, 'School Fees'], 'school fee': [EDU, 'School Fees'],
  'college fees': [EDU, 'School Fees'], 'exam fees': [EDU, 'School Fees'],

  // Income (only ever offered for an Income entry — see `allowParent`)
  salary: [INCOME, 'Salary'], bonus: [INCOME, 'Salary'], stipend: [INCOME, 'Salary'],
  freelance: [INCOME, 'Freelance'], freelancing: [INCOME, 'Freelance'], 'client payment': [INCOME, 'Freelance'],
};

const KEYWORD_PHRASES = Object.keys(MANUAL_CATEGORY_KEYWORDS).sort((a, b) => b.length - a.length);
const DICTIONARY_KEYS = Object.keys(GLOBAL_MERCHANT_DICTIONARY).sort((a, b) => b.length - a.length);

/** The key two entries share when they describe the same merchant. */
export const merchantKey = (text: string): string =>
  (text || '').toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim();

/**
 * The category this user last gave each merchant text, newest first. Built from
 * transactions that carry a two-tier category (Lent/Borrowed excluded — those
 * need a contact and are never guessed).
 */
export function buildCategoryHistory(
  transactions: { merchant?: string; parentCategory?: string; childCategory?: string; categoryId?: string; isIgnored?: boolean }[],
  isLbCategoryId: (id?: string) => boolean = () => false,
): CategoryHistory {
  const out: CategoryHistory = new Map();
  for (const t of transactions || []) {
    if (!t || t.isIgnored || !t.parentCategory || !t.childCategory || isLbCategoryId(t.categoryId)) continue;
    const key = merchantKey(t.merchant || '');
    if (key && !out.has(key)) out.set(key, { parentCategory: t.parentCategory, childCategory: t.childCategory });
  }
  return out;
}

interface SuggestOptions {
  history?: CategoryHistory;
  userRules?: UserRules;
  /** Gate by entry type etc. — return false to skip a candidate and keep looking. */
  allowParent?: (parentCategory: string, childCategory: string) => boolean;
}

/** Whole-word / whole-phrase match of `phrase` inside normalised `text`. */
const hasPhrase = (text: string, phrase: string) => ` ${text} `.includes(` ${phrase} `);

export function suggestCategory(text: string, opts: SuggestOptions = {}): CategorySuggestion | null {
  const norm = merchantKey(text);
  if (norm.length < 2) return null;
  const allow = opts.allowParent ?? (() => true);
  const ok = (p?: string, c?: string) => !!p && !!c && allow(p, c);

  // 1. Their own history for this exact text.
  const h = opts.history?.get(norm);
  if (h && ok(h.parentCategory, h.childCategory)) return { ...h, source: 'history' };

  // 2. Saved merchant rules.
  if (opts.userRules && Object.keys(opts.userRules).length) {
    const r = cleanMerchantName(text, opts.userRules);
    if (r.source === 'user_rule' && ok(r.parentCategory, r.childCategory)) {
      return { parentCategory: r.parentCategory, childCategory: r.childCategory, source: 'user_rule' };
    }
  }

  // 3. Known brands — whole words only ("ola cab" ✓, "coca cola" ✗). A long key may
  //    also match a run-together typing ("bookmyshow", "book my show").
  const words = norm.toUpperCase().split(' ');
  const flat = words.join('');
  for (const key of DICTIONARY_KEYS) {
    const hit = words.includes(key) || (key.length >= 6 && flat === key);
    if (hit) {
      const e = GLOBAL_MERCHANT_DICTIONARY[key];
      if (ok(e.parentCategory, e.childCategory)) {
        return { parentCategory: e.parentCategory, childCategory: e.childCategory, source: 'dictionary' };
      }
    }
  }

  // 4. Everyday words — longest phrase first.
  for (const phrase of KEYWORD_PHRASES) {
    if (hasPhrase(norm, phrase)) {
      const [p, c] = MANUAL_CATEGORY_KEYWORDS[phrase];
      if (ok(p, c)) return { parentCategory: p, childCategory: c, source: 'keyword' };
    }
  }
  return null;
}
