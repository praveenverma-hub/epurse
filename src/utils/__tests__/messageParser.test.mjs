// =============================================================================
// SMS / Notification message-parser test suite
// -----------------------------------------------------------------------------
// ZERO-DEPENDENCY runner — no jest, no install. Just:
//
//     npm run test:parser           (preferred)
//     node src/utils/__tests__/messageParser.test.mjs
//
// It imports the REAL parser (src/utils/messageParser.js) directly, so the
// tests can never silently drift from the shipping code. Exits non-zero on any
// failure, so it is safe to wire into CI / a pre-commit hook.
//
// -----------------------------------------------------------------------------
// HOW TO ADD A NEW CASE  (do this every time you test a new real SMS!)
// -----------------------------------------------------------------------------
// Append an object to the relevant suite array below. Shape:
//
//   {
//     name:   'short human label',
//     sender: 'HDFCBK',                 // DLT sender header
//     sms:    'the raw SMS body',
//     expect: {                         // assert ONLY the fields you care about
//       accept: true,                   // true = becomes a transaction
//       type: 'debit' | 'credit',
//       accountType: 'Bank' | 'Credit Card' | 'Debit Card' | 'Digital Wallet',
//       amount: 122.43,                 // exact numeric value
//       categoryId: 'travel',
//       accountMask: '5004',
//       merchant: 'Uber India',         // exact match
//       merchantIncludes: 'EPSILON',    // OR substring match
//       selfDualLeg: true,
//       counterpartyMask: '532',
//       counterpartyPhone: '33221',
//     },
//   }
//
// For a message the parser should NOT book as a spend/credit:
//
//   { name, sender, sms, expect: { accept: false, code: 'promotional_offer' } }
//
// Rejection / interception codes currently emitted:
//   source_not_financial · promotional_offer · market_rates_bulletin
//   upi_collect_request · credit_card_payment_notification · cc_bill_reminder
//   future_scheduled_debit · cc_payment_outgoing · missing_transaction_keyword
//   amount_not_found
// (`code` is optional — omit it to assert "rejected, reason doesn't matter".)
// =============================================================================

import { parseMessageDetailed } from '../messageParser.js';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Original real Indian-bank SMS (spends, credits, CC lifecycle)
// ─────────────────────────────────────────────────────────────────────────────
const ORIGINAL = [
  {
    name: 'ICICI CC spend at Uber',
    sender: 'ICICIB',
    sms: 'Alert: Rs.122.43 spent on ICICI Bank Credit Card XX5004 on 05-Jun-26 at Uber India. Avl Limit: Rs.1,33,251.35.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 122.43, merchant: 'Uber India', categoryId: 'travel' },
  },
  {
    name: 'SBI CC bill reminder (amount due)',
    sender: 'SBICRD',
    sms: 'Total Amount Due on your SBI Credit Card ending 1234 for statement dt 20-May-26 is ₹16,748.65. Min Amount Due: ₹837.00. Payment due date: 07-Jun-26.',
    expect: { accept: false, code: 'cc_bill_reminder' },
  },
  {
    name: 'ICICI CC payment received (notification)',
    sender: 'ICICIB',
    sms: 'Thank you! Payment of ₹16,748.65 received towards ICICI Bank Credit Card xx5004 on 06-Jun-26 via UPI. Ref No: 615729301.',
    expect: { accept: false, code: 'credit_card_payment_notification' },
  },
  {
    name: 'HDFC loan EMI scheduled for auto-debit (future)',
    sender: 'HDFCBK',
    sms: 'Dear Customer, EMI of ₹4,250.00 for your HDFC Bank Consumer Loan XXXXXX89 is scheduled for auto-debit on 05-Jun-26 from your savings A/c XX4321.',
    expect: { accept: false, code: 'future_scheduled_debit' },
  },
  {
    name: 'HDFC convert-to-EMI offer',
    sender: 'HDFCBK',
    sms: 'Splurge cleared! Convert your txn of Rs.12,500.00 at Apple Retail on HDFC CC 9876 into easy EMIs of Rs.1,120/mo for 12 months.',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'Indian Bank loan disbursal credited (genuine)',
    sender: 'INDBNK',
    sms: 'Congratulations! Instant Loan amount of ₹1,50,000.00 has been successfully credited to your Indian Bank A/c XX9532 on 04-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 150000 },
  },
  {
    name: 'Zomato refund to Axis debit card',
    sender: 'AXISBK',
    sms: 'Refund of ₹120.00 processed successfully by Zomato to your Axis Bank Card xx4412 on 05-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Debit Card', amount: 120, merchant: 'Zomato', categoryId: 'food' },
  },
  {
    name: 'SBI ATM cash withdrawal',
    sender: 'SBIXXX',
    sms: 'Cash withdrawal of INR 5,000.00 made at SBI ATM Delhi on 04/06/26 using Card XX9182.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 5000 },
  },
  {
    name: 'IMPS debit to SAKSHAM TIWA',
    sender: 'INDBNK',
    sms: 'Your A/c XX9532 has been debited with ₹352.00 on 04-Jun-26 by IMPS to SAKSHAM TIWA. Available Bal: ₹6,611.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 352, categoryId: 'transfer' },
  },
  {
    name: 'NEFT credit from TOTAL INFRA SERVICES (batch prefix)',
    sender: 'AXISBK',
    sms: 'Dear Customer, your Axis Bank A/c XX1102 has been credited with Rs.45,000.00 via NEFT from 11.TOTAL INFRA SERVICES on 05-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 45000, merchant: 'TOTAL INFRA SERVICES' },
  },
  {
    name: 'HDFC instant-loan offer with URL',
    sender: 'HDFCBK',
    sms: 'Get Instant Loan of Rs. 75000 on your HDFC Bank Credit Card x4208.\nCheck details: https://1.hdfc.bank.in/HDFCBK/s/8KNlmOXl T&C',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'HDFC convert-bill-to-EMI offer with URL',
    sender: 'HDFCBK',
    sms: 'Pnt Radhe: HDFC Bank Credit Card xx8077 Update: Convert bill of Rs. 4923 to an EMI of Rs. 459 p.m & ease this month: https://1.hdfc.bank.in/HDFCBK/s/7qnX5bWw T&C',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'ICICI CC payment received (uppercase variant)',
    sender: 'ICICIB',
    sms: 'Pnt Radhe: Dear Customer, Payment of INR 7,844.00 has been received on your ICICI Bank Credit Card Account 4xxx7004 on 27-MAY-26.Thank you.',
    expect: { accept: false, code: 'credit_card_payment_notification' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Adversarial edge cases (autopay, holds, OD, fees, penalties, reversals)
// ─────────────────────────────────────────────────────────────────────────────
const ADVERSARIAL = [
  {
    name: 'Netflix autopay mandate debit',
    sender: 'AXISBK',
    sms: 'Autopay Debit: Your Axis Bank A/c XX1102 has been debited by ₹799.00 on 05-Jun-26 for NETFLIX INDIA mandate. Ref: UPI-MP-99410A. Bal: ₹24,150.22.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 799, merchant: 'NETFLIX INDIA', categoryId: 'entertainment' },
  },
  {
    name: 'Mandate block / funds held (NOT a debit)',
    sender: 'HDFCBK',
    sms: 'Mandate Block: INR 3,500.00 has been held in HDFC A/c XX4398 on 04/06/26 for Zoomcar booking ref 88319. Funds will be captured post-trip.',
    expect: { accept: false },
  },
  {
    name: 'Overdraft cheque debit',
    sender: 'SBIXXX',
    sms: 'OD Alert: Your SBI Overdraft A/c XX7741 debited by Rs.12,500.00 via Cheque 00124 on 05-Jun-26. Utilized: Rs.88,400.00. Available Drawing Power: Rs.11,600.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 12500 },
  },
  {
    name: 'Debit-card maintenance fee (must stay Bank, not Debit Card)',
    sender: 'INDBNK',
    sms: 'Fees & Charges: A/c XX9532 debited for INR 236.00 (Incl. GST) towards Consldated Debit Card Maintenance Fees on 04-Jun-26. Bal: INR 6,375.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 236 },
  },
  {
    name: 'Cheque bounce penalty (verb is "levied")',
    sender: 'HDFCBK',
    sms: 'Alert: Cheque Bounce penalty of Rs.590.00 levied on your HDFC A/c XX4398 due to insufficient funds on Chq 009811 dated 05/06/26.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 590 },
  },
  {
    name: 'Failed UPI payout reversal (credited back)',
    sender: 'INDBNK',
    sms: 'Txn Reversal: UPI Decline payout of ₹500.00 to SWIGGY has failed. Money has been safely credited back to your Indian Bank A/c XX9532 on 06-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 500, merchant: 'SWIGGY', categoryId: 'food' },
  },
  {
    name: 'Salary NEFT credit',
    sender: 'ICICIB',
    sms: 'Salary Credit: Your ICICI A/c XX2019 has been credited with INR 1,85,450.00 via NEFT from EPSILON INFRASTRUCTURE PRIVATE LIMITED on 31-May-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 185450, categoryId: 'salary', merchantIncludes: 'EPSILON' },
  },
  {
    name: 'Dividend payout (DIV ID must not leak into merchant)',
    sender: 'HDFCBK',
    sms: 'Dividend Payout: Rs.450.00 credited to your HDFC A/c XX4398 via ACH/NACS from TATA MOTORS LTD DIV ID 202601 on 04-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 450, merchant: 'TATA MOTORS LTD', categoryId: 'investments' },
  },
  {
    name: 'CRED multi-card statement aggregation (NOT a debit)',
    sender: 'CREDXX',
    sms: 'CRED Alert: Statement generated for ICICI Card xx5004 (Rs.16,748.65) & AMEX Card xx1002 (Rs.42,110.00). Total pooled due by 15-Jun-26.',
    expect: { accept: false },
  },
  {
    name: 'Purely-future debit ("will be debited", no completed verb)',
    sender: 'AXISBK',
    sms: 'INR 74,511.67 will be debited from your Axis Bank A/c XX2655 on 04-Jun-26 via auto debit towards your loan.',
    expect: { accept: false, code: 'future_scheduled_debit' },
  },
  {
    name: 'Mixed past+future — real debit happened, future clause must not drop it',
    sender: 'HDFCBK',
    sms: 'Rs.500.00 debited from your HDFC A/c XX4398 on 06-Jun-26 to SWIGGY. Cashback of Rs.10.00 will be credited within 7 days.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 500, merchant: 'SWIGGY', categoryId: 'food' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Lookalike / decoy (phishing, offers, requests, balance alerts)
// All must be rejected EXCEPT the genuine cash deposit.
// ─────────────────────────────────────────────────────────────────────────────
const LOOKALIKE = [
  {
    name: 'KYC phishing + reward expiry + URL',
    sender: 'AD-ICICIB-S',
    sms: 'ALERT: Your ICICI Bank A/c has been blocked due to missing KYC. Reward Points worth ₹9,850.00 will expire tonight. Claim now at http://icici-kyc-update.net/login',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'Pre-approved loan offer',
    sender: 'VM-HDFCBK-T',
    sms: 'Dear Customer, ₹5,00,000.00 has been pre-approved on your HDFC Savings Account XX4398. Instant disbursal in 2 mins. Apply via HDFC Mobile App today!',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'Instant loan offer ("get an instant loan of")',
    sender: 'VK-HDFCBK-S',
    sms: 'Good News! Get an instant loan of up to Rs.50,000.00 directly credited to your bank account using code CASH50. Tap here to download the KreditBee app.',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'UPI collect request',
    sender: 'PHONPE',
    sms: 'Collect Request: SWIGGY IPAY has requested ₹425.00 from your UPI ID xx@upi. Open your GPay or PhonePe app to approve payment before 15 mins.',
    expect: { accept: false, code: 'upi_collect_request' },
  },
  {
    name: 'Credit-limit increase (not a transaction)',
    sender: 'JM-SBICRD-S',
    sms: 'Great News! The credit limit on your SBI Credit Card ending in 1234 has been increased from Rs.1,50,000.00 to Rs.2,50,000.00 at zero cost.',
    expect: { accept: false, code: 'promotional_offer' },
  },
  {
    name: 'Genuine cash deposit at CDM',
    sender: 'INDBNK',
    sms: 'Cash Deposit: INR 10,000.00 deposited at Cash Deposit Machine, Delhi branch into your Indian Bank A/c XX9532 on 06/06/26. Balance: INR 16,611.00.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 10000 },
  },
  {
    name: 'Balance enquiry reply',
    sender: 'AXISBK',
    sms: 'Bal Info: Clear Balance for your Axis Bank A/c XX1102 as of 06-Jun-26 14:30:22 is Rs.24,150.22. Thank you for banking with us.',
    expect: { accept: false, code: 'missing_transaction_keyword' },
  },
  {
    name: 'Minimum-balance alert',
    sender: 'HDFCBK',
    sms: 'Alert: Balance in your HDFC A/c XX4398 has fallen below the minimum required threshold of ₹5,000.00. Current Balance: ₹1,220.00.',
    expect: { accept: false, code: 'missing_transaction_keyword' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Real-world P2P / self-transfer / NEFT / UPI-ref patterns
// ─────────────────────────────────────────────────────────────────────────────
const REAL_WORLD = [
  {
    name: 'UPI P2P credit (VPA payee)',
    sender: 'INDBNK',
    sms: 'Rs.5000.00 credited to a/c *9532 on 02/06/2026 by a/c linked to VPA 7041906483@ybl (UPI Ref no 912764756685).Indian Bank',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 5000, accountMask: '9532', merchant: '7041906483@ybl' },
  },
  {
    name: 'NEFT inbound credit (NEFT-ref-payee)',
    sender: 'ICICIB',
    sms: 'ICICI Bank Account XX171 credited:Rs. 1,42,997.00 on 30-May-26. Info NEFT-AXISP00802935830-MOONSH. Available Balance is Rs. 2,75,406.96.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 142997, accountMask: '171' },
  },
  {
    name: 'IMPS P2P credit linked to mobile',
    sender: 'INDBNK',
    sms: 'Your a/c. XXXX9532 is credited by Rs. 60000.00 on 03-06-26 by a/c linked to mobile 9XXXXXX33221 (IMPS Ref no. 615423432006). -IndianBank',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 60000, accountMask: '9532', counterpartyPhone: '33221' },
  },
  {
    name: 'Self-transfer dual-leg (debit + credit, dispute phone in footer)',
    sender: 'ICICIB',
    sms: 'ICICI Bank Acct XX171 debited with Rs 60,000.00 on 03-Jun-26 & Acct XX532 credited.IMPS:615423432006. Call 18002662 for dispute or SMS BLOCK 171 to 9215676766',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 60000, accountMask: '171', selfDualLeg: true, counterpartyMask: '532' },
  },
  {
    name: 'IMPS P2P credit (older date)',
    sender: 'INDBNK',
    sms: 'Your a/c. XXXX9532 is credited by Rs. 5000.00 on 23-12-25 by a/c linked to mobile 9XXXXXX33221 (IMPS Ref no. 535718946347). -IndianBank',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 5000, accountMask: '9532', counterpartyPhone: '33221' },
  },
  {
    name: 'UPI debit to CRED Club',
    sender: 'INDBNK',
    sms: 'A/c *9532 debited Rs. 3331.00 on 09-05-26 to CRED Club. UPI:199999367779. Not you? SMS BLOCK to 9289592895, Dial 1930 for Cyber Fraud - Indian Bank',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 3331, accountMask: '9532', merchant: 'CRED Club' },
  },
  {
    name: 'HDFC CC payment received (uppercase)',
    sender: 'HDFCBK',
    sms: 'DEAR HDFCBANK CARDMEMBER, PAYMENT OF Rs. 3348.00 RECEIVED TOWARDS YOUR CREDIT CARD ENDING WITH 2170 ON 9-5-2026.YOUR AVAILABLE LIMIT IS RS. 249999.76',
    expect: { accept: false, code: 'credit_card_payment_notification' },
  },
  {
    name: 'SBI credit leg — counterparty name + transfer ref surfaced for self-detection',
    sender: 'SBIINB',
    sms: 'Dear Customer, Your a/c no. XXXXXXXX0972 is credited by Rs.1.00 on 06-06-26 by a/c linked to mobile 7XXXXXX221-PRAVEEN VE (IMPS Ref# 615722061047)-SBI',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 1, accountMask: '0972', counterpartyName: 'PRAVEEN VE', counterpartyPhone: '221', transferRef: '615722061047' },
  },
  {
    name: 'ICICI debit leg — dual-leg + same transfer ref for cross-bank linkage',
    sender: 'ICICIB',
    sms: 'ICICI Bank Acct XX171 debited with Rs 1.00 on 06-Jun-26 & Acct XX972 credited.IMPS:615722061047. Call 18002662 for dispute or SMS BLOCK 171 to 9215676766',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 1, accountMask: '171', selfDualLeg: true, counterpartyMask: '972', transferRef: '615722061047' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — ICICI real-world format coverage (new patterns added Jun-26)
// ─────────────────────────────────────────────────────────────────────────────
const ICICI_FORMATS = [
  {
    // "debited; PAYEE SO credited" — semicolon-separated beneficiary format.
    // smsParser fix: '; ' added to LEFT_ANCHORS + ' SO '/' CREDITED' to RIGHT_ANCHORS.
    // Known messageParser issue: merchant currently resolves to 'dispute' (trailing noise).
    name: 'ICICI UPI debit — semicolon beneficiary format (Vikram Singh)',
    sender: 'ICICIB',
    sms: 'ICICI Bank Acct XX708 debited for Rs 800.00 on 05-Jun-26; VIKRAM SINGH SO credited. UPI:109957293799. Call 18002662 for dispute. SMS BLOCK 708 to 9215676766.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 800, accountMask: '708' },
  },
  {
    // InfoTRF to FD — internal Fixed Deposit transfer, should be Bank account, self-transfer.
    // smsParser fix: SELF_TRANSFER_REGEX extended with info\s*trf / trf\s+to\s+fd.
    // Known messageParser issues: accountType wrongly 'Credit Card'; accountMask null.
    name: 'ICICI InfoTRF to Fixed Deposit (self-transfer)',
    sender: 'ICICIB',
    sms: 'ICICI Bank Acc XX708 debited Rs. 1,70,000.00 on 30-May-26 InfoTRF TO FD no..Avl Bal Rs. 30,570.12.To dispute call 18002662 or SMS BLOCK 708 to 9215676766',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 170000, accountMask: '708' },
  },
  {
    // NEFT delivery confirmation sent to the INITIATOR (sender).
    // "credited to the beneficiary account" = our NEFT reached the recipient → our side is DEBIT.
    // Known messageParser issue: type resolves to 'credit' (sees 'credited' keyword).
    name: 'ICICI NEFT outgoing — delivery confirmation to sender',
    sender: 'ICICIB',
    sms: 'ICICI BANK NEFT Transaction with reference number IN52611200536803 for Rs. 587418.00 has been credited to the beneficiary account on 22-04-2026 at 10:36:44',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 587418 },
  },
  {
    // "credited...from NAME" UPI inward — smsParser fix: ' FROM ' added to LEFT_ANCHORS.
    name: 'ICICI UPI credit — FROM-pattern merchant (Divyanshu Sriva)',
    sender: 'ICICIB',
    sms: 'Dear Customer, Acct XX708 is credited with Rs 1.00 on 07-Jun-26 from DIVYANSHU SRIVA. UPI:615833843559-ICICI Bank.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 1, accountMask: '708', merchant: 'DIVYANSHU SRIVA' },
  },
];

const SUITES = [
  ['Original (real bank SMS)', ORIGINAL],
  ['Adversarial (edge cases)', ADVERSARIAL],
  ['Lookalike (spam / decoy)', LOOKALIKE],
  ['Real-world (P2P / self-transfer)', REAL_WORLD],
  ['ICICI format coverage (Jun-26)', ICICI_FORMATS],
];

// ─────────────────────────────────────────────────────────────────────────────
// Assertion engine — compares only the fields specified in `expect`.
// ─────────────────────────────────────────────────────────────────────────────
const C = { red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m' };

function checkCase({ sender, sms, expect }) {
  const r = parseMessageDetailed(sms, { sender });
  const fails = [];

  if (expect.accept === true) {
    if (!r.ok) return [`expected ACCEPT but got REJECT [${r.error.code}]`];
    const t = r.transaction;
    const cmp = (key, actual, want) => { if (want !== undefined && actual !== want) fails.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`); };
    cmp('type', t.type, expect.type);
    cmp('accountType', t.accountType, expect.accountType);
    cmp('amount', t.amount, expect.amount);
    cmp('categoryId', t.categoryId, expect.categoryId);
    cmp('accountMask', t.accountMask, expect.accountMask);
    cmp('merchant', t.merchant, expect.merchant);
    cmp('selfDualLeg', t.selfDualLeg, expect.selfDualLeg);
    cmp('counterpartyMask', t.counterpartyMask, expect.counterpartyMask);
    cmp('counterpartyPhone', t.counterpartyPhone, expect.counterpartyPhone);
    cmp('counterpartyName', t.counterpartyName, expect.counterpartyName);
    cmp('transferRef', t.transferRef, expect.transferRef);
    if (expect.merchantIncludes !== undefined && !(t.merchant || '').includes(expect.merchantIncludes))
      fails.push(`merchant: expected to include ${JSON.stringify(expect.merchantIncludes)}, got ${JSON.stringify(t.merchant)}`);
  } else {
    // expect.accept === false  → must be rejected / intercepted
    if (r.ok) return [`expected REJECT but got ACCEPT (type=${r.transaction.type}, ${r.transaction.amount})`];
    if (expect.code !== undefined && r.error.code !== expect.code)
      fails.push(`code: expected ${JSON.stringify(expect.code)}, got ${JSON.stringify(r.error.code)}`);
  }
  return fails;
}

let total = 0, passed = 0;
const failures = [];

console.log(`\n${C.bold}══════ SMS Parser Test Suite ══════${C.reset}\n`);
for (const [label, suite] of SUITES) {
  let sp = 0;
  for (const tc of suite) {
    total++;
    const fails = checkCase(tc);
    if (fails.length === 0) { passed++; sp++; }
    else failures.push({ label, name: tc.name, fails });
  }
  const ok = sp === suite.length;
  console.log(`  ${ok ? C.green + '✓' : C.red + '✗'} ${label.padEnd(36)} ${sp}/${suite.length}${C.reset}`);
}

if (failures.length) {
  console.log(`\n${C.red}${C.bold}FAILURES (${failures.length}):${C.reset}`);
  for (const f of failures) {
    console.log(`\n  ${C.red}✗ [${f.label}] ${f.name}${C.reset}`);
    for (const line of f.fails) console.log(`      ${C.yellow}${line}${C.reset}`);
  }
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
const allPass = passed === total;
console.log(`  ${allPass ? C.green : C.red}${C.bold}${passed}/${total} passed${C.reset}\n`);
process.exit(allPass ? 0 : 1);
