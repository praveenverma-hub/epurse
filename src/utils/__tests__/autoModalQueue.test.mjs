// =============================================================================
// AUTO-MODAL QUEUE — one self-opening modal at a time, in a fixed order
// -----------------------------------------------------------------------------
//   npm run test:modals
//
// Five Dashboard surfaces can decide to open themselves, each from its own store
// flag and none aware of the others. Nothing here throws when they collide: two
// Modals racing to mount just leaves the user answering a dialog they cannot tell
// apart, or one of them un-dismissable on Android (ui-consistency §8b).
//
// The second half of this is the one that actually loses data: holding a modal
// back is only safe if its `pending*` flag is PERSISTED. `maybeQueueWeeklyRecap`
// writes `pendingWeeklyRecap` and `weeklyRecapHandled` in one `set`, and the
// guard is what stops it ever queuing again — so persisting the guard while
// leaving the queue transient throws the recap away the moment the app closes.
// It was exactly that way round, while `pendingCelebration`/`pendingCCPayment`
// were already persisted correctly.
// =============================================================================
import { readFileSync } from 'node:fs';
import { AUTO_MODAL_PRIORITY, pickAutoModal } from '../../constants/autoModals.ts';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

console.log(`\n${C.bold}══════ Auto-modal queue ══════${C.reset}\n`);

// ── the order ────────────────────────────────────────────────────────────────
check('the documented order is the one in force',
  AUTO_MODAL_PRIORITY.join(' > ') === 'welcome > ccPayment > monthlyRecap > weeklyRecap > epcClaim',
  AUTO_MODAL_PRIORITY.join(' > '));
check('nothing pending shows nothing', pickAutoModal({}) === null);

check('the first-Home welcome outranks every later prompt',
  pickAutoModal({ welcome: true, ccPayment: true, monthlyRecap: true, weeklyRecap: true, epcClaim: true }) === 'welcome');

// A question about the user's money outranks everything: answering it changes
// stored balances, so every figure the others would show is only right after it.
check('the card-payment question outranks all three recaps/claims',
  pickAutoModal({ ccPayment: true, monthlyRecap: true, weeklyRecap: true, epcClaim: true }) === 'ccPayment');
// 12 a year and tied to a boundary that will not come round again.
check('the monthly recap outranks the weekly one',
  pickAutoModal({ monthlyRecap: true, weeklyRecap: true }) === 'monthlyRecap');
// Nothing about the claim expires, so it yields to everything.
check('the coin claim comes last', pickAutoModal({ weeklyRecap: true, epcClaim: true }) === 'weeklyRecap');
check('…but shows when it is the only one', pickAutoModal({ epcClaim: true }) === 'epcClaim');
// A surface switched off must not BLOCK the queue behind a modal that was never
// going to appear — which is why each flag folds in its own "show me" setting.
check('a switched-off recap does not block what is behind it',
  pickAutoModal({ monthlyRecap: false, weeklyRecap: true }) === 'weeklyRecap');
check('an unknown key is ignored rather than jumping the queue',
  pickAutoModal({ somethingNew: true, epcClaim: true }) === 'epcClaim');

// ── every surface is driven by the Home coordinator ──────────────────────────
const SRC = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(`${SRC}${rel}`, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const dashboard = read('screens/DashboardScreen.js');
check('Home asks the shared queue for the highest-priority candidate',
  /useAutoModalQueue\(\)/.test(dashboard));
check('the app session locks automatic presentation after one modal',
  /claimAutomatic\(\)/.test(dashboard)
  && /automaticShown/.test(read('store/usePresentationSession.ts')));
for (const name of ['MonthlyRecapModal', 'WeeklyRecapModal', 'WelcomeStreakModal', 'CCPaymentPromptModal']) {
  check(`${name} receives the one active modal chosen by Home`,
    new RegExp(`<${name}[^>]*activeAutoModal=\\{activeAutoModal\\}`).test(dashboard));
}
check('the EPC claim also uses Home’s one-per-visit selection',
  /activeAutoModal\s*===\s*['"]epcClaim['"]/.test(dashboard));
const notificationSheet = read('components/NotificationsSheet.tsx');
check('a notification tap can explicitly open its pending modal',
  /onOpenPending\?\.\(pendingTarget\)/.test(notificationSheet)
  && /onOpenPending=\{\(modal\)\s*=>/.test(dashboard)
  && /setActiveAutoModal\(modal\)/.test(dashboard));
const ccPrompt = read('components/CCPaymentPromptModal.js');
check('handling one card payment releases the modal instead of auto-opening the next one',
  /onHandled\?\.\(\)/.test(ccPrompt)
  && /onHandled=\{\(\)\s*=>\s*setActiveAutoModal\(null\)\}/.test(dashboard));

// ── holding one back must not LOSE it ────────────────────────────────────────
const store = read('store/ePurseStore.js');
const partialize = store.slice(store.indexOf('partialize: (state)'));
for (const key of ['pendingWeeklyRecap', 'pendingMonthlyRecap', 'pendingCCPayment', 'pendingCelebration']) {
  check(`${key} survives a restart, so deferring it only defers it`,
    new RegExp(`${key}:\\s*state\\.${key}`).test(partialize));
}
// The pairing is the actual invariant: a persisted guard with a transient queue
// is what silently ate the recap.
check('…and every persisted recap GUARD has its queue persisted alongside it',
  ['weeklyRecapHandled', 'recapMonthHandled'].every((g) => new RegExp(`${g}:\\s*state\\.${g}`).test(partialize))
  && /pendingWeeklyRecap:\s*state\.pendingWeeklyRecap/.test(partialize)
  && /pendingMonthlyRecap:\s*state\.pendingMonthlyRecap/.test(partialize));

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
