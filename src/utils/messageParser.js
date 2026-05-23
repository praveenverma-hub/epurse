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
  'jkbank', 'kvbank',
  // ── Payment banks ─────────────────────────────────────────────────────────
  'paytm', 'pytm',       // Paytm (PYTMWT = Paytm Wallet Transaction)
  'jiomny',              // JioMoney — NOT 'jio' (avoids JIOBIL)
  'airpay', 'airtpay',   // Airtel Payments Bank — NOT 'airtel' (avoids telecom)
  'finopay', 'fino', 'indiapst',
  // ── Wallets & UPI ─────────────────────────────────────────────────────────
  'phonepe', 'phpe', 'gpay', 'googlepay',
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
  ['paytm',      'Paytm'],
  ['pytm',       'Paytm'],
  ['phonepe',    'PhonePe'],
  ['phpe',       'PhonePe'],
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
  'debited', 'withdrawn', 'deducted', 'auto-debit', 'autopay',
  'emi debited', 'emi deducted', 'emi paid',
  'paid to', 'paid via', 'paid at', 'paid from', 'amount paid',
  'sent to', 'sent via',
  'transferred to', 'transferred from', 'transfer of',
  'payment of', 'payment for',
  'purchase at', 'purchase of', 'spent at', 'spent on',
  // Credit-side
  'credited', 'deposited', 'refunded', 'refund', 'salary credited',
  'amount credited', 'cashback credited',
  'received in', 'received to',
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
const ACCOUNT_REGEX =
  /(?:a\/c|account|card(?:\s+ending)?)[^0-9]*([x*]*\d{3,6})/i;

const FIRST_ACCOUNT_EVENT_REGEX =
  /(?:a\/c|acct\.?|account)\s*[xX*•·]{0,8}(\d{3,6})\s+(debited|credited|deposited|withdrawn|deducted|refunded|received)\b/i;

// Merchant after "to", "at", "@", "from" — lazy, stops at stop words
const MERCHANT_REGEX =
  /(?:to|at|@|from)\s+([A-Za-z0-9][A-Za-z0-9&._\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9&._\-]*){0,4}?)(?=\s+(?:on|via|ref|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by)\b|\.|,|;|$)/i;

const MERCHANT_STOP =
  /\s+(?:on|via|ref|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by)\b.*$/i;

// UPI VPA: someone@bank
const VPA_REGEX = /([a-zA-Z0-9._\-]{2,30}@[a-zA-Z]{2,15})/;

// Payment acknowledgements for credit cards (not new spend/income transactions).
const CC_PAYMENT_NOTIFICATION_REGEX =
  /\bpayment\s+of\s+(?:inr|rs\.?|₹)\s*[0-9,]+(?:\.[0-9]{1,2})?[\s\S]{0,80}(?:has\s+been\s+received\s+on\s+your\b[\s\S]*\bcredit\s+card\b|was\s+credited\s+to\s+your\s+card\b|received\s+towards\s+your\b[\s\S]{0,30}\bcredit\s+card\b)/i;

// Credit-card bill REMINDER (pre-payment alert) — NOT a spend.
// Banks send these monthly to nudge the user to pay their CC bill.
// Verbs/phrases that anchor a reminder: amount/total/min/payment due,
// due date/on/by, outstanding (amount/balance/due), pay (instantly) by <date>,
// pay your bill/credit card, kindly/please pay, settle by/your/outstanding,
// bill/statement generated.
const CC_BILL_REMINDER_REGEX =
  /\b(?:(?:total|min(?:imum)?|amount|payment)\s+(?:amount\s+)?due|due\s+(?:date|on|by)\s+\d|outstanding(?:\s+(?:amount|balance|due))?|pay\s+(?:instantly\s+)?by\s+\d|pay\s+your\s+(?:bill|credit\s+card)|kindly\s+pay|please\s+pay|settle\s+(?:by|your|outstanding)|bill\s+generated|statement\s+generated)\b/i;

// Hard past-tense confirmation that money has ALREADY moved. If any of these
// fire, the SMS is a real transaction even if it also mentions "due" — we
// don't want to swallow `"Rs 500 debited towards EMI due"` as a reminder.
const CC_BILL_HARD_CONFIRMATION_REGEX =
  /\b(?:debited|credited|spent|withdrawn|deducted|deposited|refunded|transferred)\b|\bpaid\s+(?:to|via|at|from)\b/i;

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

const NON_TXN_AMOUNT_HINTS = /\b(?:due|min(?:imum)?\s+due|outstanding|avl(?:\.|\s+bal(?:ance)?)?|available\s+balance|closing\s+balance|total\s+due|statement)\b/i;

const STRONG_TRANSACTION_WORDS = [
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
  if (/credit\s+card|cc\b|c\.c\./i.test(text)) return ACCOUNT_TYPES.CREDIT_CARD;
  if (/wallet|paytm|phonepe|gpay|google\s*pay|amazon\s*pay/i.test(text))
    return ACCOUNT_TYPES.WALLET;
  if (/a\/c|account|saving|current|bank/i.test(text)) return ACCOUNT_TYPES.BANK;
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
  if (
    CC_BILL_REMINDER_REGEX.test(text) &&
    !CC_BILL_HARD_CONFIRMATION_REGEX.test(text)
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

  // ── Gate 1: Source validation ─────────────────────────────────────────────
  // Accept if sender is a bank/wallet, OR if body has an account reference
  // plus a basic debit/credit term (covers unlisted senders).
  const senderOk = isBankOrWalletSender(opts.sender);
  const bodyHasAccountRef =
    ACCOUNT_REF_REGEX.test(text) &&
    hasAnyWord(normalized, BODY_DEBIT_CREDIT_TERMS);
  const strongKeywordSignal = hasAnyWord(normalized, STRONG_TRANSACTION_WORDS);
  const nonFinancialDlt = isLikelyNonFinancialDltSender(opts.sender);

  // Unknown sender fallback is intentionally strict: require account reference
  // plus a debit/credit term. This avoids promo senders slipping in.
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

  // ── Gate 2: Mandatory transaction phrase ──────────────────────────────────
  // Must contain a concrete past-tense financial phrase.
  const phraseHit = includesAny(lower, TRANSACTION_PHRASES) || hasAnyWord(normalized, TRANSACTION_PHRASES);
  const fallbackTxnWordHit =
    /\b(?:debit(?:ed)?|credit(?:ed)?|spent|paid|withdrawn|deducted|transferred|deposited|refunded|received)\b/i.test(normalized);
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
  const isCredit =
    /credited|deposited|refunded|refund|received in|received to|salary credited|cashback credited|amount credited/i.test(text);
  const accountType = inferAccountType(`${opts.sender || ''} ${text}`);
  const defaultType = isCredit ? TRANSACTION_TYPES.CREDIT : TRANSACTION_TYPES.DEBIT;
  const note = text.length > 120 ? text.slice(0, 117) + '…' : text;

  // ── Extract: merchant ─────────────────────────────────────────────────────
  let merchant =
    text.match(VPA_REGEX)?.[1] ||
    text.match(MERCHANT_REGEX)?.[1]?.trim() ||
    null;

  if (merchant) {
    merchant = merchant
      .replace(MERCHANT_STOP, '')
      .replace(/[.,;:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
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
    firstVerb && /credited|deposited|refunded|refund|received/.test(firstVerb)
      ? TRANSACTION_TYPES.CREDIT
      : firstVerb
        ? TRANSACTION_TYPES.DEBIT
        : defaultType;
  const categoryId = categorise(`${merchant || ''} ${text}`) || 'other';

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
];

export const buildSampleTransactions = () =>
  SAMPLE_MESSAGES.map((m) =>
    parseMessage(m, { sender: 'HDFCBK' })
  ).filter(Boolean);
