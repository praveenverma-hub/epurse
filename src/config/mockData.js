// Opt in with EXPO_PUBLIC_MOCK_DATA=1 npx expo start --clear.
// A release bundle can never enable this, even with the environment flag set.
export const MOCK_DATA_ENABLED = typeof __DEV__ !== 'undefined' && __DEV__
  && process.env.EXPO_PUBLIC_MOCK_DATA === '1';

// Input facts only. No dashboard totals, percentages or chart points are mocked.
export const MOCK_SCENARIO = {
  reviewedTransactions: 6,
  months: 3,
  amountScale: 1,
  salary: 65000,
  openingBank: 30000,
  openingCash: 4000,
  creditLimit: 80000,
  expenses: [
    { merchant: 'Demo Market', amount: 1400, parent: 'food', child: 'groceries', account: 'bank' },
    { merchant: 'Demo Cafe', amount: 480, parent: 'food', child: 'fast_food', account: 'cash' },
    { merchant: 'Demo Cab', amount: 320, parent: 'travel', child: 'daily_commute', account: 'bank' },
    { merchant: 'Demo Mobile', amount: 799, parent: 'bills', child: 'mobile_internet', account: 'bank' },
    { merchant: 'Demo Shop', amount: 2400, parent: 'shopping', child: 'online', account: 'card' },
    { merchant: 'Demo Cinema', amount: 650, parent: 'entertainment', child: 'movies', account: 'card' },
    { merchant: 'Demo Pharmacy', amount: 380, parent: 'health', child: 'pharmacy', account: 'bank' },
    { merchant: 'Demo Fuel', amount: 1100, parent: 'fuel', child: 'petrol', account: 'bank' },
  ],
  budget: { food: 6000, travel: 2500, bills: 3000, shopping: 4000, health: 2000, entertainment: 1500, fuel: 2500 },
  splitAmount: 1200,
  groupAmount: 1800,
  lent: 2500,
  borrowed: 900,
  refund: 200,
  ignored: 400,
  private: 300,
  goals: [
    { name: 'Demo Emergency fund', emoji: '🛟', target: 30000, allocation: 6000, contribution: 3500 },
    { name: 'Demo Holiday', emoji: '🏖️', target: 15000, allocation: 3000, contribution: 1500 },
  ],
};
