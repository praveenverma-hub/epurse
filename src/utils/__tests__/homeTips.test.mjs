// HOME TIP TESTS — what Home's tip strip shows.
//   node --no-warnings --import ./src/utils/__tests__/_register.mjs src/utils/__tests__/homeTips.test.mjs
import { readFileSync } from 'node:fs';
import { buildHomeTips, HOME_TIP_LIMIT, SAVE_MIN_YEARLY } from '../../analytics/homeTips.js';
import { PROMO_CARDS } from '../../analytics/homeCards.js';
import { contrastRatio, mix, readableOn } from '../../constants/theme.js';
import { THEMES, DARK_NEUTRALS } from '../../constants/themes.js';
import { TIP_BAND_VARIANTS, tipBandHue, tipBandWash } from '../../constants/tipBand.js';
import { buildPalette } from '../../constants/themes.js';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}  ${detail}`); }
};
const ids = (tips) => tips.map((t) => t.id);

const CARRY   = { monthKey: '2026-09' };
const TOP     = { name: 'Food & Dining', total: 8200 };
const REWARDS = { toNext: 340, nextLevel: 3, perReview: 10 };

console.log('\n── a slide only exists with a real fact behind it ──');
{
  check('no facts, no promos → no slides (strip hides)', buildHomeTips({}, []).length === 0);
  check('rewards + feature tips alone do NOT keep the strip up — they are fillers',
    buildHomeTips({ rewards: REWARDS }, PROMO_CARDS).length === 0);
  check('…but they ride along once a live fact is there',
    ids(buildHomeTips({ lastMonthTop: TOP, rewards: REWARDS }, PROMO_CARDS)).join().startsWith('tip_save,tip_rewards,tip_promo_'));
  check('rewards with nothing to go → no rewards slide',
    !ids(buildHomeTips({ lastMonthTop: TOP, rewards: { ...REWARDS, toNext: 0 } })).includes('tip_rewards'));
  check(`a saving under ₹${SAVE_MIN_YEARLY}/yr is not worth a slide`,
    !ids(buildHomeTips({ lastMonthTop: { name: 'Fuel', total: 500 } })).includes('tip_save'));
  check('no carryable goal plan → no carry slide', !ids(buildHomeTips({ goalCarry: null })).includes('tip_goal_carry'));
}

console.log('\n── content ──');
{
  const [save] = buildHomeTips({ lastMonthTop: TOP });
  check('the saving is 10% of last month × 12', /₹9\.84k a year/.test(save.title), save.title);
  const [carry] = buildHomeTips({ goalCarry: CARRY });
  check('the carry slide names last month and is an ACTION, not a link',
    /September/.test(carry.title) && carry.action === 'keepGoalPlan' && !carry.target, JSON.stringify(carry));
  check("…using the app's existing button label", carry.cta === "Keep Last Month's Plan" && carry.actionLabel === 'Keep');
  const rw = buildHomeTips({ lastMonthTop: TOP, rewards: REWARDS }).find((t) => t.id === 'tip_rewards');
  check('the rewards slide states real progress, not a made-up count', /340 RP to Level 3/.test(rw.title) && /10/.test(rw.title), rw.title);
}

console.log('\n── last month & subscriptions ──');
{
  const [lm] = buildHomeTips({ lastMonth: { monthKey: '2026-09', spent: 42300, prevSpent: 46000 } });
  check('last month vs the month before, rounded %', lm.title === 'September: ₹42.3k spent, 8% less than August', lm.title);
  check('…and it opens THAT month\'s recap', lm.target[0] === 'MonthlyRecapSummary' && lm.target[1].monthKey === '2026-09');
  const [jan] = buildHomeTips({ lastMonth: { monthKey: '2026-01', spent: 5000, prevSpent: 4000 } });
  check('January compares against December of the year before', /25% more than December/.test(jan.title), jan.title);
  const [first] = buildHomeTips({ lastMonth: { monthKey: '2026-09', spent: 42300, prevSpent: 0 } });
  check('no month before → no comparison, just the figure', first.title === 'September: ₹42.3k spent', first.title);
  check('nothing spent / recap card on screen (null) → no slide',
    buildHomeTips({ lastMonth: { monthKey: '2026-09', spent: 0, prevSpent: 100 } }).length === 0 && buildHomeTips({ lastMonth: null }).length === 0);
  const SUBS = [{ amount: 649 }, { amount: 119 }];
  const [sub] = buildHomeTips({ subscriptions: SUBS });
  check('subscriptions: count + monthly run-rate', /^2 subscriptions take ₹768 every month$/.test(sub.title), sub.title);
  check('…but not while the carousel shows its subscriptions card',
    !ids(buildHomeTips({ subscriptions: SUBS, carouselIds: ['subscriptions'] })).includes('tip_subscriptions'));
}

console.log('\n── order, limit and the carousel hand-off ──');
{
  const LM = { monthKey: '2026-09', spent: 42300, prevSpent: 46000 };
  const all = buildHomeTips({ goalCarry: CARRY, lastMonth: LM, lastMonthTop: TOP, subscriptions: [{ amount: 649 }], rewards: REWARDS }, PROMO_CARDS);
  check('action first, then live facts, then features',
    ids(all).slice(0, 5).join() === 'tip_goal_carry,tip_last_month,tip_save,tip_subscriptions,tip_rewards', ids(all).join());
  check(`never more than ${HOME_TIP_LIMIT}`, all.length === HOME_TIP_LIMIT);
  const shown = PROMO_CARDS.slice(0, 5).map((p) => p.id);
  const tips = buildHomeTips({ lastMonthTop: TOP, carouselIds: shown }, PROMO_CARDS);
  check('a promo the carousel shows is not repeated in the strip',
    ids(tips).join() === `tip_save,tip_${PROMO_CARDS[5].id}`, ids(tips).join());
  check('every promo has a one-line tip', PROMO_CARDS.every((p) => typeof p.tip === 'string' && p.tip.length > 0 && p.tip.length <= 64),
    PROMO_CARDS.filter((p) => !p.tip || p.tip.length > 64).map((p) => p.id).join());
}

console.log('\n── our own words ──');
{
  const all = buildHomeTips({ goalCarry: CARRY, lastMonthTop: TOP, rewards: REWARDS }, PROMO_CARDS, 99);
  check('no slide uses a "Did you know?" eyebrow', all.every((t) => !/did you know/i.test(t.eyebrow)), all.map((t) => t.eyebrow).join(' | '));
  const feature = all.find((t) => t.id === 'tip_promo_backup');
  check("feature slides reuse the promo's own eyebrow", feature?.eyebrow === PROMO_CARDS.find((p) => p.id === 'promo_backup').eyebrow);
}

console.log('\n── the slide colours on every theme (LIGHT washes) ──');
{
  for (const id of Object.keys(THEMES)) {
    const p = buildPalette(id, false);
    const bands = TIP_BAND_VARIANTS.map((_, i) => tipBandWash(p.primary, i, p.card));
    const ok = bands.every((band, i) => {
      const hue = tipBandHue(p.primary, i);
      return contrastRatio(readableOn(band, p.textPrimary), band) >= 4.5
        && contrastRatio(readableOn(band, p.textSecondary), band) >= 4.5
        && contrastRatio(readableOn(p.card, hue, 3), p.card) >= 3
        && contrastRatio(readableOn(band, hue), band) >= 4.5;
    });
    check(`${id}: title / eyebrow / action ≥ 4.5, icon ≥ 3 on every slide`, ok, bands.join(' '));
    check(`${id}: LIGHT — every slide close to the card surface, never a dark band`,
      bands.every((b) => contrastRatio(b, p.card) < 1.35), bands.map((b) => contrastRatio(b, p.card).toFixed(2)).join(' '));
    check(`${id}: …but visibly tinted, and neighbours differ`,
      bands.every((b) => b.toLowerCase() !== String(p.card).toLowerCase()) && bands.every((b, i) => i === 0 || b !== bands[i - 1]));
  }
  check('hue nudges stay within ±12° — wider left the family (olive orange, green Carbon)',
    TIP_BAND_VARIANTS.every((v) => Math.abs(v.hue) <= 12));
  check('slide colours cycle when there are more slides than variants',
    tipBandWash('#5B3CC4', TIP_BAND_VARIANTS.length, '#FFFFFF') === tipBandWash('#5B3CC4', 0, '#FFFFFF'));
}

console.log('\n── the strip never moves on its own ──');
{
  const src = readFileSync(new URL('../../components/TipStrip.tsx', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('no timer in TipStrip', !/setInterval|setTimeout/.test(src));
  const rnNames = (/import \{([^}]*)\} from 'react-native'/.exec(src)?.[1] || '').split(',').map((n) => n.trim());
  check('Text comes from AppText', /from '\.\/AppText'/.test(src) && !rnNames.includes('Text'), rnNames.join());
  const dash = readFileSync(new URL('../../screens/DashboardScreen.js', import.meta.url), 'utf8');
  check('Home waits for both stores before showing slides', /<TipStrip[^>]*loading=\{!hydrated \|\| !rewardsHydrated\}/.test(dash));
  check('Home breaks the band out of its gutter', /<TipStrip[^>]*bleed=\{spacing\.lg\}/.test(dash));
  check('a band, not a card: no radius, no shadow, no card fill', !/borderRadius:\s*radius|shadows\.|backgroundColor:\s*t\.card/.test(src));
  check('each slide paints its own light wash (clones wear their original\'s)',
    /const band = tipBandWash\(theme\.primary, i, theme\.card\)/.test(src) && /inks\[realIndexFor\(listIndex, count, canLoop\)\]/.test(src)
    && /backgroundColor: ink\.band/.test(src) && !/'#[0-9A-Fa-f]{3,8}'/.test(src));
  check('every ink measured on its own slide; no border (user)',
    /icon: readableOn\(theme\.card, hue, 3\)/.test(src) && /action: readableOn\(band, hue\)/.test(src) && !/border(Top|Bottom)?Width/.test(src));
  check('compact: no separate CTA line under the title', !/item\.cta\}<\/Text>/.test(src));
  check('it loops: the clones and the wrap come from the carousel helpers', /wrapTarget\(at, count, canLoop\)/.test(src) && /__tail/.test(src) && /__head/.test(src));
}

console.log(`\n──────────────────────────────────\n  ${fail ? C.red : C.green}${pass}/${pass + fail} passed${C.reset}`);
if (fail) process.exit(1);
