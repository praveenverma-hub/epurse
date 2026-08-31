// =============================================================================
// useRewardPalette — the shared palette for the reward surfaces (Profile, Shop).
//
// These screens were one file (RewardShop.tsx) with a screen-local `D` object
// derived from useTheme(). Splitting the hub from the shop would have copied
// ~25 colour tokens into a second file, and two copies of a palette drift the
// moment one of them gets a tweak — so `D` moved out here.
//
// Two kinds of token live in it: the ones with a direct theme equivalent
// (bg/card/text/primary/success) are mapped 1:1, and the decorative ones
// (gradients, tints, the lock scrim) get a light/dark pair keyed off
// `theme.darkMode`, because they'd look broken in the other mode. Don't add a
// token here that a screen could take straight from useTheme().
//
// `gold` is the reward accent (levels, EPC) and is deliberately NOT the app
// accent: it means "earned", the same way success/danger mean their own thing
// (ui-consistency §7). `goldInk`/`successInk` are the same hues MEASURED for
// text/icon use.
//
// MEASURE AGAINST THE TINT, NOT THE CARD. The first cut derived the inks from
// `card`, which is the surface they DON'T sit on: gold text sits on a 14% gold
// fill, and that fill lifts the surface toward the ink. It measured 4.75:1 on
// the card and 4.33:1 on the pill it actually renders on — i.e. the number that
// looked safe was of the wrong pair. Deriving from the composited tint is
// strictly safer: it also clears the plain card, which is further away.
//
// The tint and border are built from the SAME alpha constants, so a fill can't
// be darkened without the ink following it.
// =============================================================================

import { useMemo } from 'react';

import { useTheme } from './useTheme';
import { mix, readableOn, withAlpha } from '../constants/theme';

export type RewardPalette = ReturnType<typeof useRewardPalette>;

export const REWARD_GOLD = '#F59E0B';
export const REWARD_GOLD_GLOW = '#FCD34D';

/** Fill alpha for a gold/success pill. Alpha, so one value works in both modes. */
export const REWARD_TINT_ALPHA = 0.14;
/** Border alpha for the same pill — visible edge, still not a second fill. */
export const REWARD_BORDER_ALPHA = 0.3;

export const useRewardPalette = () => {
  const theme = useTheme();
  const dark = theme.darkMode;

  // The surfaces the reward inks actually land on.
  const goldSurface = mix(REWARD_GOLD, REWARD_TINT_ALPHA, theme.card);
  const successSurface = mix(theme.success, REWARD_TINT_ALPHA, theme.card);

  return useMemo(() => ({
    dark,
    bg:            theme.background,
    card:          theme.card,
    cardElevated:  theme.cardAlt,
    border:        theme.divider,
    borderActive:  theme.primary,
    white:         theme.textPrimary,
    textSec:       theme.textSecondary,
    textMuted:     theme.textMuted,
    gold:          REWARD_GOLD,
    goldGlow:      REWARD_GOLD_GLOW,
    // Ink for the gold/success tints below, measured on the tint itself.
    // Raw #F59E0B is ~2.15:1 as small text on a light card.
    goldInk:       readableOn(goldSurface, REWARD_GOLD, 4.5),
    successInk:    readableOn(successSurface, theme.success, 4.5),
    primary:       theme.primary,
    success:       theme.success,
    heroGradient:  dark ? ['#1B2342', '#0F1428'] : ['#FFFFFF', '#F1F3F7'],
    cardGradient:  dark ? ['#1A2138', '#10162A'] : ['#FFFFFF', '#F7F8FA'],
    hairline:      dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)',
    overlayTint:   dark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.04)',
    overlayBorder: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
    lockTint:      dark ? 'rgba(10,14,26,0.78)'    : 'rgba(244,245,247,0.85)',
    lockBadgeBg:   dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
    lockBadgeBorder: dark ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.12)',
    goldTint:      withAlpha(REWARD_GOLD, REWARD_TINT_ALPHA),
    goldBorder:    withAlpha(REWARD_GOLD, REWARD_BORDER_ALPHA),
    successTint:   withAlpha(theme.success, REWARD_TINT_ALPHA),
    successBorder: withAlpha(theme.success, REWARD_BORDER_ALPHA),
    switchTrackOff: dark ? '#283047' : '#D1D5DB',
  }), [theme, dark, goldSurface, successSurface]);
};

export default useRewardPalette;
