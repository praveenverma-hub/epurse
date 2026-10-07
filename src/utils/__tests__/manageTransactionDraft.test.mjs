import assert from 'node:assert/strict';
import { register } from 'node:module';
register(new URL('./_store-hook.mjs', import.meta.url));
const { useEPurseStore: store } = await import('../../store/ePurseStore.js');
const { createManageDraft, manageDraftChanged, applyManageDraft } = await import('../manageTransactionDraft.js');

function seed() {
  store.setState({ transactions: [], accounts: [], groups: [], lentBorrowed: [],
    goalContributions: [], activeGroupZoneId: null, suppressedSmsIds: [], manualTxnSeq: 0 });
  store.getState().addAccount({ id: 'cash', type: 'Cash', bankName: 'Cash', balance: 5000 });
  store.getState().addTransaction({ amount: 600, type: 'debit', accountId: 'cash',
    merchant: 'Lunch', categoryId: 'food', createdAt: new Date().toISOString() });
  return store.getState().transactions[0];
}
const balance = () => store.getState().accounts.find((a) => a.id === 'cash').balance;
const latest = (txn) => store.getState().transactions.find((t) => t.id === txn.id);

let txn = seed();
let draft = createManageDraft(txn);
assert.equal(manageDraftChanged(txn, draft), false);
draft.isHidden = true;
draft.parentCategory = 'Shopping';
draft.childCategory = 'Clothing';
draft.categoryId = 'shopping';
assert.equal(manageDraftChanged(txn, draft), true);
assert.equal(!!latest(txn).isHidden, false, 'draft changes do not touch the store');
assert.equal(latest(txn).categoryId, 'food');
applyManageDraft(store, txn, draft);
assert.equal(latest(txn).isHidden, true);
assert.equal(latest(txn).parentCategory, 'Shopping');
assert.equal(balance(), 4400, 'Private and category changes do not affect balances');

txn = seed();
draft = { ...createManageDraft(txn), isIgnored: true };
applyManageDraft(store, txn, draft);
assert.equal(latest(txn).isIgnored, true);
assert.equal(balance(), 5000, 'Ignore reverses the original account effect');
txn = latest(txn);
applyManageDraft(store, txn, { ...createManageDraft(txn), isIgnored: false });
assert.equal(balance(), 4400, 'Restore reapplies the original account effect');

txn = seed();
draft = { ...createManageDraft(txn), isHidden: true,
  split: { others: [{ contactId: 'friend', name: 'Friend', percent: 50 }], meta: { mode: 'percent', myPercent: 50 } } };
applyManageDraft(store, txn, draft);
assert.equal(latest(txn).myShareAmount, 300);
assert.equal(latest(txn).isHidden, true);
assert.equal(balance(), 4400, 'a split keeps the full original account payment');
assert.equal(store.getState().lentBorrowed.filter((row) => row.sourceTxnId === txn.id).length, 1);
txn = latest(txn);
applyManageDraft(store, txn, { ...createManageDraft(txn), split: { others: [] } });
assert.equal(latest(txn).isSplit, false);
assert.equal(store.getState().lentBorrowed.filter((row) => row.sourceTxnId === txn.id).length, 0);

txn = seed();
store.setState({ groups: [{ id: 'personal', name: 'Trip', type: 'personal', totalSpend: 0 }] });
applyManageDraft(store, txn, { ...createManageDraft(txn), groupId: 'personal' });
assert.equal(latest(txn).groupId, 'personal');
assert.equal(balance(), 4400);
txn = latest(txn);
assert.throws(() => applyManageDraft(store, txn, { ...createManageDraft(txn),
  isHidden: true, split: { others: [{ name: 'Friend', percent: 50 }], meta: { mode: 'percent', myPercent: 50 } } }), /different split flow/);
assert.equal(!!latest(txn).isHidden, false, 'invalid combinations must fail before any writes');

txn = seed();
assert.throws(() => applyManageDraft(store, txn, { ...createManageDraft(txn), isHidden: true, groupId: 'deleted' }), /no longer available/);
assert.equal(!!latest(txn).isHidden, false);
store.getState().setTransactionHidden(txn.id, true);
assert.throws(() => applyManageDraft(store, txn, { ...createManageDraft(txn), isIgnored: true }), /transaction changed/);
assert.equal(balance(), 4400, 'stale drafts cannot change the balance');

txn = seed();
assert.throws(() => applyManageDraft(store, txn, { ...createManageDraft(txn), isHidden: true,
  split: { others: [{ name: 'Friend', percent: 90 }], meta: { mode: 'percent', myPercent: 50 } } }), /all shares/);
assert.equal(!!latest(txn).isHidden, false, 'invalid split totals do not partially apply other edits');
txn = seed();
applyManageDraft(store, txn, { ...createManageDraft(txn), categoryId: 'cc_bill', specialCategory: 'cc_bill' });
assert.equal(latest(txn).categoryId, 'food', 'card payments remain delegated to reconciliation');
console.log('Manage draft checks passed: staging, category, Private, Ignore/Restore, split ledger, groups, stale edits and card reconciliation.');
