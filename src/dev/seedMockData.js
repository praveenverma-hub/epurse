import { PARENT_CATEGORIES } from '../constants/twoTierCategories';
import { MOCK_SCENARIO } from '../config/mockData';

/** Feed a fresh store through its public actions; never replace computed totals. */
export async function seedMockData(store, config = MOCK_SCENARIO, now = new Date()) {
  const initial = store.getState();
  if (initial.transactions.length || initial.accounts.length || initial.groups.length || initial.goals.length) {
    throw new Error('Mock scenario requires an empty store. Reload mock mode to reset.');
  }
  if (!Number.isFinite(config.amountScale) || config.amountScale <= 0 || !Number.isInteger(config.months) || config.months < 1 || config.months > 3) {
    throw new Error('Use a positive amountScale and 1–3 months.');
  }
  const amount = (n) => Math.round(n * config.amountScale * 100) / 100;
  const at = (month, slot = 0) => new Date(now.getFullYear(), now.getMonth() - month,
    Math.min(month === 0 ? now.getDate() : 28, 1 + slot * 3), 0, 0, 0).toISOString();
  const s = () => store.getState();
  const accounts = { bank: 'demo-bank', cash: 'demo-cash', card: 'demo-card' };
  s().addAccount({ id: accounts.bank, name: 'Demo Bank ··1001', bankName: 'Demo Bank', type: 'Bank', mask: '1001', balance: amount(config.openingBank) });
  s().addAccount({ id: accounts.cash, name: 'Demo Cash', type: 'Cash', balance: amount(config.openingCash) });
  s().addAccount({ id: accounts.card, name: 'Demo Credit ··2002', bankName: 'Demo Credit', type: 'Credit Card', mask: '2002', balance: 0, creditLimit: amount(config.creditLimit), statementDay: 20, dueDay: 8 });
  const add = (id, values) => s().addTransaction({ id: `demo-${id}`, accountId: accounts.bank, type: 'debit', createdAt: at(0), ...values });
  for (let month = config.months - 1; month >= 0; month--) {
    add(`salary-${month}`, { merchant: 'Demo Salary', amount: amount(config.salary), type: 'credit', categoryId: 'salary', parentCategory: 'Income', childCategory: 'Salary', createdAt: at(month) });
    config.expenses.forEach((expense, index) => {
      const parent = PARENT_CATEGORIES.find((p) => p.id === expense.parent);
      const child = parent?.children.find((c) => c.id === expense.child);
      if (!child || !accounts[expense.account]) throw new Error('Invalid mock expense category/account');
      add(`expense-${month}-${index}`, { merchant: expense.merchant, amount: amount(expense.amount), accountId: accounts[expense.account],
        categoryId: child.legacyId || parent.legacyId, parentCategory: parent.label, childCategory: child.label,
        createdAt: at(month, index), source: month === 0 && index < 3 ? 'sms' : 'manual', isReviewed: !(month === 0 && index < 3) });
    });
  }
  add('refund', { merchant: 'Demo Shop refund', amount: amount(config.refund), type: 'credit', categoryId: 'shopping', parentCategory: 'Shopping', childCategory: 'Online Shopping', isRefund: true });
  add('ignored', { merchant: 'Demo ignored expense', amount: amount(config.ignored), categoryId: 'food' });
  s().ignoreTransaction('demo-ignored');
  add('private', { merchant: 'Demo private expense', amount: amount(config.private), categoryId: 'food' });
  s().setTransactionHidden('demo-private', true);
  add('split', { merchant: 'Demo shared lunch', amount: amount(config.splitAmount), categoryId: 'food', parentCategory: 'Food & Dining', childCategory: 'Restaurants' });
  s().setTransactionSplit('demo-split', [{ name: 'Demo Alex', contactId: 'demo-alex', shareAmount: amount(config.splitAmount) / 2, sharePercent: 50 }], { mode: 'amount', myAmount: amount(config.splitAmount) / 2, myPercent: 50 });
  const personal = s().createGroup({ name: 'Demo Home', type: 'personal', emoji: '🏠' });
  s().tagTransactionToGroup('demo-expense-0-0', personal);
  const shared = s().createGroup({ name: 'Demo Weekend', type: 'shared', emoji: '🏖️', members: [{ memberId: 'demo-sam', name: 'Demo Sam' }] });
  s().addGroupExpense(shared, { merchant: 'Demo stay', amount: amount(config.groupAmount), categoryId: 'travel', parentCategory: 'Travel & Commute', childCategory: 'Long Distance', accountId: accounts.bank, date: at(0), paidByMemberId: 'me', paidByName: 'You',
    shares: [{ memberId: 'me', shareAmount: amount(config.groupAmount) / 2 }, { memberId: 'demo-sam', shareAmount: amount(config.groupAmount) / 2 }] });
  s().addLentBorrowed({ kind: 'lent', person: 'Demo Taylor', contactId: 'demo-taylor', amount: amount(config.lent), date: at(0) });
  s().addLentBorrowed({ kind: 'borrowed', person: 'Demo Morgan', contactId: 'demo-morgan', amount: amount(config.borrowed), date: at(0) });
  s().setBudget({ perCategory: Object.fromEntries(Object.entries(config.budget).map(([key, value]) => [key, amount(value)])) });
  const allocations = {};
  for (const goal of config.goals) {
    const id = s().addGoal({ name: goal.name, emoji: goal.emoji, lifetimeTarget: amount(goal.target), duration: 'oneTime' });
    allocations[id] = amount(goal.allocation);
    s().addGoalContribution(id, amount(goal.contribution), now.toISOString());
  }
  s().setGoalPlan({ salary: amount(config.salary), allocations });
  await s().scheduleReminder({ title: 'Demo monthly check-in', body: 'Review the demo budget', anchorAt: now.getTime() + 86400000 });
  return { accounts, personal, shared };
}
