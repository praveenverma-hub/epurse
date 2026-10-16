// =============================================================================
// Default account for manual entries, and where they book while tracking is off
//     npm run test:defaultAccount
// =============================================================================
import { defaultAccountId, hiddenBookingAccountId } from '../defaultAccount.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};

const bank = { id: 'b', type: 'Bank' };
const cash = { id: 'c', type: 'Cash' };

check('primary wins', defaultAccountId([bank, { ...cash, primary: true }]) === 'c');
check('no primary → first live account', defaultAccountId([{ ...bank, archived: true }, cash]) === 'c');
check('no accounts → null', defaultAccountId([]) === null);

check('tracking off: bank primary → books to it', hiddenBookingAccountId([{ ...bank, primary: true }, cash]) === 'b');
check('tracking off: Cash primary → no account (its ₹0 floor would block unseen)',
  hiddenBookingAccountId([bank, { ...cash, primary: true }]) === null);
check('tracking off: no accounts → null', hiddenBookingAccountId([]) === null);

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass}/${pass + fail} passed\x1b[0m`);
if (fail) process.exit(1);
