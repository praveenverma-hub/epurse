// =============================================================================
// accountGradient — the account color-resolution chain shared by
// AccountDetailsScreen's hero card and AccountsScreen's list-row icon.
//   npm run test:accountGradient
// =============================================================================
import { register } from 'node:module';
register('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/__tests__/_register.mjs', import.meta.url);

const { resolveAccountGradient, FALLBACK_PALETTES } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/utils/accountGradient.js');
const { BANK_GRADIENTS } = await import('/Users/praveenverma/Desktop/pvn/ePurse/src/constants/accountCardColors.js');

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

console.log(`\n${C.bold}══════ accountGradient — resolution priority ══════${C.reset}\n`);

const theme = { gradientGreenStart: '#12856E', gradientGreenEnd: '#20B486' };

{
  const withKey = { id: 'a1', name: 'Some Wallet', colorKey: 'HDFC' };
  check('an explicit colorKey wins outright', JSON.stringify(resolveAccountGradient(withKey, theme)) === JSON.stringify(BANK_GRADIENTS.HDFC));

  const wrongKeyButBankName = { id: 'a2', bankName: 'SBI Bank', colorKey: 'HDFC' };
  check('colorKey wins even over a real bank-name match',
    JSON.stringify(resolveAccountGradient(wrongKeyButBankName, theme)) === JSON.stringify(BANK_GRADIENTS.HDFC));

  const indian = { id: 'a3', bankName: 'Indian Bank' };
  check('Indian Bank gets the theme\'s own green tokens, not a BANK_GRADIENTS entry',
    JSON.stringify(resolveAccountGradient(indian, theme)) === JSON.stringify([theme.gradientGreenStart, theme.gradientGreenEnd]));

  const indianWithKey = { id: 'a4', bankName: 'Indian Bank', colorKey: 'PNB' };
  check('…but colorKey still outranks even the Indian Bank special case',
    JSON.stringify(resolveAccountGradient(indianWithKey, theme)) === JSON.stringify(BANK_GRADIENTS.PNB));

  const named = { id: 'a5', bankName: 'HDFC Bank' };
  check('a real bank-name match is used when there\'s no colorKey',
    JSON.stringify(resolveAccountGradient(named, theme)) === JSON.stringify(BANK_GRADIENTS.HDFC));

  const flat = { id: 'a6', name: 'My Wallet', color: '#10B981' };
  check('a legacy flat `color` field renders as a same-color gradient (no bank match, no colorKey)',
    JSON.stringify(resolveAccountGradient(flat, theme)) === JSON.stringify(['#10B981', '#10B981']));

  const unknown1 = { id: 'unknown-account-1', name: 'Cash' };
  const unknown2 = { id: 'unknown-account-2', name: 'Cash' };
  const g1 = resolveAccountGradient(unknown1, theme);
  const g2 = resolveAccountGradient(unknown2, theme);
  check('two different unmatched accounts land on SOME fallback palette entry',
    FALLBACK_PALETTES.some((p) => JSON.stringify(p) === JSON.stringify(g1)));
  check('…and the fallback is stable per account id, not random each call',
    JSON.stringify(resolveAccountGradient(unknown1, theme)) === JSON.stringify(g1));
  // Not asserting g1 !== g2 (a hash collision is legitimate), just that both resolve.
  check('a second unmatched account also resolves to a real fallback entry',
    FALLBACK_PALETTES.some((p) => JSON.stringify(p) === JSON.stringify(g2)));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
