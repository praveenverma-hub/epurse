// =============================================================================
// Credit card Available Credit / Utilization + combined limits (Oct-10-26)
//     npm run test:cardLimit
// =============================================================================
import { cardLimitPosition, limitLinkSuggestions, limitPairKey } from '../cardLimit.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};
const T0 = '2026-10-05T10:00:00.000Z';
const later = (h) => new Date(new Date(T0).getTime() + h * 3600000).toISOString();
const earlier = (h) => later(-h);
const txn = (accountId, type, amount, createdAt) => ({ accountId, type, amount, createdAt });

console.log('\n— single card —');
let c = { id: 'c1', balance: -20000, creditLimit: 100000 };
let p = cardLimitPosition(c, [c], []);
check('no bank figure → limit − outstanding', p.source === 'limit' && p.available === 80000 && p.utilization === 0.2, JSON.stringify(p));
check('nothing known → null', cardLimitPosition({ id: 'x', balance: -500 }, [], []) === null);

c = { id: 'c1', balance: -20000, creditLimit: 100000, reportedAvailable: { amount: 70000, at: T0 } };
p = cardLimitPosition(c, [c], [txn('c1', 'debit', 5000, earlier(1)), txn('c1', 'debit', 2000, T0)]);
check('bank figure wins; spends at/before it are already inside it', p.source === 'bank' && p.available === 70000 && p.asOf === T0, JSON.stringify(p));
p = cardLimitPosition(c, [c], [txn('c1', 'debit', 3000, later(1)), txn('c1', 'credit', 10000, later(2))]);
check('later spend uses limit, later payment frees it', p.available === 77000 && Math.abs(p.utilization - 0.23) < 1e-9, JSON.stringify(p));
p = cardLimitPosition(c, [c], [{ ...txn('c1', 'debit', 3000, later(1)), isIgnored: true }, txn('other', 'debit', 999, later(1))]);
check('ignored txns and other accounts don\'t count', p.available === 70000);
p = cardLimitPosition({ id: 'c1', balance: 0, reportedAvailable: { amount: 45000, at: T0 } }, [], []);
check('bank figure without a known limit → available only, no utilization', p.available === 45000 && p.limit === null && p.utilization === null);
p = cardLimitPosition({ id: 'c1', balance: -120000, creditLimit: 100000 }, [], []);
check('over the limit → negative available, overLimit', p.available === -20000 && p.overLimit === true);

console.log('\n— combined limit (two cards, one limit) —');
const a = { id: 'a', balance: -30000, creditLimit: 200000, limitGroupId: 'g1' };
const b = { id: 'b', balance: -50000, creditLimit: 200000, limitGroupId: 'g1' };
const z = { id: 'z', balance: -10000, creditLimit: 50000 };
p = cardLimitPosition(a, [a, b, z], []);
check('limit − BOTH cards\' outstanding', p.available === 120000 && p.group.length === 2 && Math.abs(p.utilization - 0.4) < 1e-9, JSON.stringify(p));
check('same answer from either card', cardLimitPosition(b, [a, b, z], []).available === 120000);
const a2 = { ...a, reportedAvailable: { amount: 130000, at: earlier(5) } };
const b2 = { ...b, reportedAvailable: { amount: 125000, at: T0 } };
p = cardLimitPosition(a2, [a2, b2], [txn('a', 'debit', 4000, later(1)), txn('b', 'debit', 1000, earlier(2))]);
check('freshest bank figure across the group + later spends on ANY card', p.available === 121000 && p.asOf === T0, JSON.stringify(p));

console.log('\n— link suggestions —');
const cc = (id, bankName, creditLimit, extra = {}) => ({ id, type: 'Credit Card', bankName, creditLimit, balance: 0, ...extra });
let s = limitLinkSuggestions([cc('h1', 'HDFC', 200000), cc('h2', 'HDFC', 200000), cc('s1', 'SBI', 200000), cc('h3', 'HDFC', 100000)]);
check('same bank + same limit → one suggestion', s.length === 1 && [s[0].a.id, s[0].b.id].sort().join() === 'h1,h2', JSON.stringify(s.map((x) => [x.a.id, x.b.id])));
check('declined pair is not suggested again', limitLinkSuggestions([cc('h1', 'HDFC', 200000), cc('h2', 'HDFC', 200000)], [limitPairKey('h2', 'h1')]).length === 0);
check('already linked → nothing', limitLinkSuggestions([cc('h1', 'HDFC', 200000, { limitGroupId: 'g' }), cc('h2', 'HDFC', 200000, { limitGroupId: 'g' })]).length === 0);
check('archived / no limit / no bank → nothing', limitLinkSuggestions([cc('h1', 'HDFC', 200000), cc('h2', 'HDFC', 200000, { archived: true }), cc('h3', 'HDFC', null), cc('h4', '', 200000)]).length === 0);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
