// =============================================================================
// twoTierParser.ts — Two-Tier (Parent → Child) SMS parsing engine for ePurse
// =============================================================================
// Replaces the flat single-category model with a parentCategory + childCategory
// hierarchy that powers Habit Leak Bubble Matrix and Subscription Heartbeat.
//
// Pipeline per SMS:
//   normalize → isolate raw merchant → sanitize → match (user rules →
//   global dict → title-case fallback)
//
// Also exports:
//   migrateToTwoTier  — non-destructive Zustand store migration
//   syncUserLearningRules — compile user custom rules from manual edits
//
// Zero runtime dependencies. Safe inside Zustand `migrate`.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 1. Public Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TwoTierEntry {
  parentCategory: string;
  childCategory: string;
  /** Pre-flagged true in the dict for rhythmic fixed billing (Netflix, Spotify…). */
  isSubscription?: boolean;
}

export interface UserCustomRule {
  parentCategory: string;
  childCategory: string;
  cleanMerchant?: string;
}

/** UPPERCASE raw-merchant keys → user overrides. */
export type UserCustomRules = Record<string, UserCustomRule>;

/** Output shape for every parsed / migrated transaction. */
export interface ParsedTransaction {
  id: string;
  amount: number;
  timestamp: string;
  rawMerchant: string;
  cleanMerchant: string;
  parentCategory: string;
  childCategory: string;
  isSubscription: boolean;
  isExcludable: boolean;
}

/** Result of the internal brand-mapping step. */
interface MappedBrand {
  cleanMerchant: string;
  parentCategory: string;
  childCategory: string;
  isSubscription: boolean;
  source: 'user_rule' | 'dictionary' | 'fallback';
}

/**
 * Loose representation of any transaction that may live in the store —
 * includes both legacy (flat) and new (two-tier) fields.
 */
export interface StoredTransaction {
  id?: string;
  amount?: number;
  /** Legacy flat category id used by the store reducers (kept intact). */
  categoryId?: string;
  /** Legacy category string (alias for categoryId, may exist on older builds). */
  category?: string;
  /** NEW — populated by this engine. */
  parentCategory?: string;
  /** NEW — populated by this engine. */
  childCategory?: string;
  merchant?: string;
  cleanMerchant?: string;
  rawMerchant?: string;
  isSubscription?: boolean;
  isExcludable?: boolean;
  isIgnored?: boolean;
  timestamp?: string;
  createdAt?: string;
  note?: string;
  userEdited?: boolean;
  userEditedCategory?: boolean;
  userEditedMerchant?: boolean;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Two-Tier Global Dictionary
//    Keys are UPPERCASE merchant substrings.
//    IMPORTANT: Longer, more-specific keys must beat shorter ones (e.g.
//    "AMAZON PRIME" before "AMAZON"). Sorting at runtime handles this —
//    no manual ordering required in the literal below.
// ─────────────────────────────────────────────────────────────────────────────

export const TWO_TIER_DICTIONARY: Record<string, TwoTierEntry> = {
  // ── Food Delivery ────────────────────────────────────────────────────────
  ZOMATO:        { parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  SWIGGY:        { parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  EATSURE:       { parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  FAASOS:        { parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  BOX8:          { parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },

  // ── Groceries & Quick Commerce ───────────────────────────────────────────
  BIGBASKET:     { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  BLINKIT:       { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  ZEPTO:         { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  INSTAMART:     { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  DUNZO:         { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  DMART:         { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  RELIANCEFRESH: { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  RELIANCESMART: { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  JIOMART:       { parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },
  'NATURES BASKET':{ parentCategory: 'Food & Dining', childCategory: 'Groceries & Quick Commerce' },

  // ── Fast Food & Cafes ────────────────────────────────────────────────────
  MCDONALD:      { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  STARBUCKS:     { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  'BURGER KING': { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  BURGERKING:    { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  KFC:           { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  DOMINO:        { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  HALDIRAM:      { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  CHAIPOINT:     { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  'CHAI POINT':  { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  SUBWAY:        { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  'PIZZA HUT':   { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  PIZZAHUT:      { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  THEOBROMA:     { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  WOWMOMO:       { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  'WOW MOMO':    { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  CCD:           { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  'CAFE COFFEE': { parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },

  // ── Daily Commute ────────────────────────────────────────────────────────
  UBER:          { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  OLACABS:       { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  OLA:           { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  RAPIDO:        { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  BLUSMART:      { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  NREDI:         { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  DMRC:          { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  'DELHI METRO': { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  FASTAG:        { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  PAYTMFASTAG:   { parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },

  // ── Long Distance Travel ─────────────────────────────────────────────────
  IRCTC:         { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  MAKEMYTRIP:    { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  GOIBIBO:       { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  INDIGO:        { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  SPICEJET:      { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  'AIR INDIA':   { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  AIRINDIA:      { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  VISTARA:       { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  AKASA:         { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  REDBUS:        { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  CLEARTRIP:     { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  IXIGO:         { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  EASEMYTRIP:    { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  OYO:           { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },
  ABHIBUS:       { parentCategory: 'Travel & Commute', childCategory: 'Long Distance Travel' },

  // ── Fixed Subscriptions (LONGER keys MUST precede shorter overlapping ones)
  'AMAZON PRIME':   { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  AMAZONPRIME:      { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  'PRIME VIDEO':    { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  PRIMEVIDEO:       { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  'APPLE ICLOUD':   { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  APPLEICLOUD:      { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  ICLOUD:           { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  'YOUTUBE PREMIUM':{ parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  YOUTUBEPREMIUM:   { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  'YOUTUBE MUSIC':  { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  YOUTUBEMUSIC:     { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  NETFLIX:          { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  SPOTIFY:          { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  HOTSTAR:          { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  SONYLIV:          { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  'SONY LIV':       { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  ZEE5:             { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  JIOSAAVN:         { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  JIOCINEMA:        { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  'JIO CINEMA':     { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  MUBI:             { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  GAANA:            { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },
  VOOT:             { parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isSubscription: true },

  // ── Mobile & Internet ────────────────────────────────────────────────────
  JIOFIBER:      { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  'JIO FIBER':   { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  JIO:           { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  AIRTEL:        { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  VIRECHARGE:    { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  VODAFONE:      { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  BSNL:          { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  MTNL:          { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  ACTBROADBAND:  { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  'ACT BROADBAND':{ parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  TATASKY:       { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  'TATA PLAY':   { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  TATAPLAY:      { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  D2H:           { parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },

  // ── Variable Utilities ───────────────────────────────────────────────────
  BSES:          { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  BESCOM:        { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  MSEB:          { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  KSEB:          { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  TATAPOWER:     { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  ADANIGAS:      { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  'ADANI GAS':   { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  IGL:           { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  MGL:           { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  MAHANAGAR:     { parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },

  // ── Insurance & EMIs ─────────────────────────────────────────────────────
  LICPREMIUM:    { parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  'LIC PREMIUM': { parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  HDFCERGO:      { parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  'HDFC ERGO':   { parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  ICICILOMBARD:  { parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  BAJAJFINANCE:  { parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },

  // ── Online Shopping (AMAZON must come AFTER AMAZON PRIME / PRIME VIDEO) ─
  AMAZON:        { parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  FLIPKART:      { parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  MYNTRA:        { parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  AJIO:          { parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  MEESHO:        { parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  SNAPDEAL:      { parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  TATACLIQ:      { parentCategory: 'Shopping', childCategory: 'Online Shopping' },

  // ── Beauty & Personal Care ───────────────────────────────────────────────
  NYKAA:         { parentCategory: 'Shopping', childCategory: 'Beauty & Personal Care' },
  PURPLLE:       { parentCategory: 'Shopping', childCategory: 'Beauty & Personal Care' },

  // ── Electronics ──────────────────────────────────────────────────────────
  CROMA:             { parentCategory: 'Shopping', childCategory: 'Electronics' },
  RELIANCEDIGITAL:   { parentCategory: 'Shopping', childCategory: 'Electronics' },
  'RELIANCE DIGITAL':{ parentCategory: 'Shopping', childCategory: 'Electronics' },
  VIJAYSALES:        { parentCategory: 'Shopping', childCategory: 'Electronics' },

  // ── Sports & Outdoors ────────────────────────────────────────────────────
  DECATHLON:     { parentCategory: 'Shopping', childCategory: 'Sports & Outdoors' },

  // ── Entertainment (events / ticketing) ───────────────────────────────────
  BOOKMYSHOW:    { parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  'BOOK MY SHOW':{ parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  PVR:           { parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  INOX:          { parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  CINEPOLIS:     { parentCategory: 'Entertainment', childCategory: 'Movies & Events' },

  // ── Health & Fitness ─────────────────────────────────────────────────────
  PHARMEASY:     { parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  '1MG':         { parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  ONEMG:         { parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  NETMEDS:       { parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  APOLLOPHARMACY:{ parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  'APOLLO PHARMACY':{ parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  MEDPLUS:       { parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  PRACTO:        { parentCategory: 'Health & Fitness', childCategory: 'Consultations & Labs' },
  CULTFIT:       { parentCategory: 'Health & Fitness', childCategory: 'Gym & Fitness' },
  'CULT FIT':    { parentCategory: 'Health & Fitness', childCategory: 'Gym & Fitness' },
  CUREFIT:       { parentCategory: 'Health & Fitness', childCategory: 'Gym & Fitness' },

  // ── Fuel ─────────────────────────────────────────────────────────────────
  INDIANOIL:     { parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  IOCL:          { parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  HPCL:          { parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  BPCL:          { parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  SHELL:         { parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  'HP PETROL':   { parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },

  // ── Investments ──────────────────────────────────────────────────────────
  ZERODHA:       { parentCategory: 'Investments', childCategory: 'Stocks & Trading' },
  UPSTOX:        { parentCategory: 'Investments', childCategory: 'Stocks & Trading' },
  GROWW:         { parentCategory: 'Investments', childCategory: 'Mutual Funds' },
  KUVERA:        { parentCategory: 'Investments', childCategory: 'Mutual Funds' },
  SMALLCASE:     { parentCategory: 'Investments', childCategory: 'Stocks & Trading' },
};

// Build a sorted key list (longest → shortest) once at module load.
// This guarantees "AMAZON PRIME" is tested before "AMAZON" regardless of
// insertion order in the literal above.
const SORTED_DICT_KEYS = Object.keys(TWO_TIER_DICTIONARY).sort(
  (a, b) => b.length - a.length,
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Legacy categoryId → Two-Tier fallback map
//    Used in migration when merchant-level matching yields 'Unassigned'.
// ─────────────────────────────────────────────────────────────────────────────

const LEGACY_CATEGORY_FALLBACK: Record<
  string,
  Pick<TwoTierEntry, 'parentCategory' | 'childCategory'>
> = {
  food:          { parentCategory: 'Food & Dining',     childCategory: 'Restaurants' },
  groceries:     { parentCategory: 'Food & Dining',     childCategory: 'Groceries & Quick Commerce' },
  travel:        { parentCategory: 'Travel & Commute',  childCategory: 'Unassigned' },
  fuel:          { parentCategory: 'Fuel',              childCategory: 'Petrol & Diesel' },
  bills:         { parentCategory: 'Bills & Utilities', childCategory: 'Unassigned' },
  shopping:      { parentCategory: 'Shopping',          childCategory: 'Online Shopping' },
  entertainment: { parentCategory: 'Entertainment',     childCategory: 'Unassigned' },
  health:        { parentCategory: 'Health & Fitness',  childCategory: 'Unassigned' },
  education:     { parentCategory: 'Education',         childCategory: 'Unassigned' },
  investments:   { parentCategory: 'Investments',       childCategory: 'Unassigned' },
  salary:        { parentCategory: 'Income',            childCategory: 'Salary' },
  transfer:      { parentCategory: 'Transfers',         childCategory: 'P2P Transfer' },
  lent:          { parentCategory: 'Transfers',         childCategory: 'Lent' },
  borrowed:      { parentCategory: 'Transfers',         childCategory: 'Borrowed' },
  lent_settled:  { parentCategory: 'Transfers',         childCategory: 'Lent Settled' },
  borrow_repaid: { parentCategory: 'Transfers',         childCategory: 'Borrow Repaid' },
  other:         { parentCategory: 'Unassigned',        childCategory: 'Unassigned' },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. Anchor & sanitisation constants
// ─────────────────────────────────────────────────────────────────────────────

// Left anchors — ordered most-specific first.
const LEFT_ANCHORS: ReadonlyArray<string> = [
  'TRANSFERRED TO', 'TRF TO', 'SENT TO', 'PAID TO', 'PAID AT', 'PAID FOR',
  'PURCHASE AT', 'PURCHASE OF', 'SPENT AT', 'SPENT ON',
  'PAYMENT TO', 'PAYMENT OF', 'PAYMENT FOR',
  'TO VPA', 'TO M/S', 'FROM VPA',
  'INFO:', 'INFO-', 'INF*', 'INF:', 'WPM*', 'WP*', 'POS ',
  ' AT ', ' TO ', ' @ ',
];

const RIGHT_ANCHORS: ReadonlyArray<string> = [
  ' ON ', ' VIA ', ' USING ', ' REF ', ' REF.', ' REF-', ' REF NO',
  ' UPI REF', ' UPI:', ' UPI/', ' VALUE DATE', ' VAL DT',
  ' NEFT', ' IMPS', ' RTGS', ' DT ', ' DATED ', ' TXN', ' TRX',
  ' AVL ', ' AVL.', ' AVAILABLE', ' BAL', ' BALANCE',
  ' INFO ', ' NOT YOU', ' CALL ', ' SMS BLOCK', ' TO BLOCK',
  ' HELP ', ' HELPLINE', ' DISPUTE', '.', ',', ';',
];

const PROCESSOR_PREFIX =
  /^(PAYTM|PHONEPE|PHONPE|GPAY|GOOGLEPAY|AMAZONPAY|RAZORPAY|RZP|EZETAP|BHIM|UPI|MPS|POS|MOBIKWIK|FREECHARGE|PAYU|CCAVENUE|BILLDESK|JUSPAY)\*+/i;

const TRAILING_DYNAMIC_ID = /[-_\s]+[A-Z0-9]{3,}\d+\w*$/i;
const TRAILING_DIGITS     = /[-_\s]*\d{2,}$/;
const TRAILING_PUNCT      = /[._\-\s]+$/;
const LEADING_PUNCT       = /^[._\-\s]+/;
const ALL_DIGITS_RE       = /^\d+$/;

const SELF_TRANSFER_RE =
  /(?:from\s+a\/?c[^.]{0,40}to\s+a\/?c)|(?:credited\b.{0,30}\bdebited)|(?:debited\b.{0,30}\bcredited)|(?:own\s+account)|(?:self\s+transfer)|(?:fund\s+transfer\s+to\s+own)/i;

const AMOUNT_RE =
  /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i;

const DATE_RE =
  /\b(\d{1,2})[-\/\s]([A-Za-z]{3,9}|\d{1,2})[-\/\s](\d{2,4})\b/;

const MONTH_MAP: Readonly<Record<string, number>> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const safe = (v: unknown): string => (typeof v === 'string' ? v : '');

const toNumber = (s: string | undefined | null): number =>
  s ? parseFloat(s.replace(/,/g, '')) || 0 : 0;

function normalizeText(text: unknown): string {
  return safe(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function smartTitleCase(str: unknown): string {
  const words = safe(str)
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) =>
      /^(of|to|the|and|for|in|on|at)$/.test(w) && w.length <= 3
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1),
    );
  if (!words.length) return '';
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

function extractTimestamp(upper: string): string {
  const m = upper.match(DATE_RE);
  if (!m) return new Date().toISOString();
  const day = parseInt(m[1], 10);
  let month: number;
  if (/^[A-Z]+$/i.test(m[2])) {
    const mk = m[2].slice(0, 3).toUpperCase();
    month = MONTH_MAP[mk] ?? -1;
  } else {
    month = parseInt(m[2], 10) - 1;
  }
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 0 || month > 11 || day < 1 || day > 31 || Number.isNaN(year)) {
    return new Date().toISOString();
  }
  try {
    return new Date(Date.UTC(year, month, day)).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/** Step 1a — Isolate the core merchant substring via left/right anchors. */
function isolateRawMerchant(upper: string): string {
  let best = '';
  let bestAnchorIdx = Infinity;

  for (const la of LEFT_ANCHORS) {
    const anchorIdx = upper.indexOf(la);
    if (anchorIdx === -1) continue;
    const start = anchorIdx + la.length;
    let end = upper.length;
    for (const ra of RIGHT_ANCHORS) {
      const ri = upper.indexOf(ra, start);
      if (ri !== -1 && ri < end) end = ri;
    }
    const span = upper.slice(start, end).trim();
    if (span.length >= 2 && anchorIdx < bestAnchorIdx) {
      best = span;
      bestAnchorIdx = anchorIdx;
      if (la.length >= 5) break; // specific anchor → accept immediately
    }
  }
  return best;
}

/** Step 1b — Strip VPA suffix, processor prefixes, trailing noise. */
export function sanitizeMerchant(raw: unknown): string {
  let s = normalizeText(raw);
  if (!s) return '';

  // Drop UPI VPA suffix
  if (s.includes('@')) s = s.split('@')[0];

  // Strip processor prefixes iteratively
  let prev: string;
  do {
    prev = s;
    s = s.replace(PROCESSOR_PREFIX, '').trim();
  } while (s !== prev && s.length > 0);

  // Strip trailing dynamic IDs and punctuation
  s = s.replace(TRAILING_DYNAMIC_ID, '');
  s = s.replace(TRAILING_DIGITS, '');
  s = s.replace(TRAILING_PUNCT, '');
  s = s.replace(LEADING_PUNCT, '');
  s = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  return !s || ALL_DIGITS_RE.test(s) ? '' : s;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Brand mapping — the lookup heart of the engine
// ─────────────────────────────────────────────────────────────────────────────

function mapToBrand(
  sanitized: string,
  userCustomRules?: UserCustomRules,
): MappedBrand {
  if (!sanitized) {
    return {
      cleanMerchant: 'Unassigned',
      parentCategory: 'Unassigned',
      childCategory: 'Unassigned',
      isSubscription: false,
      source: 'fallback',
    };
  }

  const upper = sanitized.toUpperCase();
  const flat  = upper.replace(/\s+/g, ''); // 'AMAZON PRIME' → 'AMAZONPRIME'

  // ── 1. User custom rules ──
  if (userCustomRules) {
    // Exact key first
    const exactMatch = userCustomRules[upper];
    if (exactMatch) {
      return {
        cleanMerchant: exactMatch.cleanMerchant || smartTitleCase(sanitized),
        parentCategory: exactMatch.parentCategory,
        childCategory:  exactMatch.childCategory,
        isSubscription: exactMatch.childCategory === 'Fixed Subscriptions',
        source: 'user_rule',
      };
    }
    // Substring match for user rules (min 4 chars to avoid false positives)
    for (const key of Object.keys(userCustomRules)) {
      if (key.length >= 4 && (upper.includes(key) || flat.includes(key.replace(/\s+/g, '')))) {
        const rule = userCustomRules[key];
        return {
          cleanMerchant: rule.cleanMerchant || smartTitleCase(sanitized),
          parentCategory: rule.parentCategory,
          childCategory:  rule.childCategory,
          isSubscription: rule.childCategory === 'Fixed Subscriptions',
          source: 'user_rule',
        };
      }
    }
  }

  // ── 2. Global two-tier dictionary (sorted longest-key first) ──
  for (const key of SORTED_DICT_KEYS) {
    const flatKey = key.replace(/\s+/g, '');
    if (upper.includes(key) || flat.includes(flatKey)) {
      const entry = TWO_TIER_DICTIONARY[key];
      return {
        cleanMerchant:  smartTitleCase(sanitized),
        parentCategory: entry.parentCategory,
        childCategory:  entry.childCategory,
        isSubscription: entry.isSubscription === true,
        source: 'dictionary',
      };
    }
  }

  // ── 3. Smart title-case fallback ──
  return {
    cleanMerchant:  smartTitleCase(sanitized) || 'Unassigned',
    parentCategory: 'Unassigned',
    childCategory:  'Unassigned',
    isSubscription: false,
    source: 'fallback',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. parseIncomingSMS — main public entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw banking SMS into a two-tier categorised transaction object.
 * NEVER throws — malformed or garbage input returns a safe default.
 *
 * @param rawText       Raw SMS body string.
 * @param userCustomRules   Optional compiled user overrides (UPPERCASE keys).
 * @returns             Fully typed ParsedTransaction.
 */
export function parseIncomingSMS(
  rawText: unknown,
  userCustomRules: UserCustomRules = {},
): ParsedTransaction {
  const safeDefault: ParsedTransaction = {
    id:             `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    amount:         0,
    timestamp:      new Date().toISOString(),
    rawMerchant:    '',
    cleanMerchant:  'Unassigned',
    parentCategory: 'Unassigned',
    childCategory:  'Unassigned',
    isSubscription: false,
    isExcludable:   false,
  };

  if (!rawText || typeof rawText !== 'string') return safeDefault;

  let upper: string;
  try {
    upper = normalizeText(rawText);
  } catch {
    return safeDefault;
  }
  if (!upper) return safeDefault;

  // Amount
  let amount = 0;
  try {
    const am = upper.match(AMOUNT_RE);
    if (am) amount = toNumber(am[1] ?? am[2]);
  } catch { /* keep 0 */ }

  // Timestamp
  const timestamp = extractTimestamp(upper);

  // Self-transfer detection
  const isExcludable = SELF_TRANSFER_RE.test(upper);

  // Isolate → sanitize → map
  const rawMerchant = isolateRawMerchant(upper);
  const sanitized   = sanitizeMerchant(rawMerchant || upper);
  const mapped      = mapToBrand(sanitized, userCustomRules);

  return {
    id:             safeDefault.id,
    amount,
    timestamp,
    rawMerchant:    rawMerchant || '',
    cleanMerchant:  isExcludable ? mapped.cleanMerchant : mapped.cleanMerchant,
    parentCategory: isExcludable ? 'Transfers' : mapped.parentCategory,
    childCategory:  isExcludable ? 'Self Transfer' : mapped.childCategory,
    isSubscription: !isExcludable && mapped.isSubscription,
    isExcludable,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. 90-day subscription pattern detection (history-based)
//    Used for merchants NOT pre-flagged in the dictionary (e.g. a regional ISP).
// ─────────────────────────────────────────────────────────────────────────────

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function dayOfMonthDiff(a: Date, b: Date): number {
  const da = a.getUTCDate();
  const db = b.getUTCDate();
  const direct = Math.abs(da - db);
  // Month-wrap: e.g. day 1 vs day 30
  const wrap = Math.min(da, db) + (31 - Math.max(da, db));
  return Math.min(direct, wrap);
}

/**
 * Returns true if `candidate` has at least one prior match in `history`
 * within 90 days, same cleanMerchant, day-of-month ±3, amount ±15%.
 */
export function detectSubscriptionPattern(
  candidate: Pick<ParsedTransaction, 'amount' | 'timestamp' | 'cleanMerchant' | 'isExcludable'>,
  history:   ReadonlyArray<Pick<ParsedTransaction, 'amount' | 'timestamp' | 'cleanMerchant'>>,
): boolean {
  if (!candidate || candidate.isExcludable) return false;
  if (!candidate.cleanMerchant || candidate.cleanMerchant === 'Unassigned') return false;
  if (!candidate.amount || candidate.amount <= 0) return false;
  if (!history?.length) return false;

  let candTime: number;
  try {
    candTime = new Date(candidate.timestamp).getTime();
    if (Number.isNaN(candTime)) return false;
  } catch { return false; }

  const candDate      = new Date(candTime);
  const lowerBound    = candTime - NINETY_DAYS_MS;
  const amtTolerance  = candidate.amount * 0.15;

  for (const t of history) {
    if (t === (candidate as unknown)) continue;
    if (t.cleanMerchant !== candidate.cleanMerchant) continue;
    const ts = new Date(t.timestamp).getTime();
    if (Number.isNaN(ts) || ts >= candTime || ts < lowerBound) continue;
    if (Math.abs(t.amount - candidate.amount) > amtTolerance) continue;
    if (dayOfMonthDiff(candDate, new Date(ts)) > 3) continue;
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. migrateToTwoTier — non-destructive Zustand store migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Backfills `parentCategory` and `childCategory` on every stored transaction
 * that is missing them, without touching any other field the user may have
 * manually edited.
 *
 * Safe to call inside Zustand `persist.migrate`.
 *
 * Strategy per transaction:
 *   1. If `parentCategory` already set → skip (already migrated).
 *   2. Run rawMerchant / merchant through the two-tier engine.
 *   3. If no dict match, fall back to LEGACY_CATEGORY_FALLBACK via categoryId.
 *   4. Never overwrite `note`, `userEdited`, `categoryId` or any other field.
 */
export function migrateToTwoTier(
  transactions: StoredTransaction[],
  userCustomRules: UserCustomRules = {},
): StoredTransaction[] {
  if (!Array.isArray(transactions)) return transactions;

  // Pass 1 — backfill two-tier fields
  const enriched: StoredTransaction[] = transactions.map((t) => {
    if (!t || typeof t !== 'object') return t;

    // Already migrated — only ensure rawMerchant exists
    if (t.parentCategory && t.childCategory) {
      return {
        ...t,
        rawMerchant:    t.rawMerchant    ?? safe(t.merchant),
        isExcludable:   t.isExcludable   ?? Boolean(t.isIgnored),
        isSubscription: t.isSubscription ?? false,
        timestamp:      t.timestamp      ?? t.createdAt ?? new Date().toISOString(),
      };
    }

    // User manually tagged this with a category override — respect it
    if (t.userEditedCategory && t.parentCategory && t.childCategory) return t;

    const raw       = safe(t.rawMerchant) || safe(t.merchant);
    const sanitized = sanitizeMerchant(raw);
    const mapped    = mapToBrand(sanitized, userCustomRules);

    // Resolve two-tier: dictionary result > legacy categoryId fallback
    let parentCategory = mapped.parentCategory;
    let childCategory  = mapped.childCategory;
    let isSubscription = mapped.isSubscription;

    if (parentCategory === 'Unassigned' && t.categoryId) {
      const legacy = LEGACY_CATEGORY_FALLBACK[t.categoryId];
      if (legacy) {
        parentCategory = legacy.parentCategory;
        childCategory  = legacy.childCategory;
      }
    }

    // isExcludable from legacy isIgnored or self-transfer note
    const noteUpper   = normalizeText(t.note ?? '');
    const isExcludable =
      Boolean(t.isIgnored) ||
      SELF_TRANSFER_RE.test(noteUpper) ||
      (t.isExcludable ?? false);

    if (isExcludable) {
      parentCategory = 'Transfers';
      childCategory  = 'Self Transfer';
      isSubscription = false;
    }

    return {
      ...t,
      rawMerchant:    t.rawMerchant    ?? raw,
      cleanMerchant:  t.cleanMerchant  ?? mapped.cleanMerchant,
      parentCategory,
      childCategory,
      isSubscription: t.isSubscription ?? isSubscription,
      isExcludable,
      timestamp:      t.timestamp      ?? t.createdAt ?? new Date().toISOString(),
    };
  });

  // Pass 2 — history-based subscription detection for non-pre-flagged merchants
  return enriched.map((t) => {
    if (!t || t.isSubscription || t.isExcludable) return t;
    if (t.childCategory === 'Fixed Subscriptions') return { ...t, isSubscription: true };
    const pattern = detectSubscriptionPattern(
      {
        amount:         Number(t.amount ?? 0),
        timestamp:      safe(t.timestamp),
        cleanMerchant:  safe(t.cleanMerchant),
        isExcludable:   Boolean(t.isExcludable),
      },
      enriched as ParsedTransaction[],
    );
    return pattern ? { ...t, isSubscription: true } : t;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. syncUserLearningRules — local self-learning
// ─────────────────────────────────────────────────────────────────────────────

const MIN_RULE_OCCURRENCES = 2;
// SOH (U+0001) used as a key separator that can't appear in merchant strings
const RULE_SEP = '\x01';

/**
 * Scans the transaction history for manually-edited categorisations that
 * repeat ≥ MIN_RULE_OCCURRENCES times and compiles them into a UserCustomRules
 * dictionary ready to be passed back into parseIncomingSMS / migrateToTwoTier.
 *
 * A transaction is considered "manually edited" when any of:
 *   t.userEdited === true
 *   t.userEditedCategory === true
 *   t.userEditedMerchant === true
 */
export function syncUserLearningRules(
  transactions: StoredTransaction[],
): UserCustomRules {
  const rules: UserCustomRules = {};
  if (!Array.isArray(transactions)) return rules;

  type Bucket = Array<{
    parentCategory: string;
    childCategory: string;
    cleanMerchant: string;
  }>;
  const groups = new Map<string, Bucket>();

  for (const t of transactions) {
    if (!t || typeof t !== 'object') continue;
    const isManual =
      t.userEdited === true ||
      t.userEditedCategory === true ||
      t.userEditedMerchant === true;
    if (!isManual) continue;

    const rawKey = sanitizeMerchant(
      safe(t.rawMerchant) || safe(t.merchant),
    ).toUpperCase();
    if (!rawKey || rawKey.length < 3) continue;

    const parent = safe(t.parentCategory);
    const child  = safe(t.childCategory);
    const clean  = safe(t.cleanMerchant) || safe(t.merchant);
    if (!parent || !child) continue;

    const bucket = groups.get(rawKey) ?? [];
    bucket.push({ parentCategory: parent, childCategory: child, cleanMerchant: clean });
    groups.set(rawKey, bucket);
  }

  for (const [key, entries] of groups.entries()) {
    // Find the mode (most frequent parent+child combo)
    const counts = new Map<string, { count: number; cleanMerchant: string }>();
    for (const e of entries) {
      const ck = `${e.parentCategory}${RULE_SEP}${e.childCategory}`;
      const current = counts.get(ck);
      counts.set(ck, {
        count:        (current?.count ?? 0) + 1,
        cleanMerchant: e.cleanMerchant || (current?.cleanMerchant ?? ''),
      });
    }

    let bestKey   = '';
    let bestCount = 0;
    for (const [ck, { count }] of counts.entries()) {
      if (count > bestCount) {
        bestKey   = ck;
        bestCount = count;
      }
    }

    if (bestCount >= MIN_RULE_OCCURRENCES && bestKey) {
      const sepIdx = bestKey.indexOf(RULE_SEP);
      const parent = bestKey.slice(0, sepIdx);
      const child  = bestKey.slice(sepIdx + 1);
      rules[key] = {
        parentCategory: parent,
        childCategory:  child,
        cleanMerchant:  counts.get(bestKey)?.cleanMerchant ?? '',
      };
    }
  }

  return rules;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Diagnostic samples — for the SMS diagnostic screen
// ─────────────────────────────────────────────────────────────────────────────

export const TWO_TIER_PARSER_SAMPLES: readonly string[] = [
  'Rs.450 debited from A/c xx1234 on 06-May-26 to SWIGGY-1827391@oksbi via UPI. Avl bal Rs.42,310',
  'INR 499 paid to NETFLIX via UPI from A/c xx1234. Ref 887766.',
  'Rs.250 paid to PAYTM*RAPIDO via UPI. A/c xx4321. Ref 112233.',
  'Rs.1,199 debited to AMAZON PRIME MEMBERSHIP on 04-May-26. UPI Ref 556677.',
  '₹350 paid to BLINKIT via UPI from your account xx1234.',
  'Rs.180 debited via UPI to ola@paytm. A/c xx1234. Ref 998877.',
  'Rs.5,000 transferred from A/c xx1234 to A/c xx5678. Own account transfer.',
  'INR 1,299 spent on HDFC Credit Card ending 4321 at AMAZON on 05-May-26.',
  'Rs.749 paid to RAMESH_KIRANA_DELHI via UPI from your account xx1234.',
  'Rs.2,199 debited to YOUTUBE PREMIUM from A/c xx1234 on 01-May-26.',
  'INR 3,500 paid to IRCTC via Net Banking. Booking ref 9988776.',
];
