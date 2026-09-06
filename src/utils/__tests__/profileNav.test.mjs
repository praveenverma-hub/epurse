// =============================================================================
// Profile hub — navigation coherence & shared chrome
// -----------------------------------------------------------------------------
//   npm run test:profile
//
// The hub's whole job is that every destination is a visible, labelled row that
// goes somewhere real. Two ways that breaks silently, neither of which throws:
//
//   1. A row points at a route nobody registered. React Navigation logs a
//      warning to a console no user reads and the tap does NOTHING. The old
//      arrangement couldn't have this bug (the "screens" were sections of one
//      file); splitting them into routes introduces it.
//   2. A destination grows a SECOND entry point. Backup used to sit inside a
//      Settings section; promoting it to the hub is only an improvement if the
//      old row went away, otherwise there are two paths to keep in sync and the
//      hub stops being the index of anything.
//
// Every source scan runs on COMMENT-STRIPPED source. A positive check that
// matches the prose explaining it passes while the code says nothing of the
// kind — a silent false pass, which is the dangerous direction. (Three lints in
// the headerLayout suite have been bitten by exactly this.)
// =============================================================================
import { readFileSync, existsSync } from 'node:fs';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m', bold: '\x1b[1m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const ROOT = '/Users/praveenverma/Desktop/pvn/ePurse/src';
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const readDoc = (rel) => readFileSync(`${ROOT}/${rel}`, 'utf8');
const read = (rel) => code(readDoc(rel));

const nav      = read('navigation/AppNavigator.js');
const profile  = read('screens/ProfileScreen.tsx');
const shop     = read('screens/ShopScreen.tsx');
const reminder = read('screens/RemindersScreen.tsx');
const settings = read('screens/SettingsScreen.js');
const rowSrc   = read('components/NavListRow.tsx');
const hdrSrc   = read('components/PlainScreenHeader.tsx');

console.log(`\n${C.bold}══════ Profile hub — navigation ══════${C.reset}\n`);

// ── 1. Every row goes somewhere that exists ─────────────────────────────────
console.log('── routes the hub points at ──');
{
  // The hub navigates through one `go('Route')` helper, so the routes it claims
  // are exactly these literals — no need to guess at a call shape.
  const claimed = [...profile.matchAll(/go\('([A-Za-z]+)'\)/g)].map((m) => m[1]);
  const registered = new Set(
    [...nav.matchAll(/<Stack\.Screen\s+name="([A-Za-z]+)"/g)].map((m) => m[1]),
  );

  check('the hub actually navigates somewhere', claimed.length >= 4,
    `found ${claimed.length} destinations`);
  for (const route of claimed) {
    check(`row → "${route}" is a registered route`, registered.has(route),
      `AppNavigator knows: ${[...registered].join(', ')}`);
  }

  // The four the revamp promised. Named explicitly so dropping one is a failure
  // rather than a smaller-but-still-passing list.
  for (const route of ['Shop', 'Reminders', 'Backup', 'Settings']) {
    check(`"${route}" is reachable from the hub`, claimed.includes(route));
  }
}

// ── 2. The hub itself is reachable, and the old route is gone ───────────────
console.log('\n── the hub replaced RewardShop ──');
{
  check('ProfileScreen exists', existsSync(`${ROOT}/screens/ProfileScreen.tsx`));
  check('RewardShop.tsx is gone (not left behind as a second copy)',
    !existsSync(`${ROOT}/screens/RewardShop.tsx`));
  check('no route named RewardShop is registered',
    !/name="RewardShop"/.test(nav));

  // Any surviving navigate('RewardShop') is a dead tap. Scan every source file,
  // stripped, so a comment mentioning the old name is fine.
  const { execSync } = await import('node:child_process');
  const files = execSync(
    `find ${ROOT} -type f \\( -name '*.js' -o -name '*.tsx' -o -name '*.ts' \\) -not -path '*__tests__*'`,
  ).toString().trim().split('\n');
  const stale = files.filter((f) => /navigate\(\s*'RewardShop'/.test(code(readFileSync(f, 'utf8'))));
  check('nothing still navigates to RewardShop', stale.length === 0, stale.join(', '));

  // Both entry points into the hub must have moved with it.
  const dash = read('screens/DashboardScreen.js');
  const queue = read('components/DailyQueueStack.js');
  check('the Dashboard avatar opens the hub', /navigate\('Profile'\)/.test(dash));
  check('the review-queue RP pill opens the hub', /navigate\('Profile'\)/.test(queue));
}

// ── 3. One entry point per destination ──────────────────────────────────────
console.log('\n── Backup moved, it was not copied ──');
{
  check('the hub owns the Backup row', /'Backup'/.test(profile));
  check('Settings no longer mentions Backup at all', !/Backup/.test(settings),
    'two entry points to the same screen is exactly what the move was for');
  // The onboarding restore link and the Home promo card are DIFFERENT jobs
  // (first-run recovery, a nudge) — they legitimately still point at Backup.
  const onboarding = read('screens/OnboardingExperience.tsx');
  check('onboarding keeps its own restore link', /'Backup'/.test(onboarding),
    'a new phone must be able to restore before it has a profile');
}

// ── 4. The split actually split ─────────────────────────────────────────────
console.log('\n── hub vs catalogue ──');
{
  check('the catalogue lives on ShopScreen', /purchaseItem/.test(shop) && /toggleItemActive/.test(shop));
  check('the hub holds no shop logic', !/purchaseItem/.test(profile) && !/toggleItemActive/.test(profile),
    'the widget list is what kept pushing identity off the first screenful');
  check('the hub holds no widget-card chrome', !/lockOverlay/.test(profile));
  check('the hub is a LIST of destinations', (profile.match(/<NavListRow/g) || []).length >= 4);

  // The balance has to be visible while shopping — it is the answer to the
  // question every card asks.
  check('the shop keeps the EPC balance on screen',
    /selectEpcBalance/.test(shop) && /balanceStrip/.test(shop));

  // One palette, two screens. Two copies of ~25 colour tokens drift the moment
  // one gets a tweak, which is why `D` moved into a hook.
  check('both screens read the shared reward palette',
    /useRewardPalette\(\)/.test(profile) && /useRewardPalette\(\)/.test(shop));
  check('neither screen re-derives its own palette',
    !/bg: {12}theme\.background/.test(profile) && !/bg: {12}theme\.background/.test(shop));
}

// ── 5. Reminders — built, and every control really moves something ─────────
// This block used to assert the OPPOSITE: that the screen shipped no controls
// and the hub row was badged SOON. Both were true of the placeholder and are the
// wrong thing to guard now the feature exists, so they were replaced rather than
// deleted — the standard they encoded (never show a switch that moves nothing)
// is still enforced below, just against the real screen.
console.log('\n── reminders ──');
{
  const store = read('store/ePurseStore.js');
  const form  = read('screens/ReminderFormScreen.tsx');

  check('the Reminders route exists so the row is real', /name="Reminders"/.test(nav));
  check('…and the form is a REGISTERED SCREEN, not a modal', /name="ReminderForm"/.test(nav));
  check('the hub row no longer claims the feature is unbuilt',
    !/badge="SOON"[\s\S]{0,120}Reminders/.test(profile) && !/Reminders[\s\S]{0,120}badge="SOON"/.test(profile));

  // The empty state stays — an empty list still has to say what it is.
  check('an empty list still explains itself via the shared EmptyState', /<EmptyState/.test(reminder));

  // The switches are the whole point of the rewrite, so they must be wired to
  // the store, not to local state that forgets on unmount.
  check('every nudge switch writes to the store', /setNotificationPref/.test(reminder));
  check('…and the store really exposes that action', /setNotificationPref:/.test(store));
  check('…reading each value from notificationPrefs', /notificationPrefs\?\.\[key\]/.test(reminder));

  // A switch that moves nothing is the failure this block has always guarded
  // against: every pref row must have a matching GATE at a fire site.
  const rowKeys = [...reminder.matchAll(/\{ key: '([A-Za-z]+)'/g)].map((m) => m[1]);
  check(`the screen lists several nudges (${rowKeys.length})`, rowKeys.length >= 5, rowKeys.join(','));
  for (const key of rowKeys) {
    check(`"${key}" is actually gated in the store`,
      new RegExp(`nudgeAllowed\\((?:get\\(\\)|s|state), '${key}'\\)`).test(store),
      'a switch with no gate at the fire site moves nothing');
  }

  // The list must derive its times from the shared schedule util, or the row can
  // say one thing while a different moment is armed with the OS.
  check('the list derives "when" from the shared schedule util',
    /nextOccurrence/.test(reminder) && /describeRepeat/.test(reminder));
  check('…and so does the form', /nextOccurrence/.test(form));

  // The context line: a person-scoped reminder must SAY what it's about
  // ("Remind yourself to pay ₹1,200 to Rahul"), which the first cut demoted to a
  // muted one-liner and then lost. It needs the amount and name as SEPARATE
  // params — half of a pre-composed sentence can't be emphasised.
  const lb = read('screens/LentBorrowedScreen.js');
  check('the LB bell passes the amount + person structured, not pre-composed',
    /presetAmount:/.test(lb) && /presetPerson:/.test(lb) && !/presetBody:/.test(lb),
    'a ready-made sentence cannot be partially bolded');
  check('the form states the balance in words', /Remind yourself to pay /.test(form));
  check('…with the amount emphasised via formatCurrency', /formatCurrency\(amount as number\)/.test(form));
  check('…and reads it from the record too, so an EDIT says the same thing',
    /existing\?\.amount/.test(form) && /existing\?\.person/.test(form));

  // One form, three entry points — the reason BorrowReminderModal was deleted.
  check('the borrow-only reminder sheet is gone', !existsSync(`${ROOT}/components/BorrowReminderModal.js`));
  check('Lent/Borrowed routes its bell to the shared form',
    /navigate\('ReminderForm'/.test(lb));

  // The two directions are deliberately NOT symmetric: money you owe is your own
  // task (schedule an alarm), money owed TO you is someone else's (message them).
  // A scheduled "lent" reminder was built and then removed on that reasoning, so
  // this guards the decision rather than the code that once implemented it.
  check('the bell is BORROW-only (net < 0)', /!isFullySettled && pb\.net < 0 \?/.test(lb));
  check('…there is no scheduled lent reminder anywhere', !/lb_lent/.test(lb)
    && !/lb_lent/.test(read('screens/ReminderFormScreen.tsx'))
    && !/lb_lent/.test(read('screens/RemindersScreen.tsx')));
  check('…and the lent side chases by MESSAGE instead',
    /navigate\('WhatsAppReminder'/.test(lb));

  // That WhatsApp flow is a compose-and-send form, so it is a screen too — and
  // as a screen its "saved to gallery" CenterModal is no longer a second <Modal>
  // stacked on a sheet's (ui-consistency §8b).
  const wa = read('screens/WhatsAppReminderScreen.js');
  check('the WhatsApp reminder is a registered SCREEN', /name="WhatsAppReminder"/.test(nav));
  check('…that no longer renders itself as a Modal sheet',
    !/<Modal/.test(wa) && !/styles\.backdrop/.test(wa));
  check('…and uses the shared header like every other pushed screen',
    /<PlainScreenHeader/.test(wa));
  check('the old component-level modal file is gone',
    !existsSync(`${ROOT}/components/WhatsAppReminderModal.js`));

  // Repeats only keep repeating because a boot pass tops the OS queue back up.
  check('the reconcile pass runs at launch/foreground',
    /reconcileReminders\(\)/.test(code(readFileSync('/Users/praveenverma/Desktop/pvn/ePurse/App.js', 'utf8'))));
}

// ── 6. Shared chrome — one header, one row ──────────────────────────────────
console.log('\n── shared components ──');
{
  // The side slots must be EQUAL or the flexed title is centred on what's left
  // over, not on the screen. `right` therefore replaces the spacer.
  check('PlainScreenHeader gives both sides the same slot',
    /export const HEADER_SLOT = 40;/.test(hdrSrc)
    && /width: HEADER_SLOT,\n\s*height: HEADER_SLOT,/.test(hdrSrc));
  check('…and a trailing action TAKES the spacer rather than adding to it',
    /\{right \?\? <View style=\{styles\.slot\} \/>\}/.test(hdrSrc),
    'appending it after the spacer shifts the title off centre');

  // Adoption. Every screen here used to hand-roll the same three elements and
  // they had already drifted to three different looks.
  const ADOPTED = [
    'screens/ProfileScreen.tsx',
    'screens/ShopScreen.tsx',
    'screens/RemindersScreen.tsx',
    'screens/SettingsScreen.js',
    'screens/CategoriesScreen.js',
    'screens/SpendRulesScreen.js',
    'screens/BackupScreen.js',
  ];
  for (const rel of ADOPTED) {
    const src = read(rel);
    check(`${rel.split('/').pop()} uses the shared header`,
      /<PlainScreenHeader/.test(src));
    check(`…and keeps no local back-button style`, !/backBtn:/.test(src),
      'a leftover copy is how the look drifts back apart');
  }

  // KNOWN, un-swept: five screens still hand-roll a plain pushed header
  // (AddTransaction, AddGroupExpense, BudgetPlan, Budget, AccountDetails — the
  // last one theme-tinted with a trailing action). This list is asserted EXACTLY
  // so a NEW screen cannot quietly join it: converting one of them means
  // deleting it from here.
  const UNSWEPT = [
    'screens/AddTransactionScreen.tsx',
    'screens/AddGroupExpenseScreen.tsx',
    'screens/BudgetPlanScreen.js',
    'screens/BudgetScreen.js',
    'screens/AccountDetailsScreen.tsx',
    'screens/LbPersonScreen.js',
  ];
  const { execSync } = await import('node:child_process');
  const rolling = execSync(
    `grep -rl "chevron-back" ${ROOT}/screens ${ROOT}/components || true`,
  ).toString().trim().split('\n').filter(Boolean)
    .map((f) => f.replace(`${ROOT}/`, ''))
    // The shared header and the gradient one are the two places allowed to draw it.
    .filter((rel) => rel !== 'components/PlainScreenHeader.tsx'
                  && rel !== 'components/CollapsingHeaderScreen.tsx');
  const surprise = rolling.filter((rel) => !UNSWEPT.includes(rel));
  check('no NEW screen hand-rolls a back button', surprise.length === 0,
    `unexpected: ${surprise.join(', ')}`);
  const converted = UNSWEPT.filter((rel) => !rolling.includes(rel));
  check('the un-swept list has no stale entries', converted.length === 0,
    `already converted, remove from UNSWEPT: ${converted.join(', ')}`);

  // NavListRow: shared by the hub and Settings, which is the case that earned it.
  check('NavListRow is used by more than one screen',
    /<NavListRow/.test(profile) && /<NavListRow/.test(settings));
  check('Settings drops its hand-rolled nav row', !/rowChevron/.test(settings));
  check('the chevron is an icon, not a text glyph',
    /name="chevron-forward"/.test(rowSrc) && !/'›'/.test(rowSrc) && !/›/.test(settings),
    'a font glyph varies in weight per platform and cannot take a tint');
  check('the row extends along a NAMED axis, not per caller',
    /variant \?: ?'plain' \| 'tile'|variant\?: 'plain' \| 'tile'/.test(rowSrc));
  check('a tile row measures its ink against the tinted TILE, not the card',
    /const tintedSurface = mix\(accent, TILE_FILL_ALPHA, theme\.card\);/.test(rowSrc)
    && /readableOn\(tintedSurface, accent, 3\)/.test(rowSrc)
    && !/readableOn\(theme\.card, accent/.test(rowSrc),
    'measuring on the card read 3.12:1 on Orange while the tile itself was 2.71:1');
}

// ── 6b. One name for the feature ────────────────────────────────────────────
console.log('\n── naming ──');
{
  // The hub's streak stat used to read "10d · Steady" — `labelForStreak` names
  // the MULTIPLIER tier, not the streak, and it appears nowhere else in the app
  // as a standalone label. So the same number was called "Aware Run" at zero and
  // "Steady" at ten. The tier still shows where it is spelled out in full (the
  // Dashboard vault explainer: "N-day Aware Run · Steady · ×1.2").
  const rewardCfg = readFileSync(`${ROOT}/config/rewardConfig.ts`, 'utf8');
  const tiers = [...rewardCfg.matchAll(/label: '([^']+)'\s*\}/g)].map((m) => m[1]);
  check(`the tier labels were found in the config (${tiers.join(', ')})`, tiers.length >= 3);
  const leaked = tiers.filter((t) => profile.includes(`'${t}'`) || profile.includes(`>${t}<`)
    || new RegExp(`^\\s*${t}\\s*$`, 'm').test(profile));
  check('the hub shows no tier label as a standalone name', leaked.length === 0,
    `leaked: ${leaked.join(', ')}`);
  check('…and does not even reach for labelForStreak', !/labelForStreak/.test(profile));
  check('the streak stat is named "Aware Run"', /Aware Run/.test(profile));
}

// ── 6c. One heading per screen, not a masthead ──────────────────────────────
console.log('\n── copy weight ──');
{
  // The Shop shipped with FOUR tiers of text before the first card: the screen
  // title "Shop", an ALL-CAPS eyebrow "CUSTOM WIDGETS", a 20pt "Make the
  // dashboard yours", and a two-sentence paragraph — all saying the same thing.
  // ui-consistency §1 also bans ALL-CAPS eyebrows as section headings, which
  // both new screens were doing.
  check('the shop masthead is gone', !/shopEyebrow|shopHeading/.test(shop));
  check('neither new screen defines an eyebrow style',
    !/^\s*eyebrow:/m.test(profile) && !/Eyebrow:/.test(shop),
    'an InfoSheet `eyebrow` PROP is a different thing and is fine');
  check('the hub has no group labels above its two card groups',
    !/>PERKS</.test(profile) && !/>APP</.test(profile));

  // Exactly one block of copy between the balance strip and the cards.
  const body = shop.split('contentContainerStyle={styles.scroll}>')[1]?.split('shopItems.length === 0')[0] ?? '';
  const texts = (body.match(/<Text/g) || []).length;
  check(`exactly one line of intro copy before the cards (found ${texts})`, texts === 1,
    'a screen title plus three more tiers is a masthead, not a heading');
  check('…and it is a single sentence', (body.match(/\./g) || []).length <= 2,
    'where EPC comes from is the EPC info sheet\'s job, not this screen\'s');
}

// ── 7. Icons, not emoji (chrome only) ───────────────────────────────────────
console.log('\n── icons rule ──');
{
  // The old screen used 💰 for EPC in four places and 🔒 on the lock badge.
  // Those are chrome. A widget's OWN emoji is data and stays.
  check('no coin emoji left as chrome', !/💰/.test(profile) && !/💰/.test(shop));
  check('no padlock emoji on the lock badge', !/🔒/.test(shop));
  check('EPC reads as an Ionicon on both screens',
    /name="cash-outline"/.test(profile) && /name="cash-outline"/.test(shop));
  check('the widget keeps its own emoji (that is data)', /\{item\.emoji\}/.test(shop));
}

console.log(`\n${C.bold}──────────────────────────────────${C.reset}`);
console.log(`  ${fail ? C.red : C.green}${C.bold}${pass}/${pass + fail} passed${C.reset}\n`);
process.exit(fail ? 1 : 0);
