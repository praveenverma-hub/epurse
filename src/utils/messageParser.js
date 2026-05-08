// =============================================================================
// SMS / Notification message parser
// -----------------------------------------------------------------------------
// On real devices we'd hook into Android's SMS BroadcastReceiver or Notification
// Listener Service. For Expo (managed) we simulate that pipeline: external code
// hands us a raw message string, and we extract a structured Transaction.
//
// The parser is forgiving — it handles formats from HDFC, ICICI, SBI, Axis,
// Paytm, PhonePe, GPay etc. The core idea is:
//   1. Detect intent  → debit | credit
//   2. Extract amount → ₹1,250.00 / Rs 1250 / INR 1250
//   3. Extract account→ "A/c xxxx1234" / "card ending 4321"
//   4. Extract entity → merchant / sender / UPI VPA
//   5. Map to category via keyword dictionary
// =============================================================================

import { CATEGORY_KEYWORDS, ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';

// ---- intent keywords ---------------------------------------------------------
const DEBIT_KEYWORDS = [
  'debited', 'spent', 'paid', 'purchase', 'withdrawn', 'sent', 'transferred',
  'debit', 'used', 'charged', 'auto-debit', 'autopay',
];
const CREDIT_KEYWORDS = [
  'credited', 'received', 'refund', 'deposited', 'added',
  'credit', 'cashback', 'salary credited',
];

// ---- regex patterns ----------------------------------------------------------
// Captures amounts like:  Rs.1,234.50  ₹1234  INR 1,234  1234.00
const AMOUNT_REGEX =
  /(?:rs\.?|inr|₹)\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i;

// Captures masked account / card numbers:  A/c xx1234 / Card ending 4321
const ACCOUNT_REGEX = /(?:a\/c|account|card(?:\s+ending)?)[^0-9]*([x*]*\d{3,6})/i;

// Captures merchant / VPA after "to", "at", "@", "from"
// Lazy match — bounded by common SMS stop words (on, via, ref, upi, avl, info, txn).
const MERCHANT_REGEX =
  /(?:to|at|@|from)\s+([A-Za-z0-9][A-Za-z0-9&._\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9&._\-]*){0,4}?)(?=\s+(?:on|via|ref|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by)\b|\.|,|;|$)/i;

// Stop words used to trim a merchant capture if a stop boundary slipped through.
const MERCHANT_STOP = /\s+(?:on|via|ref|upi|avl|info|txn|bal|tot|udf|imps|neft|rtgs|dt|dated|by)\b.*$/i;

// UPI Virtual Payment Address (someone@bank)
const VPA_REGEX = /([a-zA-Z0-9._\-]{2,30}@[a-zA-Z]{2,15})/;

// ---- helpers -----------------------------------------------------------------
const includesAny = (text, list) => list.some((k) => text.includes(k));

const toNumber = (str) => {
  if (!str) return 0;
  return parseFloat(str.replace(/,/g, '')) || 0;
};

/** Best-guess account type based on keywords in the SMS sender / body. */
const inferAccountType = (text) => {
  if (/credit\s+card|cc\b|c\.c\./i.test(text)) return ACCOUNT_TYPES.CREDIT_CARD;
  if (/wallet|paytm|phonepe|gpay|google\s*pay|amazon\s*pay/i.test(text))
    return ACCOUNT_TYPES.WALLET;
  if (/a\/c|account|saving|current|bank/i.test(text)) return ACCOUNT_TYPES.BANK;
  return ACCOUNT_TYPES.BANK;
};

/** Pick the best category by checking merchant / body against keyword map. */
export const categorise = (text) => {
  const lower = (text || '').toLowerCase();
  for (const [catId, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return catId;
  }
  return 'other';
};

// =============================================================================
// Main parser
// =============================================================================
/**
 * @param {string} message  raw SMS / notification body
 * @param {object} [opts]   { sender, receivedAt }
 * @returns {object|null}   parsed transaction or null if not financial
 */
export const parseMessage = (message, opts = {}) => {
  if (!message || typeof message !== 'string') return null;
  const text = message.trim();
  const lower = text.toLowerCase();

  const isDebit = includesAny(lower, DEBIT_KEYWORDS);
  const isCredit = includesAny(lower, CREDIT_KEYWORDS);
  if (!isDebit && !isCredit) return null;

  // amount ----------------------------------------------------------------
  const amountMatch = text.match(AMOUNT_REGEX);
  const amount = toNumber(amountMatch?.[1] || amountMatch?.[2]);
  if (!amount) return null;

  // account ---------------------------------------------------------------
  const acctMatch = text.match(ACCOUNT_REGEX);
  const accountMask = acctMatch?.[1] || null;
  const accountType = inferAccountType(`${opts.sender || ''} ${text}`);

  // merchant / counterparty ----------------------------------------------
  let merchant =
    text.match(VPA_REGEX)?.[1] ||
    text.match(MERCHANT_REGEX)?.[1]?.trim() ||
    null;
  if (merchant) {
    merchant = merchant
      .replace(MERCHANT_STOP, '') // drop trailing "on 03-May ..." junk if any
      .replace(/[.,;:]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  }

  // category --------------------------------------------------------------
  const categoryId = categorise(`${merchant || ''} ${text}`);

  return {
    id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount,
    type: isDebit ? TRANSACTION_TYPES.DEBIT : TRANSACTION_TYPES.CREDIT,
    accountType,
    accountMask,
    merchant: merchant || (isCredit ? 'Income' : 'Expense'),
    categoryId,
    note: text.length > 120 ? text.slice(0, 117) + '…' : text,
    source: 'sms',
    isSplit: false,        // future: shared / split-with-friends
    splitWith: [],
    createdAt: opts.receivedAt || new Date().toISOString(),
  };
};

// =============================================================================
// Sample messages — useful for demos & unit tests
// =============================================================================
export const SAMPLE_MESSAGES = [
  'Rs.450.00 debited from A/c xx1234 on 06-May-26 to SWIGGY via UPI. Avl bal Rs.42,310.50',
  'INR 1,299 spent on HDFC Credit Card ending 4321 at AMAZON on 05-May-26.',
  'Your a/c xxxx5678 is credited with Rs.55,000.00 - SALARY MAY 2026.',
  'Paytm Wallet: Rs 120 paid to UBER. Available balance: Rs 480.',
  'Rs.2,499 debited from A/c xx9012 to NETFLIX on 03-May. UPI Ref 4421.',
  '₹350 paid to bigbasket@upi via UPI from your account xx1234.',
  'Rs.180 debited via UPI to ola@paytm. A/c xx1234. Ref 998877.',
];

// Convenience: run the parser over SAMPLE_MESSAGES (handy for the seed dataset).
export const buildSampleTransactions = () =>
  SAMPLE_MESSAGES.map((m) => parseMessage(m)).filter(Boolean);
