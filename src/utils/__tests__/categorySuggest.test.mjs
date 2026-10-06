import { PROJECT_ROOT } from './paths.mjs';
// =============================================================================
// categorySuggest — category guesses from typed merchant text.
//   npm run test:categorySuggest
// =============================================================================
import { register } from 'node:module';
register(`${PROJECT_ROOT}/src/utils/__tests__/_register.mjs`, import.meta.url);

const { suggestCategory, buildCategoryHistory, MANUAL_CATEGORY_KEYWORDS, merchantKey } =
  await import(`${PROJECT_ROOT}/src/utils/categorySuggest.ts`);
const { PARENT_CATEGORIES } = await import(`${PROJECT_ROOT}/src/constants/twoTierCategories.ts`);

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const child = (t, o) => suggestCategory(t, o)?.childCategory ?? null;
const notIncome = (p) => p !== 'Income';

// Every keyword must point at a real built-in category, or the form would set a
// label no picker / budget / analytics knows.
const valid = new Set(PARENT_CATEGORIES.flatMap((p) => p.children.map((c) => `${p.label}|${c.label}`)));
const bad = Object.entries(MANUAL_CATEGORY_KEYWORDS).filter(([, [p, c]]) => !valid.has(`${p}|${c}`));
check('every keyword maps to a real parent › child', bad.length === 0, JSON.stringify(bad));

check('everyday word: "Dinner" → Restaurants', child('Dinner') === 'Restaurants');
check('everyday word: "petrol" → Petrol & Diesel', child('petrol') === 'Petrol & Diesel');
check('phrase inside text: "Dinner with Rohit" → Restaurants', child('Dinner with Rohit') === 'Restaurants');
check('longest phrase wins: "movie ticket" → Movies & Events', child('movie ticket') === 'Movies & Events');
check('longest phrase wins: "train ticket" → Long Distance', child('train ticket') === 'Long Distance');
check('ambiguous on its own: "ticket" → nothing', child('ticket') === null);
check('whole words only: "parent gift" is a gift, not rent', child('parent gift') === 'Online Shopping');
check('whole words only: "auto" inside "automobile" does not match', child('automobile') === null);
check('a half-typed word suggests nothing yet ("petr")', child('petr') === null);
check('too short to guess ("d")', child('d') === null);

check('brand: "Zomato" → Food Delivery (dictionary)', suggestCategory('Zomato')?.source === 'dictionary' && child('Zomato') === 'Food Delivery');
check('brand short key needs a whole word: "Ola cab" → Daily Commute', child('Ola cab') === 'Daily Commute');
check('brand short key never hits inside a word: "Coca Cola" ≠ cab', child('Coca Cola') !== 'Daily Commute', child('Coca Cola'));

check('type gate: "salary" on an expense → nothing', child('salary', { allowParent: notIncome }) === null);
check('type gate: "salary" on income → Salary', child('salary', { allowParent: (p) => p === 'Income' }) === 'Salary');
check('type gate skips to the next layer instead of giving up',
  child('bonus dinner', { allowParent: notIncome }) === 'Restaurants');

const history = buildCategoryHistory(
  [
    { merchant: 'Dinner', parentCategory: 'Food & Dining', childCategory: 'Food Delivery' }, // newest
    { merchant: 'dinner', parentCategory: 'Food & Dining', childCategory: 'Groceries' },     // older
    { merchant: 'Rohit', parentCategory: 'Transfers', childCategory: 'Lent', categoryId: 'lent' },
    { merchant: 'Ignored thing', parentCategory: 'Shopping', childCategory: 'Electronics', isIgnored: true },
  ],
  (id) => id === 'lent',
);
check('history beats keywords: user once filed "Dinner" as Food Delivery',
  suggestCategory('dinner', { history })?.source === 'history' && child('dinner', { history }) === 'Food Delivery');
check('history: the NEWEST choice wins', child('Dinner', { history }) === 'Food Delivery');
check('history never learns Lent/Borrowed (needs a contact)', !history.has('rohit'));
check('history skips ignored transactions', !history.has('ignored thing'));
check('merchantKey normalises case/spacing/punctuation', merchantKey('  Big-Bazaar!! ') === 'big bazaar');

const rules = { 'CHOTU STORE': { parentCategory: 'Food & Dining', childCategory: 'Groceries' } };
check('saved merchant rule applies', suggestCategory('Chotu Store', { userRules: rules })?.source === 'user_rule');

console.log(`\n${C.bold}${fail ? C.red : C.green}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail ? 1 : 0);
