// =============================================================================
// smsParser — deterministic merchant & category extractor for Indian bank SMS
// -----------------------------------------------------------------------------
// Sits on top of messageParser.js (which handles sender/phrase/amount gates).
// This file is concerned with:
//   1. Cleaning the raw merchant string from a banking SMS
//   2. Mapping it to a high-quality merchant brand + category
//   3. Detecting self-transfers (isExcludable)
//   4. Detecting recurring patterns (isSubscription) from local history
//   5. Migrating older stored transactions to the new schema, non-destructively
//   6. Learning user rules from past manual re-tagging
//
// Zero dependencies. Safe for use inside Zustand `migrate`.
// =============================================================================

// =============================================================================
// Public types
// =============================================================================
export interface MerchantBrand {
  name: string;
  category: string;
}

export interface UserRule {
  cleanMerchant: string;
  category: string;
}

export type UserRules = Record<string, UserRule>;

export interface ParsedSms {
  amount: number;
  timestamp: string;
  rawMerchant: string;
  cleanMerchant: string;
  category: string;
  isSubscription: boolean;
  isExcludable: boolean;
}

export interface MappedBrand {
  cleanMerchant: string;
  category: string;
  source: 'user_rule' | 'dictionary' | 'fallback' | 'empty';
}

/**
 * Subset of the stored transaction shape that the subscription detector
 * cares about. Keeps the type loose so legacy and current shapes both fit.
 */
export interface SubscriptionCandidate {
  amount: number;
  timestamp: string;
  cleanMerchant: string;
  isExcludable?: boolean;
}

/**
 * Loose legacy transaction — fields that may or may not be present on
 * pre-migration entries living in AsyncStorage. Anything unknown is allowed
 * via the index signature.
 */
export interface LegacyTransaction {
  id?: string;
  merchant?: string;
  amount?: number;
  categoryId?: string;
  category?: string;
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

// =============================================================================
// 1. GLOBAL_MERCHANT_DICTIONARY
//    Keys are UPPERCASE substrings searched inside the sanitized raw merchant.
//    First substring hit wins, so list MOST SPECIFIC keys first.
// =============================================================================
export const GLOBAL_MERCHANT_DICTIONARY: Record<string, MerchantBrand> = {
  // ── Food & Dining ────────────────────────────────────────────────────────
  ZOMATO:        { name: 'Zomato',          category: 'food' },
  SWIGGY:        { name: 'Swiggy',          category: 'food' },
  STARBUCKS:     { name: 'Starbucks',       category: 'food' },
  DOMINO:        { name: "Domino's Pizza",  category: 'food' },
  MCDONALD:      { name: "McDonald's",      category: 'food' },
  KFC:           { name: 'KFC',             category: 'food' },
  BURGERKING:    { name: 'Burger King',     category: 'food' },
  HALDIRAM:      { name: "Haldiram's",      category: 'food' },
  CCD:           { name: 'Cafe Coffee Day', category: 'food' },

  // ── Groceries ────────────────────────────────────────────────────────────
  BLINKIT:       { name: 'Blinkit',         category: 'groceries' },
  ZEPTO:         { name: 'Zepto',           category: 'groceries' },
  BIGBASKET:     { name: 'BigBasket',       category: 'groceries' },
  INSTAMART:     { name: 'Instamart',       category: 'groceries' },
  DMART:         { name: 'DMart',           category: 'groceries' },
  RELIANCESMART: { name: 'Reliance Smart',  category: 'groceries' },
  RELIANCEFRESH: { name: 'Reliance Fresh',  category: 'groceries' },

  // ── Shopping ─────────────────────────────────────────────────────────────
  AMAZON:        { name: 'Amazon',          category: 'shopping' },
  FLIPKART:      { name: 'Flipkart',        category: 'shopping' },
  MYNTRA:        { name: 'Myntra',          category: 'shopping' },
  AJIO:          { name: 'AJIO',            category: 'shopping' },
  MEESHO:        { name: 'Meesho',          category: 'shopping' },
  NYKAA:         { name: 'Nykaa',           category: 'shopping' },
  TATACLIQ:      { name: 'Tata CLiQ',       category: 'shopping' },
  CROMA:         { name: 'Croma',           category: 'shopping' },
  DECATHLON:     { name: 'Decathlon',       category: 'shopping' },

  // ── Travel ───────────────────────────────────────────────────────────────
  UBER:          { name: 'Uber',            category: 'travel' },
  OLACABS:       { name: 'Ola',             category: 'travel' },
  OLA:           { name: 'Ola',             category: 'travel' },
  RAPIDO:        { name: 'Rapido',          category: 'travel' },
  IRCTC:         { name: 'IRCTC',           category: 'travel' },
  MAKEMYTRIP:    { name: 'MakeMyTrip',      category: 'travel' },
  GOIBIBO:       { name: 'Goibibo',         category: 'travel' },
  REDBUS:        { name: 'redBus',          category: 'travel' },
  INDIGO:        { name: 'IndiGo',          category: 'travel' },
  OYO:           { name: 'OYO',             category: 'travel' },

  // ── Subscriptions / Entertainment ────────────────────────────────────────
  NETFLIX:       { name: 'Netflix',         category: 'entertainment' },
  SPOTIFY:       { name: 'Spotify',         category: 'entertainment' },
  HOTSTAR:       { name: 'Disney+ Hotstar', category: 'entertainment' },
  AMAZONPRIME:   { name: 'Amazon Prime',    category: 'entertainment' },
  PRIMEVIDEO:    { name: 'Amazon Prime',    category: 'entertainment' },
  YOUTUBEPREMIUM:{ name: 'YouTube Premium', category: 'entertainment' },
  SONYLIV:       { name: 'SonyLIV',         category: 'entertainment' },
  JIOCINEMA:     { name: 'JioCinema',       category: 'entertainment' },
  BOOKMYSHOW:    { name: 'BookMyShow',      category: 'entertainment' },

  // ── Bills & Utilities ────────────────────────────────────────────────────
  JIO:           { name: 'Jio',             category: 'bills' },
  AIRTEL:        { name: 'Airtel',          category: 'bills' },
  VODAFONE:      { name: 'Vi',              category: 'bills' },
  TATAPOWER:     { name: 'Tata Power',      category: 'bills' },
  BESCOM:        { name: 'BESCOM',          category: 'bills' },

  // ── Fuel ─────────────────────────────────────────────────────────────────
  INDIANOIL:     { name: 'Indian Oil',      category: 'fuel' },
  HPCL:          { name: 'HP Petrol',       category: 'fuel' },
  BPCL:          { name: 'Bharat Petroleum', category: 'fuel' },
  SHELL:         { name: 'Shell',           category: 'fuel' },
};

// Substring-match order: longer keys first so e.g. AMAZONPRIME beats AMAZON.
const DICTIONARY_KEYS_BY_LENGTH = Object.keys(GLOBAL_MERCHANT_DICTIONARY)
  .sort((a, b) => b.length - a.length);

// =============================================================================
// 2. Anchor lists for raw merchant isolation
// =============================================================================
const LEFT_ANCHORS = [
  'TRANSFERRED TO', 'TRF TO', 'SENT TO', 'PAID TO', 'PAID AT', 'PAID FOR',
  'PURCHASE AT', 'PURCHASE OF', 'SPENT AT', 'SPENT ON',
  'PAYMENT TO', 'PAYMENT OF', 'PAYMENT FOR',
  'TO VPA', 'TO M/S', 'FROM VPA',
  'INFO:', 'INFO-', 'INF*', 'INF:', 'WPM*', 'WP*', 'POS ',
  '; ',      // ICICI "debited; PAYEE credited" format
  ' FROM ',  // credit messages: "credited from NAME"
  ' AT ', ' TO ', ' @ ',
];

const RIGHT_ANCHORS = [
  ' ON ', ' VIA ', ' USING ', ' REF ', ' REF.', ' REF-', ' REF NO',
  ' UPI REF', ' UPI:', ' UPI/', ' VALUE DATE', ' VAL DT',
  ' NEFT', ' IMPS', ' RTGS', ' DT ', ' DATED ', ' TXN', ' TRX',
  ' AVL ', ' AVL.', ' AVAILABLE', ' BAL', ' BALANCE',
  ' INFO ', ' NOT YOU', ' CALL ', ' SMS BLOCK', ' TO BLOCK',
  ' HELP ', ' HELPLINE', ' DISPUTE',
  ' SO ',        // "VIKRAM SINGH SO CREDITED" — stop before role word
  ' CREDITED',   // stop before credited
  '.', ',', ';',
];

// =============================================================================
// 3. Sanitation patterns
// =============================================================================
const PROCESSOR_PREFIX = /^(PAYTM|PHONEPE|PHONPE|GPAY|GOOGLEPAY|AMAZONPAY|RAZORPAY|RZP|EZETAP|BHIM|UPI|MPS|POS|MOBIKWIK|FREECHARGE|PAYU|CCAVENUE|BILLDESK|JUSPAY)\*+/i;
const TRAILING_DYNAMIC_ID = /[-_\s]+[A-Z0-9]{3,}\d+\w*$/i;   // ZOMATO-1827391, UBER_RIDE_123A
const TRAILING_DIGITS     = /[-_\s]*\d{2,}$/;                // STORE 12345
const TRAILING_PUNCT      = /[._\-\s]+$/;
const LEADING_PUNCT       = /^[._\-\s]+/;
const ALL_DIGITS          = /^\d+$/;

// Self-transfer / non-expense detection — text-level signals
const SELF_TRANSFER_REGEX =
  /(?:from\s+a\/?c[^.]{0,40}to\s+a\/?c)|(?:credited\b.{0,30}\bdebited)|(?:debited\b.{0,30}\bcredited)|(?:own\s+account)|(?:self\s+transfer)|(?:fund\s+transfer\s+to\s+own)|(?:info\s*trf\b)|(?:\btrf\s+to\s+fd\b)|(?:transfer\s+to\s+(?:fd|fixed\s+deposit))/i;

const ATM_REGEX = /\batm\b.{0,40}\bwithdraw/i;

// Generic phrases that are never real merchants — discarded after isolation
const JUNK_RAW_MERCHANT = new Set([
  'THE BENEFICIARY ACCOUNT',
  'BENEFICIARY ACCOUNT',
  'YOUR ACCOUNT',
  'THIS ACCOUNT',
  'THE ACCOUNT',
]);

const AMOUNT_REGEX =
  /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i;

const DATE_REGEX =
  /\b(\d{1,2})[-\/\s]([A-Za-z]{3,9}|\d{1,2})[-\/\s](\d{2,4})\b/;

const MONTH_MAP: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

// =============================================================================
// 4. Internal helpers
// =============================================================================
const safe = (v: unknown): string => (typeof v === 'string' ? v : '');

const toNumber = (s: string | undefined | null): number =>
  s ? parseFloat(s.replace(/,/g, '')) || 0 : 0;

function normalize(text: unknown): string {
  return safe(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function smartTitleCase(str: unknown): string {
  const cleaned = safe(str)
    .toLowerCase()
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^[a-z]+$/i.test(w) && /^(of|to|the|and|for|in|on|at)$/.test(w)
      ? w
      : w.charAt(0).toUpperCase() + w.slice(1)));
  if (cleaned.length === 0) return '';
  // Always capitalize the first word
  cleaned[0] = cleaned[0].charAt(0).toUpperCase() + cleaned[0].slice(1);
  return cleaned.join(' ');
}

/**
 * Pull the slice of text between the most specific left anchor we find and
 * the earliest right anchor that follows. Returns '' if no anchors hit.
 */
function isolateRawMerchant(upper: string): string {
  let best = '';
  let bestStart = -1;

  for (const la of LEFT_ANCHORS) {
    const idx = upper.indexOf(la);
    if (idx === -1) continue;
    const startIdx = idx + la.length;
    // Earliest right anchor after startIdx
    let endIdx = upper.length;
    for (const ra of RIGHT_ANCHORS) {
      const ri = upper.indexOf(ra, startIdx);
      if (ri !== -1 && ri < endIdx) endIdx = ri;
    }
    const span = upper.slice(startIdx, endIdx).trim();
    // Prefer the FIRST left anchor that yields a non-empty span, since the
    // anchor list is ordered most-specific first.
    if (span && span.length >= 2) {
      if (bestStart === -1 || idx < bestStart) {
        best = span;
        bestStart = idx;
      }
      // Specific anchors come first; stop on first decent hit.
      if (la.length >= 5) break;
    }
  }
  return best;
}

/**
 * Step 3 — Sanitize a raw merchant slice:
 *  - drop UPI VPA suffix (everything after '@')
 *  - strip processor prefix (PAYTM*, PHONEPE*, RZP*)
 *  - strip trailing transaction IDs / digits / hyphens / underscores
 */
export function sanitizeRawMerchant(raw: unknown): string {
  let s = normalize(raw);
  if (!s) return '';

  // Drop UPI VPA suffix
  if (s.includes('@')) {
    s = s.split('@')[0];
  }

  // Strip processor prefix iteratively (handles PAYTM*RZP*ZOMATO)
  let prev;
  do {
    prev = s;
    s = s.replace(PROCESSOR_PREFIX, '').trim();
  } while (s !== prev && s.length > 0);

  // Strip trailing dynamic IDs / digit suffixes
  s = s.replace(TRAILING_DYNAMIC_ID, '');
  s = s.replace(TRAILING_DIGITS, '');
  s = s.replace(TRAILING_PUNCT, '');
  s = s.replace(LEADING_PUNCT, '');

  // Collapse internal punctuation runs to single space
  s = s.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Reject if it collapsed to digits only
  if (!s || ALL_DIGITS.test(s)) return '';

  return s;
}

/**
 * Step 4 — Map sanitized name to clean merchant + category, with fallback chain:
 *   user rules → global dictionary → smart title case + 'Unassigned'.
 */
function mapToBrand(sanitized: string, userRules?: UserRules): MappedBrand {
  if (!sanitized) {
    return { cleanMerchant: 'Unassigned', category: 'Unassigned', source: 'empty' };
  }
  const upper = sanitized.toUpperCase();

  // 1. User rules (exact-key match, then substring match for keys ≥ 4 chars)
  if (userRules && typeof userRules === 'object') {
    if (userRules[upper]) {
      return { ...userRules[upper], source: 'user_rule' };
    }
    for (const key of Object.keys(userRules)) {
      if (key.length >= 4 && upper.includes(key)) {
        return { ...userRules[key], source: 'user_rule' };
      }
    }
  }

  // 2. Global dictionary — longest keys first
  const flat = upper.replace(/\s+/g, '');
  for (const key of DICTIONARY_KEYS_BY_LENGTH) {
    if (upper.includes(key) || flat.includes(key)) {
      const entry = GLOBAL_MERCHANT_DICTIONARY[key];
      return { cleanMerchant: entry.name, category: entry.category, source: 'dictionary' };
    }
  }

  // 3. Smart title case fallback — NEVER 'Others'
  const titled = smartTitleCase(sanitized) || 'Unassigned';
  return { cleanMerchant: titled, category: 'Unassigned', source: 'fallback' };
}

/**
 * Parse a date out of the SMS body. Returns ISO string or null.
 */
function extractTimestamp(upper: string): string | null {
  const m = upper.match(DATE_REGEX);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  let month;
  if (/^[A-Z]+$/.test(m[2])) {
    const mk = m[2].slice(0, 3).toUpperCase();
    if (!(mk in MONTH_MAP)) return null;
    month = MONTH_MAP[mk];
  } else {
    month = parseInt(m[2], 10) - 1;
  }
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  try {
    return new Date(Date.UTC(year, month, day)).toISOString();
  } catch {
    return null;
  }
}

// =============================================================================
// 5. parseSms — main entry point
// =============================================================================
/**
 * Parse a raw banking SMS into the structured analytics schema.
 * NEVER throws — garbage input returns a safe default object.
 */
export function parseSms(rawText: unknown, userRules: UserRules = {}): ParsedSms {
  // Safe defaults so the function NEVER throws — even on garbage input.
  const fallback: ParsedSms = {
    amount: 0,
    timestamp: new Date().toISOString(),
    rawMerchant: '',
    cleanMerchant: 'Unassigned',
    category: 'Unassigned',
    isSubscription: false,
    isExcludable: false,
  };

  if (!rawText || typeof rawText !== 'string') return fallback;

  let upper: string;
  try {
    upper = normalize(rawText);
  } catch {
    return fallback;
  }
  if (!upper) return fallback;

  // ── Amount ──
  let amount = 0;
  try {
    const am = upper.match(AMOUNT_REGEX);
    if (am) amount = toNumber(am[1] || am[2]);
  } catch { /* keep 0 */ }

  // ── Timestamp ──
  const timestamp = extractTimestamp(upper) || new Date().toISOString();

  // ── Self-transfer excludability ──
  // (ATM withdrawals are real expenses; only intra-own-account transfers excluded.)
  const isExcludable = SELF_TRANSFER_REGEX.test(upper);

  // ── Raw merchant isolation ──
  let rawMerchant = '';
  try {
    const isolated = isolateRawMerchant(upper);
    rawMerchant = JUNK_RAW_MERCHANT.has(isolated) ? '' : isolated;
  } catch { /* leave '' */ }

  // ── Sanitize + map ──
  const sanitized = sanitizeRawMerchant(rawMerchant);
  const mapped = mapToBrand(sanitized, userRules);

  return {
    amount,
    timestamp,
    rawMerchant: rawMerchant || '',
    cleanMerchant: isExcludable ? (mapped.cleanMerchant || 'Self Transfer') : mapped.cleanMerchant,
    category: isExcludable ? 'transfer' : mapped.category,
    isSubscription: false, // populated downstream by detectIsSubscription
    isExcludable,
  };
}

// =============================================================================
// 6. cleanMerchantName — handy for callers that already have a raw merchant
// (e.g. messageParser.js's extracted `merchant` field).
// =============================================================================
export function cleanMerchantName(
  raw: unknown,
  userRules: UserRules = {},
): MappedBrand {
  const sanitized = sanitizeRawMerchant(raw);
  return mapToBrand(sanitized, userRules);
}

// =============================================================================
// 7. Subscription detection — 90-day lookback over local history
// -----------------------------------------------------------------------------
// Criteria for a match against the candidate transaction:
//   • same cleanMerchant
//   • |amountDiff| ≤ 15% of candidate amount
//   • day-of-month within ±3 (handles month-end wrap, e.g. day 30 vs day 1)
//   • within 90 days of candidate.timestamp
// ≥ 1 matching prior occurrence ⇒ candidate.isSubscription = true.
// =============================================================================
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function dayOfMonthDiff(a: Date, b: Date): number {
  const da = a.getUTCDate();
  const db = b.getUTCDate();
  const direct = Math.abs(da - db);
  // Month-end wrap (e.g. day 1 vs day 30 = 1 calendar day diff)
  const wrap = Math.min(da, db) + (31 - Math.max(da, db));
  return Math.min(direct, wrap);
}

/**
 * Decide whether `candidate` looks like a recurring subscription, given a
 * history array of already-cleaned transactions.
 */
export function detectIsSubscription(
  candidate: SubscriptionCandidate | null | undefined,
  history: SubscriptionCandidate[] | null | undefined,
): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.isExcludable) return false;
  if (!candidate.cleanMerchant || candidate.cleanMerchant === 'Unassigned') return false;
  if (!candidate.amount || candidate.amount <= 0) return false;
  if (!Array.isArray(history) || history.length === 0) return false;

  let candTime: number;
  try {
    candTime = new Date(candidate.timestamp).getTime();
    if (Number.isNaN(candTime)) return false;
  } catch { return false; }
  const candDate = new Date(candTime);
  const lowerBound = candTime - NINETY_DAYS_MS;
  const amtTolerance = candidate.amount * 0.15;

  for (const t of history) {
    if (t === candidate) continue;
    if (!t || t.cleanMerchant !== candidate.cleanMerchant) continue;
    if (t.isExcludable) continue;
    if (!t.amount || Math.abs(t.amount - candidate.amount) > amtTolerance) continue;
    const ts = new Date(t.timestamp).getTime();
    if (Number.isNaN(ts) || ts >= candTime || ts < lowerBound) continue;
    if (dayOfMonthDiff(candDate, new Date(ts)) > 3) continue;
    return true; // one prior match is enough — pattern of ≥2 occurrences
  }
  return false;
}

/**
 * Stamp isSubscription onto an entire transaction array in one O(n²) pass.
 * For n ≲ 5000 this stays well under a second on-device and only runs once
 * during migration (or whenever the user explicitly requests a re-scan).
 */
export function markSubscriptionsInHistory<T extends SubscriptionCandidate>(
  transactions: T[],
): T[] {
  if (!Array.isArray(transactions)) return transactions;
  return transactions.map((t) => ({
    ...t,
    isSubscription: Boolean(
      t && ((t as SubscriptionCandidate & { isSubscription?: boolean }).isSubscription
        || detectIsSubscription(t, transactions)),
    ),
  }));
}

// =============================================================================
// 8. migrateHistoricalTransactions — non-destructive backfill
// -----------------------------------------------------------------------------
// Safe to call from Zustand `migrate`. For each existing transaction we ADD
// rawMerchant / cleanMerchant / category / isSubscription / isExcludable only
// if those fields are missing. Anything the user has manually edited
// (t.userEdited === true) is left strictly untouched apart from filling in
// the brand-new flags that didn't exist in older builds.
// =============================================================================
export function migrateHistoricalTransactions(
  transactions: LegacyTransaction[],
  userRules: UserRules = {},
): LegacyTransaction[] {
  if (!Array.isArray(transactions)) return transactions;

  // Pass 1: backfill clean-merchant / category / excludability per transaction
  const enriched: LegacyTransaction[] = transactions.map((t) => {
    if (!t || typeof t !== 'object') return t;

    const out: LegacyTransaction = { ...t };

    // Always ensure rawMerchant exists
    if (out.rawMerchant === undefined || out.rawMerchant === null) {
      out.rawMerchant = safe(t.merchant);
    }

    // Backfill cleanMerchant only if missing (don't clobber manual edits)
    if (!out.cleanMerchant) {
      const mapped = cleanMerchantName(out.rawMerchant || t.merchant, userRules);
      out.cleanMerchant = mapped.cleanMerchant || smartTitleCase(safe(t.merchant)) || 'Unassigned';
    }

    // Backfill category only if missing AND user hasn't tagged it.
    // The legacy field is `categoryId`; we keep both for now so nothing breaks.
    if (out.category === undefined || out.category === null) {
      if (t.userEditedCategory && t.categoryId) {
        out.category = t.categoryId;
      } else {
        const mapped = cleanMerchantName(out.rawMerchant || t.merchant, userRules);
        // If the dictionary said 'Unassigned' but the legacy categoryId is
        // something meaningful, prefer the legacy value.
        out.category =
          mapped.category !== 'Unassigned'
            ? mapped.category
            : (t.categoryId || 'Unassigned');
      }
    }

    // isExcludable: derive from legacy `isIgnored` or detect self-transfer in note.
    if (out.isExcludable === undefined || out.isExcludable === null) {
      const noteUpper = normalize(t.note || '');
      out.isExcludable =
        Boolean(t.isIgnored) || SELF_TRANSFER_REGEX.test(noteUpper);
    }

    // Ensure isSubscription field exists (false default, populated in pass 2)
    if (out.isSubscription === undefined || out.isSubscription === null) {
      out.isSubscription = false;
    }

    // Ensure timestamp field exists; map legacy createdAt if needed.
    if (!out.timestamp) {
      out.timestamp = t.createdAt || new Date().toISOString();
    }

    return out;
  });

  // Pass 2: subscription detection over the migrated history
  return enriched.map((t) => {
    if (!t || typeof t !== 'object') return t;
    if (t.isSubscription) return t; // already marked, keep
    return {
      ...t,
      isSubscription: detectIsSubscription(t as SubscriptionCandidate, enriched as SubscriptionCandidate[]),
    };
  });
}

// =============================================================================
// 9. generateUserRulesFromHistory — self-learning
// -----------------------------------------------------------------------------
// Scan stored transactions for patterns where the user has consistently
// re-tagged a particular raw merchant string to the same clean name /
// category combination. If the same rewrite shows up ≥ MIN_OCCURRENCES times,
// promote it to a user rule.
//
// A transaction is considered "manually re-tagged" when t.userEdited === true
// (or the legacy combo: t.userEditedCategory OR t.userEditedMerchant).
// =============================================================================
const MIN_OCCURRENCES_FOR_RULE = 2;

export function generateUserRulesFromHistory(
  transactions: LegacyTransaction[],
): UserRules {
  const rules: UserRules = {};
  if (!Array.isArray(transactions)) return rules;

  // Bucket by sanitized raw merchant.
  const groups = new Map<string, Array<{ cleanMerchant: string; category: string }>>();
  for (const t of transactions) {
    if (!t || typeof t !== 'object') continue;
    const isManuallyEdited =
      t.userEdited === true ||
      t.userEditedCategory === true ||
      t.userEditedMerchant === true;
    if (!isManuallyEdited) continue;

    const raw = safe(t.rawMerchant) || safe(t.merchant);
    if (!raw) continue;
    const key = sanitizeRawMerchant(raw).toUpperCase();
    if (!key || key.length < 3) continue;

    const cleanName = safe(t.cleanMerchant) || safe(t.merchant);
    const category = safe(t.category) || safe(t.categoryId);
    if (!cleanName || !category) continue;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ cleanMerchant: cleanName, category });
  }

  // Mode-detect per group: the most frequent (clean, category) tuple wins,
  // provided it appears at least MIN_OCCURRENCES_FOR_RULE times.
  for (const [key, entries] of groups.entries()) {
    const counts = new Map<string, number>();
    for (const e of entries) {
      const ck = `${e.cleanMerchant}${e.category}`;
      counts.set(ck, (counts.get(ck) || 0) + 1);
    }
    let bestKey: string | null = null;
    let bestCount = 0;
    for (const [ck, c] of counts.entries()) {
      if (c > bestCount) {
        bestKey = ck;
        bestCount = c;
      }
    }
    if (bestCount >= MIN_OCCURRENCES_FOR_RULE && bestKey) {
      const [cm, cat] = bestKey.split('');
      rules[key] = { cleanMerchant: cm, category: cat };
    }
  }

  return rules;
}

// =============================================================================
// 10. Diagnostic samples (used by the dev/diagnostic screen if you wire it up)
// =============================================================================
export const SMS_PARSER_SAMPLES: readonly string[] = [
  'Rs.450.00 debited from A/c xx1234 on 06-May-26 to SWIGGY-1827391@oksbi via UPI. Avl bal Rs.42,310.50',
  'INR 1,299 spent on HDFC Credit Card ending 4321 at AMAZON on 05-May-26.',
  'Rs.2,499 debited from A/c xx9012 to NETFLIX on 03-May. UPI Ref 4421.',
  '₹350 paid to PAYTM*BIGBASKET via UPI from your account xx1234.',
  'Rs.180 debited via UPI to ola@paytm. A/c xx1234. Ref 998877.',
  'Rs.5,000 transferred from A/c xx1234 to A/c xx5678. Self transfer.',
  'Rs.200 withdrawn from ATM xx1234 on 04-May-26.',
  'Rs.499 debited from A/c xx1234 to RZP*SPOTIFY-IND on 02-May-26. UPI Ref 8821',
  'Rs.749 paid to RAMESH_KIRANA_DELHI via UPI from your account xx1234. Ref 778899.',
];
