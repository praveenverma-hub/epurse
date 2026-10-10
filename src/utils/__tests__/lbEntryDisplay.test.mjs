// =============================================================================
// LB person ledger row wording — each fact once (Oct-10-26)
//     npm run test:lbEntry
// =============================================================================
import { suggestLbPeople } from '../lbPeopleSearch.ts';
import { lbEntryTitle, lbEntryMeta, lbEntrySign, lbEntrySource, lbEntryTone, lbNoteText, lbEffectiveKind, lbAccountFieldLabel, lbToastTitle } from '../lbEntryDisplay.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};

const D = '2026-10-03T10:00:00.000Z';
const row = (o) => ({ id: 'x', amount: 500, date: D, ...o });

let e = row({ kind: 'lent' });
check('no note → title is the kind', lbEntryTitle(e) === 'Lent');
check('…and the meta line does NOT repeat it', !lbEntryMeta(e).includes('Lent'), lbEntryMeta(e));
e = row({ kind: 'lent', note: 'Dinner' });
check('note → title', lbEntryTitle(e) === 'Dinner');
check('…meta carries the kind + date', lbEntryMeta(e).startsWith('Lent · '), lbEntryMeta(e));
e = row({ kind: 'lent_settled', note: 'Manual settlement' });
check('store placeholder note is not a title', lbEntryTitle(e) === 'Received back');
e = row({ kind: 'lent', note: 'From txn: Swiggy', sourceTxnId: 't1' });
check('"From txn: X" stamp → title is the merchant', lbEntryTitle(e) === 'Swiggy', lbEntryTitle(e));
check('edit sheet seeds an empty note for a placeholder', lbNoteText('Manual settlement') === '' && lbNoteText(' Dinner ') === 'Dinner');
e = row({ kind: 'borrowed', isGroupLine: true, groupName: 'Goa Trip', groupId: 'g1' });
check('group line → group name once', lbEntryTitle(e) === 'Goa Trip' && lbEntryMeta(e) === 'Net from group');
check('group borrowed net → −, borrowed tone', lbEntrySign(e) === '−' && lbEntryTone(e) === 'borrowed');

console.log('\n— sign / tone / source —');
check('lent = your money leaving', lbEntrySign(row({ kind: 'lent' })) === '−' && lbEntryTone(row({ kind: 'lent' })) === 'outflow');
check('repaid = your money leaving', lbEntrySign(row({ kind: 'borrow_repaid' })) === '−');
check('borrowed arrives, plain', lbEntrySign(row({ kind: 'borrowed' })) === '+' && lbEntryTone(row({ kind: 'borrowed' })) === 'plain');
check('source: manual', lbEntrySource(row({ kind: 'lent' })) === 'manual');
check('source: txn', lbEntrySource(row({ kind: 'lent', sourceTxnId: 't1' })) === 'txn');
check('source: group wins over txn', lbEntrySource(row({ kind: 'lent', sourceTxnId: 't1', groupId: 'g' })) === 'group');

console.log('\n— recording (form → kind, account label, toast) —');
check('form: lent + already settled → received back', lbEffectiveKind('lent', true) === 'lent_settled' && lbEffectiveKind('borrowed', true) === 'borrow_repaid' && lbEffectiveKind('lent', false) === 'lent');
check('account label follows the money', lbAccountFieldLabel('lent') === 'Paid From' && lbAccountFieldLabel('borrow_repaid') === 'Paid From' && lbAccountFieldLabel('borrowed') === 'Received In' && lbAccountFieldLabel('lent_settled') === 'Received In');
check('toast titles', lbToastTitle('lent', 500, 'Asha').startsWith('Lent ') && lbToastTitle('borrow_repaid', 500, 'Asha').startsWith('Repaid ') && lbToastTitle('lent_settled', 5, 'A').startsWith('Settled '));

console.log('\n— name suggestions (people already on the ledger) —');
const people = [
  { personKey: 'a', person: 'Rohit Sharma', net: 2300 },
  { personKey: 'b', person: 'Rohan', net: -100 },
  { personKey: 'c', person: 'Asha Rao', net: 0 },
  { personKey: 'd', person: 'Sharon', net: 50 },
];
const names = (q) => suggestLbPeople(people, q).map((p) => p.person).join(',');
check('word-start match, bigger balance first', names('roh') === 'Rohit Sharma,Rohan', names('roh'));
check('matches a later word ("sharma")', names('sharma') === 'Rohit Sharma', names('sharma'));
check('word-starts (by balance) rank above a mid-word match', names('sha') === 'Rohit Sharma,Sharon,Asha Rao', names('sha'));
check('case-insensitive, trims', names('  ASHA ') === 'Asha Rao');
check('empty query → none', suggestLbPeople(people, '').length === 0);
check('exact full name → nothing to suggest', names('rohan') === '');
check('limit 3', suggestLbPeople([...people, { personKey: 'e', person: 'Rhea', net: 1 }], 'r').length === 3);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
