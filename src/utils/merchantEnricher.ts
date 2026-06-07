// =============================================================================
// merchantEnricher — merchant enrichment for parsed bank transactions
// -----------------------------------------------------------------------------
// Secondary layer on top of messageParser.js, which handles the three-gate
// accept filter and produces the raw transaction object. This file provides:
//   1. VPA / processor-prefix sanitisation of the raw merchant string
//   2. Two-tier brand + category mapping aligned with twoTierCategories.ts
//      (parentCategory / childCategory labels, not flat IDs)
//   3. Recurring subscription detection from local transaction history
//
// Zero dependencies. Called from ePurseStore.ingestMessage after
// parseMessageDetailed.
// =============================================================================

// =============================================================================
// Types
// =============================================================================

export interface MerchantBrand {
  /** Display name for the merchant (e.g. "Swiggy", "McDonald's"). */
  name: string;
  /** Parent category label matching twoTierCategories.ts (e.g. "Food & Dining"). */
  parentCategory: string;
  /** Child category label matching twoTierCategories.ts (e.g. "Food Delivery"). */
  childCategory: string;
  /** True for known fixed-billing services (Netflix, Spotify, etc.) — skips history check. */
  isKnownSubscription?: boolean;
}

/** User-defined rule stored in userCustomRules (keyed by UPPERCASE raw merchant). */
export interface UserRule {
  parentCategory: string;
  childCategory: string;
  cleanMerchant?: string;
}

export type UserRules = Record<string, UserRule>;

export interface MappedBrand {
  cleanMerchant: string;
  parentCategory: string;
  childCategory: string;
  isKnownSubscription: boolean;
  source: 'user_rule' | 'dictionary' | 'fallback' | 'empty';
}

export interface SubscriptionCandidate {
  amount: number;
  /** ISO string — accepts either `createdAt` or `timestamp` from the store. */
  timestamp: string;
  cleanMerchant: string;
  isExcludable?: boolean;
}

// =============================================================================
// 1. GLOBAL_MERCHANT_DICTIONARY
//    Keys are UPPERCASE substrings searched inside the sanitised raw merchant.
//    parentCategory / childCategory must match labels in twoTierCategories.ts
//    exactly. List MOST SPECIFIC keys first — the sort at module load ensures
//    longer keys (e.g. "AMAZONPRIME") beat shorter overlapping ones ("AMAZON").
// =============================================================================
export const GLOBAL_MERCHANT_DICTIONARY: Record<string, MerchantBrand> = {

  // ── Food Delivery ──────────────────────────────────────────────────────────
  ZOMATO:          { name: 'Zomato',           parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  SWIGGY:          { name: 'Swiggy',           parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  EATSURE:         { name: 'EatSure',          parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  FAASOS:          { name: 'Faasos',           parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  EATFIT:          { name: 'EatFit',           parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },
  BOX8:            { name: 'Box8',             parentCategory: 'Food & Dining', childCategory: 'Food Delivery' },

  // ── Groceries ──────────────────────────────────────────────────────────────
  BIGBASKET:       { name: 'BigBasket',        parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  BLINKIT:         { name: 'Blinkit',          parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  ZEPTO:           { name: 'Zepto',            parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  INSTAMART:       { name: 'Instamart',        parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  DUNZO:           { name: 'Dunzo',            parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  DMART:           { name: 'DMart',            parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  RELIANCEFRESH:   { name: 'Reliance Fresh',   parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  RELIANCESMART:   { name: 'Reliance Smart',   parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  JIOMART:         { name: 'JioMart',          parentCategory: 'Food & Dining', childCategory: 'Groceries' },
  NATURESBASKET:   { name: "Nature's Basket",  parentCategory: 'Food & Dining', childCategory: 'Groceries' },

  // ── Fast Food & Cafes ──────────────────────────────────────────────────────
  MCDONALD:        { name: "McDonald's",       parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  STARBUCKS:       { name: 'Starbucks',        parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  BURGERKING:      { name: 'Burger King',      parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  KFC:             { name: 'KFC',              parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  DOMINOSPIZZA:    { name: "Domino's Pizza",   parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  DOMINO:          { name: "Domino's Pizza",   parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  PIZZAHUT:        { name: 'Pizza Hut',        parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  HALDIRAM:        { name: "Haldiram's",       parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  CHAIPOINT:       { name: 'Chai Point',       parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  THEOBROMA:       { name: 'Theobroma',        parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  WOWMOMO:         { name: 'Wow! Momo',        parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  SUBWAY:          { name: 'Subway',           parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },
  CCD:             { name: 'Cafe Coffee Day',  parentCategory: 'Food & Dining', childCategory: 'Fast Food & Cafes' },

  // ── Restaurants ────────────────────────────────────────────────────────────
  BARBEQUE:        { name: 'Barbeque Nation',  parentCategory: 'Food & Dining', childCategory: 'Restaurants' },

  // ── Daily Commute ──────────────────────────────────────────────────────────
  UBER:            { name: 'Uber',             parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  OLACABS:         { name: 'Ola',              parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  OLA:             { name: 'Ola',              parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  RAPIDO:          { name: 'Rapido',           parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  BLUSMART:        { name: 'BluSmart',         parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  DMRC:            { name: 'Delhi Metro',      parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  NREDI:           { name: 'Delhi Metro',      parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  PAYTMFASTAG:     { name: 'FASTag',           parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },
  FASTAG:          { name: 'FASTag',           parentCategory: 'Travel & Commute', childCategory: 'Daily Commute' },

  // ── Long Distance ──────────────────────────────────────────────────────────
  IRCTC:           { name: 'IRCTC',            parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  MAKEMYTRIP:      { name: 'MakeMyTrip',       parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  GOIBIBO:         { name: 'Goibibo',          parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  CLEARTRIP:       { name: 'Cleartrip',        parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  IXIGO:           { name: 'ixigo',            parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  EASEMYTRIP:      { name: 'EaseMyTrip',       parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  REDBUS:          { name: 'redBus',           parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  ABHIBUS:         { name: 'Abhibus',          parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  INDIGO:          { name: 'IndiGo',           parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  SPICEJET:        { name: 'SpiceJet',         parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  AIRINDIA:        { name: 'Air India',        parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  VISTARA:         { name: 'Vistara',          parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  AKASA:           { name: 'Akasa Air',        parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },
  OYO:             { name: 'OYO',              parentCategory: 'Travel & Commute', childCategory: 'Long Distance' },

  // ── Fixed Subscriptions (LONGER keys before shorter overlapping ones) ──────
  YOUTUBEPREMIUM:  { name: 'YouTube Premium',  parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  YOUTUBEMUSIC:    { name: 'YouTube Music',    parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  AMAZONPRIME:     { name: 'Amazon Prime',     parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  PRIMEVIDEO:      { name: 'Amazon Prime',     parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  APPLEICLOUD:     { name: 'Apple iCloud',     parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  ICLOUD:          { name: 'iCloud',           parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  NETFLIX:         { name: 'Netflix',          parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  SPOTIFY:         { name: 'Spotify',          parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  HOTSTAR:         { name: 'Disney+ Hotstar',  parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  SONYLIV:         { name: 'SonyLIV',          parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  ZEE5:            { name: 'ZEE5',             parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  JIOSAAVN:        { name: 'JioSaavn',         parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  JIOCINEMA:       { name: 'JioCinema',        parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  MUBI:            { name: 'MUBI',             parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  GAANA:           { name: 'Gaana',            parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },
  VOOT:            { name: 'Voot',             parentCategory: 'Bills & Utilities', childCategory: 'Fixed Subscriptions', isKnownSubscription: true },

  // ── Mobile & Internet ──────────────────────────────────────────────────────
  JIOFIBER:        { name: 'Jio Fiber',        parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  JIO:             { name: 'Jio',              parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  AIRTEL:          { name: 'Airtel',           parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  VODAFONE:        { name: 'Vi',               parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  BSNL:            { name: 'BSNL',             parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  MTNL:            { name: 'MTNL',             parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  ACTBROADBAND:    { name: 'ACT Broadband',    parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  TATAPLAY:        { name: 'Tata Play',        parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  TATASKY:         { name: 'Tata Play',        parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },
  D2H:             { name: 'D2H',              parentCategory: 'Bills & Utilities', childCategory: 'Mobile & Internet' },

  // ── Variable Utilities ─────────────────────────────────────────────────────
  BSES:            { name: 'BSES',             parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  BESCOM:          { name: 'BESCOM',           parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  MSEB:            { name: 'MSEB',             parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  KSEB:            { name: 'KSEB',             parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  TATAPOWER:       { name: 'Tata Power',       parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  ADANIGAS:        { name: 'Adani Gas',        parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  IGL:             { name: 'IGL',              parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  MGL:             { name: 'MGL',              parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },
  MAHANAGAR:       { name: 'Mahanagar Gas',    parentCategory: 'Bills & Utilities', childCategory: 'Variable Utilities' },

  // ── Insurance & EMI ────────────────────────────────────────────────────────
  LICPREMIUM:      { name: 'LIC',              parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  HDFCERGO:        { name: 'HDFC ERGO',        parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  ICICILOMBARD:    { name: 'ICICI Lombard',    parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },
  BAJAJFINANCE:    { name: 'Bajaj Finance',    parentCategory: 'Bills & Utilities', childCategory: 'Insurance & EMI' },

  // ── Online Shopping (AFTER AMAZONPRIME / PRIMEVIDEO to avoid early match) ─
  AMAZONPAY:       { name: 'Amazon',           parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  AMAZON:          { name: 'Amazon',           parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  FLIPKART:        { name: 'Flipkart',         parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  MYNTRA:          { name: 'Myntra',           parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  AJIO:            { name: 'AJIO',             parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  MEESHO:          { name: 'Meesho',           parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  TATACLIQ:        { name: 'Tata CLiQ',        parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  FIRSTCRY:        { name: 'FirstCry',         parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  LENSKART:        { name: 'Lenskart',         parentCategory: 'Shopping', childCategory: 'Online Shopping' },
  SNAPDEAL:        { name: 'Snapdeal',         parentCategory: 'Shopping', childCategory: 'Online Shopping' },

  // ── Beauty & Care ──────────────────────────────────────────────────────────
  NYKAA:           { name: 'Nykaa',            parentCategory: 'Shopping', childCategory: 'Beauty & Care' },
  PURPLLE:         { name: 'Purplle',          parentCategory: 'Shopping', childCategory: 'Beauty & Care' },

  // ── Electronics ────────────────────────────────────────────────────────────
  CROMA:           { name: 'Croma',            parentCategory: 'Shopping', childCategory: 'Electronics' },
  RELIANCEDIGITAL: { name: 'Reliance Digital', parentCategory: 'Shopping', childCategory: 'Electronics' },
  VIJAYSALES:      { name: 'Vijay Sales',      parentCategory: 'Shopping', childCategory: 'Electronics' },

  // ── Sports & Outdoors ──────────────────────────────────────────────────────
  DECATHLON:       { name: 'Decathlon',        parentCategory: 'Shopping', childCategory: 'Sports & Outdoors' },

  // ── Entertainment / Movies & Events ───────────────────────────────────────
  BOOKMYSHOW:      { name: 'BookMyShow',       parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  PVRINOX:         { name: 'PVR INOX',         parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  PVR:             { name: 'PVR',              parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  INOX:            { name: 'INOX',             parentCategory: 'Entertainment', childCategory: 'Movies & Events' },
  CINEPOLIS:       { name: 'Cinepolis',        parentCategory: 'Entertainment', childCategory: 'Movies & Events' },

  // ── Pharmacy & Meds ────────────────────────────────────────────────────────
  PHARMEASY:       { name: 'PharmEasy',        parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  TATA1MG:         { name: 'Tata 1mg',         parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  NETMEDS:         { name: 'Netmeds',          parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  APOLLOPHARMACY:  { name: 'Apollo Pharmacy',  parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },
  MEDPLUS:         { name: 'MedPlus',          parentCategory: 'Health & Fitness', childCategory: 'Pharmacy & Meds' },

  // ── Consultations ──────────────────────────────────────────────────────────
  PRACTO:          { name: 'Practo',           parentCategory: 'Health & Fitness', childCategory: 'Consultations' },

  // ── Gym & Fitness ──────────────────────────────────────────────────────────
  CULTFIT:         { name: 'Cult.fit',         parentCategory: 'Health & Fitness', childCategory: 'Gym & Fitness' },
  CUREFIT:         { name: 'Cult.fit',         parentCategory: 'Health & Fitness', childCategory: 'Gym & Fitness' },

  // ── Fuel / Petrol & Diesel ─────────────────────────────────────────────────
  INDIANOIL:       { name: 'Indian Oil',       parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  IOCL:            { name: 'Indian Oil',       parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  HPCL:            { name: 'HP Petrol',        parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  BPCL:            { name: 'Bharat Petroleum', parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  SHELL:           { name: 'Shell',            parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },
  RELIANCEPETRO:   { name: 'Reliance Petro',   parentCategory: 'Fuel', childCategory: 'Petrol & Diesel' },

  // ── Investments ────────────────────────────────────────────────────────────
  ZERODHA:         { name: 'Zerodha',          parentCategory: 'Investments', childCategory: 'Stocks & Trading' },
  UPSTOX:          { name: 'Upstox',           parentCategory: 'Investments', childCategory: 'Stocks & Trading' },
  SMALLCASE:       { name: 'Smallcase',        parentCategory: 'Investments', childCategory: 'Stocks & Trading' },
  GROWW:           { name: 'Groww',            parentCategory: 'Investments', childCategory: 'Mutual Funds' },
  KUVERA:          { name: 'Kuvera',           parentCategory: 'Investments', childCategory: 'Mutual Funds' },
  PAYTMMONEY:      { name: 'Paytm Money',      parentCategory: 'Investments', childCategory: 'Mutual Funds' },
  INDMONEY:        { name: 'INDmoney',         parentCategory: 'Investments', childCategory: 'Mutual Funds' },

  // ── Education ──────────────────────────────────────────────────────────────
  UNACADEMY:       { name: 'Unacademy',        parentCategory: 'Education', childCategory: 'Online Courses' },
  BYJUS:           { name: "Byju's",           parentCategory: 'Education', childCategory: 'Online Courses' },
  VEDANTU:         { name: 'Vedantu',          parentCategory: 'Education', childCategory: 'Online Courses' },
  WHITEHAT:        { name: 'WhiteHat Jr',      parentCategory: 'Education', childCategory: 'Online Courses' },
  CUEMATH:         { name: 'Cuemath',          parentCategory: 'Education', childCategory: 'Online Courses' },
  SIMPLILEARN:     { name: 'Simplilearn',      parentCategory: 'Education', childCategory: 'Online Courses' },
  COURSERA:        { name: 'Coursera',         parentCategory: 'Education', childCategory: 'Online Courses' },
  UDEMY:           { name: 'Udemy',            parentCategory: 'Education', childCategory: 'Online Courses' },
  UPGRAD:          { name: 'upGrad',           parentCategory: 'Education', childCategory: 'Online Courses' },
};

// Longer keys matched first — guarantees AMAZONPRIME beats AMAZON, etc.
const DICTIONARY_KEYS_BY_LENGTH = Object.keys(GLOBAL_MERCHANT_DICTIONARY)
  .sort((a, b) => b.length - a.length);

// =============================================================================
// 2. Sanitisation patterns
// =============================================================================

const PROCESSOR_PREFIX =
  /^(PAYTM|PHONEPE|PHONPE|GPAY|GOOGLEPAY|AMAZONPAY|RAZORPAY|RZP|EZETAP|BHIM|UPI|MPS|POS|MOBIKWIK|FREECHARGE|PAYU|CCAVENUE|BILLDESK|JUSPAY)\*+/i;

const TRAILING_DYNAMIC_ID = /[-_\s]+[A-Z0-9]{3,}\d+\w*$/i;
const TRAILING_DIGITS     = /[-_\s]*\d{2,}$/;
const TRAILING_PUNCT      = /[._\-\s]+$/;
const LEADING_PUNCT       = /^[._\-\s]+/;
const ALL_DIGITS          = /^\d+$/;

const JUNK_RAW_MERCHANT = new Set([
  'THE BENEFICIARY ACCOUNT',
  'BENEFICIARY ACCOUNT',
  'YOUR ACCOUNT',
  'THIS ACCOUNT',
  'THE ACCOUNT',
]);

// =============================================================================
// 3. Helpers
// =============================================================================
const safe = (v: unknown): string => (typeof v === 'string' ? v : '');

function normalize(text: unknown): string {
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
      w.length <= 3 && /^(of|to|the|and|for|in|on|at)$/.test(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1),
    );
  if (words.length === 0) return '';
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(' ');
}

// =============================================================================
// 4. sanitizeRawMerchant — strip VPA suffix, processor prefix, trailing IDs
// =============================================================================
export function sanitizeRawMerchant(raw: unknown): string {
  let s = normalize(raw);
  if (!s) return '';

  if (s.includes('@')) s = s.split('@')[0];

  let prev: string;
  do {
    prev = s;
    s = s.replace(PROCESSOR_PREFIX, '').trim();
  } while (s !== prev && s.length > 0);

  s = s.replace(TRAILING_DYNAMIC_ID, '');
  s = s.replace(TRAILING_DIGITS, '');
  s = s.replace(TRAILING_PUNCT, '');
  s = s.replace(LEADING_PUNCT, '');
  s = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!s || ALL_DIGITS.test(s)) return '';
  if (JUNK_RAW_MERCHANT.has(s)) return '';
  return s;
}

// =============================================================================
// 5. mapToBrand — user rules → dictionary → title-case fallback
// =============================================================================
function mapToBrand(sanitized: string, userRules?: UserRules): MappedBrand {
  if (!sanitized) {
    return { cleanMerchant: '', parentCategory: '', childCategory: '', isKnownSubscription: false, source: 'empty' };
  }
  const upper = sanitized.toUpperCase();

  // 1. User rules (exact UPPERCASE key, then substring for keys ≥ 4 chars)
  if (userRules && typeof userRules === 'object') {
    if (userRules[upper]) {
      const rule = userRules[upper];
      return {
        cleanMerchant:     rule.cleanMerchant || smartTitleCase(sanitized),
        parentCategory:    rule.parentCategory,
        childCategory:     rule.childCategory,
        isKnownSubscription: false,
        source: 'user_rule',
      };
    }
    for (const key of Object.keys(userRules)) {
      if (key.length >= 4 && upper.includes(key)) {
        const rule = userRules[key];
        return {
          cleanMerchant:     rule.cleanMerchant || smartTitleCase(sanitized),
          parentCategory:    rule.parentCategory,
          childCategory:     rule.childCategory,
          isKnownSubscription: false,
          source: 'user_rule',
        };
      }
    }
  }

  // 2. Global dictionary — longer keys first to avoid partial matches
  const flat = upper.replace(/\s+/g, '');
  for (const key of DICTIONARY_KEYS_BY_LENGTH) {
    if (upper.includes(key) || flat.includes(key)) {
      const entry = GLOBAL_MERCHANT_DICTIONARY[key];
      return {
        cleanMerchant:     entry.name,
        parentCategory:    entry.parentCategory,
        childCategory:     entry.childCategory,
        isKnownSubscription: entry.isKnownSubscription === true,
        source: 'dictionary',
      };
    }
  }

  // 3. Title-case fallback — no category, caller keeps messageParser's categoryId
  return {
    cleanMerchant:     smartTitleCase(sanitized),
    parentCategory:    '',
    childCategory:     '',
    isKnownSubscription: false,
    source: 'fallback',
  };
}

// =============================================================================
// 6. cleanMerchantName — main enrichment entry point
//    Returns parentCategory/childCategory from twoTierCategories.ts labels.
//    Returns empty strings when no dictionary/user-rule match found (caller
//    should keep messageParser's flat categoryId in that case).
// =============================================================================
export function cleanMerchantName(
  raw: unknown,
  userRules: UserRules = {},
): MappedBrand {
  const sanitized = sanitizeRawMerchant(raw);
  return mapToBrand(sanitized, userRules);
}

// =============================================================================
// 7. detectIsSubscription — 90-day recurring-payment detection
//    Used for merchants NOT pre-flagged with isKnownSubscription (e.g. regional ISPs).
// =============================================================================
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function dayOfMonthDiff(a: Date, b: Date): number {
  const da = a.getUTCDate();
  const db = b.getUTCDate();
  const direct = Math.abs(da - db);
  const wrap = Math.min(da, db) + (31 - Math.max(da, db));
  return Math.min(direct, wrap);
}

/**
 * Returns true when `candidate` matches ≥1 prior transaction in `history`:
 * same cleanMerchant, amount ±15%, day-of-month ±3, within 90 days.
 */
export function detectIsSubscription(
  candidate: SubscriptionCandidate | null | undefined,
  history: SubscriptionCandidate[] | null | undefined,
): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.isExcludable) return false;
  if (!candidate.cleanMerchant) return false;
  if (!candidate.amount || candidate.amount <= 0) return false;
  if (!Array.isArray(history) || history.length === 0) return false;

  let candTime: number;
  try {
    candTime = new Date(candidate.timestamp).getTime();
    if (Number.isNaN(candTime)) return false;
  } catch { return false; }

  const candDate   = new Date(candTime);
  const lowerBound = candTime - NINETY_DAYS_MS;
  const amtTol     = candidate.amount * 0.15;

  for (const t of history) {
    if (t === candidate) continue;
    if (!t || t.cleanMerchant !== candidate.cleanMerchant) continue;
    if (t.isExcludable) continue;
    if (!t.amount || Math.abs(t.amount - candidate.amount) > amtTol) continue;
    const ts = new Date(t.timestamp).getTime();
    if (Number.isNaN(ts) || ts >= candTime || ts < lowerBound) continue;
    if (dayOfMonthDiff(candDate, new Date(ts)) > 3) continue;
    return true;
  }
  return false;
}
