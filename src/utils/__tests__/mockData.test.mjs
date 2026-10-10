import assert from 'node:assert/strict';
import { register } from 'node:module';
import { spawnSync } from 'node:child_process';
const configUrl = new URL('../../config/mockData.js', import.meta.url).href;
for (const [dev, flag, expected] of [[true, '1', true], [true, '0', false], [false, '1', false]]) {
  const check = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
    `globalThis.__DEV__=${dev}; process.env.EXPO_PUBLIC_MOCK_DATA=${JSON.stringify(flag)}; const m=await import(${JSON.stringify(configUrl)}); if(m.MOCK_DATA_ENABLED!==${expected}) process.exit(1);`], { encoding: 'utf8' });
  assert.equal(check.status, 0, `mock enablement gate: dev=${dev}, flag=${flag}: ${check.stderr}`);
}
register('./_store-hook.mjs', import.meta.url);
const { useEPurseStore: store } = await import('../../store/ePurseStore.js');
const { seedMockData } = await import('../../dev/seedMockData.js');
const { MOCK_SCENARIO } = await import('../../config/mockData.js');
const { mockStorage } = await import('../../dev/mockStorage.js');
await new Promise((resolve) => setTimeout(resolve, 0));
const initial = store.getState();
for (const scale of [1, 2]) {
  store.setState(initial, true);
  const c = { ...MOCK_SCENARIO, amountScale: scale };
  const now = new Date();
  const ids = await seedMockData(store, c, now);
  const s = store.getState();
  const bankExpenses = c.expenses.filter((x) => x.account === 'bank').reduce((sum, x) => sum + x.amount, 0);
  const expectedBank = (c.openingBank + c.months * (c.salary - bankExpenses) + c.refund - c.private - c.splitAmount - c.groupAmount - c.repaid - c.lentFromBank) * scale;
  assert.equal(s.accounts.find((a) => a.id === ids.accounts.bank).balance, expectedBank, 'bank balance reflects full paid amounts, refund and ignore reversal');
  assert.equal(s.accounts.find((a) => a.id === ids.accounts.card).balance, -c.months * c.expenses.filter((x) => x.account === 'card').reduce((sum, x) => sum + x.amount, 0) * scale, 'card balance is negative for outstanding purchases');
  assert.equal(s.getMonthlyIncome(now), c.salary * scale);
  const expenseTotal = c.expenses.reduce((sum, x) => sum + x.amount, 0);
  assert.equal(s.getMonthlySpend(now), (expenseTotal + c.private + c.splitAmount / 2 + c.groupAmount / 2 - c.refund + c.repaid) * scale, 'spend uses own shares, includes private + the repaid borrow, excludes ignored + lent');
  assert.equal(s.budget.totalCap, Object.values(c.budget).reduce((a, b) => a + b, 0) * scale);
  assert.equal(s.goalContributions.reduce((sum, x) => sum + x.amount, 0), c.goals.reduce((sum, x) => sum + x.contribution, 0) * scale);
  assert.equal(s.transactions.filter((t) => t.source === 'sms' && !t.isReviewed).length, 3);
  assert.equal(s.groups.length, 2);
  // Every LB entry kind: plain (no account), a booked Repayment (editable, on the bank),
  // and a bank txn tagged Lent (view-only).
  const repaidRow = s.lentBorrowed.find((l) => l.kind === 'borrow_repaid');
  assert.equal(s.lentBorrowedAccountId(repaidRow), ids.accounts.bank, 'repaid entry is booked on the bank');
  assert.equal(s.isLentBorrowedEditable(repaidRow), true);
  const smsLent = s.lentBorrowed.find((l) => l.sourceTxnId === 'demo-lent-sms');
  assert.ok(smsLent && smsLent.kind === 'lent' && !s.isLentBorrowedEditable(smsLent), 'SMS-tagged lent is txn-backed + view-only');
  assert.equal(s.getPersonBalances().find((p) => p.contactId === 'demo-taylor').net, (c.lent + c.lentFromBank) * scale);
  assert.equal(s.getPersonBalances().find((p) => p.contactId === 'demo-morgan').net, -(c.borrowed - c.repaid) * scale);
  assert.equal(s.reminders.length, 1);
  await assert.rejects(seedMockData(store, c), /empty store/);
}
assert.equal(await mockStorage.getItem('real-ledger'), null);
await mockStorage.setItem('test', 'value');
assert.equal(await mockStorage.getItem('test'), 'value');
await mockStorage.removeItem('test');
assert.equal(await mockStorage.getItem('test'), null);
console.log('Mock scenario: financial invariants pass at 1× and 2×; storage isolation and repeat-seed guard pass.');
