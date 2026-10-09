// =============================================================================
// Group Detail top card — figures + balance line (Oct-10-26)
//     npm run test:groupHero
// =============================================================================
import { groupHeroFigures, groupBalanceLine } from '../groupHero.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};
const say = (line) => (line ? line.segments.map((s) => ('text' in s ? s.text : `[${s.amount}:${s.tone}]`)).join('') : null);

const share = (me, payer = 'me') => ({ paidByMemberId: payer, shares: [{ memberId: 'me', shareAmount: me }, { memberId: 'm1', shareAmount: 900 - me }] });

console.log('\n— figures —');
let f = groupHeroFigures([
  { type: 'debit', amount: 900, groupSplit: share(300) },                               // I paid ₹900, my part ₹300
  { type: 'debit', amount: 900, groupSplit: share(450, 'm1'), isGroupMemo: true },      // Rohit paid, my part ₹450
  { type: 'debit', amount: 600, groupSplit: share(0, 'm1'), isGroupMemo: true },        // not involved
]);
check('total = every bill, whoever paid', f.totalBills === 2400, JSON.stringify(f));
check('your share = your part of every bill (incl. ones others paid)', f.yourShare === 750, JSON.stringify(f));
f = groupHeroFigures([{ type: 'debit', amount: 1000 }, { type: 'credit', amount: 200, isRefund: true }, { type: 'credit', amount: 5000 }]);
check('personal: refunds net out, plain income ignored', f.totalBills === 800 && f.yourShare === 800, JSON.stringify(f));
check('empty group → zeros', JSON.stringify(groupHeroFigures([])) === '{"totalBills":0,"yourShare":0}');

console.log('\n— balance line —');
check('no expenses → no line', groupBalanceLine([], false) === null);
check('expenses, nothing outstanding → settled', say(groupBalanceLine([], true)) === 'All settled up');
check('one person owes you (first name)', say(groupBalanceLine([{ person: 'Rohit Sharma', net: 600 }], true)) === 'Rohit owes you [600:lent]');
check('several owe you → count + total', say(groupBalanceLine([{ person: 'Rohit', net: 600 }, { person: 'Aman', net: 300 }], true)) === '2 people owe you [900:lent]');
check('you owe one', say(groupBalanceLine([{ person: 'Rohit', net: -300 }], true)) === 'You owe Rohit [300:borrowed]');
check('you owe several', say(groupBalanceLine([{ person: 'Rohit', net: -300 }, { person: 'Aman', net: -200 }], true)) === 'You owe 2 people [500:borrowed]');
check('mixed → both, each in its colour', say(groupBalanceLine([{ person: 'Rohit', net: 900 }, { person: 'Aman', net: -300 }], true)) === 'Owed to you [900:lent] · You owe [300:borrowed]');
check('sub-paisa noise counts as settled', groupBalanceLine([{ person: 'Rohit', net: 0.001 }], true).kind === 'settled');

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
