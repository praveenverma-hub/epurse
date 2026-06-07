// =============================================================================
// SMS / Notification message parser
// =============================================================================
// Three-gate filter (must pass all three to become a transaction):
//
//  Gate 1 — Source check  (OR)
//    a) Sender ID contains a known bank / wallet name, OR
//    b) Message body contains an account/card reference (A/c XX1234,
//       card ending 1234) together with any basic debit/credit term.
//    → Eliminates: telecom offers (Jio, Vi), e-commerce promos, OTPs.
//
//  Gate 2 — Transaction phrase
//    Body must contain a concrete past-tense financial phrase such as
//    "debited", "credited", "paid to", "paid via", "transferred", etc.
//    → Eliminates: balance enquiry replies, offers with amounts.
//
//  Gate 3 — Monetary amount
//    Body must contain ₹/Rs/INR followed by (or preceded by) a number.
//    → Eliminates: non-monetary SMS that somehow slipped through.
//
// After passing all three gates the parser extracts amount, account mask,
// merchant, and maps to a category. Falls back to "other" if no brand match.
// =============================================================================

import { CATEGORY_KEYWORDS, ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';

// =============================================================================
// Gate 1a — Sender keywords
// Substrings matched against the sender ID (case-insensitive, dashes stripped).
// DLT promotional prefix senders (VM-*, DM-*, BP-*) are blocked before this.
// =============================================================================
const BANK_WALLET_SENDER_KEYS = [
  // ── Major private banks ───────────────────────────────────────────────────
  'hdfc', 'icici', 'axis', 'kotak', 'idfc', 'indusind', 'indus',
  'federal', 'rbl', 'csb', 'dcb', 'karur', 'cityunion', 'tamilnad',
  'lakshmi', 'nainital', 'southind', 'ujjvn', 'equitas', 'esaf',
  'aubank', 'ausmfi', 'bandhan', 'utkarsh', 'suryoday', 'jana',
  'northeast', 'yesbnk', 'yesbank',
  // ── PSU / nationalised banks ──────────────────────────────────────────────
  'sbi', 'pnb', 'boi', 'bob', 'canbnk', 'canbk', 'unionbk',
  'ucobk', 'indianbk', 'indbnk', 'centbk', 'mahbnk', 'punbsind',
  'iobbnk', 'allbnk', 'andbk', 'syndbk', 'vijaya', 'dena',
  'jkbank', 'kvbank', 'idbi',
  // ── Card networks / issuers (non-bank DLT senders) ───────────────────────
  'amex',                // American Express India
  // ── Payment banks ─────────────────────────────────────────────────────────
  'paytm', 'pytm',       // Paytm (PYTMWT = Paytm Wallet Transaction)
  'jiomny',              // JioMoney — NOT 'jio' (avoids JIOBIL)
  'airpay', 'airtpay',   // Airtel Payments Bank — NOT 'airtel' (avoids telecom)
  'finopay', 'fino', 'indiapst',
  // ── Wallets & UPI ─────────────────────────────────────────────────────────
  'phonepe', 'phpe', 'phonpe', 'gpay', 'googlepay',
  'ampay', 'amazonpay',
  'freecharge', 'frech', 'mobikwik', 'bhim', 'olamoney',
];

// Ordered list: first match wins. Keys match substrings of normalized sender ID.
const SENDER_KEY_TO_BANK = [
  ['hdfc',       'HDFC Bank'],
  ['icici',      'ICICI Bank'],
  ['axis',       'Axis Bank'],
  ['kotak',      'Kotak Bank'],
  ['idfc',       'IDFC Bank'],
  ['indusind',   'IndusInd Bank'],
  ['indus',      'IndusInd Bank'],
  ['federal',    'Federal Bank'],
  ['rbl',        'RBL Bank'],
  ['csb',        'CSB Bank'],
  ['aubank',     'AU Small Finance Bank'],
  ['ausmfi',     'AU Small Finance Bank'],
  ['bandhan',    'Bandhan Bank'],
  ['yesbank',    'Yes Bank'],
  ['yesbnk',     'Yes Bank'],
  ['sbi',        'SBI'],
  ['pnb',        'PNB'],
  ['boi',        'Bank of India'],
  ['bob',        'Bank of Baroda'],
  ['canbnk',     'Canara Bank'],
  ['canbk',      'Canara Bank'],
  ['unionbk',    'Union Bank'],
  ['indianbk',   'Indian Bank'],
  ['indbnk',     'Indian Bank'],
  ['centbk',     'Central Bank'],
  ['iobbnk',     'IOB'],
  ['ucobk',      'UCO Bank'],
  ['mahbnk',     'Bank of Maharashtra'],
  ['punbsind',   'Punjab & Sind Bank'],
  ['jkbank',     'J&K Bank'],
  ['dcb',        'DCB Bank'],
  ['karur',      'Karur Vysya Bank'],
  ['cityunion',  'City Union Bank'],
  ['southind',   'South Indian Bank'],
  ['equitas',    'Equitas SFB'],
  ['utkarsh',    'Utkarsh SFB'],
  ['ujjvn',      'Ujjivan SFB'],
  ['suryoday',   'Suryoday SFB'],
  ['jana',       'Jana SFB'],
  ['esaf',       'ESAF SFB'],
  ['northeast',  'North East SFB'],
  ['indiapst',   'India Post Payments'],
  ['tamilnad',   'Tamilnad Mercantile Bank'],
  ['nainital',   'Nainital Bank'],
  ['lakshmi',    'Lakshmi Vilas Bank'],
  ['vijaya',     'Bank of Baroda'],
  ['dena',       'Bank of Baroda'],
  ['syndbk',     'Canara Bank'],
  ['allbnk',     'Indian Bank'],
  ['andbk',      'Union Bank'],
  ['kvbank',     'Karur Vysya Bank'],
  ['idbi',       'IDBI Bank'],
  ['amex',       'American Express'],
  ['paytm',      'Paytm'],
  ['pytm',       'Paytm'],
  ['phonepe',    'PhonePe'],
  ['phpe',       'PhonePe'],
  ['phonpe',     'PhonePe'],
  ['gpay',       'Google Pay'],
  ['googlepay',  'Google Pay'],
  ['amazonpay',  'Amazon Pay'],
  ['ampay',      'Amazon Pay'],
  ['jiomny',     'JioMoney'],
  ['airpay',     'Airtel Payments'],
  ['airtpay',    'Airtel Payments'],
  ['mobikwik',   'MobiKwik'],
  ['freecharge', 'FreeCharge'],
  ['frech',      'FreeCharge'],
  ['bhim',       'BHIM UPI'],
  ['olamoney',   'Ola Money'],
  ['finopay',    'Fino Payments Bank'],
  ['fino',       'Fino Payments Bank'],
];

const getBankName = (sender) => {
  if (!sender) return null;
  const s = sender.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [key, name] of SENDER_KEY_TO_BANK) {
    if (s.includes(key)) return name;
  }
  return null;
};

// =============================================================================
// Gate 1b — Body account-reference regex (fallback when sender is unknown)
// If body has an account / card reference AND a basic debit/credit word,
// we accept the message even if the sender wasn't in the whitelist.
// This covers small banks, new wallets, or unusual sender ID formats.
// =============================================================================
const ACCOUNT_REF_REGEX =
  /(?:a\/c|acct\.?|account|card\s+ending|card\s+no\.?)\s*[xX*•·]{0,8}\d{3,}/i;

const BODY_DEBIT_CREDIT_TERMS = [
  'debit', 'credit', 'paid', 'payment', 'transfer', 'withdraw',
  'deposit', 'debited', 'credited', 'withdrawn', 'transferred',
];

// =============================================================================
// Gate 2 — Mandatory transaction phrase
// The body must contain at least one of these to confirm a real transaction
// actually happened (past-tense / directed financial action).
// =============================================================================
const TRANSACTION_PHRASES = [
  // Debit-side
  'debit',
  'debited', 'withdrawn', 'deducted', 'auto-debit', 'autopay',
  'emi debited', 'emi deducted', 'emi paid',
  'paid to', 'paid via', 'paid at', 'paid from', 'amount paid',
  'sent to', 'sent via',
  'money sent',           // "Money Sent: Rs.60.00 to MERCHANT"
  'transferred to', 'transferred from', 'transfer of',
  'payment of', 'payment for',
  'purchase at', 'purchase of', 'spent at', 'spent on',
  'charged on', 'charged at',  // "INR 2,150.00 charged on Axis Card xx1002"
  // "Txn Rs.305.00 On HDFC Bank Card 8077 At merchant@upi by UPI …" — no debit verb, just "Txn"
  'txn',
  // Card usage / ATM cash withdrawal ("Card ending 1234 used at ATM/merchant")
  'used at', 'used for', 'cash withdrawal', 'cash withdrawn', 'withdrawal at', 'atm cash',
  // Bare-verb debit forms (some banks omit -ed: "Rs 500 debit from A/c")
  'debit from', 'debit of', 'debit at',
  // Credit-side
  'credit',
  'credited', 'deposited', 'refunded', 'refund', 'salary credited',
  'amount credited', 'cashback credited',
  'received in', 'received to', 'received from',
  'money in',             // "Money In: Rs.10,000.00 to A/c XX1102"
  // Bare-verb credit forms
  'credit to', 'credit in', 'credit of',
  // Reversal confirmations
  'reversed to', 'amount reversed', 'transaction reversed', 'reversal credited',
  // Bank charges / penalties (no debit verb — only "levied on" or "penalty of")
  'levied on', 'levied', 'penalty of', 'charge levied',
];

// =============================================================================
// Regex patterns
// =============================================================================

// Amount: Rs.1,234.50 / ₹1234 / INR 1,234 / 1234.00 INR
const AMOUNT_REGEX =
  /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i;
const AMOUNT_REGEX_GLOBAL =
  /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/ig;

// Masked account / card: A/c xx1234 / Card ending 4321
// NOTE: Only whitespace + mask chars (x, *, •) allowed between the keyword and the
// digits — prevents "Card spends of INR 8497" from capturing 8497 as a mask.
const ACCOUNT_REGEX =
  /(?:a\/c|acct?|account|card(?:\s+ending)?)\.?\s*(?:no\.?\s*)?[xX*•·]{0,8}\s*([xX*•·]*\d{3,6})/i;

const FIRST_ACCOUNT_EVENT_REGEX =
  /(?:a\/c|acct?\.?|account)\s*[xX*•·]{0,8}(\d{3,6})\s+(debited|credited|deposited|withdrawn|deducted|refunded|received)\b/i;

// Every masked account/card number in the body (global). Used for self-transfer
// detection: a single SMS that references two accounts (e.g. "Acct XX171 debited
// … & Acct XX532 credited") may be a transfer between the user's own accounts.
const ACCOUNT_MASK_GLOBAL =
  /(?:a\/c|acct\.?|account)\.?\s*(?:no\.?)?\s*[xX*•·]{0,8}\s*(\d{3,6})/ig;

// Counterparty mobile number — "credited … by a/c linked to mobile 9XXXXXX33221".
// Captures the (possibly masked) token; trailing digits are extracted in code.
const COUNTERPARTY_PHONE_REGEX =
  /(?:linked\s+to\s+mobile|to\s+mobile(?:\s+no\.?)?|mobile\s+no\.?|vpa\s+linked\s+to\s+mobile)\s*(?:\+?91)?\s*([0-9xX*]{4,15})/i;

// Counterparty name appended after a masked mobile / VPA token, e.g.
// "linked to mobile 7XXXXXX221-PRAVEEN VE" or "VPA name@bank-RAHUL K". Used to
// detect self transfers when the phone is too masked to match (only the
// counterparty NAME — possibly the user's own — is left to anchor on).
const COUNTERPARTY_NAME_REGEX =
  /(?:mobile|vpa)\s+[\w@.xX*]+\s*-\s*([A-Za-z][A-Za-z]*(?:\s+[A-Za-z]+){0,3})/i;

// Transfer reference shared by both legs of one transfer, reported separately
// by the sending and receiving banks. Matches "IMPS Ref# 615722061047",
// "IMPS:615722061047", "UPI Ref no 597700275328", "UPI:199999367779", etc.
const TRANSFER_REF_REGEX =
  /\b(?:imps|upi|neft|rtgs)\b[\s\S]{0,6}?(?:ref(?:erence)?\.?\s*(?:no\.?|#)?\s*)?[:#\-\s]\s*([0-9]{6,})/i;

// "Acct XX302 debited … ; RADHIKA credited." — beneficiary name between semicolon and "credited".
// Guard: skips account references (Acct/A/c/Account) so own-account transfers don't leak through.
const BENEFICIARY_CREDITED_REGEX = /;\s*(?!(?:a\/c|acct?|account)\b)([A-Za-z][A-Za-z\s]{1,29}?)\s+credited\b/i;

// Merchant after "to", "at", "@", "from", "by", "for" — lazy, stops at stop words.
// Negative lookahead blocks currency captures (Rs.xxx / INR xxx / ₹xxx) right after anchor.
const MERCHANT_REGEX =
  /(?:to|at|@|from|by|for)\s+(?!(?:rs\.?|inr|₹)\s*\d)([A-Za-z0-9][A-Za-z0-9&._\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9&._\-]*){0,4}?)(?=\s+(?:on|via|ref|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by|has|is|was|div|id|mandate)\b|\s+to\s+your\b|\.|,|;|$)/i;

const MERCHANT_STOP =
  /\s+(?:on|via|ref|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by|has|is|was|div|id|mandate)\b.*$/i;

// UPI VPA: someone@bank
const VPA_REGEX = /([a-zA-Z0-9._\-]{2,30}@[a-zA-Z]{2,15})/;

// Payment acknowledgements for credit cards (not new spend/income transactions).
const CC_PAYMENT_NOTIFICATION_REGEX =
  /\bpayment\s+of\s+(?:inr|rs\.?|₹)\s*[0-9,]+(?:\.[0-9]{1,2})?[\s\S]{0,80}(?:has\s+been\s+received\s+on\s+your\b[\s\S]*\bcredit\s+card\b|was\s+credited\s+to\s+your\s+card\b|received\s+towards\s+[\w\s]{0,30}credit\s+card\b)/i;

// Credit-card bill REMINDER (pre-payment alert) — NOT a spend.
// Banks send these monthly to nudge the user to pay their CC bill.
// Verbs/phrases that anchor a reminder: amount/total/min/payment due,
// due date/on/by, outstanding (amount/balance/due), pay (instantly) by <date>,
// pay your bill/credit card, kindly/please pay, settle by/your/outstanding,
// bill/statement generated.
const CC_BILL_REMINDER_REGEX =
  /\b(?:(?:total|min(?:imum)?|amt|amount|payment|payable)\s+(?:amount\s+)?due(?:s)?|due\s*[:\s]\s*\d+|due\s+(?:date|on|by)\s+\d+|outstanding(?:\s+(?:amount|balance|due))?|pay(?:able)?\s+(?:instantly\s+)?by\s+\d+|pay\s+your\s+(?:bill|credit\s+card)|kindly\s+pay|please\s+pay|settle\s+(?:by|your|outstanding)|bill\s+generated|statement\s+(?:generated|is\s+sent))\b/i;

// Hard past-tense confirmation that money has ALREADY moved. If any of these
// fire, the SMS is a real transaction even if it also mentions "due" — we
// don't want to swallow `"Rs 500 debited towards EMI due"` as a reminder.
const CC_BILL_HARD_CONFIRMATION_REGEX =
  /\b(?:debited|credited|spent|withdrawn|deducted|deposited|refunded|transferred|charged|billed)\b|\bpaid\s+(?:to|via|at|from)\b/i;

// Guard: past-tense completion phrase that overrides promotional patterns.
// "has been credited/debited/transferred" = real disbursement, not a promo pitch.
const COMPLETED_TRANSACTION_REGEX =
  /\b(?:has\s+been|was|have\s+been)\s+(?:debited|credited|transferred|deposited|refunded|disbursed|processed)\b/i;

// Pull the card last-4 from a CC reminder body.
const CC_CARD_LAST4_REGEX =
  /\bcredit\s+card\b[^0-9]{0,30}(\d{4})\b|\bcard\s+(?:ending|no\.?)?\s*[xX*•·]*(\d{4})\b/i;

// Pull the "pay by <date>" date string from a CC reminder body.
const CC_DUE_DATE_REGEX =
  /\b(?:pay\s+(?:instantly\s+)?by|due\s+(?:date|on|by))\s+(\d{1,2}[\/\-\s][A-Za-z]{3,9}[\/\-\s]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;

// Outgoing CC bill payment from source bank account (not an expense — it's a
// liability settlement). Patterns: "towards [bank] credit card", "credit card
// bill payment successful", "paid to [bank] credit card".
// Requires a debit verb (CC_BILL_HARD_CONFIRMATION_REGEX) to fire alongside.
const CC_PAYMENT_OUTGOING_REGEX =
  /\btowards\s+(?:[\w]+\s+)?credit\s+card\b|\bcredit\s+card\s+(?:bill\s+)?(?:payment|dues?)\s+(?:successful|done|completed|processed|cleared)\b|\bpaid\s+(?:to|towards)\s+(?:[\w]+\s+)?credit\s+card\b|\bcredit\s+card\s+bill\s+payment\b/i;

// Promotional / upsell messages from banks (EMI offers, reward conversions).
// These contain an amount (the "eligible spend") but no actual transaction happened.
// Examples: "spends of INR 8497 are eligible for FLEXI EMI conversion"
const PROMOTIONAL_OFFER_REGEX =
  /\beligible\s+for\s+(?:emi|flexi|conversion|offer|cashback|reward|discount)\b|\bconvert\s+(?:now|to|into|your|bill)\b|\bflexi[\s-]*emi\b|\bconvert\s+(?:spends?|bill\s+of)\b|\breward\s+points?\s+eligible\b|\bpre[- ]?approved\b|\bget\s+(?:an?\s+)?(?:instant\s+)?(?:loan|credit)\s+of\b|\bloan\s+of\s+up\s+to\b|\binstant\s+disbursal\b|\busing\s+code\b|\bdownload\s+the\s+\w+\s+app\b|\b(?:credit|card|loan)\s+limit\b[\s\S]{0,80}\b(?:increased|changed|updated|raised|revised)\b|\bincreased\s+(?:from|to)\s+(?:rs\.?|inr|₹)|\b(?:increase|increasing|raise|raising)\s+(?:the\s+)?(?:credit\s+)?limit\b|\b\d{1,3}\s*%\s*off\b|\buse\s+(?:promo\s+)?code\b|https?:\/\/|\breward\s+points?\s+(?:worth|accumulated|earned|balance)\b|\bredeem\s+(?:now|your|points?|rewards?)\b/i;

// EMI conversion NOTICE — an already-booked purchase being restructured into
// instalments ("...purchase of Rs.45,000 ... has been converted to 6 Months EMI").
// The original spend was counted when it happened, so this must NOT book a second
// transaction. Distinct from a real EMI INSTALMENT debit ("EMI of Rs X debited"),
// which has no "converted to … EMI" phrasing and still books normally.
// Also catches setup-confirmation format: "request to convert … into N Months EMI has been set up"
const EMI_CONVERSION_REGEX = /\bconverted?\s+(?:in)?to\b[\s\S]{0,60}\bemi\b|\bto\s+convert\b[\s\S]{0,80}\binto\b[\s\S]{0,30}\bemi\b/i;

// Market rates / FX bulletin from bank treasury desks — NOT a transaction.
// Example: "INR 91.79 (-0.08) GBP 1.3786, EUR 1.1980 ... Brent Crude 67.20 Gold 5270.75 Rgds SBI Glb Mkts"
// Detected by: two or more forex pairs in succession, or commodity + forex combo.
const MARKET_RATES_REGEX =
  /\b(?:gbp|eur|jpy|chf|usd|aud|cad|sgd)\s+[\d.]+[,\s]+(?:gbp|eur|jpy|chf|usd|aud|cad|sgd)\s+[\d.]+\b|\bglb\s*mkts\b|\bglobal\s+market\b/i;

// UPI collect / payment requests — money has NOT moved yet; user must approve.
// Example: "Collect Request of Rs 500 from merchant@upi. Tap to approve."
const COLLECT_REQUEST_REGEX = /\bcollect\s+request\b|\bupi\s+collect\b|\bpayment\s+request\s+of\b/i;

// AutoPay / NACH mandate SETUP confirmations — the mandate was registered, no money moved yet.
// Distinct from an actual mandate EXECUTION ("AutoPay of Rs 500 debited"), which has a debit verb.
// Guard: COMPLETED_TRANSACTION_REGEX (was/has been debited/credited) lets real dual-action messages through.
const MANDATE_SETUP_REGEX = /\b(?:autopay|nach|standing\s+instruction|mandate)\b[\s\S]{0,100}\b(?:created|registered|set\s+up|activated|established)\b/i;

// =============================================================================
// Helpers
// =============================================================================
const includesAny = (text, list) => list.some((k) => text.includes(k));

const toNumber = (str) =>
  str ? parseFloat(str.replace(/,/g, '')) || 0 : 0;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasAnyWord = (text, list) =>
  list.some((word) => new RegExp(`\\b${escapeRegex(word)}\\b`, 'i').test(text));

const normalizeForKeywordScan = (text) =>
  (text || '')
    .toLowerCase()
    .replace(/[\n\r\t]+/g, ' ')
    .replace(/[^a-z0-9@]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const EVENT_PATTERNS = [
  { type: TRANSACTION_TYPES.CREDIT, regex: /\b(?:credited|deposited|refunded|refund|cashback credited|amount credited|received)\b/gi },
  { type: TRANSACTION_TYPES.DEBIT, regex: /\b(?:debited|spent|paid|withdrawn|deducted|auto-debit|autopay|transferred)\b/gi },
];

const NON_TXN_AMOUNT_HINTS = /\b(?:due|min(?:imum)?\s+due|outstanding|avl(?:\.|\s+bal(?:ance)?)?|available\s+balance|closing\s+balance|total\s+due|statement|bal(?:ance)?)\b/i;

const STRONG_TRANSACTION_WORDS = [
  'debit',
  'credit',
  'debited',
  'credited',
  'paid',
  'spent',
  'withdrawn',
  'deducted',
  'transferred',
  'deposited',
  'refund',
  'refunded',
  'received',
  'levied',
];

const extractAmountNearTransactionKeyword = (text) => {
  const amountMatches = [];
  let m;
  while ((m = AMOUNT_REGEX_GLOBAL.exec(text)) !== null) {
    amountMatches.push({
      amount: toNumber(m[1] || m[2]),
      index: m.index,
    });
  }
  AMOUNT_REGEX_GLOBAL.lastIndex = 0;
  if (amountMatches.length === 0) return { amount: 0, reason: 'no_amount_match', keyword: null };

  const eventHits = [];
  EVENT_PATTERNS.forEach(({ regex }) => {
    let hit;
    while ((hit = regex.exec(text)) !== null) {
      eventHits.push({ index: hit.index, keyword: hit[0] });
    }
    regex.lastIndex = 0;
  });

  if (eventHits.length > 0) {
    let best = null;
    eventHits.forEach((ev) => {
      amountMatches.forEach((a) => {
        const distance = Math.abs(a.index - ev.index);
        if (distance > 45) return;
        if (!best || distance < best.distance) {
          best = { amount: a.amount, distance, keyword: ev.keyword };
        }
      });
    });
    if (best?.amount) {
      return {
        amount: best.amount,
        reason: 'nearest_transaction_keyword',
        keyword: best.keyword || null,
      };
    }
  }

  for (const a of amountMatches) {
    const around = text.slice(Math.max(0, a.index - 24), Math.min(text.length, a.index + 24));
    if (!NON_TXN_AMOUNT_HINTS.test(around)) {
      return {
        amount: a.amount,
        reason: 'first_non_due_context_amount',
        keyword: null,
      };
    }
  }
  return {
    amount: amountMatches[0].amount || 0,
    reason: 'fallback_first_amount',
    keyword: null,
  };
};

const NON_FINANCIAL_DLT_KEYS = [
  'vicare',
  'jio',
  'jiocare',
  'airtel',
  'vodafone',
  'idea',
  'viapp',
];

const inferAccountType = (text) => {
  if (/credit\s+card|\bcc\b|c\.c\./i.test(text)) return ACCOUNT_TYPES.CREDIT_CARD;
  // Debit card / ATM: explicit "debit card", or an ATM / cash withdrawal (always
  // a debit/ATM card), or a "Card ending …" reference WITHOUT "credit card".
  // Keeps debit-card spends segregated from generic bank-account ("A/c") debits.
  if (
    /debit\s*card(?!\s+(?:maintenance|annual|issuance|fees?|charges?|renewal))/i.test(text) ||
    /\bdr\s*card\b|\batm\b|cash\s+with(?:drawal|drawn)|\bawcw\b/i.test(text) ||
    /card\s+(?:ending|no\.?|number)\b/i.test(text) ||
    /\bcard\s+[xX*•·]{1,8}\d{3,6}\b/i.test(text)
  ) {
    return ACCOUNT_TYPES.DEBIT_CARD;
  }
  // Bank check BEFORE wallet: "splitwise@paytm" in a UPI credit should not
  // override an explicit "Kotak Bank A/c XX5124" reference in the same SMS.
  if (/a\/c|account|saving|current|bank/i.test(text)) return ACCOUNT_TYPES.BANK;
  if (/wallet|paytm|phonepe|gpay|google\s*pay|amazon\s*pay/i.test(text))
    return ACCOUNT_TYPES.WALLET;
  return ACCOUNT_TYPES.BANK;
};

/**
 * Sender check — true if sender ID belongs to a bank or payment wallet.
 * Blocks DLT promotional-prefix senders (VM-*, DM-*) unconditionally.
 */
const isBankOrWalletSender = (sender) => {
  if (!sender) return false;
  const s = sender.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(s)) return false; // pure phone number
  return BANK_WALLET_SENDER_KEYS.some((k) => s.includes(k));
};

const isLikelyNonFinancialDltSender = (sender) => {
  if (!sender) return false;
  const raw = sender.trim();
  const dltMatch = raw.match(/^[A-Za-z]{2}-([A-Za-z0-9]+)-[A-Za-z]$/);
  if (!dltMatch?.[1]) return false;
  const entity = dltMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
  return NON_FINANCIAL_DLT_KEYS.some((k) => entity.includes(k));
};

export const categorise = (text) => {
  const lower = ` ${(text || '').toLowerCase()} `;
  for (const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return catId;
  }
  return null;
};

// =============================================================================
// Main parser
// =============================================================================
/**
 * @param {string} message  raw SMS body
 * @param {object} [opts]   { sender, receivedAt, smsId }
 * @returns {object|null}   parsed transaction or null
 */
export const parseMessage = (message, opts = {}) => {
  const result = parseMessageDetailed(message, opts);
  return result.ok ? result.transaction : null;
};

/**
 * Same parser as parseMessage(), but with explicit failure reason.
 * @returns {{ok: true, transaction: object} | {ok: false, error: {code: string, message: string}}}
 */
export const parseMessageDetailed = (message, opts = {}) => {
  if (!message || typeof message !== 'string') {
    return {
      ok: false,
      error: { code: 'invalid_message', message: 'Message is missing or invalid.' },
    };
  }
  const text = message.trim();
  if (!text) {
    return {
      ok: false,
      error: { code: 'empty_message', message: 'Message is empty.' },
    };
  }
  const lower = text.toLowerCase();
  const normalized = normalizeForKeywordScan(text);

  // ── Gate 1: Source validation ─────────────────────────────────────────────
  // Reject non-financial senders before any CC-specific pattern checks.
  // This prevents Airtel / Jio / utility SMSes from being misclassified as
  // credit-card events (e.g. "bill due on 15" matching CC_BILL_REMINDER_REGEX).
  const senderOk = isBankOrWalletSender(opts.sender);
  const bodyHasAccountRef =
    ACCOUNT_REF_REGEX.test(text) &&
    hasAnyWord(normalized, BODY_DEBIT_CREDIT_TERMS);
  const strongKeywordSignal = hasAnyWord(normalized, STRONG_TRANSACTION_WORDS);
  const nonFinancialDlt = isLikelyNonFinancialDltSender(opts.sender);

  if (!senderOk && (!bodyHasAccountRef || !strongKeywordSignal || nonFinancialDlt)) {
    return {
      ok: false,
      error: {
        code: 'source_not_financial',
        message:
          'Could not verify this as a financial SMS (no known bank sender or account/payment reference).',
      },
    };
  }

  // ── Non-transaction early exits (bank-sender confirmed above) ───────────────

  // Promotional / EMI-conversion / upsell messages.
  // Guard: if a completed past-tense transaction verb is present ("has been credited/
  // disbursed/…") the message is a real disbursement, not a sales pitch — skip the
  // filter so pre-approved loan disbursals aren't swallowed.
  if (PROMOTIONAL_OFFER_REGEX.test(text) && !COMPLETED_TRANSACTION_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'promotional_offer',
        message: 'Promotional or EMI-conversion offer detected — not a transaction.',
      },
    };
  }

  // EMI conversion notice — original purchase already booked; don't double-count.
  if (EMI_CONVERSION_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'emi_conversion',
        message: 'EMI conversion of an existing purchase — not a new transaction.',
      },
    };
  }

  // FX / market-rates bulletins (SBI Glb Mkts, treasury desk broadcasts).
  // Multiple forex pairs (GBP x.xx, EUR x.xx …) or commodity prices in one message.
  if (MARKET_RATES_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'market_rates_bulletin',
        message: 'Market rates / FX bulletin detected — not a transaction.',
      },
    };
  }

  // UPI collect / payment requests — approval prompt, money has not moved yet.
  if (COLLECT_REQUEST_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'upi_collect_request',
        message: 'UPI collect/payment request detected — not a completed transaction.',
      },
    };
  }

  // Mandate setup confirmations — mandate registered, no money has moved.
  if (MANDATE_SETUP_REGEX.test(text) && !COMPLETED_TRANSACTION_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'mandate_setup',
        message: 'AutoPay/NACH mandate creation confirmation — not an actual debit.',
      },
    };
  }

  // ── CC-specific early exits (bank-sender verified above) ──────────────────

  // Exclude card payment acknowledgement SMSes. The actual outgoing spend is
  // already captured from the source account debit message.
  // We still extract amount + mask so the store can credit the CC account balance.
  if (CC_PAYMENT_NOTIFICATION_REGEX.test(text)) {
    const amtMatch  = text.match(AMOUNT_REGEX);
    const paidAmt   = toNumber(amtMatch?.[1] || amtMatch?.[2]);
    const acctMatch = text.match(ACCOUNT_REGEX);
    const rawMask   = acctMatch?.[1]?.replace(/[x*·•]/gi, '') || null;
    return {
      ok: false,
      error: {
        code: 'credit_card_payment_notification',
        message:
          'Credit-card payment acknowledgement detected (notification only), so it was skipped.',
      },
      ccPayment: paidAmt > 0
        ? { amount: paidAmt, accountMask: rawMask ? rawMask.slice(-4) : null, bankName: getBankName(opts.sender) }
        : null,
    };
  }

  // Credit-card bill REMINDER — money has not moved yet. We must NOT register
  // it as a transaction (the old logic mis-classified these as debits because
  // "Credit Card" leaks the word "credit" into Gate 2). Return the parsed
  // reminder fields so the store can anchor an in-app notification on the
  // matching card.
  // Future-tense forms like "will be debited" don't count as hard confirmation
  // since the transaction hasn't occurred yet.
  const isFutureTense = /will\s+be\s+(?:debited|credited|deducted|withdrawn|transferred)|(?:is\s+)?scheduled\s+(?:for\s+(?:auto[\s-]?debit|debit|payment)|tomorrow|today|on\b)|is\s+due\s+for\s+(?:auto[\s-]?debit|payment)/i.test(text);
  if (
    CC_BILL_REMINDER_REGEX.test(text) &&
    (!CC_BILL_HARD_CONFIRMATION_REGEX.test(text) || isFutureTense) &&
    /\bcredit\s+card\b/i.test(text)
  ) {
    const amtMatch  = text.match(AMOUNT_REGEX);
    const dueAmt    = toNumber(amtMatch?.[1] || amtMatch?.[2]);
    const cardMatch = text.match(CC_CARD_LAST4_REGEX);
    const cardLast4 = cardMatch?.[1] || cardMatch?.[2] || null;
    const dateMatch = text.match(CC_DUE_DATE_REGEX);
    const dueDate   = dateMatch?.[1] || null;
    return {
      ok: false,
      error: {
        code: 'cc_bill_reminder',
        message:
          'Credit-card bill reminder detected (amount due / pay by …), so it was not added as a spend.',
      },
      ccDue: dueAmt > 0
        ? { amount: dueAmt, cardLast4, dueDate, bankName: getBankName(opts.sender) }
        : null,
    };
  }

  // Future / scheduled debit — money has NOT moved yet (e.g. loan EMI "scheduled
  // for auto-debit on 05-Jun", or "will be debited"). Catches the NON-credit-card
  // forms that the CC_BILL_REMINDER branch above (which requires "credit card")
  // does not cover. We surface the amount/mask so the store can anchor a reminder.
  //
  // Backward-compat guard: only fire when the message is PURELY future — i.e.
  // after stripping the future clauses, no completed past-tense verb remains.
  // This protects mixed messages like "Rs 500 debited … Rs 10 will be credited",
  // where a real transaction already happened and must still be booked.
  const textSansFuture = text.replace(
    /\b(?:will\s+be\s+(?:debited|credited|deducted|withdrawn|transferred)|(?:is\s+)?scheduled\s+(?:for\s+(?:auto[\s-]?debit|debit|payment)|tomorrow|today|on)|is\s+due\s+for\s+(?:auto[\s-]?debit|payment))\b/gi,
    ' ',
  );
  const hasCompletedVerb =
    /\b(?:debited|credited|deposited|withdrawn|deducted|refunded|spent)\b/i.test(textSansFuture);
  if (isFutureTense && !hasCompletedVerb) {
    const amtMatch  = text.match(AMOUNT_REGEX);
    const dueAmt    = toNumber(amtMatch?.[1] || amtMatch?.[2]);
    const acctMatch = text.match(ACCOUNT_REGEX);
    const rawMask   = acctMatch?.[1]?.replace(/[x*·•]/gi, '') || null;
    return {
      ok: false,
      error: {
        code: 'future_scheduled_debit',
        message:
          'Scheduled / future debit detected (not yet executed), so it was not added as a spend.',
      },
      scheduledDebit: dueAmt > 0
        ? { amount: dueAmt, accountMask: rawMask ? rawMask.slice(-4) : null, bankName: getBankName(opts.sender) }
        : null,
    };
  }

  // Outgoing CC bill payment from source bank account — money leaving the user's
  // savings/bank account to pay a credit card bill. This is a liability
  // settlement, NOT an expense: individual CC spends were already counted when
  // each purchase was made. Suppressing this prevents double-counting.
  // Requires a past-tense verb to guard against forward-looking reminders.
  if (
    CC_PAYMENT_OUTGOING_REGEX.test(text) &&
    CC_BILL_HARD_CONFIRMATION_REGEX.test(text)
  ) {
    const amtMatch  = text.match(AMOUNT_REGEX);
    const outAmt    = toNumber(amtMatch?.[1] || amtMatch?.[2]);
    const acctMatch = text.match(ACCOUNT_REGEX);
    const rawMask   = acctMatch?.[1]?.replace(/[x*·•]/gi, '') || null;
    return {
      ok: false,
      error: {
        code: 'cc_payment_outgoing',
        message:
          'Outgoing credit-card bill payment detected (liability settlement, not an expense), so it was not added to the spend ledger.',
      },
      ccOutgoing: outAmt > 0
        ? { amount: outAmt, accountMask: rawMask ? rawMask.slice(-4) : null, bankName: getBankName(opts.sender) }
        : null,
    };
  }

  // ── Gate 2: Mandatory transaction phrase ──────────────────────────────────
  // Must contain a concrete past-tense financial phrase.
  const phraseHit = includesAny(lower, TRANSACTION_PHRASES) || hasAnyWord(normalized, TRANSACTION_PHRASES);
  // Only past-tense / action forms accepted here.
  // "debit" and "credit" (bare nouns, as in "debit card" / "credit card") are
  // intentionally excluded — they produced false positives for promotional SMSes.
  const fallbackTxnWordHit =
    /\b(?:debited|credited|spent|paid|withdrawn|deducted|transferred|deposited|refunded|received|levied)\b/i.test(normalized);
  if (!phraseHit && !fallbackTxnWordHit) {
    return {
      ok: false,
      error: {
        code: 'missing_transaction_keyword',
        message:
          'No transaction keyword found (expected words like debited, credited, paid, spent, transferred).',
      },
    };
  }

  // ── Gate 3: Monetary amount ───────────────────────────────────────────────
  const amountMatch = text.match(AMOUNT_REGEX);
  const amountPick = extractAmountNearTransactionKeyword(text);
  const amount = amountPick.amount || toNumber(amountMatch?.[1] || amountMatch?.[2]);
  if (!amount) {
    return {
      ok: false,
      error: {
        code: 'amount_not_found',
        message: 'Amount not found. Expected formats like Rs.450, ₹450, INR 450.',
      },
    };
  }

  // ── Extract: debit vs credit ──────────────────────────────────────────────
  // Check for "credited to beneficiary" or "debited from beneficiary" patterns.
  // These indicate money moved for the OTHER party, so it's the opposite direction
  // from the user's perspective.
  const creditedToOther = /credited\s+to\s+(?:the\s+|a\s+)?(?:beneficiary|your\s+(?:beneficiary|account))/i.test(text);
  const debitedFromOther = /debited\s+from\s+beneficiary/i.test(text);

  // Direction is read from `textSansFuture` (future clauses stripped) so a
  // forward-looking aside like "Cashback … will be credited" can't flip a
  // completed debit into a credit.
  // When "debited … from your" appears (e.g. RD installment "debited Rs.5k from your
  // savings A/c"), treat as DEBIT even if "credited" also appears (dual-leg phrasing).
  const debitedFromThisAccount = /\bdebited\b[\s\S]{0,50}from\s+your\b/i.test(textSansFuture);
  const isCredit =
    debitedFromThisAccount
      ? false
      : creditedToOther
        ? false // "credited to beneficiary" = user sent money = DEBIT
        : debitedFromOther
          ? true // "debited from beneficiary" = user received money = CREDIT
          : /credited|deposited|refunded|refund|received(?:\s+(?:in|to|from|by))?|\breceived\b|salary credited|cashback credited|amount credited|transferred\s+to\s+your\b|\bmoney\s+in\b|\bprocessed\s+into\b/i.test(textSansFuture);
  const accountType = inferAccountType(`${opts.sender || ''} ${text}`);
  const defaultType = isCredit ? TRANSACTION_TYPES.CREDIT : TRANSACTION_TYPES.DEBIT;
  const note = text.length > 120 ? text.slice(0, 117) + '…' : text;

  // ── Extract: merchant ─────────────────────────────────────────────────────
  let merchant =
    text.match(BENEFICIARY_CREDITED_REGEX)?.[1]?.trim() ||
    text.match(VPA_REGEX)?.[1] ||
    text.match(MERCHANT_REGEX)?.[1]?.trim() ||
    null;

  if (merchant) {
    merchant = merchant
      .replace(MERCHANT_STOP, '')
      .replace(/\.\s+\S.*$/g, '')   // stop at "period + space" — prevents bleeding past sentence end
      .replace(/^\d+\.\s*/g, '')    // strip NEFT/IMPS batch prefix e.g. "11." before sender name
      .replace(/^(?:upi|imps|neft|rtgs|ach|nft)[-\s]*\d+[-\s]*/i, '') // strip rail+ref prefix e.g. "UPI-755012995968-" → payee
      .replace(/[.,;:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    // Discard pure-numeric captures — phone / ref numbers are never a merchant
    // (e.g. dispute footer "...SMS BLOCK 171 to 9215676766" → falls back to sender).
    if (/^\d{4,}$/.test(merchant)) merchant = null;
  }

  // Fallback merchant: cleaned-up sender ID
  if (!merchant && opts.sender) {
    const cleaned = opts.sender
      .replace(/^[+\d\-]+$/, '')
      .replace(/[-_]/g, ' ')
      .trim();
    if (cleaned) merchant = cleaned.slice(0, 40);
  }

  // ── Normal single-leg parse ───────────────────────────────────────────────
  const firstEvent = text.match(FIRST_ACCOUNT_EVENT_REGEX);
  const acctMatch = text.match(ACCOUNT_REGEX);
  const accountMask = firstEvent?.[1] || acctMatch?.[1] || null;
  const firstVerb = (firstEvent?.[2] || '').toLowerCase();
  const inferredTypeFromFirstVerb =
    creditedToOther || debitedFromOther
      ? creditedToOther ? TRANSACTION_TYPES.DEBIT : TRANSACTION_TYPES.CREDIT
      : firstVerb && /credited|deposited|refunded|refund|received/.test(firstVerb)
        ? TRANSACTION_TYPES.CREDIT
        : firstVerb
          ? TRANSACTION_TYPES.DEBIT
          : defaultType;
  const categoryId = categorise(`${merchant || ''} ${text}`) || 'other';

  // ── Self-transfer signals ─────────────────────────────────────────────────
  // Surfaced raw — the store decides (against the user's accounts / phones)
  // whether this is actually a transfer between the user's own accounts.
  const allMasks = [];
  let mm;
  while ((mm = ACCOUNT_MASK_GLOBAL.exec(text)) !== null) {
    if (mm[1]) allMasks.push(mm[1]);
  }
  ACCOUNT_MASK_GLOBAL.lastIndex = 0;
  const distinctMasks = [...new Set(allMasks)];

  // Dual-leg: one SMS reporting both a debit and a credit across ≥2 accounts.
  const hasDebitEvt  = /\bdebited\b/i.test(text);
  const hasCreditEvt = /\bcredited\b/i.test(text);
  const selfDualLeg  = distinctMasks.length >= 2 && hasDebitEvt && hasCreditEvt;

  // The "other" account mask in a dual-leg message (the counterparty leg).
  const counterpartyMask = selfDualLeg
    ? (distinctMasks.find((m) => m !== accountMask) || null)
    : null;

  // Counterparty mobile — trailing digit run of the captured (masked) token.
  // Banks mask all but the last 3-4 digits, so accept a run of ≥3 here; the
  // store still requires ≥4 shared digits to MATCH a user phone (this just
  // surfaces whatever is visible).
  const phoneToken = text.match(COUNTERPARTY_PHONE_REGEX)?.[1] || '';
  const counterpartyPhone = (phoneToken.match(/(\d{3,})\s*$/)?.[1]) || null;

  // Counterparty name (e.g. "…-PRAVEEN VE") — lets the store flag a self
  // transfer to the user's own number even when the phone is fully masked.
  const counterpartyName = text.match(COUNTERPARTY_NAME_REGEX)?.[1]?.trim() || null;

  // Shared transfer reference — links the two legs of one transfer reported by
  // the sending and receiving banks (see propagateSelfByRef in the store).
  const transferRef = text.match(TRANSFER_REF_REGEX)?.[1] || null;

  const single = buildTransaction({
    amount,
    type: inferredTypeFromFirstVerb,
    accountType,
    accountMask,
    bankName: getBankName(opts.sender),
    merchant: merchant || (inferredTypeFromFirstVerb === TRANSACTION_TYPES.CREDIT ? 'Income' : 'Expense'),
    categoryId,
    note,
    createdAt: opts.receivedAt,
    counterpartyMask,
    counterpartyPhone,
    counterpartyName,
    transferRef,
    selfDualLeg,
  });

  return {
    ok: true,
    transaction: single,
    transactions: [single],
    debug: {
      pickedAmount: amount,
      amountReason: amountPick.reason,
      amountKeyword: amountPick.keyword,
      firstActionVerb: firstVerb || null,
      inferredType: inferredTypeFromFirstVerb,
    },
  };
};

function buildTransaction({
  amount,
  type,
  accountType,
  accountMask,
  bankName,
  merchant,
  categoryId,
  note,
  createdAt,
  counterpartyMask = null,
  counterpartyPhone = null,
  counterpartyName = null,
  transferRef = null,
  selfDualLeg = false,
}) {
  return {
    id:          `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount,
    type,
    accountType,
    accountMask,
    bankName:    bankName || null,
    merchant,
    categoryId,
    note,
    source:      'sms',
    isSplit:     false,
    splitWith:   [],
    createdAt:   createdAt || new Date().toISOString(),
    // Self-transfer detection hints (resolved against user accounts/phones/name in store).
    counterpartyMask,
    counterpartyPhone,
    counterpartyName,
    transferRef,
    selfDualLeg,
  };
}

// =============================================================================
// Sample messages (for diagnostic screen / testing only)
// =============================================================================
export const SAMPLE_MESSAGES = [
  'Rs.450.00 debited from A/c xx1234 on 06-May-26 to SWIGGY via UPI. Avl bal Rs.42,310.50',
  'INR 1,299 spent on HDFC Credit Card ending 4321 at AMAZON on 05-May-26.',
  'Your a/c xxxx5678 is credited with Rs.55,000.00 - SALARY MAY 2026.',
  'Rs.1.00 credited to a/c *9532 on 09/05/2026 by a/c linked to VPA pranzul1@ibl (UPI Ref no 597700275328).Indian Bank',
  'ICICI Bank Acct XX171 debited with Rs 50,000.00 on 30-Apr-26 & Acct XX532 credited.IMPS:612020852223.',
  'Paytm Wallet: Rs 120 paid to UBER. Available balance: Rs 480.',
  'Rs.2,499 debited from A/c xx9012 to NETFLIX on 03-May. UPI Ref 4421.',
  '₹350 paid to bigbasket@upi via UPI from your account xx1234.',
  'Rs.180 debited via UPI to ola@paytm. A/c xx1234. Ref 998877.',
  // Beneficiary-direction transactions (opposite of normal direction)
  'Your NEFT txn with ref. no. AXOIR15200939340 for INR 101.00 is credited to beneficiary PRAVEEN KUMAR DWIVEDI on 01-06-26. Axis Bank',
  'Rs 2,500 is credited to beneficiary account. NEFT reference: 12345. Please acknowledge.',
  // Credit card bill reminders (future-tense "will be debited" — not actual transactions)
  'INR 74511.67 is due for payment on 04-06-26 towards Axis Bank CC no. XX6828. INR 74511.67 will be debited from Axis Bank A/c no. XX2655 via auto debit.',
  // Bare imperative/statement form "Debit" (not "Debited")
  'Debit INR 38000.00\nAxis Bank A/c XX2655\n02-06-26 11:52:35\nIMPS/P2A/615311412942/PRAV\nWhatsApp BAL to 917036165000\nNot You? SMS BLOCKALL CustID to 919951860002',
  // Amount extraction: should pick transaction amount, not final balance
  'Card ending x3733 used at ATM SHYAM NAGAR KAN on 10/04/2026 21:02 for txn Rs 10000.00 Bal Rs 84354.25. If not you?',
  // Self transfer between own accounts — dual-leg (sender bank) + counterparty-phone (receiver bank)
  'ICICI Bank Acct XX171 debited with Rs 60,000.00 on 03-Jun-26 & Acct XX532 credited.IMPS:615423432006. Call 18002662 for dispute or SMS BLOCK 171 to 9215676766',
  'Your a/c. XXXX9532 is credited by Rs. 60000.00 on 03-06-26 by a/c linked to mobile 9XXXXXX33221 (IMPS Ref no. 615423432006). -IndianBank',
];

export const buildSampleTransactions = () =>
  SAMPLE_MESSAGES.map((m) =>
    parseMessage(m, { sender: 'HDFCBK' })
  ).filter(Boolean);
