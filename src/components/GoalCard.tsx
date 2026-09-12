// =============================================================================
// GoalCard — one goal as a square tile.
//
// The list rows this replaces were a planning control (name, ±, amount) doing
// double duty as a status display, and neither half read well. A goal is a
// thing you're PROUD of, so it gets a tile built the way a trophy card is: a
// state ribbon across the top, the goal's own glyph as the hero, one headline
// number in a pill, the name, and a footer of three small stats divided by
// hairlines. Allocating to it lives in the plan editor, not here.
//
// PROGRESS IS THE RING AROUND THE GLYPH, not a bar under it (Sep-11-26). The
// tile already had a circle at its centre; wrapping it in the arc means one
// element carries both identity and status instead of two competing for the
// same 150pt of width. The arc is NOT the goal's own colour — that colour
// already tints the whole tile, so an arc in it disappeared into its own wash.
// It runs the theme's dark accent over a neutral track instead, and sits flush
// against the disc with no gap between the two.
//
// The glyph sits on a RADIAL glow in the goal's colour that fades to nothing at
// the disc's edge. It has to be SVG: RN's `shadow*`/`elevation` only draw a hard
// drop BENEATH a view, which is a different thing entirely from light behind an
// icon.
//
// Two columns on a phone, so every number is `formatCompact` ("₹3L", "₹45k").
// A full `formatCurrency` wraps at this width and the stat row falls apart.
// =============================================================================

import React, { useId } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import type { TextStyle, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../hooks/useTheme';
import {
  radius, spacing, typography as typographyBase, shadows, withAlpha, readableOn, mix,
} from '../constants/theme';
import { formatCompact } from '../utils/format';
import ProgressRing from './ProgressRing';
import EditIcon from './EditIcon';

const typography = typographyBase as unknown as Record<string, TextStyle>;

/** The card's own border, and the inner radius its clipped children follow. */
const CARD_BORDER = 1;
const INNER_RADIUS = radius.lg - CARD_BORDER;
/**
 * Fixed so the pencil can be placed just under the ribbon and the content can
 * start just under both. Letting the band size itself to its text meant those
 * two offsets were guesses that drifted with the font.
 */
const RIBBON_H = 22;
/** How much of the state's colour the band carries. */
const RIBBON_TINT = 0.18;

/** Outer diameter of the progress arc. */
const RING = 78;
const RING_STROKE = 5;
/**
 * The glyph disc. Exactly the arc's INNER diameter, so the two meet with no gap
 * — the stroke is centred on `(size - stroke) / 2`, which puts its inner edge at
 * `(size - 2 × stroke) / 2`. Subtracting anything more re-opens the ring of card
 * that used to sit between them.
 */
const MEDALLION = RING - RING_STROKE * 2;

export type GoalCardStatus = 'funded' | 'ahead' | 'on_track' | 'behind';

export interface GoalCardProps {
  name: string;
  emoji: string;
  color: string;
  /** This month's allocation. */
  planned: number;
  /** Put in this month (matched spend + anything typed). */
  funded: number;
  /** Pace against the day of the month. */
  status?: GoalCardStatus;
  /** Everything ever put in. */
  lifetimeSaved: number;
  /**
   * Optional finish line — and the ONE signal this card uses for duration
   * (Sep-12-26): a One-Time goal always has one (it's the only duration the
   * form ever lets have one), a Recurring goal never does. No separate
   * `duration` prop needed — the two are enforced to move together at the
   * store/form. A One-Time goal MAY also have a monthly rate (`planned`)
   * toward it, same as a Recurring goal — the two fields aren't mutually
   * exclusive, only Target-vs-none is duration-gated.
   */
  lifetimeTarget?: number | null;
  /** Whole months left at the current monthly rate, when both a target AND
   *  a monthly rate are known — null for a target with no rate to project
   *  from, or a goal with no target at all. */
  monthsLeft?: number | null;
  /** Set once the lifetime target has been reached. */
  achieved?: boolean;
  /**
   * Tapping the card BODY — opens the goal's own detail screen
   * (`GoalDetailScreen`, Sep-12-26): full stats, its history, and what this
   * total is MADE of (its matching + linked transactions). A bottom sheet did
   * this narrower job before; a full screen is where "stats required" lives.
   * Editing has its own affordance (the pencil); the two used to be the SAME
   * tap, so a body tap silently opened the edit form as a surprise, not a
   * shortcut. Still optional: a caller with nothing to show for it can omit
   * it and the tile is simply not pressable.
   */
  onPress?: () => void;
  /** The pencil. The ONLY way into the edit form from this tile. */
  onEdit?: () => void;
  onAddMoney?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** Label on the tile's one action. "Add" read as "add a goal" beside the FAB. */
const ACTION_LABEL = 'Update';

/**
 * What each pace state SAYS. Deliberately verbose: these sat at 6–8 characters
 * ("FUNDED", "AHEAD") in a chip barely wider than they were, and a bare word
 * doesn't say what it is measuring. The ribbon now spans the tile, so it can
 * afford to name the thing — "AHEAD" alone could mean ahead of anything.
 */
const RIBBON_COPY: Record<GoalCardStatus, string> = {
  funded: 'FULLY FUNDED',
  ahead: 'AHEAD OF PACE',
  on_track: 'ON TRACK',
  behind: 'BEHIND PACE',
};

/** No allocation in this month's plan — see the ribbon comment below. */
const RIBBON_UNPLANNED = 'NOTHING PLANNED';

const GoalCard: React.FC<GoalCardProps> = ({
  name, emoji, color, planned, funded, status, lifetimeSaved, lifetimeTarget,
  monthsLeft, achieved, onPress, onEdit, onAddMoney, style,
}) => {
  const theme = useTheme();
  // SVG gradient ids are GLOBAL to the document, and a screen renders many of
  // these tiles at once — a shared id means every glow picks up whichever card
  // mounted last (and renders the wrong colour, or nothing, on Android). React's
  // useId is per-instance; its `:r0:` form isn't safe in a url(#…) reference, so
  // the punctuation is stripped.
  const glowId = `goalGlow${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // A ONE-TIME goal (has a lifetime target) MAY ALSO have a monthly rate
  // toward it — the two are no longer mutually exclusive (Sep-12-26,
  // corrected same day: a one-time goal funded steadily every month is the
  // common case, not an edge case). `isOneTime` only gates whether a target
  // exists at all; `planned0` (no monthly figure THIS month) applies the
  // same way to either duration.
  const isOneTime = !!(lifetimeTarget && lifetimeTarget > 0);
  // Whether a monthly FIGURE exists — read from `planned` itself, not from
  // `status` (Sep-12-26: `status` used to be undefined only because the store
  // skipped an unplanned goal's row entirely, so "no status" and "nothing
  // planned" were the same fact by accident. Once the store started including
  // a row for a goal with real money but NO plan — fixing "This month"
  // reading ₹0 for exactly that goal — `status` stopped implying planned0,
  // since `paceStatus` trivially returns 'funded' for a zero plan).
  const planned0 = !(planned > 0);

  const pct = isOneTime
    ? Math.max(0, Math.min(100, Math.round((lifetimeSaved / lifetimeTarget) * 100)))
    : planned > 0
      ? Math.max(0, Math.min(100, Math.round((funded / planned) * 100)))
      : 0;

  // The ribbon states the most useful thing that's TRUE, in this order:
  //   1. done            — the target has been reached
  //   2. % saved         — a target, but NOTHING monthly to project a date from
  //   3. not in the plan — NO target either, and nothing monthly (recurring, unset)
  //   4. months to go     — a target AND a monthly rate together imply a finish date
  //   5. this month's pace — FUNDED / AHEAD / ON TRACK / BEHIND
  //
  // Step 3 is load-bearing. `status` is undefined for a goal with no row in
  // this month's plan, and this used to fall through to `status ?? 'on_track'`
  // — so a goal with nothing allocated and nothing funded announced "ON
  // TRACK". The one state the chip must never invent is reassurance.
  //
  // `status` falls back to NOTHING PLANNED rather than a real pace word if it
  // is ever missing here — it shouldn't be, since every caller that reports
  // `planned > 0` also has a real plan row to read `status` off, but the type
  // is optional and a silent wrong pace is worse than the honest unplanned copy.
  const ribbonText = achieved
    ? 'GOAL COMPLETE'
    : planned0
      ? (isOneTime ? `${pct}% SAVED` : RIBBON_UNPLANNED)
      : isOneTime && monthsLeft && monthsLeft > 0
        ? `${monthsLeft} MONTH${monthsLeft === 1 ? '' : 'S'} TO GO`
        : status ? RIBBON_COPY[status] : RIBBON_UNPLANNED;

  /** The state's colour. The band wears a TINT of it, not the solid. */
  const ribbonHue = achieved
    ? theme.success
    : planned0
      ? (isOneTime ? color : theme.textMuted)
      : status === 'behind' ? theme.warning : color;

  // A translucent band has no colour of its own to measure against, so the ink
  // is measured on what it will actually COMPOSITE to: the goal wash over the
  // card, then the band's tint over that. Measuring on the raw hue instead
  // would be measuring a colour that never appears on screen.
  const washedCard = mix(color, theme.darkMode ? 0.22 : 0.16, theme.card);
  const ribbonSurface = mix(ribbonHue, RIBBON_TINT, washedCard);
  const ribbonInk = readableOn(ribbonSurface, ribbonHue, 4.5);
  // The arc is the GOAL's own colour — same hue as the wash and the medallion
  // glow, so the whole tile reads as one coloured object rather than the ring
  // introducing a second, unrelated accent. Still run through `readableOn`
  // against the neutral track (3:1, a graphical element): most of the 8 goal
  // colours pass as-is, but a few (teal, sky, amber, pink) sit at ~3.1–3.2:1 on
  // the LIGHT track unboosted and need a touch darkened to hold the floor —
  // dark mode's track already clears it for every one.
  const ringInk = readableOn(theme.divider, color, 3);

  // A goal with NOTHING set up yet — no target, no plan, nothing ever saved —
  // used to print "₹0" three times over (the pill, both footer cells). Every
  // one of those zeros is TRUE, but three of them in a row on a brand-new tile
  // reads as broken rather than as "nothing has happened". The ribbon already
  // says so once ("NOTHING PLANNED"); a lone zero elsewhere is still real
  // information (an ongoing goal that got nothing THIS month), so the dash
  // only stands in for zero when literally nothing has EVER happened —
  // `lifetimeSaved` covers that in one check, since it can only be 0 if this
  // month's funding is too.
  const isIdle = planned0 && lifetimeSaved <= 0 && !isOneTime;

  const headline = isIdle
    ? '—'
    : isOneTime
      ? formatCompact(lifetimeTarget)
      : formatCompact(planned);
  const headlineLabel = isOneTime ? 'TARGET' : 'MONTHLY';

  // TWO stats, not three. The middle cell used to mirror the pill exactly — it
  // showed Target when the pill showed TARGET, and Monthly when the pill showed
  // MONTHLY — so the tile printed the same number twice whichever branch it
  // took. The pill keeps the headline; the footer carries the two figures it
  // never shows, each now with half the row instead of a third.
  //
  // What this drops is the monthly allocation on a goal that HAS a target. That
  // number is not lost: the ribbon states this month's pace against it, and the
  // plan screen's legend shows it to the rupee.
  const stats: { k: string; v: string }[] = [
    { k: 'Saved so far', v: isIdle ? '—' : formatCompact(lifetimeSaved) },
    { k: 'This month', v: isIdle ? '—' : formatCompact(funded) },
  ];

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'summary'}
      accessibilityLabel={`${name}, ${formatCompact(lifetimeSaved)} saved`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: withAlpha(color, 0.25),
          opacity: pressed && onPress ? 0.92 : 1,
        },
        style,
      ]}
    >
      {/* A wash of the goal's own colour, strongest under the ribbon — the tile
          is tinted by the goal rather than decorated with it. */}
      <LinearGradient
        colors={[withAlpha(color, theme.darkMode ? 0.22 : 0.16), withAlpha(color, 0.02)]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Full-bleed across the tile's top, as on the card this was modelled
          on. It was a centred pill at 74% width, which left ~90pt for text and
          truncated "15 MONTHS TO GO" to "15 MONTH…" on a 360pt phone — a status
          chip nobody can finish reading is worse than none. `adjustsFontSizeToFit`
          is the backstop for a narrow device or a long month count. */}
      <View
        style={[
          styles.ribbon,
          {
            backgroundColor: withAlpha(ribbonHue, RIBBON_TINT),
            borderBottomColor: withAlpha(ribbonHue, 0.35),
          },
        ]}
      >
        <Text
          style={[styles.ribbonTxt, { color: ribbonInk }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          allowFontScaling={false}
        >
          {ribbonText}
        </Text>
      </View>

      {/* Edit is the ONLY way into the form from here, so it has to be an
          explicit affordance. Bottom-right rather than top-right: the ribbon
          now owns the full top edge. The outline makes it read as a BUTTON — a
          bare glyph in the corner of a decorated tile looks like decoration. */}
      {onEdit ? (
        <Pressable
          onPress={onEdit}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name}`}
          style={({ pressed }) => [
            styles.pencil,
            { borderColor: theme.inputBorder, backgroundColor: theme.card, opacity: pressed ? 0.55 : 1 },
          ]}
        >
          <EditIcon size={12} color={theme.textSecondary} />
        </Pressable>
      ) : null}

      <View style={styles.ringWrap}>
        {/* Deliberate exception to the same-hue TRACK rule (ui-consistency §5b):
            the tile is already washed in the goal's colour, so a tinted track
            read as one more band of the same wash rather than a track under a
            fill. Neutral track, GOAL colour over it — the fill still matches
            the wash and the medallion glow, so the tile reads as one coloured
            object; only the track breaks from that to stay legible. Measured
            with `readableOn` (3:1, a graphical element): a couple of the eight
            goal colours sit just under that on the light-mode track unboosted
            and get nudged; every one already clears it in dark mode. */}
        <ProgressRing
          progress={pct / 100}
          size={RING}
          strokeWidth={RING_STROKE}
          color={ringInk}
          trackColor={theme.divider}
        />
        <View style={[styles.medallion, { backgroundColor: theme.card }]}>
          {/* A glow BEHIND the glyph that fades out as it reaches the disc's
              edge, so the icon reads as lit from within rather than stamped on
              a flat circle. Radial, which RN styles cannot express at all — a
              `shadow*` here would be a hard drop UNDER the disc instead. */}
          <Svg width={MEDALLION} height={MEDALLION} style={StyleSheet.absoluteFill}>
            <Defs>
              {/* r < 50% so the glow is spent well BEFORE the disc's edge —
                  it should read as light around the glyph, not as a tinted
                  circle. Alphas are deliberately low: at tile size this sits
                  behind a 26pt emoji and only has to lift it off the card. */}
              <RadialGradient id={glowId} cx="50%" cy="50%" r="38%">
                <Stop offset="0" stopColor={color} stopOpacity={theme.darkMode ? 0.4 : 0.3} />
                <Stop offset="0.55" stopColor={color} stopOpacity={theme.darkMode ? 0.16 : 0.11} />
                {/* Fully transparent at the end — any alpha left here draws a
                    visible rim and the fade stops reading as one. */}
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={MEDALLION / 2} cy={MEDALLION / 2} r={MEDALLION / 2} fill={`url(#${glowId})`} />
          </Svg>
          <Text style={styles.medallionGlyph} allowFontScaling={false}>{emoji}</Text>
        </View>
      </View>

      <View style={[styles.pill, { backgroundColor: theme.card, borderColor: withAlpha(color, 0.3) }]}>
        <Text style={[styles.pillLabel, { color: theme.textMuted }]} allowFontScaling={false}>
          {headlineLabel}
        </Text>
        <Text style={[styles.pillValue, { color: theme.textPrimary }]} numberOfLines={1}>
          {headline}
        </Text>
      </View>

      <Text style={[styles.name, { color: theme.textPrimary }]} numberOfLines={1}>
        {name}
      </Text>

      <View style={[styles.stats, { borderTopColor: theme.divider }]}>
        {stats.map((s, i) => (
          <View
            key={s.k}
            style={[
              styles.stat,
              { borderLeftColor: theme.divider, borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth },
            ]}
          >
            <Text style={[styles.statV, { color: theme.textPrimary }]} numberOfLines={1}>{s.v}</Text>
            <Text style={[styles.statK, { color: theme.textMuted }]} numberOfLines={1}>{s.k}</Text>
          </View>
        ))}
      </View>

      {/* One centred action. Whether the goal also fills itself is said in the
          sheet this opens, not crowded in beside the button. */}
      {onAddMoney ? (
        <Pressable
          onPress={onAddMoney}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Update how much you've put into ${name}`}
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor: withAlpha(theme.primary, 0.45), opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="add" size={13} color={theme.primary} />
          <Text style={[styles.addTxt, { color: theme.primary }]}>{ACTION_LABEL}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: CARD_BORDER,
    paddingTop: RIBBON_H + spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md - 2,
    alignItems: 'center',
    overflow: 'hidden',
    ...shadows.card,
  },

  // Edge to edge across the top, INSIDE the card's 1pt border. Relying on
  // `overflow: hidden` alone left the band square against the card's rounded
  // corners on Android (children are clipped to the border box, not the padding
  // box, and the corner is where that difference shows) — so it carries the
  // card's INNER radius itself and is inset by the border width on all three
  // sides it touches. The hairline under it gives the translucent band a
  // defined lower edge instead of a soft fade into the wash.
  ribbon: {
    position: 'absolute',
    top: CARD_BORDER,
    left: CARD_BORDER,
    right: CARD_BORDER,
    height: RIBBON_H,
    borderTopLeftRadius: INNER_RADIUS,
    borderTopRightRadius: INNER_RADIUS,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 0.4 tracking, not 0.6: at 15 characters the wider spacing was costing three
  // characters of room for no legibility gain at this size.
  ribbonTxt: { ...typography.tiny, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.4 },

  // Top-right, tucked just under the ribbon — both offsets derive from RIBBON_H
  // so neither drifts if the band's height changes.
  pencil: {
    position: 'absolute',
    top: RIBBON_H + spacing.xs,
    right: spacing.sm - 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  ringWrap: {
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  // Centred inside the ring rather than laid out after it. `overflow: hidden`
  // keeps the glow's square canvas clipped to the disc.
  medallion: {
    position: 'absolute',
    width: MEDALLION,
    height: MEDALLION,
    borderRadius: MEDALLION / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medallionGlyph: { fontSize: 26 },

  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md - 2,
    paddingVertical: 5,
    marginTop: spacing.md - 2,
    maxWidth: '100%',
  },
  pillLabel: { ...typography.tiny, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5 },
  pillValue: { ...typography.bodyBold, fontWeight: '800', flexShrink: 1 },

  name: { ...typography.bodyBold, marginTop: spacing.sm, textAlign: 'center', width: '100%' },

  stats: {
    flexDirection: 'row',
    width: '100%',
    marginTop: spacing.md - 2,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  // A size up from the three-cell version — half a row each is room the old
  // 8.5pt label was shrunk to avoid needing.
  statV: { ...typography.bodyBold, fontWeight: '800' },
  statK: { ...typography.tiny, fontSize: 9.5, marginTop: 1 },

  addBtn: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    marginTop: spacing.sm,
  },
  addTxt: { ...typography.tiny, fontSize: 10.5, fontWeight: '700' },
});

export default GoalCard;
