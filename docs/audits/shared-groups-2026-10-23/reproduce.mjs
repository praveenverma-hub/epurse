// Read-only local audit probes. No network, accounts, or database writes.
// Run from repository root:
// node --no-warnings --import ./src/utils/__tests__/_register.mjs docs/audits/shared-groups-2026-10-23/reproduce.mjs
import assert from 'node:assert/strict';
import { emptyFold, foldEvents, buildCheckpoint } from '../../../src/sync/fold.ts';
import { encodeEvent, parseEvent, V1_LIMITS } from '../../../src/sync/events.ts';
import { phoneDigits } from '../../../src/sync/phoneKey.ts';
import { groupSyncStatus } from '../../../src/utils/groupSyncStatus.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = id(1), other = id(2), a = id(3), b = id(4), expenseId = id(5);
const at = '2026-10-23T00:00:00Z';
const data = (seq, event, authorId = user) => ({ seq, eventId: id(100 + seq), authorId, systemType: null, systemSubject: null, plaintext: encodeEvent(event, at), createdAt: at });
const system = (seq, systemType, systemSubject) => ({ seq, eventId: id(100 + seq), authorId: null, systemType, systemSubject, plaintext: null, createdAt: at });
const expense = { type: 'expense.upsert', entityId: expenseId, amountPaise: 10000, title: 'Dinner', categoryId: 'other', date: '2026-10-23', paidBy: a, shares: [{ memberId: b, paise: 10000 }] };
const initial = foldEvents(emptyFold(), [system(1, 'group_created', user), system(2, 'member_joined', other), data(3, {type:'member.add',memberId:a,name:'A'}), data(4, {type:'member.add',memberId:b,name:'B'}), data(5, expense)]).fold;
const checkpoint = data(6, {type:'group.checkpoint', ...buildCheckpoint(initial)});
const frozen = foldEvents(initial, [checkpoint]).fold;
let count = 0;
function confirmed(name, fn) { fn(); console.log(`CONFIRMED ${++count}: ${name}`); }

confirmed('Reusing a frozen expense entity ID doubles debt and replaces its history', () => {
  const r = foldEvents(frozen, [data(7, expense)]);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.fold.balances[a], 20000);
  assert.equal(r.fold.entries[expenseId].versions.length, 1);
});
confirmed('Correction can create debt for an expense that never existed', () => {
  const r = foldEvents(initial, [data(6, {type:'expense.correct', entityId:id(7), correctsId:id(8), base:id(8), title:'Invented correction', date:'2026-10-23', debts:[{from:b,to:a,paise:50000}], expense:null})]);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.fold.balances[a], 60000);
});
confirmed('False checkpoint produces different balances on full-history and fresh phones', () => {
  const cp = data(6, {type:'group.checkpoint', ...buildCheckpoint(initial), debts:[]});
  const full = foldEvents(initial, [cp]);
  const fresh = foldEvents(emptyFold(), [cp]);
  assert.equal(full.fold.checkpointMismatch, 6);
  assert.equal(full.fold.balances[a], 10000);
  assert.equal(fresh.fold.balances[a] ?? 0, 0);
});
confirmed('Member can claim any unclaimed identity; no invite binding is checked', () => {
  const r = foldEvents(initial, [data(6, {type:'member.claim', memberId:a, userId:other}, other)]);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.fold.members[a].userId, other);
});
confirmed('Removing server access does not archive the member in the fold', () => {
  const claimed = foldEvents(initial, [data(6, {type:'member.claim', memberId:b, userId:other}, other)]).fold;
  const removed = foldEvents(claimed, [system(7, 'member_removed', other)]).fold;
  assert.equal(removed.activeUsers.includes(other), false);
  assert.equal(removed.members[b].archived, false);
  const r = foldEvents(removed, [data(8, {...expense, entityId:id(9)})]);
  assert.equal(r.rejected.length, 0);
});
confirmed('Valid individual expenses can generate an invalid checkpoint aggregate', () => {
  const big = {...expense, amountPaise:V1_LIMITS.MAX_PAISE, shares:[{memberId:b,paise:V1_LIMITS.MAX_PAISE}]};
  const f = foldEvents(initial, [data(6,big), data(7,{...big,entityId:id(9)})]).fold;
  assert.ok(f.balances[a] > V1_LIMITS.MAX_PAISE);
  assert.equal(parseEvent(encodeEvent({type:'group.checkpoint', ...buildCheckpoint(f)}, at)), null);
});
confirmed('Phone fingerprints discard country-code distinctions', () => {
  assert.equal(phoneDigits('+1 212 555 1234'), phoneDigits('+91 2125551234'));
});
confirmed('Live status ignores stale sync time and checkpoint mismatch', () => {
  const members = {[a]:{name:'A',userId:user,archived:false}, [b]:{name:'B',userId:other,archived:false}};
  assert.equal(groupSyncStatus({type:'shared',shared:{status:'active',outbox:[],syncedAt:'2020-01-01',fold:{...initial,members,checkpointMismatch:6}}}), 'live');
});
console.log(`${count} local audit probes confirmed; these assert current defects/limitations, not desired behavior.`);
