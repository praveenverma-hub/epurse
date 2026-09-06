// =============================================================================
// Categories + the keyword dictionary the SMS parser uses to classify txns.
// -----------------------------------------------------------------------------
// Strategy: identify the *merchant brand* in the SMS body (Swiggy, Uber,
// Amazon, Netflix…) and assign the category that matches the brand.
// Generic words like "UPI", "txn" are NOT category keywords — they're just
// payment rails and would over-trigger.
// =============================================================================

export const DEFAULT_CATEGORIES = [
  { id: 'food',          name: 'Food & Dining',  color: '#FF5A1F', emoji: '🍔' },
  { id: 'travel',        name: 'Travel & Cabs',  color: '#3B82F6', emoji: '🚕' },
  { id: 'fuel',          name: 'Fuel',           color: '#F97316', emoji: '⛽' },
  { id: 'bills',         name: 'Bills & Utility',color: '#8B5CF6', emoji: '💡' },
  { id: 'shopping',      name: 'Shopping',       color: '#EC4899', emoji: '🛍️' },
  { id: 'groceries',     name: 'Groceries',      color: '#10B981', emoji: '🥦' },
  { id: 'entertainment', name: 'Entertainment',  color: '#F59E0B', emoji: '🎬' },
  { id: 'health',        name: 'Health & Fitness', color: '#EF4444', emoji: '💊' },
  { id: 'education',     name: 'Education',      color: '#0EA5E9', emoji: '🎓' },
  { id: 'investments',   name: 'Investments',    color: '#14B8A6', emoji: '📈' },
  { id: 'salary',        name: 'Salary',         color: '#059669', emoji: '💰' },
  { id: 'transfer',      name: 'P2P Transfer',   color: '#6B7280', emoji: '🔁' },
  { id: 'self',          name: 'Self Transfer',  color: '#6B7280', emoji: '🔄' },
  { id: 'lent',          name: 'You Lent',       color: '#10B981', emoji: '🤝' },
  { id: 'borrowed',      name: 'You Borrowed',   color: '#8B5CF6', emoji: '🧾' },
  { id: 'lent_settled',  name: 'Lent Settled',   color: '#14B8A6', emoji: '✅' },
  { id: 'borrow_repaid', name: 'Borrow Repaid',  color: '#6366F1', emoji: '💳' },
  // Credit-card bill payment — money leaving a bank account to clear a card's dues.
  // A liability settlement, NOT spend (the card purchases were already counted), so
  // it lives in NON_SPEND_CATS and is excluded from all totals.
  { id: 'cc_bill',       name: 'Credit Card Bill', color: '#8B5CF6', emoji: '💳' },
  // Repaying money you borrowed. Unlike the borrow_repaid ledger marker, this IS a
  // real expense (the money leaves an account now, and the original purchase was
  // usually never logged) — so it is NOT in NON_SPEND_CATEGORY_IDS and counts as spend.
  { id: 'repayment',     name: 'Repayment',      color: '#6B7280', emoji: '💸' },
  { id: 'other',         name: 'Other',          color: '#9CA3AF', emoji: '📌' },
];

/**
 * Category ids that move money but are NOT spend/income — excluded from every
 * total, chart and analytic (Spent/Earned, category breakdown, spending pace,
 * merchant bubbles, subscriptions, budgets). Balances still track these; only
 * the "how much did I spend/earn" view ignores them.
 *
 *  - lent / borrowed / lent_settled / borrow_repaid → the lend-borrow ledger
 *  - self → transfers between the user's own accounts
 *  - cc_bill → paying off a credit-card bill (the card purchases were already counted)
 *
 * SINGLE SOURCE OF TRUTH. The store re-exports this as NON_SPEND_CATS and the
 * analytics selectors import it directly — do not fork a second copy. Add a new
 * non-spend category here and every exclusion site picks it up.
 */
export const NON_SPEND_CATEGORY_IDS = new Set([
  'lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'self', 'cc_bill',
]);

/**
 * Merchant-brand → category map.
 * Keys are lowercase substrings searched in the SMS body and the parsed
 * merchant string. Order doesn't matter — first hit wins.
 */
export const CATEGORY_KEYWORDS = {
  food: [
    // Indian food delivery
    'swiggy', 'zomato', 'eatfit', 'faasos', 'box8', 'freshmenu', 'eatsure',
    // Restaurants / fast-food
    'mcdonald', 'kfc', 'dominos', 'pizza hut', 'subway', 'burger king',
    'starbucks', 'cafe coffee day', ' ccd ', 'haldiram', 'barbeque nation',
    'chai point', 'theobroma', 'wow momo',
    // Generic
    'restaurant', 'cafe ', 'cafe.', 'dining', 'eatery',
  ],
  travel: [
    // Cab apps
    'uber', 'ola ', 'olacabs', 'rapido', 'meru', 'jugnoo', 'blusmart',
    // Travel booking
    'irctc', 'makemytrip', 'mmt ', 'goibibo', 'cleartrip', 'ixigo',
    'easemytrip', 'yatra', 'redbus', 'abhibus', 'agoda', 'oyo', 'airbnb',
    'booking.com',
    // Airlines
    'indigo', 'spicejet', 'air india', 'vistara', 'akasa',
    // Transit / generic
    'metro', 'fastag', 'paytm fastag', 'flight', 'cab ', 'cab.',
  ],
  fuel: [
    'fuel', 'petrol', 'diesel', 'shell', 'hpcl', 'iocl', 'bpcl',
    'reliance petroleum', 'indian oil', 'hp petrol', 'bharat petroleum',
  ],
  bills: [
    // Telecom
    'jio', 'airtel', 'vi recharge', 'vodafone', 'bsnl', 'mtnl',
    // ISP / DTH
    'broadband', 'tata sky', 'tatasky', 'tata play', 'd2h', 'dish tv', 'dth',
    // Utility
    'electricity', 'water bill', 'gas bill', 'bescom', 'mseb', 'kseb',
    'mahanagar gas', 'igl bill', 'adani gas',
    // Recharge / rent / insurance
    'recharge', 'rent', 'lic premium', 'insurance', 'premium paid',
    'hdfc ergo', 'bajaj allianz', 'icici lombard',
  ],
  shopping: [
    // E-commerce
    'amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'snapdeal', 'tata cliq',
    'nykaa', 'firstcry', 'lenskart', 'bewakoof', 'urbanic', 'limeroad',
    // Electronics / brands
    'apple store', 'apple.com', 'croma', 'reliance digital', 'vijay sales',
    'samsung shop', 'mi store',
    // Apparel
    'lifestyle', 'pantaloons', 'shoppers stop', 'westside',
    'h&m', 'zara ', 'uniqlo', 'levis', 'puma', 'nike', 'adidas', 'decathlon',
    // Generic
    ' mall ', 'shopping',
  ],
  groceries: [
    'bigbasket', 'blinkit', 'zepto', 'instamart', 'dunzo',
    'dmart', 'd-mart', 'd mart',
    'reliance fresh', 'reliance smart', 'spencer', 'natures basket',
    ' more ', 'kirana', 'grocery', 'supermarket',
  ],
  entertainment: [
    // Streaming
    'netflix', 'prime video', 'amazon prime', 'hotstar', 'disney+',
    'spotify', 'youtube premium', 'sonyliv', 'sony liv', 'zee5', 'voot',
    'mubi', 'jiocinema', 'jio cinema', 'eros now',
    // Music
    'gaana', 'wynk', 'jiosaavn',
    // Movies / events
    'bookmyshow', 'pvr ', 'inox', 'cinepolis',
  ],
  health: [
    // Pharmacy
    'pharmeasy', '1mg', 'tata 1mg', 'netmeds', 'apollo pharmacy', 'medplus',
    'medlife', 'practo',
    // Fitness
    'cult fit', 'cure fit', 'cult.fit', 'gympik', 'gym ', 'fitness',
    // Generic
    'pharmacy', 'hospital', 'clinic', 'doctor', 'medicine',
  ],
  education: [
    'unacademy', 'byju', 'vedantu', 'whitehat', 'cuemath', 'simplilearn',
    'coursera', 'udemy', 'upgrad', 'edx ',
    'school fee', 'college fee', 'tuition',
  ],
  investments: [
    'zerodha', 'upstox', 'groww', 'kuvera', 'paytm money', 'inditrade',
    'smallcase', 'ind money',
    ' sip ', 'mutual fund', ' mf ', ' nps ', ' ppf ', ' fd ', ' rd ',
    'dividend', 'div payout', 'ach/nacs',
  ],
  salary: ['salary', 'payroll', 'stipend', 'wages credited', 'compensation'],
  transfer: [
    // P2P transfers — generic pattern, lowest priority
    'imps to', 'neft to', 'rtgs to', 'transferred to', 'sent to ',
    'paid to mr', 'paid to mrs', 'paid to ms',
  ],
  lent: [
    'you lent', 'lent to', 'loaned to', 'gave loan', 'gave to',
  ],
  borrowed: [
    'you borrowed', 'borrowed from', 'loan taken', 'took loan',
  ],
  lent_settled: [
    // NOT a bare 'returned' or 'settled' (both removed Aug-26): they fired on bank
    // narration that has
    // nothing to do with a person — "NEFT returned by the beneficiary bank",
    // "returned cheque", "your transaction has been settled" (routine card-network
    // wording) — and put those credits in the lend/borrow LEDGER as a
    // phantom repayment, where they also stopped counting as money in (lent_settled
    // is in NON_SPEND_CATS). Real returns of money are handled by the isRefund path.
    // Keep every keyword here person-scoped for the same reason.
    'settlement received', 'paid back', 'returned amount', 'repayment received',
  ],
  borrow_repaid: [
    'loan repaid', 'repaid', 'repayment done', 'paid back to', 'borrow repaid',
    'borrowed amount paid',
  ],
};

export const ACCOUNT_TYPES = {
  BANK: 'Bank',
  CREDIT_CARD: 'Credit Card',
  DEBIT_CARD: 'Debit Card',
  WALLET: 'Digital Wallet',
  CASH: 'Cash',
};

// Single source for the emoji + short label shown for each account type — was
// duplicated identically in AccountCard.tsx and AccountsScreen.js (a third,
// differently-worded all-caps subtitle map lives only in AccountCard, for the
// card's own visual style, and is NOT folded in here since it isn't a dupe).
export const ACCOUNT_TYPE_EMOJI = {
  [ACCOUNT_TYPES.BANK]: '🏦',
  [ACCOUNT_TYPES.CREDIT_CARD]: '💳',
  [ACCOUNT_TYPES.DEBIT_CARD]: '🏧',
  [ACCOUNT_TYPES.WALLET]: '👛',
  [ACCOUNT_TYPES.CASH]: '💵',
};

export const ACCOUNT_TYPE_LABEL = {
  [ACCOUNT_TYPES.BANK]: 'Bank',
  [ACCOUNT_TYPES.CREDIT_CARD]: 'Credit Card',
  [ACCOUNT_TYPES.DEBIT_CARD]: 'Debit Card',
  [ACCOUNT_TYPES.WALLET]: 'Wallet',
  [ACCOUNT_TYPES.CASH]: 'Cash',
};

export const TRANSACTION_TYPES = {
  DEBIT: 'debit',
  CREDIT: 'credit',
  LENT: 'lent',
  BORROWED: 'borrowed',
};
