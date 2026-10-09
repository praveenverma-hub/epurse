// =============================================================================
// Transaction card model — what every list card says (Oct-9-26)
//     npm run test:txnCard
// Pins buildTxnCard's rules: amount = MY cost (+ "of ₹bill" when they differ),
// one muted rule for "not my money", chip priority + "+N", and the per-context
// tier-2 line (account / payer / manual entry).
// =============================================================================
import { buildTxnCard, txnAccountLabel, txnPayerName, CARD_CONTEXT, MAX_CHIPS } from '../txnCardModel.ts';
import { splitPosition, splitRelationLabel } from '../splitPosition.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};
const labels = (m) => m.chips.map((c) => c.label).join(',');

const base = { id: 't', type: 'debit', amount: 900, merchant: 'Barbeque Nation', categoryId: 'food',
  childCategory: 'Restaurants', accountType: 'Bank', accountMask: '4521', bankName: 'HDFC Bank', source: 'sms' };
const shared = { id: 'g1', type: 'shared', name: 'Goa', members: [
  { memberId: 'me', name: 'You', isMe: true }, { memberId: 'm1', name: 'Rohit Sharma' }, { memberId: 'm2', name: 'Aman' }] };

console.log('\n— account label —');
check('bank: short bank name + mask', txnAccountLabel(base) === 'HDFC ··4521', txnAccountLabel(base));
check('credit card: "Card"', txnAccountLabel({ ...base, accountType: 'Credit Card', bankName: 'ICICI Bank', accountMask: '9876' }) === 'ICICI Card ··9876');
check('live account name wins (user may rename), mask not doubled',
  txnAccountLabel(base, { name: 'Salary ··4521' }) === 'Salary ··4521' && txnAccountLabel(base, { name: 'Salary' }) === 'Salary ··4521');
check('no bank → type label', txnAccountLabel({ accountType: 'Cash' }) === 'Cash');
check('nothing → empty', txnAccountLabel({}) === '');

console.log('\n— plain debit / credit —');
let m = buildTxnCard(base, { categoryName: 'Food & Dining' });
check('tier 2 = sub-category · account', m.meta === 'Restaurants · HDFC ··4521', m.meta);
check('full bill, expense ink, no "of" hint', m.amount.value === 900 && m.amount.tone === 'expense' && m.totalHint === null);
check('no chips, no split, no ribbon', m.chips.length === 0 && m.splitCount === 0 && !m.showGroupRibbon);
m = buildTxnCard({ ...base, childCategory: undefined }, { categoryName: 'Food & Dining' });
check('falls back to the category name', m.meta.startsWith('Food & Dining · '), m.meta);
m = buildTxnCard({ ...base, type: 'credit', isRefund: true, merchant: '  ' });
check('refund credit: + income ink and a REFUND chip', m.amount.sign === '+' && m.amount.tone === 'income' && labels(m) === 'REFUND');
check('blank merchant → "Transaction"', m.title === 'Transaction');
check('a note shows the note mark', buildTxnCard({ ...base, note: 'team lunch' }).hasNote && !buildTxnCard({ ...base, note: '  ' }).hasNote);

console.log('\n— splits —');
m = buildTxnCard({ ...base, isSplit: true, myShareAmount: 300,
  splitWith: [{ name: 'Rohit', shareAmount: 300 }, { name: 'Aman', shareAmount: 300 }] });
check('I paid, kept a share: my share + "of ₹900", 3 people', m.amount.value === 300 && m.totalHint === 900 && m.splitCount === 3);
check('…primarily my spend → no LENT chip', m.chips.length === 0, labels(m));
m = buildTxnCard({ ...base, isSplit: true, myShareAmount: 0, splitWith: [{ name: 'Rohit', shareAmount: 900 }] });
check('I fronted it all: LENT', labels(m) === 'LENT');
m = buildTxnCard({ ...base, accountId: undefined, accountType: undefined, isSplit: true, isSplitMemo: true, myShareAmount: 450,
  splitPaidBy: { name: 'Rohit Sharma' }, splitWith: [{ name: 'Rohit Sharma', shareAmount: 450 }] });
check('Rohit paid (plain): payer replaces the account', m.meta === 'Restaurants · Rohit paid', m.meta);
check('…muted, my share of the bill, BORROWED (no MEMO jargon)',
  m.amount.tone === 'muted' && m.amount.value === 450 && m.totalHint === 900 && labels(m) === 'BORROWED', `${m.amount.tone} ${labels(m)}`);

console.log('\n— groups —');
const gTxn = { ...base, groupId: 'g1', groupSplit: { paidByMemberId: 'm1', paidByName: 'Rohit',
  shares: [{ memberId: 'me', shareAmount: 300 }, { memberId: 'm1', shareAmount: 300 }, { memberId: 'm2', shareAmount: 300 }] },
  isGroupMemo: true };
m = buildTxnCard(gTxn, { group: shared });
check('group memo: payer from the group\'s members, first name', m.meta === 'Restaurants · Rohit paid', m.meta);
check('…muted share of the bill, BORROWED, ribbon, no split pill',
  m.amount.tone === 'muted' && m.totalHint === 900 && labels(m) === 'BORROWED' && m.showGroupRibbon && m.splitCount === 0);
m = buildTxnCard({ ...gTxn, groupSplit: { ...gTxn.groupSplit, shares: [{ memberId: 'me', shareAmount: 0 }, { memberId: 'm2', shareAmount: 900 }] } }, { group: shared });
check('0 share, not my bill: "Not involved", still says what the bill was', m.amount.notInvolved && m.totalHint === 900);
m = buildTxnCard({ ...base, groupId: 'g1', groupSplit: { paidByMemberId: 'me',
  shares: [{ memberId: 'me', shareAmount: 0 }, { memberId: 'm1', shareAmount: 900 }] } }, { group: shared });
check('I fronted a group bill, 0 share: full amount, no hint, LENT',
  !m.amount.notInvolved && m.amount.value === 900 && m.totalHint === null && labels(m) === 'LENT', `${m.amount.value} ${m.totalHint} ${labels(m)}`);

console.log('\n— chip priority —');
m = buildTxnCard({ ...base, isIgnored: true, isHidden: true });
check('ignored outranks private (and private is moot once ignored)', labels(m) === 'IGNORED' && m.overflow === 0);
check('…ignored is muted', m.amount.tone === 'muted');
m = buildTxnCard({ ...base, isHidden: true }, { isExcluded: true });
check('excluded keeps full ink (money did leave), EXCLUDED before PRIVATE',
  m.amount.tone === 'expense' && labels(m) === 'EXCLUDED,PRIVATE');
m = buildTxnCard({ ...base, categoryId: 'lent', isSplit: true, myShareAmount: 0, splitWith: [{ name: 'R', shareAmount: 900 }], isHidden: true }, { isExcluded: true });
check(`at most ${MAX_CHIPS} + "+N"`, m.chips.length === MAX_CHIPS && m.overflow === 1 && labels(m) === 'EXCLUDED,LENT', `${labels(m)} +${m.overflow}`);
check('LENT category + LENT split framing counted once', m.overflow === 1);

console.log('\n— context —');
m = buildTxnCard({ ...base, source: 'manual' }, { context: CARD_CONTEXT.ACCOUNT });
check('account screen: no account repeat; a manual entry says so', m.meta === 'Restaurants · Manual entry', m.meta);
check('…bank-parsed: just the sub-category', buildTxnCard(base, { context: CARD_CONTEXT.ACCOUNT }).meta === 'Restaurants');
m = buildTxnCard({ ...gTxn, isGroupMemo: false, groupSplit: { ...gTxn.groupSplit, paidByMemberId: 'me' } }, { group: shared, context: CARD_CONTEXT.GROUP });
check('group screen: "You paid", no ribbon (the page is the group)', m.meta === 'Restaurants · You paid' && !m.showGroupRibbon, m.meta);
check('payer name helper is null when it was my money', txnPayerName(base) === null);

console.log('\n— split position (detail sheets + split editor) —');
const rel = (pos) => pos.people.map((p) => `${p.name}:${p.relation}:${p.share}`).join(' | ');
let pos = splitPosition({ ...base, isSplit: true, myShareAmount: 300,
  splitWith: [{ contactId: 'c1', name: 'Rohit Sharma', shareAmount: 300 }, { contactId: 'c2', name: 'Aman', shareAmount: 300 }] });
check('plain, I paid ₹900 split 3 ways: paid 900, share 300, LENT 600',
  pos.youPaid === 900 && pos.yourShare === 300 && pos.net.kind === 'lent' && pos.net.amount === 600, JSON.stringify(pos.net));
check('…each friend owes ME their share', rel(pos) === 'You:payer:300 | Rohit Sharma:owes_you:300 | Aman:owes_you:300', rel(pos));
check('…payer (me) listed first, as the payer', pos.people[0].isMe && pos.people[0].relation === 'payer');
check('…payer label carries the BILL, not the share', splitRelationLabel(pos.people[0], { billLabel: '₹900', payerName: 'You' }) === 'Paid ₹900');

pos = splitPosition({ ...base, isSplit: true, isSplitMemo: true, myShareAmount: 450,
  splitPaidBy: { contactId: 'c1', name: 'Rohit Sharma' }, splitWith: [{ contactId: 'c1', name: 'Rohit Sharma', shareAmount: 450 }] });
check('plain, Rohit paid: I paid 0, share 450, BORROWED 450',
  pos.youPaid === 0 && pos.yourShare === 450 && pos.net.kind === 'borrowed' && pos.net.amount === 450 && !pos.payer.isMe);
check('…Rohit is the payer row, I\'m "you_owe"', rel(pos) === 'Rohit Sharma:payer:450 | You:you_owe:450', rel(pos));
check('…my sub-label names who I owe', splitRelationLabel(pos.people[1], { billLabel: '₹900', payerName: pos.payer.name }) === 'You owe Rohit');

pos = splitPosition(gTxn, { group: shared });
check('group, Rohit paid ₹900 three ways: BORROWED 300, I owe Rohit',
  pos.net.kind === 'borrowed' && pos.net.amount === 300 && pos.people.find((p) => p.isMe).relation === 'you_owe', JSON.stringify(pos.net));
check('…Aman owes ROHIT (not me) — shown as a relation, not as my debt',
  pos.people.find((p) => p.key === 'm2').relation === 'owes_payer'
  && splitRelationLabel(pos.people.find((p) => p.key === 'm2'), { billLabel: '₹900', payerName: 'Rohit' }) === 'Owes Rohit');

pos = splitPosition({ ...base, groupId: 'g1', groupSplit: { paidByMemberId: 'me',
  shares: [{ memberId: 'me', shareAmount: 0 }, { memberId: 'm1', shareAmount: 450 }, { memberId: 'm2', shareAmount: 450 }] } }, { group: shared });
check('group, I fronted it all (full owed): share 0, LENT the whole 900',
  pos.yourShare === 0 && pos.net.kind === 'lent' && pos.net.amount === 900
  && pos.people.filter((p) => p.relation === 'owes_you').length === 2);

pos = splitPosition({ ...gTxn, groupSplit: { paidByMemberId: 'm1', paidByName: 'Rohit',
  shares: [{ memberId: 'me', shareAmount: 0 }, { memberId: 'm2', shareAmount: 900 }] } }, { group: shared });
check('group, not involved: even, payer still listed though he has no share row',
  pos.net.kind === 'even' && pos.people.find((p) => p.isMe).relation === 'not_involved' && pos.people[0].isPayer && pos.people[0].name === 'Rohit Sharma', rel(pos));
check('a plain, unsplit txn has no position', splitPosition(base) === null);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
