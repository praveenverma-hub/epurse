// =============================================================================
// LB person ledger row wording — each fact once (Oct-10-26)
//     npm run test:lbEntry
// =============================================================================
import { suggestLbPeople, openBalancePeople, findLbPerson, settleExtra } from '../lbPeopleSearch.ts';
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

console.log('\n— settle suggestions (who has an open balance that way) —');
const open = (kind, list = people) => openBalancePeople(list, kind).map((p) => p.person).join(',');
check('received back → people who owe me, biggest first', open('lent_settled') === 'Rohit Sharma,Sharon', open('lent_settled'));
check('repaid → people I owe', open('borrow_repaid') === 'Rohan', open('borrow_repaid'));
check('settled people and float noise are left out', open('lent_settled', [{ personKey: 'x', person: 'X', net: 0.001 }, { personKey: 'y', person: 'Y', net: 0 }]) === '');
check('any real amount is open (₹0.20, ₹1)', open('lent_settled', [{ personKey: 'x', person: 'X', net: 0.2 }, { personKey: 'y', person: 'Y', net: 1 }]) === 'Y,X');
check('a new lend or borrow suggests nobody', open('lent') === '' && open('borrowed') === '' && open(undefined) === '');
check('balance keeps its sign (the row says who owes whom)', openBalancePeople(people, 'borrow_repaid')[0].net === -100);

console.log('\n— settling more than is open —');
const rohit = { personKey: 'a', person: 'Rohit Sharma', contactId: 'c1', phone: '+91 98765 43210', net: 500 };
check('found by contact, number (any format) or name', findLbPerson([rohit], { contactId: 'c1' }) === rohit
  && findLbPerson([rohit], { phone: '9876543210' }) === rohit && findLbPerson([rohit], { name: ' rohit sharma ' }) === rohit && findLbPerson([rohit], { name: 'Amit' }) === null);
check('Rohit owed ₹500, paid ₹800 → ₹300 extra', JSON.stringify(settleExtra('lent_settled', 800, rohit)) === JSON.stringify({ open: 500, extra: 300 }));
check('…₹500 or less fits (no warning)', settleExtra('lent_settled', 500, rohit) === null && settleExtra('lent_settled', 200, rohit) === null);
check('nothing open → all of it flips', JSON.stringify(settleExtra('lent_settled', 800, null)) === JSON.stringify({ open: 0, extra: 800 }));
check('repaying someone I owe: by the other sign', settleExtra('borrow_repaid', 150, { ...rohit, net: -100 })?.extra === 50 && settleExtra('borrow_repaid', 100, { ...rohit, net: -100 }) === null);
check('not a settlement → no warning', settleExtra('lent', 800, rohit) === null);

console.log('\n— the LB tab: add form opens from a tab under the header\'s curve (Oct-20-26) —');
{
  const { readFileSync } = await import('node:fs');
  const rd = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  const form = rd('components/LbEntryForm.js');
  const screen = rd('screens/LentBorrowedScreen.js');
  const header = rd('components/CollapsingHeaderScreen.tsx');
  check('collapsed: the form renders nothing (the header tab is the trigger) but stays mounted',
    /if \(!isOpen\) return null;/.test(form) && /const isOpen = !collapsible \|\| open;/.test(form));
  check('ONE button in the form: Cancel while nothing is typed, Add once something is',
    /title=\{cancels \? 'Cancel' : submitLabel\}/.test(form) && /const cancels = collapsible && !typed;/.test(form));
  check('Cancel and a save both close it, eased', /const close = useCallback\(\(\) => \{ animateNextLayout\(\); onOpenChange\?\.\(false\); \}/.test(form)
    && /animateNextLayout\(\);\s*if \(collapsible\) onOpenChange\?\.\(false\);/.test(form));
  check('opened from the tab → name focused', /autoFocus=\{collapsible\}/.test(form));
  check('the screen: tab only when the panel lists people, ⌄ collapsed, no arrow open',
    /attachedTab=\{hasPeople\(kind\) \?/.test(screen) && /trailingIcon: formOpen\[kind\] \? undefined : 'chevron-down'/.test(screen));
  check('…the tab toggles with the shared accordion ease', /const toggleForm = \(\) => \{ animateNextLayout\(\);/.test(screen));
  check('header tab: tucked UNDER the curve (same radius), below the header in both stacking orders',
    /marginTop: -curveRadius,\s*paddingTop: curveRadius,/.test(header) && /zIndex: 9,\s*elevation: 5,/.test(header));
  check('…a 44pt target: 36 showing + 8 slop', /const ATTACHED_TAB_H = 36;/.test(header) && /const ATTACHED_TAB_SLOP = 8;/.test(header)
    && /minHeight: curveRadius \+ ATTACHED_TAB_H/.test(header));
  check('…its ink measured on its own wash', /const ink = readableOn\(surface, attachedTab\.color\);/.test(header));
  check('the person screen\'s sheet is untouched (never collapsible)', !/collapsible/.test(rd('screens/LbPersonScreen.js')));
  const faq = rd('components/FaqAccordion.tsx');
  check('ONE accordion motion app-wide: FaqAccordion uses the same helper', /animateNextLayout\(\)/.test(faq) && !/LayoutAnimation\.configureNext/.test(faq));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
