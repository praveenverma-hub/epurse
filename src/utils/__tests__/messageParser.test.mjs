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
//   future_scheduled_debit · cc_payment_outgoing · emi_conversion
//   missing_transaction_keyword · amount_not_found
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
    // Payee name ends with a "/" before the UPI ref ("GULAFSHA  D/. UPI:...").
    // The trailing "/" must terminate the merchant (not break it like "A/c"),
    // else the regex skips ahead to the dispute phone and falls back to sender.
    name: 'UPI debit to payee with trailing slash',
    sender: 'INDIANBK',
    sms: 'A/c *9532 debited Rs. 690.00 on 11-06-26 to GULAFSHA  D/. UPI:338920462510. Not you? SMS BLOCK to 9289592895, Dial 1930 for Cyber Fraud - Indian Bank',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 690, accountMask: '9532', merchant: 'GULAFSHA D' },
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

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Investments (FD/SIP/mandate/autopay), debit cards & marketing
// (Jun-26). Asserts the fields the parser resolves reliably. Merchant/category
// are intentionally NOT asserted where extraction is still weak — see the
// per-case KNOWN GAP notes; those are tracked follow-ups, not regressions.
// ─────────────────────────────────────────────────────────────────────────────
const INVEST_CARDS_MARKETING = [
  // KNOWN GAP: ideally a self-transfer (own money → FD, non-spend); booked as a
  // debit/investments today. Merchant noisy ("creation of Term Deposit No").
  {
    name: 'FD creation — savings debited to fund a Term Deposit',
    sender: 'ICICIB',
    sms: 'FD Created: Your Savings A/c XX9532 has been debited by Rs.50,000.00 for creation of Term Deposit No. 9940129482. Interest Rate: 7.10% p.a. Maturity Date: 07-Jun-2027.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 50000, accountMask: '9532' },
  },
  // KNOWN GAP: ideally self-transfer (principal return). Merchant leaks sender.
  {
    name: 'FD maturity — proceeds credited back to A/c',
    sender: 'INDBNK',
    sms: 'Alert: Fixed Deposit No. XXXXXX4412 for INR 1,00,000.00 has matured on 06-Jun-26 & total proceeds of INR 1,07,450.00 have been credited back to your Indian Bank A/c XX9532.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 107450, accountMask: '9532' },
  },
  // KNOWN GAP: merchant should be the fund ("Parag Parikh…"); currently leaks sender.
  {
    name: 'SIP via NACH toward a mutual fund',
    sender: 'HDFCBK',
    sms: 'SIP Order: Your HDFC Bank A/c XX4398 has been debited with ₹5,000.00 on 05-Jun-26 via NACH toward PARAG PARIKH FLEXI CAP FUND-GROWTH. Folio No: 8812493/11.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 5000, accountMask: '4398', categoryId: 'investments' },
  },
  // KNOWN GAP: merchant should be "Groww"; currently leaks sender.
  {
    name: 'Groww NACH mandate debit',
    sender: 'AXISBK',
    sms: 'Groww Alert: Mandate debit request of INR 10,000.00 initiated by GROWW-STOCKS against your Axis Bank A/c XX1102 on 04/06/26.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 10000, accountMask: '1102', categoryId: 'investments' },
  },
  // KNOWN GAP: merchant should be "Apple One"; category ideally subscription. Leaks sender.
  {
    name: 'UPI-autopay subscription debit (Apple One)',
    sender: 'ICICIB',
    sms: 'Autopay Executed: Your ICICI Bank A/c XX2019 has been debited by ₹3,199.00 on 05-Jun-26 for Apple One Premium Bundle annual subscription via UPI Mandate Ref: UMN993041.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 3199, accountMask: '2019' },
  },
  // Scheduled for tomorrow → money has NOT moved yet.
  {
    name: 'BillDesk auto-debit scheduled tomorrow',
    sender: 'BLDESK',
    sms: 'BillDesk Alert: Auto-debit of Rs.1,450.00 scheduled tomorrow (08-Jun-26) for your BESCOM Electricity Bill from your anchored HDFC Credit Card ending 9876.',
    expect: { accept: false, code: 'future_scheduled_debit' },
  },
  // KNOWN GAP: merchant noisy ("a purchase of Rs.850"); category still resolves to food.
  {
    name: 'Indian Bank debit-card purchase (CCD)',
    sender: 'INDBNK',
    sms: 'Thank you for using your Indian Bank Debit Card ending 9182 for a purchase of Rs.850.00 at CAFE COFFEE DAY DELHI on 06-Jun-26. Avl Bal: Rs.14,210.35.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 850, accountMask: '9182', categoryId: 'food' },
  },
  // Clean end-to-end: merchant + category both resolve.
  {
    name: 'Axis debit-card swipe (Croma)',
    sender: 'AXISBK',
    sms: 'Txn Alert: Your Axis Bank Debit Card XX4412 was swiped for INR 12,500.00 at TATA CROMA STORES on 04/06/26. Clean Balance: INR 31,400.12.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 12500, accountMask: '4412', merchant: 'TATA CROMA STORES', categoryId: 'shopping' },
  },
  // Marketing — pre-approved credit-limit upgrade.
  {
    name: 'CC limit-upgrade offer (marketing)',
    sender: 'ICICIB',
    sms: 'Pre-Approved Offer: Get an instant credit limit upgrade on your ICICI Credit Card xx5004 up to ₹3,50,000.00 at ZERO processing fee. SMS CCUPG to 56767.',
    expect: { accept: false, code: 'promotional_offer' },
  },
  // Marketing — limit-to-loan conversion.
  {
    name: 'InstaLoan conversion (marketing)',
    sender: 'HDFCBK',
    sms: 'Urgent: Rs.75,000.00 Cash is waiting to be transferred! Convert your HDFC CC 9876 available limit into an instant InstaLoan today. Tap hdfcbk.io/iloan.',
    expect: { accept: false, code: 'promotional_offer' },
  },
  // Marketing — discount blast ("50% OFF" / "Use code"). The ₹150 / ₹499 are not a spend.
  {
    name: 'Swiggy discount blast (marketing)',
    sender: 'SBICRD',
    sms: 'Special Deal: Get up to 50% OFF on Swiggy using your SBI Credit Card ending 1234. Max discount ₹150 on orders above ₹499. Use code SBIFOOD.',
    expect: { accept: false, code: 'promotional_offer' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — FASTag, intl/DCC, fuel surcharge, reversals, EMI conversion, DBT.
// ─────────────────────────────────────────────────────────────────────────────
const FASTAG_FX_SURCHARGE = [
  // FASTag toll debit → wallet account, toll plaza merchant, travel.
  {
    name: 'FASTag toll debit (SBI wallet)',
    sender: 'SBIINB',
    sms: 'FASTag Debit: ₹310.00 debited from your linked SBI FASTag wallet for vehicle DL3C-XX-1102 at Kherki Daula Plaza on 07-Jun-26 14:10:02. Avl Bal: ₹180.00.',
    expect: { accept: true, type: 'debit', accountType: 'Digital Wallet', amount: 310, merchant: 'Kherki Daula Plaza', categoryId: 'travel' },
  },
  // FASTag low-balance alert — no money moved.
  {
    name: 'FASTag low-balance alert',
    sender: 'HDFCBK',
    sms: 'Alert: Your HDFC FASTag wallet balance for MH12-XX-9876 has fallen below threshold. Current: Rs.95.00.',
    expect: { accept: false, code: 'missing_transaction_keyword' },
  },
  // International charge with DCC — must book the INR equivalent, not the USD figure.
  {
    name: 'Intl card charge with DCC (INR equiv)',
    sender: 'ICICIB',
    sms: 'Intl Txn: Your ICICI Bank Credit Card xx5004 was charged USD 15.00 at OpenAI San Francisco on 06-Jun-26. Dynamic Currency Conversion (DCC) Equiv: INR 1,262.45.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1262.45, accountMask: '5004', merchant: 'OpenAI San Francisco' },
  },
  // Fuel purchase + surcharge line — must book the main ₹2,000, not the ₹20 surcharge.
  {
    name: 'Fuel purchase with surcharge line',
    sender: 'HDFCBK',
    sms: 'Txn Alert: Your HDFC Credit Card xx9876 charged Rs.2,000.00 at HPCL Fuel Station, Delhi on 06-Jun-26. Fuel Surcharge of Rs.20.00 + GST levied additionally.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 2000, accountMask: '9876', merchant: 'HPCL Fuel Station', categoryId: 'fuel' },
  },
  // Surcharge-waiver reversal → credit back to the card. KNOWN GAP: merchant noisy.
  {
    name: 'Fuel surcharge reversal (credit to CC)',
    sender: 'HDFCBK',
    sms: 'Surcharge Waiver: Reversal of Rs.20.00 credited to your HDFC Credit Card xx9876 on 07-Jun-26 towards Fuel Surcharge Waiver.',
    expect: { accept: true, type: 'credit', accountType: 'Credit Card', amount: 20, accountMask: '9876' },
  },
  // EMI conversion of an already-booked purchase — must NOT double-count the ₹45,000.
  {
    name: 'EMI conversion notice (no double-count)',
    sender: 'HDFCBK',
    sms: 'EMI Alert: Your recent purchase of Rs.45,000.00 at APPLE INDIA STORE on HDFC CC xx9876 has been converted to 6 Months EMI. Monthly Installment: Rs.7,950.00.',
    expect: { accept: false, code: 'emi_conversion' },
  },
  // Govt DBT / tax refund credit. KNOWN GAP: merchant leaks sender; category 'other'.
  {
    name: 'DBT income-tax refund (credit)',
    sender: 'SBIINB',
    sms: 'DBT Credit: INR 2,000.00 credited to your State Bank of India A/c XX7741 on 05-Jun-26 via NACH/PFMS towards Income Tax Refund AY 2026-27.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 2000, accountMask: '7741' },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8 — 50-message real-world sweep (UPI/CC/DC/NACH, Jun-26)
// Bugs fixed: added IDBI+Amex to sender list, "money sent"/"money in"/"charged"
// to TRANSACTION_PHRASES, "money in" to credit-direction regex, Bank-before-Wallet
// ordering in inferAccountType.
// Known gaps (not asserted): merchant falls back to sender for "towards X" /
// "Money Sent" / "NACH" formats; "Amex Card"/"Axis Card"/"OneCard" parsed as
// Debit Card when body lacks explicit "credit card" keyword.
// ─────────────────────────────────────────────────────────────────────────────
const UPI_CC_DC_NACH = [
  // ── CAT 1: UPI Outflows ──────────────────────────────────────────────────
  { name: 'HDFC UPI debit to Zomato',
    sender: 'HDFCBK', sms: 'Rs.150.00 debited from A/c XX4398 via UPI to ZOMATO on 08-Jun-26 Ref 61599021. Bal: Rs.24,500.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 150, accountMask: '4398' } },
  { name: 'Axis Bank UPI debit to Chai Point',
    sender: 'AXISBK', sms: 'Txn Alert: ₹45.00 debited from your Axis Bank A/c XX1102 to CHAI POINT via UPI. Ref No: 615920119. Avl Bal: ₹12,140.22.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 45, accountMask: '1102' } },
  { name: 'Kotak UPI debit to MakeMyTrip',
    sender: 'KOTAKB', sms: 'Your Kotak Bank A/c XX5124 has been debited by ₹2,500.00 to MAKE MY TRIP via UPI Ref 6157811. Avl Bal: ₹45,100.12.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 2500, accountMask: '5124' } },
  // "Money Sent:" prefix — previously rejected missing_transaction_keyword
  { name: 'Money Sent prefix (UPI debit)',
    sender: 'AXISBK', sms: 'Money Sent: Rs.60.00 to LOCAL KIRYANA STORE from A/c XX1102 via UPI on 08-Jun-26. Current Bal: Rs.11,220.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 60, accountMask: '1102' } },
  { name: 'PNB UPI debit to Swiggy Instamart',
    sender: 'PNBSMS', sms: 'Debited: INR 180.00 from PNB A/c XX3021 via UPI to SWIGGY INSTAMART. Ref: 6159821. Bal: INR 8,430.22.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 180, accountMask: '3021' } },
  // ── CAT 2: UPI Inward / P2P Credits ─────────────────────────────────────
  { name: 'HDFC UPI credit from person',
    sender: 'HDFCBK', sms: 'Money Received: Rs.500.00 credited to your HDFC A/c XX4398 via UPI from Amit Verma on 08-Jun-26. Ref: 61599301. Bal: Rs.25,000.00.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 500, accountMask: '4398' } },
  { name: 'SBI UPI credit — Received! prefix',
    sender: 'SBIBNK', sms: 'Received! ₹3,000.00 into SBI A/c XX7741 from Sakshi Umrao via UPI on 08/06/26. Ref: 6159401. Balance: ₹7,120.35.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 3000, accountMask: '7741' } },
  // "Money In:" prefix — previously rejected missing_transaction_keyword
  { name: 'Money In prefix (UPI credit)',
    sender: 'AXISBK', sms: 'Money In: Rs.10,000.00 to A/c XX1102 via UPI from Papa Kanpur on 06-Jun-26. Current Bal: Rs.21,220.00.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 10000, accountMask: '1102' } },
  { name: 'Kotak UPI credit — Bank type despite paytm VPA in body',
    sender: 'KOTAKB', sms: 'Your Kotak Bank A/c XX5124 has been credited by ₹800.00 via UPI from splitwise@paytm Ref 6157922. Avl Bal: ₹45,900.12.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 800, accountMask: '5124' } },
  { name: 'BoB UPI cashback credit',
    sender: 'BOBIBN', sms: 'ALERT: ₹35.00 credited to your Bank of Baroda A/c XX8812 via UPI towards Merchant Cashback. Ref: 6158999. Bal: ₹14,385.00.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 35, accountMask: '8812' } },
  // ── CAT 3: Credit Card Spends ────────────────────────────────────────────
  { name: 'HDFC CC spend at Amazon',
    sender: 'HDFCBK', sms: 'Txn Alert: Your HDFC Bank Credit Card ending 9876 was spent for Rs.4,350.00 at AMAZON INDIA on 08-Jun-26. Available Limit: Rs.1,45,650.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 4350, accountMask: '9876' } },
  { name: 'ICICI CC spend at Uber',
    sender: 'ICICIB', sms: 'Alert: ₹850.00 was spent on your ICICI Credit Card xx5004 at UBER INDIA on 07/06/26. Current Available Limit: ₹88,400.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 850, accountMask: '5004' } },
  // "charged on" — previously rejected missing_transaction_keyword
  { name: 'Axis Card charged-on format',
    sender: 'AXISBK', sms: 'Transaction Alert: INR 2,150.00 charged on Axis Card xx1002 at SWIGGY DINESTRUCT on 08-Jun-26. Outstanding Amount: INR 14,250.00.',
    expect: { accept: true, type: 'debit', amount: 2150, accountMask: '1002' } },
  // Amex — previously rejected source_not_financial; amex added to sender keys
  { name: 'Amex Card spend at Taj Hotels',
    sender: 'AMEXIN', sms: 'Your Amex Card ending 2004 was used for a payment of ₹6,800.00 at TAJ HOTELS on 07-Jun-26. Available Spends Limit: ₹3,12,000.00.',
    expect: { accept: true, type: 'debit', amount: 6800, accountMask: '2004', merchant: 'TAJ HOTELS' } },
  { name: 'Kotak CC spend at MakeMyTrip',
    sender: 'KOTAKB', sms: 'Alert: INR 18,500.00 spent on Kotak Credit Card xx3192 at MAKE MY TRIP on 08/06/26. Avl Limit: INR 1,11,500.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 18500, accountMask: '3192' } },
  { name: 'IDFC CC spend at Shell fuel',
    sender: 'IDFCFB', sms: 'Txn Info: Your IDFC FIRST Credit Card ending 7741 was charged Rs.1,250.00 at SHELL FUEL STATION on 07-Jun-26. Avl Limit: Rs.78,200.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1250, accountMask: '7741', merchant: 'SHELL FUEL STATION' } },
  { name: 'RBL CC swiped at Starbucks',
    sender: 'RBLBNK', sms: 'Your RBL Bank Credit Card xx6631 was swiped for ₹350.00 at STARBUCKS DELHI on 08-Jun-26. Available Credit Limit: ₹64,150.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 350, accountMask: '6631' } },
  { name: 'IndusInd CC spend at Zara',
    sender: 'INDUSB', sms: 'Notification: Rs.8,990.00 spent on IndusInd Credit Card ending 5512 at ZARA INDIA on 06-Jun-26. Clear Spends Limit: Rs.1,41,010.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 8990, accountMask: '5512' } },
  // ── CAT 4: Debit Card POS / ECOM ────────────────────────────────────────
  { name: 'Axis Debit Card swiped at Shoppers Stop',
    sender: 'AXISBK', sms: 'Txn Alert: Your Axis Bank Debit Card XX4412 was swiped for INR 4,500.00 at SHOPPERS STOP on 07/06/26. Clean Balance: INR 26,900.12.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 4500, accountMask: '4412', merchant: 'SHOPPERS STOP' } },
  { name: 'SBI Debit Card ECOM at Flipkart',
    sender: 'SBICRD', sms: 'Debited: Rs.2,500.00 from your SBI Debit Card ending 1124 via ATM Cash ECOM at FLIPKART INDIA on 06-Jun-26. Avl Bal: Rs.41,200.00.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 2500, accountMask: '1124' } },
  { name: 'HDFC Debit Card POS at Decathlon',
    sender: 'HDFCBK', sms: 'Your HDFC Bank Debit Card ending 4398 was used for a POS transaction of ₹1,850.00 at DECATHLON DELHI on 08-Jun-26. Avl Bal: ₹20,580.00.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 1850, accountMask: '4398', merchant: 'DECATHLON DELHI' } },
  { name: 'ICICI Debit Card debit at Paytm Parking',
    sender: 'ICICIB', sms: 'Alert: INR 350.00 debited from ICICI Debit Card xx2019 at PAYTM PARKING PLAZA on 07-Jun-26. Balance left: INR 45,200.12.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 350, accountMask: '2019' } },
  // IDBI — previously rejected source_not_financial; idbi added to sender keys
  { name: 'IDBI Debit Card ECOM at Rebel Foods',
    sender: 'IDBIBK', sms: 'Transaction Info: INR 750.00 debited from your IDBI Debit Card xx4110 at REBEL FOODS via ECOM on 08-Jun-26. Bal: INR 12,400.00.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 750, accountMask: '4110' } },
  { name: 'Canara Bank Debit Card POS at Big Bazaar',
    sender: 'CANBNK', sms: 'Debited: ₹3,200.00 from Canara Bank Debit Card ending 5541 via POS at BIG BAZAAR on 07-Jun-26. Avl Bal: ₹18,100.00.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 3200, accountMask: '5541' } },
  // ── CAT 5: Autopay / NACH / SI ───────────────────────────────────────────
  { name: 'Axis Autopay debit for Netflix mandate',
    sender: 'AXISBK', sms: 'Autopay Debit: Your Axis Bank A/c XX1102 has been debited by ₹799.00 on 05-Jun-26 for NETFLIX INDIA mandate. Ref: UPI-MP-99410A. Bal: ₹24,150.22.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 799, accountMask: '1102' } },
  // Mandate hold (fund block, money not moved) — correct reject
  { name: 'Mandate hold / fund block (not a spend)',
    sender: 'HDFCBK', sms: 'Mandate Block: INR 3,500.00 has been held in HDFC A/c XX4398 on 04/06/26 for Zoomcar booking ref 88319. Funds will be captured post-trip.',
    expect: { accept: false } },
  { name: 'ICICI Autopay Executed for Apple One',
    sender: 'ICICIB', sms: 'Autopay Executed: Your ICICI Bank A/c XX2019 has been debited by ₹3,199.00 on 05-Jun-26 for Apple One Premium Bundle via UPI Mandate Ref: UMN993041.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 3199, accountMask: '2019' } },
  { name: 'SBI SI debit for Home Loan EMI',
    sender: 'SBICRD', sms: 'Standing Instruction: Your SBI Savings A/c XX7741 debited by Rs.15,000.00 towards Home Loan EMI Ref LH99401 on 05-Jun-26. Avl Bal: Rs.61,400.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 15000, accountMask: '7741' } },
  { name: 'Kotak NACH debit for Nippon Life Insurance',
    sender: 'KOTAKB', sms: 'NACH Alert: Rs.2,499.00 debited from your Kotak Bank A/c XX5124 towards NIPPON LIFE INSURANCE mandate on 08-Jun-26. Bal: Rs.42,601.12.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 2499, accountMask: '5124' } },
  { name: 'PNB UPI Mandate for YouTube Premium',
    sender: 'PNBSMS', sms: 'UPI Mandate: ₹149.00 successfully debited from PNB A/c XX3021 for YouTube Premium automated subscription. Ref: 61594011.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 149, accountMask: '3021' } },
  { name: 'BoB SI Executed for Tata Power',
    sender: 'BOBIBN', sms: 'SI Executed: Your Bank of Baroda A/c XX8812 has been debited by INR 4,300.00 for Tata Power SI mandate on 07-Jun-26. Bal: INR 8,850.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 4300, accountMask: '8812' } },
  { name: 'HDFC CC Autopay for JioFiber',
    sender: 'HDFCBK', sms: 'Autopay Notification: Rs.699.00 debited from HDFC Credit Card xx9876 for JioFiber Automated Bill Pay. Available Limit: Rs.1,44,951.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 699, accountMask: '9876' } },
  { name: 'Axis Mandate Executed for Spotify',
    sender: 'AXISBK', sms: 'Mandate Executed: INR 599.00 debited from Axis Bank A/c XX1102 for Spotify Premium annual mandate on 06-Jun-26. Bal: INR 23,551.22.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 599, accountMask: '1102' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9 — Investments, FASTag variants, fuel surcharge pairs, EMI/loan (Jun-26)
// Bugs fixed: COMPLETED_TRANSACTION_REGEX guard on PROMOTIONAL_OFFER_REGEX (loan
// disbursal); "charged"/"billed" added to CC_BILL_HARD_CONFIRMATION_REGEX; broadened
// EMI_CONVERSION_REGEX to catch "to convert … into … EMI" setup confirmations;
// "processed into" added to isCredit direction regex; debitedFromThisAccount guard;
// reward-points accumulation/redeem added to PROMOTIONAL_OFFER_REGEX.
// Known gaps: NPS "confirms receipt" rejected (no txn phrase — own RD confirms right);
// OneCard "first installment generated in statement" rejected (informational, not debit);
// merchant falls back to sender for "towards X" / NACH formats.
// ─────────────────────────────────────────────────────────────────────────────
const INVEST_FASTAG_EMI = [
  // ── CAT 6: Investments ──────────────────────────────────────────────────
  { name: 'Indian Bank FD creation (debit from savings)',
    sender: 'INDBNK', sms: 'FD Created: Your Savings A/c XX9532 has been debited by Rs.50,000.00 for creation of Term Deposit No. 9940129482. Interest Rate: 7.10% p.a. Maturity Date: 07-Jun-2027.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 50000, accountMask: '9532' } },
  { name: 'Indian Bank FD maturity (credit back)',
    sender: 'INDBNK', sms: 'Alert: Fixed Deposit No. XXXXXX4412 for INR 1,00,000.00 has matured on 06-Jun-26 & total proceeds of INR 1,07,450.00 have been credited back to your Indian Bank A/c XX9532.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 107450, accountMask: '9532' } },
  { name: 'HDFC SIP NACH debit to MF',
    sender: 'HDFCBK', sms: 'SIP Order: Your HDFC Bank A/c XX4398 has been debited with ₹5,000.00 on 05-Jun-26 via NACH toward PARAG PARIKH FLEXI CAP FUND-GROWTH. Folio No: 8812493/11.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 5000, accountMask: '4398' } },
  // "processed into" direction — previously parsed as DEBIT
  { name: 'MF dividend credit (processed into)',
    sender: 'ICICIB', sms: 'Mutual Fund Credit: Dividend payout of Rs.1,250.00 has been processed into your ICICI Bank A/c XX2019 from SBI Bluechip Fund. Avl Bal: Rs.46,450.12.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 1250, accountMask: '2019' } },
  { name: 'Zerodha SIP debit via Netbanking',
    sender: 'SBICRD', sms: 'Zerodha Coin: Your SIP installment of ₹2,500.00 for Zerodha Nifty LargeMidcap 250 Index Fund has been debited via Netbanking from SBI A/c XX7741.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 2500, accountMask: '7741' } },
  // RD — "credited by debited" dual phrasing; debitedFromThisAccount guard kicks in
  { name: 'RD installment (credited-by-debited format → debit)',
    sender: 'HDFCBK', sms: 'RD Alert: Monthly Recurring Deposit A/c RD00911 has been credited by debited Rs.5,000.00 from your HDFC Savings A/c XX4398 on 08-Jun-26. Bal: Rs.15,580.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 5000, accountMask: '4398' } },
  { name: 'Kotak PPF contribution (transfer credit to PPF)',
    sender: 'KOTAKB', sms: 'PPF Contribution: Your Public Provident Fund A/c XX1104 has been credited with Rs.12,500.00 via transfer from your Kotak Bank A/c XX5124 on 05-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 12500, accountMask: '1104' } },
  { name: 'HDFC Securities stock purchase debit',
    sender: 'HDFCBK', sms: 'Stock Purchase: Your HDFC Securities trading account debited by ₹45,210.00 towards purchase of TATA MOTORS equity on 08-Jun-26. Linked A/c XX4398 debited.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 45210, accountMask: '4398' } },
  // ── CAT 7: FASTag variants ───────────────────────────────────────────────
  { name: 'ICICI FASTag toll debit (linked A/c)',
    sender: 'ICICIB', sms: 'ICICI FASTag: Toll fee of Rs.85.00 debited for vehicle HR26-AB-4412 at Eastern Peripheral Expressway on 08-Jun-26. Linked A/c XX2019 debited.',
    expect: { accept: true, type: 'debit', amount: 85 } },
  { name: 'Paytm FASTag wallet debit at toll',
    sender: 'PYTMWT', sms: 'Paytm FASTag: ₹150.00 debited for vehicle UP78-CD-9532 at Kanpur Toll Plaza on 06-Jun-26. Available Wallet Balance: ₹420.00.',
    expect: { accept: true, type: 'debit', accountType: 'Digital Wallet', amount: 150, merchant: 'Kanpur Toll Plaza' } },
  { name: 'Axis FASTag wallet debit at expressway',
    sender: 'AXISBK', sms: 'Axis FASTag: Rs.240.00 debited for vehicle DL1C-W-2019 at Yamuna Expressway Plaza on 05-Jun-26. Remaining dynamic wallet balance: Rs.1,150.00.',
    expect: { accept: true, type: 'debit', amount: 240 } },
  { name: 'IDFC FASTag wallet recharge (credit)',
    sender: 'IDFCFB', sms: 'Recharge Success: Your IDFC FASTag wallet for vehicle MH02-EE-7741 has been credited with ₹2,000.00 via UPI. Current Wallet Balance: ₹2,450.00.',
    expect: { accept: true, type: 'credit', amount: 2000 } },
  { name: 'BoB FASTag wallet toll debit',
    sender: 'BOBIBN', sms: 'Toll Alert: ₹40.00 debited from your Bank of Baroda FASTag wallet for vehicle DL3C-XX-1102 at DND Flyway on 08-Jun-26. Avl Bal: ₹140.00.',
    expect: { accept: true, type: 'debit', amount: 40 } },
  { name: 'Kotak FASTag low-balance alert (no transaction)',
    sender: 'KOTAKB', sms: 'FASTag Low Bal: Balance in your Kotak FASTag wallet for HR26-AB-4412 is Rs.45.00. Please top-up to ensure seamless passage at next toll barrier.',
    expect: { accept: false } },
  { name: 'SBI FASTag wallet toll debit',
    sender: 'SBIINB', sms: 'Txn Alert: Rs.60.00 debited from SBI FASTag wallet for vehicle UP78-CD-9532 at Ganga Expressway Plaza on 07-Jun-26. Wallet Balance: Rs.360.00.',
    expect: { accept: true, type: 'debit', accountType: 'Digital Wallet', amount: 60 } },
  { name: 'HDFC FASTag auto-recharge (bank debit)',
    sender: 'HDFCBK', sms: 'FASTag Auto-Recharge: Your HDFC Bank A/c XX4398 has been debited by ₹1,000.00 towards automated top-up of linked FASTag account MH12-XX-9876.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 1000, accountMask: '4398' } },
  // ── CAT 8: Fuel surcharge pairs ──────────────────────────────────────────
  { name: 'ICICI CC fuel purchase (main charge vs surcharge)',
    sender: 'ICICIB', sms: 'Your ICICI Credit Card xx5004 was used for Rs.1,500.00 at Indian Oil Petrol Pump on 08-Jun-26. Surcharge of Rs.15.00 applied. Waiver will follow.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1500, accountMask: '5004' } },
  { name: 'ICICI fuel surcharge waiver credit',
    sender: 'ICICIB', sms: 'Waiver Alert: Rs.15.00 credited back to your ICICI Credit Card xx5004 on 09-Jun-26 towards IOCL Fuel Surcharge Waiver. Outstanding updated.',
    expect: { accept: true, type: 'credit', accountType: 'Credit Card', amount: 15, accountMask: '5004' } },
  { name: 'SBI CC fuel spend (surcharge + Fuel Promo)',
    sender: 'SBICRD', sms: 'Spent: Rs.3,000.00 on SBI Credit Card ending 1234 at Bharat Petroleum Mumbai on 05-Jun-26. Surcharge levied: Rs.30.00. Fuel Promo applied.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 3000, accountMask: '1234' } },
  { name: 'SBI BPCL surcharge reversal credit',
    sender: 'SBICRD', sms: 'Surcharge Refund: Reversal of INR 30.00 processed into your SBI Credit Card ending 1234 towards BPCL Surcharge Waiver on 07-Jun-26.',
    expect: { accept: true, type: 'credit', accountType: 'Credit Card', amount: 30, accountMask: '1234' } },
  // "charged to … outstanding" — previously rejected cc_bill_reminder; "charged" now hard-confirms
  { name: 'Axis CC Shell Fuel charged (outstanding in body)',
    sender: 'AXISBK', sms: 'Txn: Rs.1,000.00 charged to your Axis Bank Credit Card xx1002 at Shell Fuel on 08-Jun-26. Surcharge of Rs.10.00 + GST added to active outstanding.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1000, accountMask: '1002', merchant: 'Shell Fuel' } },
  { name: 'Axis Shell surcharge waiver credit',
    sender: 'AXISBK', sms: 'Waiver Credit: Your Axis Bank Credit Card xx1002 has been credited with Rs.10.00 towards Shell Surcharge Waiver on 09-Jun-26.',
    expect: { accept: true, type: 'credit', amount: 10, accountMask: '1002' } },
  { name: 'Kotak CC HPCL surcharge levied (amount = surcharge, not total)',
    sender: 'KOTAKB', sms: 'Alert: Fuel Surcharge of Rs.25.00 levied on your Kotak Credit Card xx3192 for purchase at HPCL Station on 06-Jun-26. Total charge: Rs.2,525.00.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 25, accountMask: '3192' } },
  { name: 'Kotak HPCL surcharge reversal credit',
    sender: 'KOTAKB', sms: 'Waiver Settled: Kotak Credit Card xx3192 credited with Rs.25.00 on 08-Jun-26 towards HPCL Surcharge Reversal. Clear Limit updated.',
    expect: { accept: true, type: 'credit', amount: 25, accountMask: '3192' } },
  // ── CAT 9: EMI / loan ────────────────────────────────────────────────────
  { name: 'ICICI Amazon purchase converted to EMI (reject)',
    sender: 'ICICIB', sms: 'Your Amazon purchase of Rs.18,000.00 on ICICI Credit Card xx5004 has been converted to 3 Months EMI. First installment of Rs.6,200.00 bills next cycle.',
    expect: { accept: false, code: 'emi_conversion' } },
  // Loan disbursal — "pre-approved" label; previously rejected as promo; COMPLETED_TRANSACTION_REGEX guard
  { name: 'SBI pre-approved loan disbursal (real credit)',
    sender: 'SBICRD', sms: 'Loan Disbursal: Pre-approved loan of Rs.2,00,000.00 has been credited to your SBI Savings A/c XX7741 via Loan A/c LN99401. EMI of Rs.8,500.00 starts 05-Jul-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 200000, accountMask: '7741' } },
  // EMI setup confirmation — "to convert … into … EMI"; previously mis-accepted as ₹25k spend
  { name: 'HDFC EMI setup confirmation (reject as emi_conversion)',
    sender: 'HDFCBK', sms: 'Your request to convert Rs.25,000.00 spent at TATA MOTORS SERVICE on HDFC CC 9876 into 12 Months EMI has been successfully set up. Ref: EMI202611.',
    expect: { accept: false, code: 'emi_conversion' } },
  { name: 'HDFC No-Cost EMI interest subvention credit',
    sender: 'HDFCBK', sms: 'Your No-Cost EMI request for Rs.12,000.00 on Flipkart using HDFC Credit Card 9876 has been approved. Interest subvention of Rs.450.00 credited.',
    expect: { accept: true, type: 'credit', accountType: 'Credit Card', amount: 450, accountMask: '9876' } },
  { name: 'Axis InstaLoan top-up credit',
    sender: 'AXISBK', sms: 'Loan Top-Up: INR 50,000.00 successfully transferred to your Axis Bank Savings A/c XX1102 via InstaLoan processing gateway. Ref No: IL99410.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 50000, accountMask: '1102' } },
  // "billed to … Minimum due updated" — previously rejected cc_bill_reminder; "billed" now hard-confirms
  { name: 'SBI CC monthly EMI billed (Minimum due in body)',
    sender: 'SBICRD', sms: 'EMI Notification: Your monthly card EMI of Rs.4,320.00 for Laptop Purchase has been billed to your SBI Credit Card ending 1234. Minimum due updated.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 4320, accountMask: '1234' } },
  { name: 'Bajaj Finserv consumer durable loan disbursed',
    sender: 'ICICIB', sms: 'Consumer Durable Loan: Rs.35,000.00 disbursed by Bajaj Finserv to Reliance Digital for your purchase. Monthly auto-debit set from ICICI A/c XX2019.',
    expect: { accept: true, type: 'debit', amount: 35000, accountMask: '2019' } },
  // ── CAT 10: Marketing spam ───────────────────────────────────────────────
  { name: 'HDFC pre-approved loan marketing (no completed verb)',
    sender: 'HDFCBK', sms: 'Dear Customer, ₹5,00,000.00 has been pre-approved on your HDFC Savings Account XX4398. Instant disbursal in 2 mins. Apply via HDFC Mobile App today!',
    expect: { accept: false, code: 'promotional_offer' } },
  { name: 'SBI CC limit increase notification (marketing)',
    sender: 'SBICRD', sms: 'Great News! The credit limit on your SBI Credit Card ending 1234 has been increased from Rs.1,50,000.00 to Rs.2,50,000.00 at zero cost. Avail now.',
    expect: { accept: false, code: 'promotional_offer' } },
  // Reward-points accumulation summary — previously mis-accepted as ₹3,625 spend
  { name: 'HDFC reward-points summary (not a transaction)',
    sender: 'HDFCBK', sms: 'Dear Customer, your HDFC Credit Card ending 9876 has accumulated 14,500 Reward Points worth Rs.3,625.00. T&C apply. Redeem now via HDFC Netbanking.',
    expect: { accept: false, code: 'promotional_offer' } },
];

// Suite 10 — Credit-limit & mandate-setup edge cases (Jun-26)
// Fixes: PROMOTIONAL_OFFER_REGEX extended to catch "limit...changed" + "increasing the limit";
//        MANDATE_SETUP_REGEX added to reject autopay/NACH mandate creation confirmations.
const CREDIT_LIMIT_MANDATE = [
  // ── Credit limit upsell / change notifications ───────────────────────────
  { name: 'ICICI CC limit upsell SMS (increasing the limit)',
    sender: 'ICICIB',
    sms: 'Manage spends effectively by increasing the limit on ICICI Bank Credit Card XX7004 from Rs150000 to Rs180000. SMS CRLIM 7004 to 5676766 to raise the limit',
    expect: { accept: false, code: 'promotional_offer' } },
  { name: 'ICICI CC credit limit changed notification',
    sender: 'ICICIB',
    sms: 'Dear Customer, The credit limit for your ICICI Bank Credit Card 4375X7004 has been changed from INR 150000 to INR 180000 on 2026-04-15.',
    expect: { accept: false, code: 'promotional_offer' } },
  // ── AutoPay mandate setup confirmation ───────────────────────────────────
  { name: 'ICICI AutoPay mandate created (not a real debit)',
    sender: 'ICICIB',
    sms: 'Your AutoPay mandate with ASPRESENTED is successfully created towards Www Airtel In from 08-May-26 to 08-May-36 for Rs 7000.00, RRN 612808586417-ICICI Bank.',
    expect: { accept: false, code: 'mandate_setup' } },
  // ── HDFC "Txn Rs.X" format (no debit verb, Gate-2 fix via 'txn' phrase) ──
  { name: 'HDFC CC UPI txn (multi-line, no debit verb)',
    sender: 'HDFCBK',
    sms: 'Txn Rs.305.00\nOn HDFC Bank Card 8077\nAt q327914270@ybl \nby UPI 307600331251\nOn 07-06\nNot You?\nCall 18002586161/SMS BLOCK CC 8077 to 7308080808',
    expect: { accept: true, type: 'debit', amount: 305, accountType: 'Credit Card', accountMask: '8077' } },
  // ── BENEFICIARY_CREDITED_REGEX: "; PAYEE credited" merchant extraction ───
  // Previously returned "dispute" (from "Call 18002662 for dispute") — must return "RADHIKA"
  { name: 'ICICI UPI debit — merchant from "; RADHIKA credited" not from footer',
    sender: 'ICICIB',
    sms: 'ICICI Bank Acct XX302 debited for Rs 1400.00 on 04-Jun-26; RADHIKA credited. UPI:607375520779. Call 18002662 for dispute. SMS BLOCK 302 to 9215676766.',
    expect: { accept: true, type: 'debit', amount: 1400, accountMask: '302', merchant: 'RADHIKA' } },
  // ── HDFC "Sent Rs.X" multi-line UPI format (Gate-2: "sent rs") ───────────
  { name: 'HDFC UPI "Sent Rs.X" multi-line format',
    sender: 'HDFCBK',
    sms: 'Sent Rs.3082.00\nFrom HDFC Bank A/C *5960\nTo JAYPEE INFRATECH LIMITED\nOn 08/06/26\nRef 615949682807\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
    expect: { accept: true, type: 'debit', amount: 3082, accountType: 'Bank', accountMask: '5960', merchantIncludes: 'JAYPEE' } },
];

// SUITE 11 — Debit-card↔bank co-reference (coAccountMask). One SMS that names
// BOTH a card and the a/c it draws from → surface the OTHER mask so the store can
// suggest merging the card into its bank. A plain single-account SMS must NOT set it.
const DC_BANK_COREF = [
  { name: 'Debit-card spend names its source a/c → coAccountMask = the a/c',
    sender: 'HDFCBK', sms: 'Rs.1,200.00 spent on HDFC Debit Card xx1234 at SWIGGY on 06-Jun-26, linked to A/c xx5678. Avl Bal Rs.20,300.00.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 1200, accountMask: '1234', coAccountMask: '5678' } },
  { name: 'Plain bank debit (single mask) → no coAccountMask',
    sender: 'HDFCBK', sms: 'Rs.450.00 debited from A/c xx1234 on 06-Jun-26 to SWIGGY via UPI. Avl bal Rs.42,310.50',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 450, accountMask: '1234', coAccountMask: null } },
];

// Jul-26 stress batch — OTP delivery, declined/failed/blocked txns, CC bill-pay
// reminders, "processed for a transaction of" card usage, foreign-currency spends,
// and mask extraction for "CC XX####" / "account ending ####". Senders mirror the
// live probe. NOTE: a few accepts document KNOWN account-type gaps ("Card ending"
// / "<Bank> Card XX" without the word "credit" → Debit Card) — asserting only the
// fields that are stable (amount / mask / merchant), not the mis-inferred type.
const JUL26_STRESS = [
  // ── OTP delivery → never a transaction ──
  { name: 'OTP for CC transaction (Flipkart)',
    sender: 'ICICIB', sms: '817982 is One-Time Password for INR 87456.00 transaction towards Flipkart In using ICICI Bank Credit Card XX2001. OTPs are SECRET. DO NOT disclose',
    expect: { accept: false, code: 'otp_message' } },
  { name: 'OTP (do not share) + foreign amount',
    sender: 'AMEX', sms: 'Do not share your OTP. 432109 is the OTP for your transaction of USD 45.00 at AMAZON US on Amex Card ending 3002.',
    expect: { accept: false, code: 'otp_message' } },

  // ── Declined / failed / blocked → no money moved ──
  { name: 'Transaction declined (insufficient funds)',
    sender: 'HDFCBK', sms: 'TRANSACTION DECLINED: Your request for INR 3,200.00 at ZOMATO on HDFC Bank Card XX9876 failed due to Insufficient Funds.',
    expect: { accept: false, code: 'transaction_failed' } },
  { name: 'Transaction failed (reversed if debited)',
    sender: 'HDFCBK', sms: 'TRANSACTION FAILED: Rs. 5,000.00 to A/c XX4321 failed at 14:22 on 04-Jul-26. Amount will be reversed if debited.',
    expect: { accept: false, code: 'transaction_failed' } },
  { name: 'Transaction blocked (suspected activity)',
    sender: 'AXISBK', sms: 'Txn of INR 12,500.00 on Axis Bank Debit Card XX9981 at Croma was BLOCKED due to suspected activity. Call bank if this was you.',
    expect: { accept: false, code: 'transaction_failed' } },

  // ── CC bill-pay reminder (with bank name between "your" and "credit card") ──
  { name: 'Pay your <bank> credit card bill before <date> → ccDue',
    sender: 'HDFCBK', sms: 'Pay your HDFC credit card bill of Rs.45,120.00 before 10-Jul to avoid late fees. Click hdfc.com/pay.',
    expect: { accept: false, code: 'cc_bill_reminder' } },

  // ── Promotional / limit / loan ──
  { name: 'Credit limit increased → promo',
    sender: 'SBICRD', sms: 'Congratulations! The credit limit on your SBI Card XX1004 has been increased to INR 3,00,000. T&C Apply.',
    expect: { accept: false, code: 'promotional_offer' } },
  { name: 'Pre-approved car loan → promo',
    sender: 'ICICIB', sms: 'Pre-approved! Get a pre-approved car loan of up to INR 12,00,000 from ICICI Bank today. Check offer in iMobile app.',
    expect: { accept: false, code: 'promotional_offer' } },

  // ── Real spends ──
  { name: 'Bank debit "towards Amazon India" → merchant recovered',
    sender: 'HDFCBK', sms: 'Alert: INR 2,450.00 debited from HDFC Bank A/c XX9876 on 04-Jul-26 towards Amazon India. Clr Bal: INR 45,120.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 2450, accountMask: '9876', merchant: 'Amazon India', categoryId: 'shopping' } },
  { name: 'CC spend at Swiggy (Avl Limit ignored)',
    sender: 'ICICIB', sms: 'Spent Rs.450.00 on ICICI Bank Credit Card XX4002 at SWIGGY on 04/07/26. Avl Limit: Rs.1,20,000.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 450, accountMask: '4002', categoryId: 'food' } },
  { name: '"processed for a transaction of ₹X at MERCHANT" → accepted',
    sender: 'SBICRD', sms: 'Your SBI Card ending 1004 has been processed for a transaction of ₹12,999.00 at Apple Store on 04 Jul 26.',
    expect: { accept: true, type: 'debit', amount: 12999, accountMask: '1004', merchant: 'Apple Store' } },
  { name: 'CC spend at PVR',
    sender: 'KOTAKB', sms: 'Thank you for using Kotak Credit Card XX8812 for INR 1,240.50 at PVR CINEMAS on 04/07/26.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1240.5, accountMask: '8812' } },
  { name: 'Bank debit "towards MAKE MY TRIP" → merchant recovered',
    sender: 'FEDBNK', sms: 'Transaction alert: Rs 4,230.00 debited from Federal Bank A/c XX1293 on 04-07-26 towards MAKE MY TRIP.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 4230, accountMask: '1293', merchant: 'MAKE MY TRIP' } },
  { name: 'Metro via UPI, balance-in-A/c mask',
    sender: 'BOBTXN', sms: 'Paid ₹320.00 to BLR METRO via UPI Ref 6192039482. Balance in Bank of Baroda A/c XX4412: ₹12,400.00.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 320, accountMask: '4412', categoryId: 'travel' } },
  { name: 'Foreign USD (approx INR) picks INR amount, "CC XX####" mask',
    sender: 'ICICIB', sms: 'Txn of USD 15.00 (approx INR 1,260.00) done on ICICI Bank CC XX2001 at NETFLIX.COM on 04-Jul-26.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1260, accountMask: '2001', merchant: 'NETFLIX.COM' } },
  { name: 'Foreign JPY with "Approx INR X debited" picks INR',
    sender: 'ICICIB', sms: 'Spent JPY 4,500 at 7-ELEVEN TOKYO on ICICI Card XX2001. Approx INR 2,450.00 debited.',
    expect: { accept: true, type: 'debit', amount: 2450, accountMask: '2001' } },

  // ── Credits ──
  { name: 'Salary credit (NEFT)',
    sender: 'SBIINB', sms: 'Your a/c no. XXXXXX1234 has been credited with Salary of Rs 85,000.00 on 01-Jul-26 by NEFT (P2A).',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 85000, accountMask: '1234', categoryId: 'salary' } },
  { name: 'CC reversal credited back, "CC XX####" mask',
    sender: 'ICICIB', sms: 'REVERSAL: Rs 1,499.00 has been credited back to your ICICI Bank CC XX2001 from FLIPKART on 05-Jul-26.',
    expect: { accept: true, type: 'credit', accountType: 'Credit Card', amount: 1499, accountMask: '2001', merchant: 'FLIPKART' } },
  { name: 'Refund credit, "account ending ####" mask',
    sender: 'HDFCBK', sms: 'REFUND: Your account ending 4321 has been credited with ₹850.00 from UBER INDIA.',
    expect: { accept: true, type: 'credit', amount: 850, accountMask: '4321', merchant: 'UBER INDIA' } },
  { name: 'Dividend credit',
    sender: 'HDFCBK', sms: 'Dividend of INR 1,200.00 credited to your HDFC Bank A/c XX9876 by TCS LTD on 03-Jul-26.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 1200, accountMask: '9876' } },

  // ── Merchant edge cases (anchored payee w/ noise; NEFT remitter w/ no anchor) ──
  { name: 'UPI debit "to NAME/." + fraud footer → clean payee, not the footer number',
    sender: 'INDBNK', sms: 'A/c *9532 debited Rs. 690.00 on 11-06-26 to GULAFSHA  D/. UPI:338920462510. Not you? SMS BLOCK to 9289592895, Dial 1930 for Cyber Fraud - Indian Bank',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 690, accountMask: '9532', merchant: 'GULAFSHA D' } },
  { name: 'NEFT credit remitter from ref string (no to/from anchor)',
    sender: 'ICICIB', sms: 'ICICI Bank Account XX171 credited:Rs. 47,997.00 on 30-May-26. Info NEFT-AXISP00802935830-MOONSH. Available Balance is Rs. 1,75,406.96.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 47997, accountMask: '171', merchant: 'MOONSH' } },
];

// Jul-26 merchant/verb batch (#51-88) — "charged"/"for using" card-usage verbs, merchant
// cleanup ("using"/"(" stops, "order at"/"auto-renewal of"/"ride with" filler strip),
// "towards MERCHANT" and NEFT/IMPS "from REMITTER" recovery, subscriptions & VPAs.
const MERCHANT_JUL26 = [
  // "charged" as a standalone card-usage verb (was dropped when no "credit"/"debit" word present)
  { name: '"was charged INR X for auto-renewal of MERCHANT" (Amazon Prime)',
    sender: 'HDFCBK', sms: 'Your HDFC Bank Card XX9876 was charged INR 1,499.00 for auto-renewal of AMAZON PRIME MEMBERSHIP.',
    expect: { accept: true, type: 'debit', amount: 1499, accountMask: '9876', merchant: 'AMAZON PRIME MEMBERSHIP' } },
  { name: '"has been charged ₹X towards MERCHANT" (Spotify SI)',
    sender: 'SBICRD', sms: 'SI Alert: Your SBI Card ending 1004 has been charged ₹179.00 towards SPOTIFY INDIA.',
    expect: { accept: true, type: 'debit', amount: 179, accountMask: '1004', merchant: 'SPOTIFY INDIA', categoryId: 'entertainment' } },
  { name: '"Thank you for using <Card> for INR X at MERCHANT" (plain Card, IRCTC)',
    sender: 'AXISBK', sms: 'Thank you for using Axis Card XX1102 for INR 4,250.00 at IRCTC TICKETING.',
    expect: { accept: true, type: 'debit', amount: 4250, accountMask: '1102', merchant: 'IRCTC TICKETING', categoryId: 'travel' } },

  // Merchant boundary/cleanup fixes
  { name: '"to MERCHANT (UPI Ref …)" — "(" stops the merchant, no sender leak',
    sender: 'AXISBK', sms: 'Money transferred: ₹350.00 from Axis A/c XX1122 to SWIGGY FOOD DELIVERY (UPI Ref 6182739).',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 350, accountMask: '1122', merchant: 'SWIGGY FOOD DELIVERY' } },
  { name: '"at MERCHANT using <Card>" — "using" stops the merchant',
    sender: 'SBICRD', sms: 'Spent ₹1,050.00 at BBDaily using SBI Card XX1004. Avl Limit: ₹94,000.00.',
    expect: { accept: true, type: 'debit', amount: 1050, accountMask: '1004', merchant: 'BBDaily' } },
  { name: '"for order at MERCHANT" — filler stripped (Paytm wallet)',
    sender: 'PAYTM', sms: 'Your Paytm Wallet was debited by Rs.420.00 for order at BIGBASKET SUPERMARKET.',
    expect: { accept: true, type: 'debit', accountType: 'Digital Wallet', amount: 420, merchant: 'BIGBASKET SUPERMARKET' } },
  { name: '"for order at MERCHANT" — filler stripped (CC)',
    sender: 'AXISBK', sms: 'Your Axis Bank Credit Card XX1102 was charged Rs.14,999 for order at FLIPKART PAYMENTS.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 14999, accountMask: '1102', merchant: 'FLIPKART PAYMENTS' } },
  { name: '"for ride with MERCHANT" — filler stripped (Ola on wallet)',
    sender: 'PAYTM', sms: 'Txn of Rs.220.00 done on Paytm Wallet for ride with OLA CABS on 04-Jul-26.',
    expect: { accept: true, type: 'debit', accountType: 'Digital Wallet', amount: 220, merchant: 'OLA CABS', categoryId: 'travel' } },

  // "towards MERCHANT" recovery (recurring/subscription)
  { name: 'debit "towards AMAZON SELLER SERVICES"',
    sender: 'HDFCBK', sms: 'Alert: INR 2,340.80 debited from HDFC Bank A/c XX9876 towards AMAZON SELLER SERVICES.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 2340.8, accountMask: '9876', merchant: 'AMAZON SELLER SERVICES' } },
  { name: 'Recurring Txn "towards NETFLIX INDIA" on CC',
    sender: 'ICICIB', sms: 'Recurring Txn: Rs.649.00 debited from ICICI Bank CC XX2001 towards NETFLIX INDIA on 04-Jul-26.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 649, accountMask: '2001', merchant: 'NETFLIX INDIA', categoryId: 'entertainment' } },

  // Credits — NEFT/IMPS remitter + salary
  { name: 'Salary credit "via NEFT from VECTOSCALAR"',
    sender: 'HDFCBK', sms: 'Your HDFC Bank A/c XX9876 has been credited with Salary of INR 1,25,000.00 via NEFT from VECTOSCALAR.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 125000, accountMask: '9876', merchant: 'VECTOSCALAR', categoryId: 'salary' } },
  { name: 'IMPS credit "from ORANGEMANTRA TECH. Ref No:"',
    sender: 'SBIINB', sms: 'Account XX4321 credited with ₹45,000.00 via IMPS from ORANGEMANTRA TECH. Ref No: 6192837.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 45000, accountMask: '4321', merchant: 'ORANGEMANTRA TECH' } },
  { name: 'Dividend credit "from ZERODHA"',
    sender: 'KOTAKB', sms: 'Your Kotak Bank A/c XX8812 has been credited with Rs.3,240.00 via dividend payout from ZERODHA.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 3240, accountMask: '8812', merchant: 'ZERODHA' } },

  // VPA payees kept as-is at parser level (store enricher strips @suffix)
  { name: 'UPI VPA payee (zepto@ybl)',
    sender: 'KOTAKB', sms: 'Paid ₹85.00 to zepto@ybl via UPI from your Kotak Bank A/c XX8812.',
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 85, accountMask: '8812', merchant: 'zepto@ybl' } },
];

// Jul-26 edge batch (#89-118) — holds/pre-auth & reversals & disputes, EMI/SIP,
// foreign→INR, "AC XX####" mask, "sent from" transfers, merchant filler cleanup.
const EDGE_JUL26 = [
  // Non-transactions
  { name: 'EMI conversion of existing purchase → not a new txn',
    sender: 'ICICIB', sms: 'Your txn of INR 45,000.00 at APPLE STORE on ICICI Bank CC XX2001 has been converted to 6M EMI. Rs.8,120.00 pm will be debited.',
    expect: { accept: false, code: 'emi_conversion' } },
  { name: 'Pre-auth hold "held … This is not a charge" → not a spend',
    sender: 'ICICIB', sms: 'Pre-Auth Alert: INR 5,000.00 held on your ICICI Bank Credit Card XX2001 at TAJ HOTELS RESORTS. This is not a charge.',
    expect: { accept: false, code: 'preauth_hold' } },
  { name: 'Refundable security deposit "will be released" → not a spend',
    sender: 'SBICRD', sms: 'Blocked: ₹3,000.00 on SBI Card XX1004 for Zoomcar Security Deposit. Amount will be released post trip completion.',
    expect: { accept: false, code: 'preauth_hold' } },

  // Spends
  { name: 'SIP installment processed → debit, investments',
    sender: 'HDFCBK', sms: 'Auto-debit ALERT: Your SIP installment of ₹5,000.00 towards NIPPON INDIA MUTUAL FUND was processed from HDFC Bank A/c XX4321.',
    expect: { accept: true, type: 'debit', amount: 5000, accountMask: '4321', merchant: 'NIPPON INDIA MUTUAL FUND', categoryId: 'investments' } },
  { name: 'Foreign SGD auto-renewal picks "Equiv INR", merchant recovered',
    sender: 'AMEX', sms: 'Auto-Renewal Notice: Your Amex card ending 3002 was debited SGD 12.00 towards LINKEDIN PREMIUM. Equiv INR 745.22. Taxes extra.',
    expect: { accept: true, type: 'debit', amount: 745.22, accountMask: '3002', merchant: 'LINKEDIN PREMIUM' } },
  { name: 'Annual fee "+ GST" stops merchant (no sender leak)',
    sender: 'AXISBK', sms: 'Your Axis bank Credit card XX1102 has been charged INR 2,499.00 for Annual Membership Fee + GST. Accum. Reward Points: 4,500.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 2499, accountMask: '1102', merchant: 'Annual Membership Fee' } },
  { name: 'Fuel spend picks base amount, not the surcharge',
    sender: 'HDFCBK', sms: 'Spent Rs.1,200.00 at SHELL FUEL STATION on HDFC Card XX9876. Fuel Surcharge of Rs.12.00 applied (Waiver pending).',
    expect: { accept: true, type: 'debit', amount: 1200, accountMask: '9876', merchant: 'SHELL FUEL STATION', categoryId: 'fuel' } },
  { name: '"shopping at MERCHANT" filler stripped',
    sender: 'IDFCFB', sms: 'Thank you for shopping at RELIANCE RETAIL MART. ₹3,421.00 charged via UPI on your IDFC First Bank A/c XX5543.',
    expect: { accept: true, type: 'debit', amount: 3421, accountMask: '5543', merchant: 'RELIANCE RETAIL MART' } },
  { name: 'UPI Autopay subscription (YouTube Premium)',
    sender: 'SBIINB', sms: 'UPI Autopay: ₹199.00 debited from SBI A/c XX1004 towards YOUTUBE PREMIUM RECURRING.',
    expect: { accept: true, type: 'debit', amount: 199, accountMask: '1004', merchant: 'YOUTUBE PREMIUM RECURRING', categoryId: 'entertainment' } },
  { name: 'ATM withdrawal "AC XX####" (no slash) yields mask',
    sender: 'HDFCBK', sms: 'HDFCBank AC XX9876 Debited INR 4,500; ATM WDL; OMNI ATM BLR. Bal INR 12,000.',
    expect: { accept: true, type: 'debit', amount: 4500, accountMask: '9876' } },
  { name: '"Transfer: … sent from your A/c" → booked as debit',
    sender: 'SBIINB', sms: "Transfer: Rs.15,000.00 sent from your SBI A/c XX4321 to sister's account via IMPS. Net Bal: Rs.45,000.",
    expect: { accept: true, type: 'debit', accountType: 'Bank', amount: 15000, accountMask: '4321' } },

  // Credits — reversal / dispute / refund
  { name: 'Reversal "cancelled and reversed to your account" → CREDIT',
    sender: 'SBICRD', sms: 'REVERSAL: Txn of Rs.12,999.00 at FLIPKART on SBI Card XX1004 has been cancelled and reversed to your account.',
    expect: { accept: true, type: 'credit', amount: 12999, accountMask: '1004', merchant: 'FLIPKART' } },
  { name: 'Dispute settled credit, merchant "at UBER" recovered',
    sender: 'KOTAKB', sms: 'Dispute Settled: Your Kotak Bank A/c XX8812 has been credited with INR 3,200.00 for disputed transaction at UBER.',
    expect: { accept: true, type: 'credit', accountType: 'Bank', amount: 3200, accountMask: '8812', merchant: 'UBER' } },
  { name: 'Partial refund to CC (credit)',
    sender: 'HDFCBK', sms: 'Partial Refund: Rs.420.00 credited back to your HDFC Credit Card XX9876 from BLINKIT GROCERY.',
    expect: { accept: true, type: 'credit', accountType: 'Credit Card', amount: 420, accountMask: '9876', merchant: 'BLINKIT GROCERY' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// Outgoing credit-card bill payments (Jul-26) — money leaving a bank account to
// clear a card's dues. Detected as cc_payment_outgoing so it's kept OUT of the spend
// ledger (the card purchases were already counted). Only HIGH-CONFIDENCE wording
// ("credit card" / "cc bill") auto-fires; ambiguous channels (CRED) stay normal
// debits for the user to reclassify by hand.
// ─────────────────────────────────────────────────────────────────────────────
const CC_BILL_OUTGOING_JUL26 = [
  { name: 'Paid to <bank> credit card',
    sender: 'HDFCBK', sms: 'Rs.42,300.00 debited from a/c XX4021 and paid to HDFC credit card. Ref 900112.',
    expect: { accept: false, code: 'cc_payment_outgoing' } },
  { name: 'Credit card bill payment debited',
    sender: 'ICICIB', sms: 'Credit card bill payment of Rs.18,500 debited from A/c XX8899. Ref 5521.',
    expect: { accept: false, code: 'cc_payment_outgoing' } },
  { name: 'Towards credit card dues',
    sender: 'SBIINB', sms: 'INR 9,999 debited towards SBI credit card dues. Avl bal INR 51,203.',
    expect: { accept: false, code: 'cc_payment_outgoing' } },
  { name: 'CC bill pay narration',
    sender: 'KOTAKB', sms: 'Rs.12,000 debited from A/c XX5566 for cc bill payment. Ref 8890.',
    expect: { accept: false, code: 'cc_payment_outgoing' } },
  // Guard — ambiguous CRED payment stays a NORMAL debit (user reclassifies manually).
  { name: 'Guard: UPI to CRED stays a debit',
    sender: 'AXISBK', sms: 'Rs.25,000 debited from A/c XX1234 to CRED via UPI. Ref 774411.',
    expect: { accept: true, type: 'debit' } },
  // Guard — "credited" (incoming) must not be read as an outgoing CC bill.
  { name: 'Guard: salary credited',
    sender: 'HDFCBK', sms: 'Rs.85,000 credited to a/c XX4021 by ACME PAYROLL. Avl bal Rs.1,20,000.',
    expect: { accept: true, type: 'credit' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 15 — Cashback-offer promos & "to NAME.RRN <ref>" merchant leak (Jul-26)
//   · "Get X% Extra Cashback … Max. Cashback …" is an OFFER, not a txn (the amount
//     is a Min. Trxn threshold) → promotional_offer.
//   · "Sent Rs.X … to REEMA KUMARI.RRN 853904840357.Avl Bal …" — merchant must stop
//     at ".RRN"; the char class allows '.', so RRN/balance would otherwise glue on.
//   · Guard: a REAL "cashback credited" must still be accepted as a credit.
// ─────────────────────────────────────────────────────────────────────────────
const CASHBACK_RRN_JUL26 = [
  { name: 'SBI Monte Carlo cashback offer (Min. Trxn amount, not a txn)',
    sender: 'SBICRD',
    sms: "Get 5% Extra Cashback at Monte Carlo with your SBI Credit Card. Min. Trxn.: Rs.6500; Max. Cashback: Rs.750 per card a/c. Valid till 17-August'26. T&C",
    expect: { accept: false, code: 'promotional_offer' } },
  { name: 'Indian Bank UPI Sent — merchant stops at .RRN',
    sender: 'INDBNK',
    sms: 'Sent Rs.107.00 from A/c *9532 on 17-07-26 to REEMA KUMARI.RRN 853904840357.Avl Bal Rs.3300.67.Not you?SMS BLOCK to 9289592895-Indian Bank',
    expect: { accept: true, type: 'debit', amount: 107, accountMask: '9532', merchant: 'REEMA KUMARI' } },
  { name: 'Guard: real cashback credited still accepted',
    sender: 'HDFCBK',
    sms: 'Rs.50.00 cashback credited to your A/c *1234 on 17-07-26. Avl Bal Rs.500.00',
    expect: { accept: true, type: 'credit', amount: 50, accountMask: '1234' } },
  // "Flat Rs.X cashback" — 'flat' separated from 'cashback' by the amount, no % present.
  { name: 'ICICI Flat Rs.1000 cashback on flights offer',
    sender: 'ICICIB',
    sms: 'Flat Rs.1000 cashback on flights! Book with ICICI Credit Card, min spend Rs.10000. Offer valid till 31-Aug-26.',
    expect: { accept: false, code: 'promotional_offer' } },
  { name: 'HDFC get 10% cashback up to Rs.500 (use code) offer',
    sender: 'HDFCBK',
    sms: 'Get 10% cashback up to Rs.500 on your first Amazon order with HDFC Credit Card. Use code HDFC10. T&C apply.',
    expect: { accept: false, code: 'promotional_offer' } },
  { name: 'ICICI "Earn cashback on every UPI txn" festive offer (URL)',
    sender: 'ICICIB',
    sms: 'Win exciting rewards! Earn cashback on every UPI transaction this Diwali with ICICI Bank. Know more: http://icici.in/offer',
    expect: { accept: false, code: 'promotional_offer' } },
  // Guard: "received a cashback of Rs.X credited" (amount NOT adjacent to 'cashback') stays a credit.
  { name: 'Guard: "received a cashback of Rs.X credited" still books',
    sender: 'HDFCBK',
    sms: 'You received a cashback of Rs.75.50 credited to your A/c XX1234 for txn at Zomato. Avl Bal Rs.900.',
    expect: { accept: true, type: 'credit', amount: 75.5, accountMask: '1234' } },
  // CC payment received WITHOUT "has been" — must be a CC-payment notification (true-up),
  // NOT booked as a ₹12000 income credit. Previously the regex required "has been received".
  { name: 'SBI CC payment received (no "has been") → cc payment, not income',
    sender: 'SBICRD',
    sms: 'Payment of Rs.12000 received on your SBI Credit Card XX1234. Thank you.',
    expect: { accept: false, code: 'credit_card_payment_notification' } },
  // "Instant Discount" offer — must reject (was booked as a ₹9000 debit).
  { name: 'SBI "Get up to Rs.9000 Instant Discount" offer → rejected',
    sender: 'SBICRD',
    sms: "Get up to Rs. 9000 Instant Discount at Electronics Paradise with SBI Credit Card. Min. Trxn.: Rs. 20000; Max. Discount: Rs. 9000 per card. Validity: Till 21-August'26. T&C",
    expect: { accept: false, code: 'promotional_offer' } },
  // BillPay/BBPS: biller is the subject before "Bill", NOT the "from <card>" source.
  { name: 'BillPay bill paid via CC → merchant is the biller, debit on the card',
    sender: 'HDFCBK',
    sms: 'Bill Paid!\nSBI Life Bill 2x430759904 of Rs. 100000.00 paid on 22-Jul-2026 from HDFC Bank Credit Card 2170.\n\nBillPay Ref: HGALP147CC1079489174',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 100000, accountMask: '2170', merchant: 'SBI Life' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 16 — Rail abbreviations (NEFT/IMPS/RTGS Cr/Dr/of) & refund reason-clause
//   merchant cleanup (Jul-26). Banks often omit the -ed verb on rail transfers
//   ("NEFT Cr of Rs.X", "IMPS Dr Rs.X") — Gate-2 must still accept them, and "Cr"
//   must read as CREDIT. Refund/reversal narration ("by AMAZON for order
//   cancellation") must not bleed into the merchant.
// ─────────────────────────────────────────────────────────────────────────────
const RAIL_ABBREV_JUL26 = [
  { name: 'NEFT Cr of Rs.X (no -ed verb) → credit',
    sender: 'KOTAKB', sms: 'NEFT Cr of Rs.8000 in A/c XX5566 from ACME CORP LTD. Ref KKBKN00123.',
    expect: { accept: true, type: 'credit', amount: 8000, merchant: 'ACME CORP LTD' } },
  { name: 'IMPS Dr Rs.X (no -ed verb) → debit',
    sender: 'AXISBK', sms: 'IMPS Dr Rs.6000 from A/c XX5960 to VENDOR PAYMENTS. Ref 300112233445.',
    expect: { accept: true, type: 'debit', amount: 6000, merchant: 'VENDOR PAYMENTS' } },
  { name: 'RTGS Cr Rs.X large amount → credit',
    sender: 'ICICIB', sms: 'RTGS Cr Rs.9999999 to A/c XX302 from EXPORTS LTD. Ref R11223344.',
    expect: { accept: true, type: 'credit', amount: 9999999, merchant: 'EXPORTS LTD' } },
  { name: 'IMPS of Rs.X to payee successful (no verb) → debit',
    sender: 'PAYTMB', sms: 'IMPS of Rs.1500 to RAM KIRANA STORE successful from Paytm. Bal Rs.3500.',
    expect: { accept: true, type: 'debit', amount: 1500 } },
  { name: 'Refund merchant stops before "for order cancellation"',
    sender: 'HDFCBK', sms: 'Rs.750 refunded to A/c XX4021 by AMAZON for order cancellation on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 750, merchant: 'AMAZON' } },
  { name: 'NEFT rail-ref name merchant no longer bleeds "credited Rs"',
    sender: 'SBIINB', sms: 'Info: NEFT-SBIN0802935-MOONSHINE TECH-Rs.30000 credited to A/c XX9911.',
    expect: { accept: true, type: 'credit', amount: 30000, merchant: 'MOONSHINE TECH' } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 17 — Card-type inference: CC formats that omit the word "credit" (Jul-26).
//   A credit/available/card LIMIT, outstanding, or amount due are credit-card-ONLY
//   signals → Credit Card even without "credit card"/"cc". Bare "Card xxNNNN" with a
//   balance (or no signal) stays Debit Card. Explicit debit/ATM always Debit.
// ─────────────────────────────────────────────────────────────────────────────
const CARD_TYPE_JUL26 = [
  { name: 'Amex "Card ending" + Avl Limit → Credit Card',
    sender: 'AMEX', sms: 'INR 2,150.00 charged on Amex Card ending 1002 at FLIPKART on 22-07-26. Avl Limit Rs.98000.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 2150 } },
  { name: 'Axis Card xxNNNN + Outstanding → Credit Card',
    sender: 'AXISBK', sms: 'Txn of INR 1500 on Axis Card xx1002 at SWIGGY. Outstanding Rs.12000.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 1500 } },
  { name: 'Bare Card xxNNNN + Total amount due → Credit Card',
    sender: 'HDFCBK', sms: 'Rs.500 spent on Card xx8077 at ZOMATO. Total amount due Rs.6000.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 500 } },
  { name: 'Guard: "Bank Card xxNNNN" refund, no signal → Debit Card',
    sender: 'AXISBK', sms: 'Refund of Rs.120 to your Axis Bank Card xx4412 on 22-07-26.',
    expect: { accept: true, type: 'credit', accountType: 'Debit Card', amount: 120 } },
  { name: 'Guard: Debit Card + Avl Bal stays Debit Card',
    sender: 'ICICIB', sms: 'Rs.850 spent via Debit Card xx302 at BIG BAZAAR. Avl Bal Rs.9000.',
    expect: { accept: true, type: 'debit', accountType: 'Debit Card', amount: 850 } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 18 — 100-message stress-test findings (Jul-26): rail/format coverage,
//   reversal-vs-failed, the 10-crore cap, and unknown-sender card spends.
// ─────────────────────────────────────────────────────────────────────────────
const STRESS_FINDINGS_JUL26 = [
  { name: 'Reversal for a FAILED txn is a genuine credit (not swallowed)',
    sender: 'HDFCBK', sms: 'Rs.320 reversed to A/c XX4021 for failed ATM txn on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 320 } },
  { name: 'Future "will be reversed if debited" stays a decline',
    sender: 'HDFCBK', sms: 'TRANSACTION FAILED: Rs.5000 to A/c XX4321 failed at 14:22. Amount will be reversed if debited.',
    expect: { accept: false, code: 'transaction_failed' } },
  { name: 'Amount over ₹10 crore rejected (cap)',
    sender: 'HDFCBK', sms: 'Rs.10,00,00,001 debited from A/c XX4021 to VENDOR. Ref X.',
    expect: { accept: false, code: 'amount_exceeds_limit' } },
  { name: 'Exactly ₹10 crore still books',
    sender: 'HDFCBK', sms: 'Rs.10,00,00,000 debited from A/c XX4021 to VENDOR PAYMENT. Ref Y.',
    expect: { accept: true, type: 'debit', amount: 100000000 } },
  { name: 'Compact "UPI/DR/<ref>/PAYEE/Rs.X" (no verb) books',
    sender: 'HDFCBK', sms: 'UPI/DR/307600331251/AMAZON/Rs.1299 from A/c XX4021.',
    expect: { accept: true, type: 'debit', amount: 1299 } },
  { name: '"UPI payment to X … successful" (no -ed verb) books',
    sender: 'IDBIBK', sms: 'Rs.99 UPI payment to SPOTIFY from IDBI A/c XX3344 successful.',
    expect: { accept: true, type: 'debit', amount: 99 } },
  { name: '"Avl Cr Limit" → Credit Card (word "credit" absent)',
    sender: 'RBLBNK', sms: 'INR 640.00 spent on RBL Card xx5511 at MCDONALDS. Avl Cr Limit Rs.40000.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 640, merchant: 'MCDONALDS' } },
  { name: 'UPI "to MERCHANT from A/c" — merchant is the payee, not the source',
    sender: 'SBIINB', sms: 'Rs.1500 paid via UPI to RAM STORE from A/c XX9911. UPI Ref 219000112233.',
    expect: { accept: true, type: 'debit', amount: 1500, merchant: 'RAM STORE' } },
  { name: 'Card spend from an UNKNOWN sender still clears Gate-1 (card ref + spent)',
    sender: 'ONECRD', sms: 'Rs.780 spent on your Card xx3421 at ZARA. Total amount due Rs.9000.',
    expect: { accept: true, type: 'debit', accountType: 'Credit Card', amount: 780 } },
  // Pre-auth / hold (fuel, hotel) — money only blocked, real charge posts later. Must NOT book.
  { name: 'Fuel pre-auth hold ("final amount may vary") not booked',
    sender: 'SBIINB', sms: 'Rs.500 hold placed on A/c XX302 for fuel txn at HP PETROL. Final amount may vary.',
    expect: { accept: false, code: 'preauth_hold' } },
  // Wallet SMS with NO a/c mask + unrecognised sender — a wallet-brand phrase in the body
  // (+ debit term) clears Gate-1.
  { name: 'Amazon Pay balance spend (no a/c mask) books via wallet body signal',
    sender: 'AMZNIN', sms: 'Rs.299 paid using Amazon Pay balance at SWIGGY. Bal Rs.51.',
    expect: { accept: true, type: 'debit', accountType: 'Digital Wallet', amount: 299 } },
  { name: 'Mobikwik wallet debit books via wallet body signal',
    sender: 'MBKWIK', sms: 'Rs.120 debited from Mobikwik wallet for METRO recharge.',
    expect: { accept: true, type: 'debit', amount: 120 } },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 19 — Adversarial false-positive traps (Jul-26). Informational messages that
//   CARRY an amount but must NOT book a phantom transaction (the #1 trust-killer),
//   plus direction/amount correctness on genuine txns.
// ─────────────────────────────────────────────────────────────────────────────
const ADVERSARIAL_FP_JUL26 = [
  { name: 'Low-balance alert not booked',
    sender: 'HDFCBK', sms: 'Your A/c XX4021 balance is low: Rs.320.50. Add funds to avoid failed autopay.',
    expect: { accept: false, code: 'balance_alert' } },
  { name: 'Monthly spend summary not booked',
    sender: 'ICICIB', sms: 'You have spent Rs.45,000 this month on your ICICI Card. View insights on iMobile.',
    expect: { accept: false, code: 'non_transaction_notice' } },
  { name: 'Available-limit statement not booked',
    sender: 'SBICRD', sms: 'Your SBI Card XX7890 available limit is Rs.1,50,000. Shop more, earn more!',
    expect: { accept: false, code: 'non_transaction_notice' } },
  { name: '"Scheduled to be debited" future notice not booked',
    sender: 'HDFCBK', sms: 'Your SIP of Rs.5000 is scheduled to be debited on 25-Jul from A/c XX4021.',
    expect: { accept: false } },
  { name: 'FD "will mature and be credited" not booked',
    sender: 'SBIINB', sms: 'Your FD of Rs.100000 will mature on 30-Jul and be credited to A/c XX9911.',
    expect: { accept: false, code: 'non_transaction_notice' } },
  { name: 'Conditional "may be charged" not booked',
    sender: 'AXISBK', sms: 'You may be charged Rs.590 if minimum balance is not maintained in A/c XX5960.',
    expect: { accept: false, code: 'non_transaction_notice' } },
  { name: '"Salary expected to be credited" not booked',
    sender: 'HDFCBK', sms: 'Your salary of Rs.85000 is expected to be credited by 01-Aug.',
    expect: { accept: false } },
  { name: 'UPI "has FAILED. Amount not debited" not booked',
    sender: 'ICICIB', sms: 'Your UPI transaction of Rs.2000 to raj@ybl has FAILED. Amount not debited.',
    expect: { accept: false, code: 'transaction_failed' } },
  { name: 'creditedToOther → DEBIT direction',
    sender: 'HDFCBK', sms: 'Rs.5000 debited from A/c XX4021 and credited to the beneficiary RAHUL on 22-07.',
    expect: { accept: true, type: 'debit', amount: 5000 } },
  { name: 'debitedFromOther → CREDIT direction',
    sender: 'ICICIB', sms: 'Rs.3000 debited from beneficiary a/c; your A/c XX302 credited on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 3000 } },
  { name: 'Salary credit with TDS line → picks salary, not the TDS',
    sender: 'ICICIB', sms: 'Salary Rs.95000 credited to A/c XX302. TDS of Rs.5000 deducted.',
    expect: { accept: true, type: 'credit', amount: 95000 } },
  { name: 'Guard: real debit + trailing "low balance" advisory still books',
    sender: 'HDFCBK', sms: 'Rs.500 debited from A/c XX4021 at STORE. Low balance, please add funds.',
    expect: { accept: true, type: 'debit', amount: 500 } },
];

// SUITE 20 — Refund / reversal / cashback detection (Jul-26). Genuine money-back
//   credits must set isRefund; income & P2P credits and expense debits must NOT;
//   promo cashback OFFERS and "will be reversed" failures must not book at all.
// ─────────────────────────────────────────────────────────────────────────────
const REFUND_DETECTION_JUL26 = [
  { name: 'Refund credit → isRefund',
    sender: 'HDFCBK', sms: 'Rs.499 refunded to your A/c XX4021 by AMAZON for order #402 on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 499, isRefund: true } },
  { name: 'Reversal credit (failed txn reversed) → isRefund',
    sender: 'ICICIB', sms: 'Rs.2,320 reversed to your A/c XX302 for a failed txn on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 2320, isRefund: true } },
  { name: 'Cashback credited → isRefund (cashback = refund)',
    sender: 'AXISBK', sms: 'Rs.50 cashback credited to your A/c XX5960 on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 50, isRefund: true } },
  { name: '"returned to your account" → CREDIT + isRefund',
    sender: 'HDFCBK', sms: 'Rs.899 has been returned to your account XX4021 for a cancelled order.',
    expect: { accept: true, type: 'credit', amount: 899, isRefund: true } },
  { name: '"credited back" to card → isRefund',
    sender: 'SBICRD', sms: 'Rs.200 credited back to your SBI Credit Card XX7890 on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 200, isRefund: true } },
  { name: 'Salary credit is NOT a refund',
    sender: 'HDFCBK', sms: 'Rs.85,000 credited to A/c XX4021 - SALARY JUL 2026.',
    expect: { accept: true, type: 'credit', amount: 85000, isRefund: false } },
  { name: 'P2P credit is NOT a refund',
    sender: 'ICICIB', sms: 'Rs.1,500 credited to A/c XX302 by RAHUL via UPI on 22-07-26.',
    expect: { accept: true, type: 'credit', amount: 1500, isRefund: false } },
  { name: 'Expense debit is NOT a refund',
    sender: 'HDFCBK', sms: 'Rs.1,299 debited from A/c XX4021 at AMAZON on 22-07-26.',
    expect: { accept: true, type: 'debit', amount: 1299, isRefund: false } },
  { name: 'Promo cashback OFFER not booked at all',
    sender: 'HDFCBK', sms: 'Get flat Rs.100 cashback on your next UPI payment! Use code SAVE100.',
    expect: { accept: false } },
  { name: '"will be reversed" failure not booked',
    sender: 'ICICIB', sms: 'Your payment of Rs.500 to raj@ybl has failed. Amount will be reversed in 3 days.',
    expect: { accept: false } },
];

const SUITES = [
  ['Original (real bank SMS)', ORIGINAL],
  ['Adversarial (edge cases)', ADVERSARIAL],
  ['Lookalike (spam / decoy)', LOOKALIKE],
  ['Real-world (P2P / self-transfer)', REAL_WORLD],
  ['ICICI format coverage (Jun-26)', ICICI_FORMATS],
  ['Investments, cards & marketing (Jun-26)', INVEST_CARDS_MARKETING],
  ['FASTag, FX, surcharge & EMI (Jun-26)', FASTAG_FX_SURCHARGE],
  ['UPI / CC / DC / NACH sweep (Jun-26)', UPI_CC_DC_NACH],
  ['Investments / FASTag / fuel-waiver / EMI-loan (Jun-26)', INVEST_FASTAG_EMI],
  ['Credit-limit & mandate-setup (Jun-26)', CREDIT_LIMIT_MANDATE],
  ['Debit-card↔bank co-reference (Jun-26)', DC_BANK_COREF],
  ['Jul-26 stress (OTP/decline/CC-bill/foreign)', JUL26_STRESS],
  ['Jul-26 merchant/verb (#51-88)', MERCHANT_JUL26],
  ['Jul-26 edge (holds/reversals/EMI/#89-118)', EDGE_JUL26],
  ['CC bill outgoing (CRED/cc-bill, Jul-26)', CC_BILL_OUTGOING_JUL26],
  ['Cashback offer & .RRN merchant leak (Jul-26)', CASHBACK_RRN_JUL26],
  ['Rail abbreviations & refund merchant (Jul-26)', RAIL_ABBREV_JUL26],
  ['Card-type inference: CC without "credit" (Jul-26)', CARD_TYPE_JUL26],
  ['100-msg stress findings (Jul-26)', STRESS_FINDINGS_JUL26],
  ['Adversarial false-positive traps (Jul-26)', ADVERSARIAL_FP_JUL26],
  ['Refund / reversal / cashback detection (Jul-26)', REFUND_DETECTION_JUL26],
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
    cmp('isRefund', !!t.isRefund, expect.isRefund);
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
    cmp('coAccountMask', t.coAccountMask, expect.coAccountMask);
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
