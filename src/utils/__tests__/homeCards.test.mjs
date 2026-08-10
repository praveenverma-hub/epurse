// =============================================================================
// HOME CARD TESTS — what the Dashboard carousel decides to show.
// -----------------------------------------------------------------------------
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs \
//        src/utils/__tests__/homeCards.test.mjs
//
// Two things are worth pinning, and they're both about restraint:
//   1. A card NEVER appears without real data behind it. A carousel that says
//      "₹0 in subscriptions" or "0% of your budget used" is worse than an empty
//      slot, and every one of these is driven by a selector that legitimately
//      returns zero/null for a new user.
//   2. Ranking is by urgency, not by builder order — the whole point of the
//      rework. An over-budget warning must beat "your top category is Food".
//
// The promo backfill is what makes the feature banners self-retiring, so the
// hand-off in both directions is tested too.
// =============================================================================
import { buildHomeCards, HOME_CARD_LIMIT, PROMO_CARDS, TIER } from '../../analytics/homeCards.js';
import { CARD_BODY_MAX_CHARS, CARD_TITLE_MAX_CHARS_PER_LINE } from '../../constants/carousel.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};

const ids = (cards) => cards.map((c) => c.id);
const PROMOS = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, icon: 'x', eyebrow: 'e', title: 't', body: 'b', cta: 'c', target: ['Home'] }));

// Facts that produce one card each, for composing cases.
const OVER_BUDGET  = { total: { cap: 10000, actual: 12000, pct: 120, remaining: 0, over: true, overshoot: 2000 }, daysLeftInMonth: 9 };
const HOT_BUDGET   = { total: { cap: 10000, actual: 8500, pct: 85, remaining: 1500, over: false }, daysLeftInMonth: 9 };
const CALM_BUDGET  = { total: { cap: 10000, actual: 2000, pct: 20, remaining: 8000, over: false }, daysLeftInMonth: 9 };
const SUBS         = [{ merchant: 'Netflix', amount: 649, priceHike: false }, { merchant: 'Spotify', amount: 119, priceHike: false }];
const SUBS_HIKED   = [{ merchant: 'Netflix', amount: 649, priceHike: true, hikeFrom: 549, hikeTo: 649 }, ...SUBS];
const TOP_CAT      = { name: 'Food & Dining', emoji: '🍔', total: 8200, percent: 42 };
const WEEK         = { total: 4300, dailyAvg: 614, daysElapsed: 7 };
const UNCAT        = { amount: 5600, count: 4 };

// ── Nothing is invented from nothing ────────────────────────────────────────
console.log('\n── a card needs real data ──');

let cards = buildHomeCards({}, []);
check('no facts and no promos → no cards at all (not placeholders)', cards.length === 0, JSON.stringify(ids(cards)));

check('no budget plan → no budget card',
  !ids(buildHomeCards({ budget: null })).includes('budget_over'));
check('a budget with no total cap → no budget card',
  !ids(buildHomeCards({ budget: { total: { cap: null }, daysLeftInMonth: 5 } })).some((i) => i.startsWith('budget')));
check('a calm budget (20% used) → no card; silence is the good news',
  buildHomeCards({ budget: CALM_BUDGET }).length === 0);

check('zero-spend week → no week card',
  !ids(buildHomeCards({ week: { total: 0, dailyAvg: 0, daysElapsed: 3 } })).includes('week_pace'));
check('a top category at 12% → no card (nothing is concentrated)',
  !ids(buildHomeCards({ topCategory: { name: 'Food', total: 500, percent: 12 } })).includes('top_category'));
check('a top category at 0 spend → no card',
  !ids(buildHomeCards({ topCategory: { name: 'Food', total: 0, percent: 80 } })).includes('top_category'));
check('ONE subscription → no commitment card (not a pattern yet)',
  !ids(buildHomeCards({ subscriptions: [SUBS[0]] })).includes('subscriptions'));
check('subscriptions summing to 0 → no card',
  !ids(buildHomeCards({ subscriptions: [{ merchant: 'A', amount: 0 }, { merchant: 'B', amount: 0 }] })).includes('subscriptions'));
check('uncategorised amount 0 → no card',
  !ids(buildHomeCards({ uncategorised: { amount: 0, count: 0 } })).includes('uncategorised'));
check('a "hike" that is not actually higher → no hike card',
  !ids(buildHomeCards({ subscriptions: [{ merchant: 'N', amount: 100, priceHike: true, hikeFrom: 200, hikeTo: 100 }] })).includes('sub_hike'));

// ── Urgency wins ────────────────────────────────────────────────────────────
console.log('\n── ranking is by urgency ──');

cards = buildHomeCards({ budget: OVER_BUDGET, topCategory: TOP_CAT, week: WEEK, subscriptions: SUBS_HIKED, uncategorised: UNCAT }, PROMOS);
check('over-budget outranks every insight', cards[0].id === 'budget_over', JSON.stringify(ids(cards)));
check('tiers come out in order', cards.every((c, i) => i === 0 || cards[i - 1].tier <= c.tier), JSON.stringify(cards.map((c) => c.tier)));
// Within a tier there's no second sort key — the stable sort keeps the builder
// list's order, so THAT list is the within-tier ranking. Pinned here because it's
// otherwise invisible: reordering the builders silently reorders the strip.
{
  // A raised limit on purpose: at HOME_CARD_LIMIT the 6th card is trimmed, so the
  // last insight would never reach this assertion.
  const all = buildHomeCards(
    { budget: OVER_BUDGET, topCategory: TOP_CAT, week: WEEK, subscriptions: SUBS_HIKED, uncategorised: UNCAT },
    [], 10,
  );
  const insights = all.filter((c) => c.tier === TIER.INSIGHT).map((c) => c.id);
  check('insights hold their intended order: category → subscriptions → unlabelled',
    JSON.stringify(insights) === JSON.stringify(['top_category', 'subscriptions', 'uncategorised']),
    JSON.stringify(insights));
}
check('the moment (this week) sits above standing insights',
  ids(cards).indexOf('week_pace') < ids(cards).indexOf('top_category'), JSON.stringify(ids(cards)));

// The builder list is grouped by subject, NOT by tier, so ranking is the only
// thing that decides order. This case is built so that dropping the sort shows
// an INSIGHT first: `subscriptionHikeCard` (urgent) runs after the two insight
// builders whose facts are also present.
cards = buildHomeCards({ topCategory: TOP_CAT, subscriptions: SUBS_HIKED });
check('a late-built URGENT card still beats early-built insights',
  cards[0].id === 'sub_hike', JSON.stringify(ids(cards)));

cards = buildHomeCards({ subscriptions: SUBS_HIKED, topCategory: TOP_CAT });
check('a price hike is urgent, so it leads', cards[0].id === 'sub_hike', JSON.stringify(ids(cards)));
check('the same subscriptions still produce the commitment card too',
  ids(cards).includes('subscriptions'), JSON.stringify(ids(cards)));

cards = buildHomeCards({ subscriptions: [
  { merchant: 'Small', amount: 200, priceHike: true, hikeFrom: 180, hikeTo: 200 },
  { merchant: 'Big',   amount: 900, priceHike: true, hikeFrom: 600, hikeTo: 900 },
] });
check('with two hikes, the BIGGEST rise is the one shown',
  cards[0].title.includes('Big'), cards[0].title);

check('over-budget beats running-hot — they never both appear',
  buildHomeCards({ budget: OVER_BUDGET }).filter((c) => c.id.startsWith('budget')).length === 1);
check('running hot with 9 days left → a card',
  ids(buildHomeCards({ budget: HOT_BUDGET })).includes('budget_pace'));
check('running hot on the last days → NO card (nothing left to change)',
  !ids(buildHomeCards({ budget: { ...HOT_BUDGET, daysLeftInMonth: 2 } })).includes('budget_pace'));

// ── Promos are the empty state ──────────────────────────────────────────────
console.log('\n── promos backfill, then retire ──');

cards = buildHomeCards({}, PROMOS);
check('a brand-new user sees promos and nothing else',
  cards.length === HOME_CARD_LIMIT && cards.every((c) => c.tier === TIER.PROMO), JSON.stringify(ids(cards)));

cards = buildHomeCards({ topCategory: TOP_CAT }, PROMOS);
check('one live card → it leads and promos fill the rest',
  cards[0].id === 'top_category' && cards.length === HOME_CARD_LIMIT, JSON.stringify(ids(cards)));
check('the live card is NOT tagged as a promo', cards[0].tier === TIER.INSIGHT);

cards = buildHomeCards({ budget: OVER_BUDGET, subscriptions: SUBS_HIKED, week: WEEK, topCategory: TOP_CAT, uncategorised: UNCAT }, PROMOS);
check('a full house of live cards retires the promos entirely',
  cards.length === HOME_CARD_LIMIT && !cards.some((c) => c.tier === TIER.PROMO), JSON.stringify(ids(cards)));
check('never exceeds the limit even with 6 live candidates',
  cards.length === HOME_CARD_LIMIT, String(cards.length));

check('no promos supplied and few facts → just the live cards, no padding',
  buildHomeCards({ topCategory: TOP_CAT }, []).length === 1);

// ── Shape contract (the carousel renders these fields blind) ────────────────
console.log('\n── every card is renderable ──');

cards = buildHomeCards({ budget: OVER_BUDGET, subscriptions: SUBS_HIKED, week: WEEK, topCategory: TOP_CAT, uncategorised: UNCAT }, PROMOS);
const REQUIRED = ['id', 'icon', 'eyebrow', 'title', 'body', 'cta', 'target', 'tier', 'tone'];
const missing = cards.flatMap((c) => REQUIRED.filter((k) => c[k] === undefined).map((k) => `${c.id}.${k}`));
check('no card is missing a field the carousel reads', missing.length === 0, missing.join(', '));
check('every target is a [route, params?] tuple',
  cards.every((c) => Array.isArray(c.target) && typeof c.target[0] === 'string'));
check('ids are unique (they are FlatList keys)',
  new Set(ids(cards)).size === cards.length, JSON.stringify(ids(cards)));
check('no title still contains an unformatted raw number',
  cards.every((c) => !/\d{4,}/.test(c.title)), cards.map((c) => c.title).join(' | '));
check('urgent cards are toned danger, insights are not',
  cards.filter((c) => c.tier === TIER.URGENT).every((c) => c.tone === 'danger')
  && cards.filter((c) => c.tier === TIER.INSIGHT).every((c) => c.tone === 'accent'));

// A promo must survive backfill with its own copy intact — the tier is
// overridden, nothing else is.
const promoOut = buildHomeCards({}, [{ id: 'keepme', icon: 'i', eyebrow: 'E', title: 'T', body: 'B', cta: 'C', target: ['Groups', { a: 1 }] }])[0];
check('backfill preserves a promo\'s own copy and target',
  promoOut.title === 'T' && promoOut.target[1].a === 1 && promoOut.tier === TIER.PROMO, JSON.stringify(promoOut));

// ── CC bill due — the one card with a time window ───────────────────────────
// Every case injects `now`, so these don't drift as the real date moves.
console.log('\n── CC bill due window ──');
{
  const NOW = new Date(2026, 7, 10, 15, 0, 0).getTime();   // 10 Aug 2026, afternoon
  const bill = (dueDate, extra = {}) => ({
    hdfc: { amount: 12400, cardLast4: '4021', bankName: 'HDFC Bank', dueDate, ...extra },
  });
  const billCard = (bills, now = NOW) =>
    buildHomeCards({ ccBills: bills, now }, []).find((c) => c.id === 'cc_bill_due') || null;

  check('due in 3 days → a card', !!billCard(bill('13-Aug-26')));
  check('reads "due in 3 days"', billCard(bill('13-Aug-26')).title.includes('due in 3 days'),
    billCard(bill('13-Aug-26'))?.title);
  check('due tomorrow reads "due tomorrow"', billCard(bill('11-Aug-26')).title.includes('due tomorrow'));
  check('due today reads "due today"', billCard(bill('10-Aug-26')).title.includes('due today'));
  // Floored to local midnight on BOTH sides — at 3pm, a bill dated tomorrow is
  // "tomorrow", not "0 days", which raw timestamp subtraction would give.
  check('the afternoon does not turn tomorrow into today',
    billCard(bill('11-Aug-26')).title.includes('tomorrow'), billCard(bill('11-Aug-26'))?.title);

  check('7 days out → still shown (edge of the window)', !!billCard(bill('17-Aug-26')));
  check('8 days out → not yet worth interrupting for', billCard(bill('18-Aug-26')) === null);

  check('1 day overdue → still warns', !!billCard(bill('09-Aug-26')));
  check('overdue copy says overdue', billCard(bill('09-Aug-26')).eyebrow === 'Overdue');
  check('overdue reads "1 day overdue"', billCard(bill('09-Aug-26')).title.includes('1 day overdue'));
  check('3 days overdue → still warns (edge of grace)', !!billCard(bill('07-Aug-26')));
  check('4 days overdue → gone; assume paid rather than nag',
    billCard(bill('06-Aug-26')) === null);

  check('an unparseable due date → no card, not a vague one',
    billCard(bill('sometime soon')) === null);
  check('a missing due date → no card', billCard(bill(null)) === null);
  check('a zero amount → no card', billCard(bill('12-Aug-26', { amount: 0 })) === null);
  check('an empty bill map → no card', billCard({}) === null);

  // Numeric Indian form, since that's the other shape banks send.
  check('DD/MM/YYYY parses too', !!billCard(bill('12/08/2026')));

  // Two cards, two bills: the nearer one wins, and only ONE bill card is ever
  // emitted — two would crowd out every other card in a 5-slot strip.
  const two = {
    a: { amount: 5000, cardLast4: '1111', bankName: 'A Bank', dueDate: '16-Aug-26' },
    b: { amount: 9000, cardLast4: '2222', bankName: 'B Bank', dueDate: '12-Aug-26' },
  };
  const twoCards = buildHomeCards({ ccBills: two, now: NOW }, []);
  check('with two bills, the SOONEST is shown', twoCards[0].body.includes('2222'), twoCards[0].body);
  check('only one bill card is emitted',
    twoCards.filter((c) => c.id === 'cc_bill_due').length === 1);

  check('the card names the specific card, not just "credit card"',
    billCard(bill('12-Aug-26')).body.includes('HDFC Bank •• 4021'), billCard(bill('12-Aug-26'))?.body);
  // Asserts the LABEL leads, not the punctuation after it — this check used to
  // hard-code the trailing "." and broke when the copy was shortened to fit the
  // narrower centred card, which is a test coupled to wording rather than behaviour.
  check('a bill with no mask still renders a sensible label',
    billCard({ x: { amount: 900, bankName: 'ICICI', dueDate: '12-Aug-26' } }).body.startsWith('ICICI'));

  // The reason this card exists: it must outrank everything, including a breach.
  const withBudget = buildHomeCards(
    { ccBills: bill('12-Aug-26'), budget: OVER_BUDGET, subscriptions: SUBS_HIKED, now: NOW }, [],
  );
  check('a dated bill leads even over an over-budget warning',
    withBudget[0].id === 'cc_bill_due', JSON.stringify(withBudget.map((c) => c.id)));
  check('and the rest of the urgent tier still follows it',
    withBudget[1].id === 'budget_over' && withBudget[2].id === 'sub_hike',
    JSON.stringify(withBudget.map((c) => c.id)));
}

// ── The REAL promo cards, not just fixtures ─────────────────────────────────
// The cases above use stub promos to test the mechanism; these check the copy
// that actually ships. A promo missing a field renders a blank line on a brand-
// new user's very first screen, which is the worst possible place for it.
console.log('\n── shipped promo cards ──');

check(`there are enough promos to fill the strip (${PROMO_CARDS.length} ≥ ${HOME_CARD_LIMIT})`,
  PROMO_CARDS.length >= HOME_CARD_LIMIT);
const promoMissing = PROMO_CARDS.flatMap((c) =>
  ['id', 'icon', 'eyebrow', 'title', 'body', 'cta', 'target']
    .filter((k) => !c[k]).map((k) => `${c.id || '?'}.${k}`));
check('every shipped promo has all its copy', promoMissing.length === 0, promoMissing.join(', '));
check('shipped promo ids are unique',
  new Set(PROMO_CARDS.map((c) => c.id)).size === PROMO_CARDS.length);
check('every shipped promo routes somewhere',
  PROMO_CARDS.every((c) => Array.isArray(c.target) && typeof c.target[0] === 'string'));
// The card caps title at 2 lines; a promo hard-wraps with \n, so a third line
// would be silently truncated on the one screen a new user definitely sees.
check('no shipped promo title has more than 2 lines',
  PROMO_CARDS.every((c) => c.title.split('\n').length <= 2),
  PROMO_CARDS.filter((c) => c.title.split('\n').length > 2).map((c) => c.id).join(', '));
check('a real-promo build fills exactly the limit',
  buildHomeCards({}, PROMO_CARDS).length === HOME_CARD_LIMIT);

// ── Copy has to FIT the card ────────────────────────────────────────────────
// Centring the carousel (a peek on both sides now) cost the card ~30pt of width,
// so the copy budget shrank with it. The card truncates with an ellipsis, which
// mid-word reads as broken rather than trimmed — and two of these bodies were
// already over budget at the OLD width, silently clipped.
//
// The budgets are conservative character approximations, documented in
// constants/carousel.js. Checked for LIVE cards too, not just the static promos:
// their bodies are template strings, so the only way to know is to build them.
console.log('\n── copy fits the card ──');
{
  const all = buildHomeCards(
    {
      budget: OVER_BUDGET, topCategory: TOP_CAT, week: WEEK,
      subscriptions: SUBS_HIKED, uncategorised: UNCAT,
      ccBills: { h: { amount: 12400, cardLast4: '4021', bankName: 'HDFC Bank', dueDate: '13-Aug-26' } },
      now: new Date(2026, 7, 10).getTime(),
    },
    PROMO_CARDS, 20,
  );
  // Also cover the branches the "full house" set doesn't reach.
  const variants = [
    ...all,
    ...buildHomeCards({ budget: HOT_BUDGET }, [], 5),
    ...buildHomeCards({ uncategorised: { amount: 900, count: 1 } }, [], 5),
    ...buildHomeCards({ week: { total: 500, dailyAvg: 500, daysElapsed: 1 } }, [], 5),
    ...buildHomeCards({
      ccBills: { h: { amount: 5000, cardLast4: '9999', bankName: 'Kotak Mahindra Bank', dueDate: '08-Aug-26' } },
      now: new Date(2026, 7, 10).getTime(),
    }, [], 5),
  ];

  const longBodies = variants
    .filter((c) => c.body.length > CARD_BODY_MAX_CHARS)
    .map((c) => `${c.id} (${c.body.length})`);
  check(`every body fits ${CARD_BODY_MAX_CHARS} chars`, longBodies.length === 0, longBodies.join(', '));

  // Promos hard-wrap with \n, so the budget is PER LINE; a live title is one
  // string that wraps on its own, so its whole length must fit two lines.
  const longTitleLines = variants.flatMap((c) => {
    const lines = c.title.split('\n');
    const budget = lines.length > 1 ? CARD_TITLE_MAX_CHARS_PER_LINE : CARD_TITLE_MAX_CHARS_PER_LINE * 2;
    return lines.filter((l) => l.length > budget).map((l) => `${c.id}: "${l}" (${l.length})`);
  });
  check('every title line fits its budget', longTitleLines.length === 0, longTitleLines.join(' · '));

  const longCtas = variants.filter((c) => c.cta.length > 24).map((c) => `${c.id} (${c.cta.length})`);
  check('every CTA stays short enough for one line', longCtas.length === 0, longCtas.join(', '));
  const longEyebrows = variants.filter((c) => c.eyebrow.length > 18).map((c) => `${c.id} (${c.eyebrow.length})`);
  check('every eyebrow stays short (it is UPPERCASED, so it grows)', longEyebrows.length === 0, longEyebrows.join(', '));
}

// ── Defensive: selectors do return junk sometimes ───────────────────────────
console.log('\n── survives missing / malformed facts ──');

check('undefined facts object does not throw', buildHomeCards(undefined, PROMOS).length === HOME_CARD_LIMIT);
check('null subscriptions array does not throw', buildHomeCards({ subscriptions: null }).length === 0);
check('a subscription with no amount is tolerated',
  buildHomeCards({ subscriptions: [{ merchant: 'A' }, { merchant: 'B', amount: 300 }] }).length >= 0);
check('a custom limit is honoured', buildHomeCards({}, PROMOS, 2).length === 2);

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${fail === 0 ? C.green : C.red}${pass}/${pass + fail} passed${C.reset}`);
process.exit(fail === 0 ? 0 : 1);
