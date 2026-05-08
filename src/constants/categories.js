// Default expense categories with iconography (emoji-based, no heavy images)
export const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'Food', icon: 'food', color: '#FF5A1F', emoji: '🍔' },
  { id: 'travel', name: 'Travel', icon: 'travel', color: '#3B82F6', emoji: '✈️' },
  { id: 'bills', name: 'Bills', icon: 'bills', color: '#8B5CF6', emoji: '💡' },
  { id: 'shopping', name: 'Shopping', icon: 'shopping', color: '#EC4899', emoji: '🛍️' },
  { id: 'groceries', name: 'Groceries', icon: 'groceries', color: '#10B981', emoji: '🥦' },
  { id: 'entertainment', name: 'Entertainment', icon: 'entertainment', color: '#F59E0B', emoji: '🎬' },
  { id: 'health', name: 'Health', icon: 'health', color: '#EF4444', emoji: '💊' },
  { id: 'salary', name: 'Salary', icon: 'salary', color: '#059669', emoji: '💰' },
  { id: 'transfer', name: 'Transfer', icon: 'transfer', color: '#6B7280', emoji: '🔁' },
  { id: 'other', name: 'Other', icon: 'other', color: '#9CA3AF', emoji: '📌' },
];

// Keyword → category mapping used by the message parser
export const CATEGORY_KEYWORDS = {
  food: ['swiggy', 'zomato', 'mcdonald', 'kfc', 'dominos', 'restaurant', 'cafe', 'starbucks', 'food', 'eat'],
  travel: ['uber', 'ola', 'rapido', 'irctc', 'makemytrip', 'goibibo', 'flight', 'metro', 'bus', 'cab', 'fuel', 'petrol'],
  bills: ['electricity', 'recharge', 'jio', 'airtel', 'broadband', 'water bill', 'gas bill', 'dth', 'rent'],
  shopping: ['amazon', 'flipkart', 'myntra', 'ajio', 'meesho', 'shopping', 'mall'],
  groceries: ['bigbasket', 'blinkit', 'zepto', 'dmart', 'reliance fresh', 'grocery', 'supermarket'],
  entertainment: ['netflix', 'prime video', 'hotstar', 'spotify', 'bookmyshow', 'cinema', 'pvr', 'inox'],
  health: ['pharmacy', 'apollo', 'medplus', 'hospital', 'clinic', 'doctor', 'medicine'],
  salary: ['salary', 'payroll', 'stipend'],
  transfer: ['upi', 'imps', 'neft', 'rtgs', 'transfer'],
};

export const ACCOUNT_TYPES = {
  BANK: 'Bank',
  CREDIT_CARD: 'Credit Card',
  WALLET: 'Digital Wallet',
  CASH: 'Cash',
};

export const TRANSACTION_TYPES = {
  DEBIT: 'debit',
  CREDIT: 'credit',
  LENT: 'lent',
  BORROWED: 'borrowed',
};
