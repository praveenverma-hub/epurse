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
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';

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
  /(?:a\/c|acct\.?|account|card\s+ending|card\s+no\.?|card)\s*[xX*•·]{0,8}\d{3,}/i;

const BODY_DEBIT_CREDIT_TERMS = [
  'debit', 'credit', 'paid', 'payment', 'transfer', 'withdraw',
  'deposit', 'debited', 'credited', 'withdrawn', 'transferred',
  'spent', 'sent', 'charged',
];

// Wallet SMS carry NO a/c mask, so when the DLT sender header isn't recognised they'd
// fail Gate-1. An explicit wallet-brand phrase in the BODY (+ a debit/credit term) is a
// reliable financial signal for them. e.g. "paid using Amazon Pay balance", "debited from
// Mobikwik wallet", "via Ola Money", "via CRED".
const WALLET_BODY_REGEX =
  /\b(?:wallet|amazon\s*pay|paytm(?:\s+balance)?|phonepe|mobikwik|freecharge|ola\s*money|cred|payzapp|jupiter\s+edge|slice|lazypay|simpl)\b/i;

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
  'paid to', 'paid via', 'paid at', 'paid from', 'amount paid', 'payment to',
  // Compact UPI rail forms with no verb: "UPI/DR/<ref>/PAYEE/Rs.X", "UPI Cr Rs.X".
  'upi/dr', 'upi/cr', 'upi-dr', 'upi-cr', 'upi dr', 'upi cr',
  'sent to', 'sent via', 'sent from',  // "Transfer: Rs.X sent from your A/c to <payee>"
  'sent rs', 'sent inr', 'sent ₹',  // "Sent Rs.3082.00\nFrom HDFC Bank A/C *5960\nTo MERCHANT" (HDFC UPI)
  'money sent',           // "Money Sent: Rs.60.00 to MERCHANT"
  'transferred to', 'transferred from', 'transfer of',
  'payment of', 'payment for',
  'purchase at', 'purchase of', 'spent at', 'spent on',
  'charged on', 'charged at',  // "INR 2,150.00 charged on Axis Card xx1002"
  // "Txn Rs.305.00 On HDFC Bank Card 8077 At merchant@upi by UPI …" — no debit verb, just "Txn"
  'txn',
  // "…has been processed for a transaction of Rs.X at MERCHANT" (card usage, no -ed verb)
  'transaction of', 'transaction at',
  // Card usage / ATM cash withdrawal ("Card ending 1234 used at ATM/merchant")
  'used at', 'used for', 'cash withdrawal', 'cash withdrawn', 'withdrawal at', 'atm cash',
  // "Thank you for using <Bank> Card for INR X at MERCHANT" (plain "Card", no debit/credit word)
  'for using',
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
  // Rail abbreviations: "NEFT Cr of Rs.X", "IMPS Dr Rs.X", "RTGS Cr Rs.X",
  // "IMPS of Rs.X to <payee> successful" — banks often omit the -ed verb.
  'neft cr', 'neft dr', 'neft of', 'imps cr', 'imps dr', 'imps of',
  'rtgs cr', 'rtgs dr', 'rtgs of',
  // Reversal / refund confirmations. "returned to your a/c" and "credited back" are
  // scoped to "…your account/card" so they can't fire on "I returned the item".
  'reversed to', 'amount reversed', 'transaction reversed', 'reversal credited',
  'returned to your', 'credited back',
  // Bank charges / penalties (no debit verb — only "levied on" or "penalty of")
  'levied on', 'levied', 'penalty of', 'charge levied',
  // Top-ups have no debit/credit verb at all: "Rs.2000 added to your Paytm Wallet from
  // A/c XX4412", "Your FASTag linked to A/c XX5521 has been recharged with Rs.500".
  // Both are real money movements that were being dropped as missing_transaction_keyword.
  // 'added to your' is scoped (not bare 'added') so it can't fire on "added to your
  // rewards/watchlist"; 'recharged with' likewise needs the amount-bearing form.
  'added to your', 'recharged with', 'recharge of', 'topped up', 'top-up of',
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
  /(?:a\/c|\bac\b|acct?|account|card|\bcc\b)(?:\s+ending)?\.?\s*(?:no\.?\s*)?[xX*•·]{0,8}\s*([xX*•·]*\d{3,6})/i;

// Two branches, because bank SMS use BOTH orderings for "which account, which
// verb" and neither is rare: "A/c XX171 debited..." (mask-then-verb — the only
// shape this regex used to catch) and "debited from A/c XX4021..." (verb-then-
// mask — the DOMINANT shape everywhere else in this file's own test fixtures).
// A message missing verb-then-mask entirely isn't a corner case: it's the
// common phrasing, and a message containing BOTH a debit and a credit verb
// (a same-SMS self-transfer) with neither leg in mask-then-verb order used to
// leave `firstVerb` empty, silently falling back to a whole-text keyword scan
// that always resolves CREDIT (the text necessarily contains "credited"
// somewhere) — reversing which of the two accounts was actually debited.
// `.match()` returns the leftmost successful branch, so ordinary single-leg
// messages are unaffected either way.
const FIRST_ACCOUNT_EVENT_REGEX =
  /(?:a\/c|acct?\.?|account)\s*[xX*•·]{0,8}(\d{3,6})\s+(debited|credited|deposited|withdrawn|deducted|refunded|received)\b|(debited|credited|deposited|withdrawn|deducted|refunded|received)\s+(?:from|to|in|on)?\s*(?:a\/c|acct?\.?|account)\s*[xX*•·]{0,8}(\d{3,6})/i;

// Every masked account/card number in the body (global). Used for self-transfer
// detection: a single SMS that references two accounts (e.g. "Acct XX171 debited
// … & Acct XX532 credited") may be a transfer between the user's own accounts.
const ACCOUNT_MASK_GLOBAL =
  /(?:a\/c|acct\.?|account)\.?\s*(?:no\.?)?\s*[xX*•·]{0,8}\s*(\d{3,6})/ig;

// Every masked CARD number in the body (global). ACCOUNT_MASK_GLOBAL only catches
// a/c-style refs, so this complements it for the debit-card↔bank co-reference
// (e.g. "Debit Card xx1234 … A/c xx5678" — we need BOTH masks to pair them).
const CARD_MASK_GLOBAL =
  /card(?:\s+(?:no\.?|number|ending|ent))?\.?\s*[xX*•·]{0,8}\s*(\d{3,6})/ig;

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

// Merchant after "to", "at", "@", "from", "by", "for", "toward(s)" — lazy, stops at stop
// words. Negative lookahead blocks currency captures (Rs.xxx / INR xxx / ₹xxx) right
// after anchor, and "to/by mobile <digits>" — "a/c linked to mobile 9XXXXXX13245" is a
// P2P/self-transfer routing description (the counterparty's masked phone), never a real
// merchant name. `towards?` (not just `towards`) — SIP/NACH SMS commonly use the singular
// "toward" ("via NACH toward PARAG PARIKH FLEXI CAP FUND"), which this anchor missed
// entirely before, falling through to the bank sender as the "merchant". `against` and
// `subscription` in the stop-word list for the same reason: NACH mandate SMS phrase the
// payee as "initiated by GROWW-STOCKS against your account", and autopay SMS as "for
// Apple One Premium Bundle annual subscription" — both closed off the capture before the
// bare word-count cap could kick in, so it matched null and fell back to the sender.
const MERCHANT_REGEX =
  /(?:towards?|to|at|@|from|by|for)\s+(?!(?:rs\.?|inr|₹)\s*\d|mobile\s+[0-9x]{2,})([A-Za-z0-9][A-Za-z0-9&._\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9&._\-]*){0,4}?)(?=\s+(?:on|via|ref|rrn|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by|has|is|was|div|id|mandate|using|not|against|subscription)\b|\s+from\s+(?:a\/c|acct\.?|account|your)\b|\s+to\s+your\b|\s*\.|\s*,|;|\s*[(+]|\/(?![A-Za-z])|$)/i;

const MERCHANT_STOP =
  /\s+(?:(?:on|via|ref|rrn|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by|has|is|was|div|id|mandate|using|not|against|subscription)\b|from\s+(?:a\/c|acct\.?|account|your)\b).*$/i;

// A period glued directly to a stop keyword or a ref/balance number-run (no space),
// e.g. "REEMA KUMARI.RRN 853904840357.Avl Bal" → cut at ".RRN". The merchant char
// class allows '.', so these would otherwise stay glued into the captured token.
const MERCHANT_PERIOD_STOP =
  /\.(?:rrn|avl|bal|ref|utr|upi|txn|info|neft|imps|rtgs|dt|not|\d)[\s\S]*$/i;

// UPI VPA: someone@bank
const VPA_REGEX = /([a-zA-Z0-9._\-]{2,30}@[a-zA-Z]{2,15})/;

// NEFT / IMPS / RTGS remitter (or payee) name, buried in the reference string with
// NO "to/from" anchor. Format: rail + optional Cr/Dr/P2A + an alphanumeric ref
// (must contain a digit) + delimiter + the NAME (letters only, may be truncated).
// e.g. "Info NEFT-AXISP00802935830-MOONSH." → "MOONSH", "IMPS/P2A/615.../JOHN DOE" → "JOHN DOE".
// Used only as a fallback (after the anchored MERCHANT_REGEX) so it can't override a
// real "to MERCHANT" capture; keeps NEFT credits from leaking the bank sender as merchant.
const NEFT_REMITTER_REGEX =
  /\b(?:neft|imps|rtgs|ach)\b[\s:\/-]*(?:cr|dr|p2a|p2p|inward|outward)?[\s:\/-]*[a-z]*\d[a-z0-9]*[\s:\/-]+([a-z][a-z .&]{1,29}?)(?=\s*(?:[-\/.,;:]|available|avl|info|ref|utr|$))/i;

// BillPay / BBPS biller: "<Biller> Bill <ref> of Rs.X paid … from <account>". The biller
// is the sentence SUBJECT before "Bill", not the "from <account>" payment source that the
// generic MERCHANT_REGEX would otherwise grab. Skips a leading "Bill Paid!" header, then
// captures the biller up to " Bill ", requiring a nearby "paid" so it only fires on this
// bill-payment shape. e.g. "Bill Paid! SBI Life Bill 2x430… paid … from HDFC…" → "SBI Life".
const BILLPAY_MERCHANT_REGEX =
  /(?:bill\s+paid[!:.]?\s*)?([A-Za-z][A-Za-z0-9&.\- ]{1,39}?)\s+bill\b[\s\S]{0,45}\bpaid\b/i;

// Payment acknowledgements for credit cards (not new spend/income transactions).
const CC_PAYMENT_NOTIFICATION_REGEX =
  /\bpayment\s+of\s+(?:inr|rs\.?|₹)\s*[0-9,]+(?:\.[0-9]{1,2})?[\s\S]{0,80}(?:(?:has\s+been\s+)?received\s+on\s+your\b[\s\S]*\bcredit\s+card\b|(?:was\s+)?credited\s+to\s+your\s+card\b|received\s+towards\s+[\w\s]{0,30}credit\s+card\b)/i;

// Credit-card bill REMINDER (pre-payment alert) — NOT a spend.
// Banks send these monthly to nudge the user to pay their CC bill.
// Verbs/phrases that anchor a reminder: amount/total/min/payment due,
// due date/on/by, outstanding (amount/balance/due), pay (instantly) by <date>,
// pay your bill/credit card, kindly/please pay, settle by/your/outstanding,
// bill/statement generated.
const CC_BILL_REMINDER_REGEX =
  /\b(?:(?:total|min(?:imum)?|amt|amount|payment|payable)\s+(?:amount\s+)?due(?:s)?|due\s*[:\s]\s*\d+|due\s+(?:date|on|by)\s+\d+|outstanding(?:\s+(?:amount|balance|due))?|pay(?:able)?\s+(?:instantly\s+)?by\s+\d+|pay\s+your\s+(?:[\w]+\s+){0,3}?(?:bill|credit\s+card)|kindly\s+pay|please\s+pay|settle\s+(?:by|your|outstanding)|bill\s+generated|statement\s+(?:generated|is\s+sent))\b/i;

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
// The separator is `\s*:?\s*-?\s*`, not `\s+`: banks write "Payment due date:
// 07-Jun-26" and "Min due date :- 09-Jul-26" far more often than the bare
// "due date 07-Jun-26" this used to require, so the date was being dropped on the
// most common phrasing of all. That failed SILENTLY — the CC-due notification just
// fell back to "Pay before the due date" and no reminder was scheduled, which is
// why it went unnoticed until the date had to be stored and shown. A dateless
// "due date soon" still matches nothing.
const CC_DUE_DATE_REGEX =
  /\b(?:pay\s+(?:instantly\s+)?by|due\s+(?:date|on|by))\s*:?\s*-?\s*(\d{1,2}[\/\-\s][A-Za-z]{3,9}[\/\-\s]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;

// Pull the STATEMENT/cycle-close date from a CC reminder body — a real, already-seen
// phrasing is "Total Amount Due ... for statement dt 20-May-26 is ..." (SBI). Distinct
// from CC_DUE_DATE_REGEX (the PAYMENT deadline): this is when the billing cycle itself
// closed, which is what lets the app learn a card's recurring cycle day rather than
// only ever reacting to a bill that already arrived. Same date-shape alternation as
// CC_DUE_DATE_REGEX. A statement mentioning only a month ("statement for Jul-26 is
// generated", no day) intentionally does NOT match here — a month alone can't give a
// day-of-month, and the anchor for THAT phrasing lives in CC_BILL_REMINDER_REGEX only.
const CC_STATEMENT_DATE_REGEX =
  /\bstatement\s+(?:dt|dated|date|generated\s+on|as\s+of)\s*:?\s*-?\s*(\d{1,2}[\/\-\s][A-Za-z]{3,9}[\/\-\s]\d{2,4}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;

// Outgoing CC bill payment from source bank account (not an expense — it's a
// liability settlement). Patterns: "towards [bank] credit card", "credit card
// bill payment successful", "paid to [bank] credit card".
// Requires a debit verb (CC_BILL_HARD_CONFIRMATION_REGEX) to fire alongside.
// NOTE: only HIGH-CONFIDENCE wording auto-fires here — explicit "credit card" /
// "cc bill". Ambiguous channels like CRED (also used for rent/shopping) are left as
// normal debits so real expenses aren't hidden; the user reclassifies those by hand
// ('cc_bill' via markAsCCBillPayment).
const CC_PAYMENT_OUTGOING_REGEX =
  /\btowards\s+(?:[\w]+\s+)?credit\s+card\b|\bcredit\s+card\s+(?:bill\s+)?(?:payment|dues?)\s+(?:successful|done|completed|processed|cleared)\b|\bpaid\s+(?:to|towards)\s+(?:[\w]+\s+)?credit\s+card\b|\bcredit\s+card\s+bill\s+payment\b|\bcc\s+bill(?:\s+pay(?:ment)?)?\b/i;

// Promotional / upsell messages from banks (EMI offers, reward conversions).
// These contain an amount (the "eligible spend") but no actual transaction happened.
// Examples: "spends of INR 8497 are eligible for FLEXI EMI conversion"
const PROMOTIONAL_OFFER_REGEX =
  /\beligible\s+for\s+(?:emi|flexi|conversion|offer|cashback|reward|discount)\b|\bconvert\s+(?:now|to|into|your|bill)\b|\bflexi[\s-]*emi\b|\bconvert\s+(?:spends?|bill\s+of)\b|\breward\s+points?\s+eligible\b|\bpre[- ]?approved\b|\bget\s+(?:an?\s+)?(?:instant\s+)?(?:loan|credit)\s+of\b|\bloan\s+of\s+up\s+to\b|\binstant\s+disbursal\b|\busing\s+code\b|\bdownload\s+the\s+\w+\s+app\b|\b(?:credit|card|loan)\s+limit\b[\s\S]{0,80}\b(?:increased|changed|updated|raised|revised)\b|\bincreased\s+(?:from|to)\s+(?:rs\.?|inr|₹)|\b(?:increase|increasing|raise|raising)\s+(?:the\s+)?(?:credit\s+)?limit\b|\b\d{1,3}\s*%\s*off\b|\buse\s+(?:promo\s+)?code\b|https?:\/\/|\breward\s+points?\s+(?:worth|accumulated|earned|balance)\b|\bredeem\s+(?:now|your|points?|rewards?)\b|\b(?:extra|flat|bonus)\s+cashback\b|\b\d{1,3}\s*%\s*(?:extra\s+|flat\s+|bonus\s+)?cashback\b|\b(?:get|earn|enjoy|avail|win|unlock)\s+(?:up\s*to\s+)?(?:\d{1,3}\s*%\s*)?(?:extra\s+|flat\s+)?cashback\b|\bmax\.?\s*cashback\b|\bcashback\s+up\s?to\b|\bcashback\s+on\b(?!\s*\d{1,2}[-\/])|\b(?:flat|extra|bonus|get|earn|win|enjoy|avail|unlock|upto|up\s?to)\s+(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?\s*cashback\b|\b(?:instant|flat|extra|bonus|festive)\s+discount\b|\b\d{1,3}\s*%\s*(?:instant\s+|flat\s+)?discount\b|\b(?:get|earn|enjoy|avail|save|unlock|grab)\s+(?:up\s*to\s+)?(?:(?:\d{1,3}\s*%|(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?)\s*)?(?:instant\s+|flat\s+)?discount\b|\bmax\.?\s*discount\b|\bdiscount\s+(?:on(?!\s*\d{1,2}[-\/])|at|up\s?to|of\s+up\s?to)\b/i;

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

// One-Time Password delivery — a code sent to AUTHORISE a transaction. No money
// has moved, so it must never book as a spend even though it names an amount +
// merchant + card (e.g. "817982 is One-Time Password for INR 87456 transaction
// towards Flipkart … using ICICI Bank Credit Card"). Detected by the OTP-delivery
// framing ("<code> is OTP", "OTP for your transaction", "do not share … OTP").
const OTP_MESSAGE_REGEX =
  /\b\d{3,8}\s+is\s+(?:the\s+|your\s+)?(?:otp|one[\s-]?time\s+password)\b|\b(?:otp|one[\s-]?time\s+password)\s+for\s+(?:your\s+)?(?:transaction|txn|purchase|payment)\b|\bdo\s+not\s+share\b[\s\S]{0,40}\botp\b|\botps?\s+are\s+secret\b/i;

// Declined / failed / blocked transactions — the money did NOT leave the account,
// so these must not book as a spend (e.g. "TRANSACTION FAILED …", "was BLOCKED due
// to …", "DECLINED: … Insufficient Funds"). NOTE: "reversed" is deliberately NOT
// listed — a genuine reversal is a real CREDIT back and must still book.
const FAILED_TRANSACTION_REGEX =
  /\b(?:transaction|txn|payment|request|purchase|attempt|withdrawal)\s+(?:was\s+|has\s+been\s+|is\s+)?(?:declined|failed|blocked|rejected|unsuccessful|not\s+successful)\b|\b(?:declined|failed|blocked|rejected|unsuccessful)\s+(?:due\s+to|at|because|as|:)|\bwas\s+(?:declined|blocked|rejected|unsuccessful)\b|\b(?:transaction|txn|payment|upi)\b[\s\S]{0,45}?\bhas\s+failed\b|\b(?:amount\s+not\s+debited|not\s+debited|no\s+amount\s+(?:was\s+)?debited)\b/i;

// Informational notices that CARRY an amount but book NO transaction — the #1 source of
// "phantom transaction" false positives. These phrases are notice-EXCLUSIVE (never appear
// in a real completed single-txn SMS): a spend SUMMARY, a limit STATEMENT, a conditional
// "may be charged", or a FUTURE credit/debit notice ("scheduled/expected to be debited",
// "will mature"). Rejected unconditionally. (Real spends say "Avl limit Rs.X", not
// "limit is Rs.X"; a real spend line is "Rs.X spent at MERCHANT", never "spent … this month".)
const NON_TXN_NOTICE_REGEX =
  /\byou\s+have\s+spent\b|\bspent\s+(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d+)?\s+(?:so\s+far\s+)?this\s+month\b|\btotal\s+spends?\b|\b(?:available|avl\.?)\s+limit\s+is\b|\b(?:you\s+)?(?:may|might)\s+be\s+charged\b|\bwill\s+mature\b|\b(?:scheduled|expected|due|set|going)\s+to\s+be\s+(?:auto[\s-]?)?(?:debited|credited|deducted|charged)\b/i;

// Balance / funds ALERTS — reject ONLY when no real transaction is also present, since an
// advisory ("… low balance, add funds") can tail a genuine debit ("Rs.500 debited. Low balance.").
const BALANCE_ALERT_REGEX =
  /\bbalance\s+is\s+low\b|\blow\s+balance\b|\binsufficient\s+(?:balance|funds)\b|\badd\s+funds\b|\bmaintain\s+(?:a\s+)?(?:minimum|min\.?)\s+balance\b/i;

// Pre-authorisation / hold / refundable security deposit — money is only BLOCKED,
// not spent (released later), so it must not book. e.g. "Pre-Auth Alert: INR 5000
// held on your CC … This is not a charge", "Blocked … Security Deposit. Amount will
// be released post trip". The "released"/"not a charge" signals are the safe anchors
// (bare "security deposit" alone is too broad — a real deposit payment can be a spend).
const HOLD_PREAUTH_REGEX =
  /\bpre[\s-]?auth(?:oriz|oris)?(?:ation|ed)?\b|\bauthorization\s+hold\b|\bamount\s+held\b|\bheld\s+on\s+your\b|\bthis\s+is\s+not\s+an?\s+(?:actual\s+)?charge\b|\bwill\s+be\s+released\b|\breleased\s+(?:post|after|on)\b|\bhold\s+placed\b|\bplaced\s+a\s+hold\b|\bon\s+hold\b|\b(?:final\s+)?amount\s+(?:may|might)\s+vary\b|\btemporarily\s+blocked\b/i;

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

// A CREDIT that is money back for a prior payment — refund / return / reversal /
// cashback. Flagged as `isRefund` so the store nets it against spend (not income).
// (Promotional cashback OFFERS are already intercepted earlier as promos.)
// `chargeback` and the past-tense "(has been|was) reversed" split form are here for the
// same reason they're in the failed-txn guard: money coming BACK is a refund, and
// without them it books as Income and overstates earnings instead of reducing Spent.
const REFUND_CREDIT_REGEX =
  /\b(?:refund(?:ed)?|refund\s+of|reversed\s+to|reversal|charge\s?back|credited\s+back|returned\s+to\s+your|(?:(?:has|have)\s+been|was|were)\s+reversed|cashback(?:\s+credited)?)\b/i;

// A merchant capture that is really bank narration — a statement period, a currency
// leg, an order ref. Nulled so the parse falls back to the bank sender name.
// The determiner arm is deliberately followed by a NOUN LIST rather than matching any
// "the …": real merchants do start with a determiner ("The Body Shop", "The Bombay
// Store"), and nulling those would be a worse bug than the one being fixed.
const JUNK_MERCHANT_REGEX = new RegExp(
  [
    '^\\d{4,}$',                                            // pure ref / phone number
    '^(?:the|your|our|this|a|an)\\s+(?:quarter|statement|month|period|amount|txn|transaction|spends?|account|card|bill|cycle|year|due\\s+date|payment|purchase|withdrawal|order|ride|renewal)\\b',
    '^(?:fy|ay)\\s*\\d',                                    // "FY 2026-27"
    '^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\\s]?\\d{2,4}$', // "Jul-26"
    '^(?:usd|eur|gbp|aed|sgd|aud|cad|jpy|chf)\\s*[\\d.,]+$', // "USD 24" (the INR leg is the real amount)
    '^order\\s+[\\w-]*\\d',                                 // "order 402-11"
    '^(?:a|an|the)?\\s*failed\\b',                          // "a failed ATM withdrawal"
  ].join('|'),
  'i',
);

// Retry pattern for a discarded junk capture. MERCHANT_REGEX takes the FIRST of
// towards|to|at|@|from|by|for, so a leading currency leg wins over the real payee:
// "used for USD 24.99 (Rs.2,092.16) at OPENAI *CHATGPT" captured "USD 24". Re-reading
// the "at <NAME>" clause recovers the merchant instead of falling back to the bank.
const AT_MERCHANT_REGEX =
  /\bat\s+([A-Za-z][A-Za-z0-9&.*'_\- ]{1,39}?)(?=\s+(?:on|via|ref|rrn|dt|dated|using)\b|\s*[.,;(]|$)/i;

const STRONG_TRANSACTION_WORDS = [
  'debit',
  'credit',
  'debited',
  'credited',
  'paid',
  'spent',
  'sent',
  'withdrawn',
  'deducted',
  'transferred',
  'deposited',
  'refund',
  'refunded',
  'received',
  'levied',
];

// A withheld TAX amount shown alongside the primary credit ("Salary Rs.95000 credited.
// TDS of Rs.5000 deducted.") — never THE transaction amount when a primary exists. Scoped
// to TDS/TCS only: a "surcharge"/"fee" can legitimately BE the transaction (e.g. a fuel
// surcharge SMS), so those must stay eligible.
const SECONDARY_AMOUNT_CONTEXT = /\b(?:tds|tcs)\b\s*(?:of\s+)?(?:rs\.?|inr|₹)?\s*$/i;

const extractAmountNearTransactionKeyword = (text) => {
  const amountMatches = [];
  let m;
  while ((m = AMOUNT_REGEX_GLOBAL.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 20), m.index);
    amountMatches.push({
      amount: toNumber(m[1] || m[2]),
      index: m.index,
      secondary: SECONDARY_AMOUNT_CONTEXT.test(before),
    });
  }
  AMOUNT_REGEX_GLOBAL.lastIndex = 0;
  if (amountMatches.length === 0) return { amount: 0, reason: 'no_amount_match', keyword: null };
  // Prefer primary amounts; only fall back to fee/tax amounts if that's all there is.
  const primaryMatches = amountMatches.filter((a) => !a.secondary);
  const candidates = primaryMatches.length > 0 ? primaryMatches : amountMatches;

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
      candidates.forEach((a) => {
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

  for (const a of candidates) {
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
    amount: candidates[0].amount || 0,
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
  // 1. Explicit credit card wins outright.
  if (/credit\s+card|\bcc\b|c\.c\./i.test(text)) return ACCOUNT_TYPES.CREDIT_CARD;
  // 2. Explicit debit card / ATM / cash withdrawal — always a debit/ATM card. Checked
  //    before the CC-signal heuristic so a co-mentioned "limit" can't flip a real ATM SMS.
  if (
    /debit\s*card(?!\s+(?:maintenance|annual|issuance|fees?|charges?|renewal))/i.test(text) ||
    /\bdr\s*card\b|\batm\b|cash\s+with(?:drawal|drawn)|\bawcw\b/i.test(text)
  ) {
    return ACCOUNT_TYPES.DEBIT_CARD;
  }
  // 3. Strong credit-card-ONLY signals that a debit card / bank a/c never carry — a
  //    credit/available/card LIMIT, outstanding, (min/total) amount due, a generated
  //    statement, "billed to". Recovers CC formats that OMIT the word "credit"
  //    (Amex, OneCard, "Axis Card xx1002 … Avl Limit Rs.X"). The optional
  //    "spend(s)/spending" before LIMIT recovers "Available Spends Limit" (Amex) /
  //    "Clear Spends Limit" (IndusInd) — without it these fell through to Debit Card,
  //    since the word "limit" wasn't immediately after "available"/"avl"/"card".
  if (
    /(?:credit|avl\.?|available|clear|card)(?:\s+spend(?:s|ing)?)?\s+limit|\bcr\.?\s+limit\b|\boutstanding\b|(?:min(?:imum)?|total)\s+(?:amt|amount)\s+due|statement\s+(?:generated|is\s+ready)|\bbilled\s+to\b/i.test(text)
  ) {
    return ACCOUNT_TYPES.CREDIT_CARD;
  }
  // 4. Bare "Card ending/no/xxNNNN" with no debit/credit signal — default to Debit Card
  //    (bank-issued card; keeps card spends segregated from generic "A/c" debits). The
  //    user can flip it to Credit Card on the onboarding card screen if wrongly judged.
  if (
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
  // A wallet-brand phrase + a debit/credit term stands in for the missing a/c mask.
  const bodyHasWalletSignal =
    WALLET_BODY_REGEX.test(text) && hasAnyWord(normalized, BODY_DEBIT_CREDIT_TERMS);
  const strongKeywordSignal = hasAnyWord(normalized, STRONG_TRANSACTION_WORDS);
  const nonFinancialDlt = isLikelyNonFinancialDltSender(opts.sender);

  if (!senderOk && ((!bodyHasAccountRef && !bodyHasWalletSignal) || !strongKeywordSignal || nonFinancialDlt)) {
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

  // OTP / authentication code — a transaction is being authorised, not completed.
  // (After the promo filter so phishing "reward/URL" decoys keep their promo code.)
  if (OTP_MESSAGE_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'otp_message',
        message: 'One-time password / authentication code detected — not a completed transaction.',
      },
    };
  }

  // Declined / failed / blocked transaction — no money moved. Runs AFTER the promo
  // filter so a phishing "A/c blocked due to KYC … claim reward at <url>" decoy is
  // classified as promotional, not as a genuine transaction decline.
  // Guard: a COMPLETED reversal / refund credit-back ("Rs.320 reversed to A/c … for
  // failed ATM txn", "Rs.1499 credited back to your card") is a genuine credit — the
  // word "failed" only explains WHY money returned, so it must NOT be swallowed by the
  // failed-txn filter. Requires a completed credit-back phrase — a FUTURE/conditional
  // "amount WILL BE reversed if debited" is still a genuine decline and stays rejected.
  // The past-tense "(has been|was) reversed" arm covers the split form banks use when
  // the destination is attached to a SECOND verb — "…has been reversed and credited to
  // A/c XX8891" — where `reversed to` never matches and the whole credit was dropped.
  // Past tense ONLY: "amount will be reversed if debited" must stay a decline.
  const isReversalCredit =
    /\b(?:reversed\s+to|credited\s+back|refunded\s+to|refund\s+of|returned\s+to\s+your|(?:has|have)\s+been\s+reversed|(?:was|were)\s+reversed)\b/i.test(text);
  if (FAILED_TRANSACTION_REGEX.test(text) && !isReversalCredit) {
    return {
      ok: false,
      error: {
        code: 'transaction_failed',
        message: 'Declined / failed / blocked transaction detected — no money moved, so it was not added.',
      },
    };
  }


  // Pre-auth / hold / refundable security deposit — money is only held, not spent.
  if (HOLD_PREAUTH_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'preauth_hold',
        message: 'Pre-authorisation hold / refundable deposit detected (amount held, not charged) — not added as a spend.',
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
  const isFutureTense = /will\s+be\s+(?:debited|credited|deducted|withdrawn|transferred|charged)|(?:is\s+)?scheduled\s+(?:for\s+(?:auto[\s-]?debit|debit|payment)|tomorrow|today|on\b)|is\s+due\s+for\s+(?:auto[\s-]?debit|payment)/i.test(text);
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
    const stmtMatch = text.match(CC_STATEMENT_DATE_REGEX);
    const statementDate = stmtMatch?.[1] || null;
    return {
      ok: false,
      error: {
        code: 'cc_bill_reminder',
        message:
          'Credit-card bill reminder detected (amount due / pay by …), so it was not added as a spend.',
      },
      ccDue: dueAmt > 0
        ? { amount: dueAmt, cardLast4, dueDate, statementDate, bankName: getBankName(opts.sender) }
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
    /\b(?:will\s+be\s+(?:debited|credited|deducted|withdrawn|transferred|charged)|(?:is\s+)?scheduled\s+(?:for\s+(?:auto[\s-]?debit|debit|payment)|tomorrow|today|on)|is\s+due\s+for\s+(?:auto[\s-]?debit|payment))\b/gi,
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

  // Informational notice carrying an amount (spend summary, limit statement, conditional
  // "may be charged", future "scheduled/expected to be debited", "will mature"). Runs
  // AFTER the CC-payment/bill/outgoing + future interceptors so those keep their specific
  // codes/side-effects; these phrases are notice-EXCLUSIVE, so reject outright.
  if (NON_TXN_NOTICE_REGEX.test(text)) {
    return {
      ok: false,
      error: {
        code: 'non_transaction_notice',
        message: 'Informational notice (spend summary, limit statement, or future/conditional debit) — not a completed transaction.',
      },
    };
  }
  // Balance / funds alert — reject only if no genuine completed debit/credit/levy is present
  // (an advisory can tail a real debit; "penalty … levied … due to insufficient funds" IS real).
  const hasCompletedTxnVerb =
    /\b(?:debited|credited|deposited|withdrawn|deducted|refunded|levied|charged|spent|paid)\b/i.test(text);
  if (BALANCE_ALERT_REGEX.test(text) && !hasCompletedTxnVerb) {
    return {
      ok: false,
      error: {
        code: 'balance_alert',
        message: 'Low-balance / minimum-balance alert — no money moved, so it was not added.',
      },
    };
  }

  // ── Gate 2: Mandatory transaction phrase ──────────────────────────────────
  // Must contain a concrete past-tense financial phrase.
  const phraseHit = includesAny(lower, TRANSACTION_PHRASES) || hasAnyWord(normalized, TRANSACTION_PHRASES);
  // Only past-tense / action forms accepted here.
  // "debit" and "credit" (bare nouns, as in "debit card" / "credit card") are
  // intentionally excluded — they produced false positives for promotional SMSes.
  const fallbackTxnWordHit =
    /\b(?:debited|credited|spent|paid|withdrawn|deducted|transferred|deposited|refunded|received|levied|charged)\b/i.test(normalized);
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
  // Sanity cap — a single txn over ₹10 crore (MAX_ALLOWED_AMOUNT) is almost certainly a
  // misparse (e.g. a limit/reference number read as the amount), so reject it.
  if (amount > MAX_ALLOWED_AMOUNT) {
    return {
      ok: false,
      error: {
        code: 'amount_exceeds_limit',
        message: `Amount exceeds the ₹${MAX_ALLOWED_AMOUNT.toLocaleString('en-IN')} limit — likely a misparse.`,
      },
    };
  }

  // ── Extract: debit vs credit ──────────────────────────────────────────────
  // Check for "credited to beneficiary" or "debited from beneficiary" patterns.
  // These indicate money moved for the OTHER party, so it's the opposite direction
  // from the user's perspective.
  // NOTE "your account" is deliberately NOT in here. It used to be, and it inverted
  // every "…has been credited to your account XXXX9532" — a plain incoming credit (IT
  // refunds, NACH payouts) — into a DEBIT, i.e. real income booked as spend. The
  // inversion is only correct when the money landed with the OTHER party, which is what
  // "beneficiary" marks; "your beneficiary" still matches, "your account" is the user's
  // own and must stay a credit.
  const creditedToOther = /credited\s+to\s+(?:the\s+|a\s+)?(?:your\s+)?beneficiary/i.test(text);
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
          : /credited|deposited|refunded|refund|received(?:\s+(?:in|to|from|by))?|\breceived\b|salary credited|cashback credited|amount credited|transferred\s+to\s+your\b|\bmoney\s+in\b|\bprocessed\s+into\b|\breversed\s+to\b|\breversal\b|\breturned\s+to\s+your\b|\bcredited\s+back\b|\b(?:neft|imps|rtgs|ach|upi)\b[\s:\/-]*cr\b/i.test(textSansFuture);
  const accountType = inferAccountType(`${opts.sender || ''} ${text}`);
  const defaultType = isCredit ? TRANSACTION_TYPES.CREDIT : TRANSACTION_TYPES.DEBIT;
  // A trimmed copy of the SMS body, kept for SEARCH (Activity matches it) and for the
  // legacy phantom-txn migrations. It is deliberately NOT `note` — `note` is the user's
  // own note, shown as "Note" in the detail sheets and prefilled into the edit form, so
  // dumping the bank's message in there made every SMS transaction look like the user
  // had typed the whole SMS. (`rawSms` is the FULL body, but it's preview-build-only
  // and stripped after RAW_SMS_RETENTION_MS, so it can't back search.)
  const smsText = text.length > 120 ? text.slice(0, 117) + '…' : text;

  // ── Extract: merchant ─────────────────────────────────────────────────────
  // BillPay biller wins first — its "from <account>" source would otherwise be captured
  // by MERCHANT_REGEX's "from" anchor.
  let merchant =
    text.match(BILLPAY_MERCHANT_REGEX)?.[1]?.trim() ||
    text.match(BENEFICIARY_CREDITED_REGEX)?.[1]?.trim() ||
    text.match(VPA_REGEX)?.[1] ||
    text.match(MERCHANT_REGEX)?.[1]?.trim() ||
    text.match(NEFT_REMITTER_REGEX)?.[1]?.trim() ||
    null;

  if (merchant) {
    merchant = merchant
      .replace(MERCHANT_STOP, '')
      .replace(MERCHANT_PERIOD_STOP, '') // cut at ".RRN"/".Avl"/".<ref#>" glued without a space
      // Trailing bank-narration verb (+ optional amount) that a rail-ref capture bled into,
      // e.g. "MOONSHINE TECH credited Rs.30000" → "MOONSHINE TECH".
      .replace(/\s+(?:credited|debited|deposited|transferred|withdrawn|refunded|received|sent|paid|spent|charged|billed)\b[\s\S]*$/i, '')
      // Trailing currency+amount glued to the name, e.g. "JOHN DOE Rs.4500" → "JOHN DOE".
      .replace(/\s+(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d+)?[\s\S]*$/i, '')
      // Bare trailing currency token left after the amount was cut, e.g. "JOHN DOE Rs" → "JOHN DOE"
      // (end-anchored so a merchant like "RS TRADERS" mid-name is untouched).
      .replace(/\s+(?:rs\.?|inr|₹)\s*$/i, '')
      .replace(/\.\s+\S.*$/g, '')   // stop at "period + space" — prevents bleeding past sentence end
      .replace(/^\d+\.\s*/g, '')    // strip NEFT/IMPS batch prefix e.g. "11." before sender name
      .replace(/^(?:upi|imps|neft|rtgs|ach|nft)[-\s]*\d+[-\s]*/i, '') // strip rail+ref prefix e.g. "UPI-755012995968-" → payee
      // Strip a leading action-noun filler so "for order at BIGBASKET" → "BIGBASKET",
      // "for auto-renewal of AMAZON PRIME" → "AMAZON PRIME", "for ride with OLA CABS" → "OLA CABS".
      .replace(/^(?:order|purchase|payment|txn|transaction|shopping|disputed\s+transaction|auto[-\s]?renewal|auto[-\s]?load|renewal|recharge|ride)\s+(?:of|at|for|on|with)\s+/i, '')
      // Trailing reason clause on refunds/reversals, e.g. "AMAZON for order cancellation" → "AMAZON".
      .replace(/\s+for\s+(?:the\s+|order\s+|a\s+)?(?:cancellation|cancelled|refund|reversal|failed|declined|returned|chargeback|disputed)\b[\s\S]*$/i, '')
      // Wallet payments narrate the SOURCE before the payee — "paid from your Paytm
      // Wallet to BLINKIT" — so the capture keeps the wallet as a prefix.
      .replace(/^your\s+[\w\s]*?\bwallet\s+to\s+/i, '')
      .replace(/[.,;:]+$/g, '')
      // Dangling preposition left behind after a trailing clause was cut, e.g.
      // "FOREX MARKUP CHARGES for" → "FOREX MARKUP CHARGES".
      .replace(/\s+(?:for|on|at|to|from|via|towards?|against|by|of|in)$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
    // Discard captures that are narration, not a name, so they fall back to the bank
    // sender below. A wrong-but-plausible merchant ("FY 2026-27", "the statement") is
    // worse than the bank's name: it looks like a real payee, so it survives into the
    // merchant list, subscription detection and Analytics bubbles as a fake entity.
    if (JUNK_MERCHANT_REGEX.test(merchant)) {
      const retry = text.match(AT_MERCHANT_REGEX)?.[1]?.trim();
      merchant = retry && !JUNK_MERCHANT_REGEX.test(retry) ? retry.slice(0, 40) : null;
    }
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
  // Groups 1/2 are the mask-then-verb branch, 3/4 the verb-then-mask branch —
  // exactly one pair is populated, whichever branch matched.
  const accountMask = firstEvent?.[1] || firstEvent?.[4] || acctMatch?.[1] || null;
  const firstVerb = (firstEvent?.[2] || firstEvent?.[3] || '').toLowerCase();
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

  // Dual-leg: one SMS reporting both a debit and a credit across ≥2 accounts
  // (e.g. "Acct XX171 debited … & Acct XX972 credited"). `selfDualLeg` gates
  // whether the STORE may synthesize the missing leg's own transaction
  // (buildSelfCounterLeg) — it must stay this strict, because a message that
  // only reports ONE side completing must never fabricate a matching entry
  // for the other side; that side's own SMS, when it arrives, is the real one.
  const hasDebitEvt  = /\bdebited\b/i.test(text);
  const hasCreditEvt = /\bcredited\b/i.test(text);
  const selfDualLeg  = distinctMasks.length >= 2 && hasDebitEvt && hasCreditEvt;

  // A message can also name a SECOND account mask while reporting only ONE
  // side of the transfer — "Rs.5000 debited from A/c X and transferred to A/c
  // Y" has no "credited" anywhere, so `selfDualLeg` is false, but it still
  // names Y as plainly as a true dual-leg message names its counterpart. Two
  // banks reporting their own halves of one NEFT/IMPS self-transfer as SEPARATE
  // SMS is the common case (unlike a combined dual-leg SMS, which is rarer) —
  // each half individually looks exactly like this. Gated on transfer-type
  // language so an unrelated message that happens to name two accounts (e.g.
  // an EMI debited from a savings account against a loan account) doesn't
  // qualify — those don't say NEFT/IMPS/RTGS/UPI/"transfer".
  const hasTransferLanguage = /\b(?:neft|imps|rtgs|upi|transfer(?:red)?)\b/i.test(text);

  // The "other" account mask this message names — from a true dual-leg
  // message, or a solo leg that still names its counterparty via transfer
  // language. Either way it's the SAME signal to the store (case (a) below);
  // only the synthesis decision above cares which kind it was.
  const counterpartyMask = (distinctMasks.length >= 2 && (selfDualLeg || hasTransferLanguage))
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

  // Debit-card↔bank co-reference: one SMS that names BOTH a card and an a/c
  // (e.g. "spent on Debit Card xx1234 from A/c xx5678") — surface the OTHER mask
  // so the store can suggest merging the card into its bank. Gated on the SMS
  // actually mentioning both a card and an account so an ordinary dual-bank
  // self-transfer doesn't masquerade as a card link (the store also type-checks).
  const mentionsCard = /\b(?:debit\s*card|credit\s*card|atm|dr\s*card|card\s*(?:ending|no\.?|number))\b|\bcard\b/i.test(text);
  const mentionsAcct = /\ba\/?c\b|\baccount\b/i.test(text);
  // Pool BOTH a/c masks and card masks, then pick whichever differs from the
  // primary accountMask. Works in both directions: a card spend that names its
  // source a/c, or an a/c debit that names the card used.
  const cardMasks = [];
  let cmm;
  while ((cmm = CARD_MASK_GLOBAL.exec(text)) !== null) {
    if (cmm[1]) cardMasks.push(cmm[1]);
  }
  CARD_MASK_GLOBAL.lastIndex = 0;
  const coMaskPool = [...new Set([...distinctMasks, ...cardMasks])];
  const coAccountMask =
    mentionsCard && mentionsAcct
      ? (coMaskPool.find((m) => m && m !== accountMask) || null)
      : null;

  // Refund/cashback credit → flagged so the store nets it against spend, not income.
  const isRefund =
    inferredTypeFromFirstVerb === TRANSACTION_TYPES.CREDIT && REFUND_CREDIT_REGEX.test(text);

  const single = buildTransaction({
    amount,
    type: inferredTypeFromFirstVerb,
    accountType,
    accountMask,
    bankName: getBankName(opts.sender),
    merchant: merchant || (isRefund ? 'Refund' : inferredTypeFromFirstVerb === TRANSACTION_TYPES.CREDIT ? 'Income' : 'Expense'),
    categoryId,
    smsText,
    createdAt: opts.receivedAt,
    isRefund,
    counterpartyMask,
    counterpartyPhone,
    counterpartyName,
    transferRef,
    selfDualLeg,
    coAccountMask,
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
  smsText,
  createdAt,
  isRefund = false,
  counterpartyMask = null,
  counterpartyPhone = null,
  counterpartyName = null,
  transferRef = null,
  selfDualLeg = false,
  coAccountMask = null,
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
    smsText,
    source:      'sms',
    isRefund:    !!isRefund,
    isSplit:     false,
    splitWith:   [],
    createdAt:   createdAt || new Date().toISOString(),
    // Self-transfer detection hints (resolved against user accounts/phones/name in store).
    counterpartyMask,
    counterpartyPhone,
    counterpartyName,
    transferRef,
    selfDualLeg,
    // Debit-card↔bank link hint: the OTHER mask when one SMS names both a card and
    // an a/c (e.g. "spent on Debit Card xx1234 from A/c xx5678"). The store pairs a
    // Debit Card account with a Bank account from this to SUGGEST a merge (same money).
    coAccountMask,
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
