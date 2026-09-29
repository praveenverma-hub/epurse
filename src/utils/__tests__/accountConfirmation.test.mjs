import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./_store-hook.mjs', import.meta.url).href, import.meta.url);

const storeModule = await import('../../store/ePurseStore.js');
const useStore = storeModule.useEPurseStore || storeModule.default;

useStore.setState({
  accounts: [
    { id: 'mine', type: 'Bank', bankName: 'HDFC', mask: '1111', balance: 0 },
    { id: 'reject', type: 'Credit Card', bankName: 'ICICI', mask: '2222', balance: 0 },
  ],
  transactions: [
    { id: 'live-mine', accountId: 'mine' },
    { id: 'live-reject', accountId: 'reject' },
  ],
  archivedTransactions: [
    { id: 'old-mine', accountId: 'mine' },
    { id: 'old-reject', accountId: 'reject' },
  ],
  declinedAccountLinks: [],
  ccBills: {},
  ccDueReminderIds: {},
  ccCycleHeadsUpNotified: {},
});

useStore.getState().deleteAccount('reject', { purgeTransactions: true });

const state = useStore.getState();
assert.deepEqual(state.accounts.map((a) => a.id), ['mine']);
assert.deepEqual(state.transactions.map((t) => t.id), ['live-mine']);
assert.deepEqual(state.archivedTransactions.map((t) => t.id), ['old-mine']);

console.log('accountConfirmation: rejected account and imported history purged');
