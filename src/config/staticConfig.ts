// =============================================================================
// staticConfig.ts — the app's STATIC configuration, grouped by screen / module.
//
// Static means fixed at build time: it does not come from the store, the user, or
// the environment, and nothing at runtime writes to it. One place to turn app
// behaviour on and off, so a look that is under evaluation doesn't live as a lone
// `const USE_X = false` buried 130 lines into a screen where nobody finds it.
//
// Shape is deliberate:
//
//     STATIC_CONFIG.<screen | module | feature>.<switch>
//
// Read it directly at the point of use (`STATIC_CONFIG.header.lightenOnCollapse`) —
// do NOT copy a value into a local constant or thread it through props. The value
// of a single switch is that there is exactly one place to change and exactly one
// place to grep.
//
// ── What belongs here ──
// A choice WE make at build time: which of two looks ships, whether a behaviour
// is on. Flipping one should be a one-line edit with no migration.
//
// ── What does NOT ──
//   • Anything a USER should choose → a store key + a Settings row. A build flag
//     costs nothing; a user setting costs a store key, a backup field, a
//     migration and a Settings row, so it has to earn them.
//   • Anything derived from the ENVIRONMENT (dev vs preview vs store build) →
//     `constants/buildVariant.js` (`IS_PREVIEW_BUILD`). That is not a choice.
//   • Tuning numbers that several files must agree on (spacing, carousel
//     geometry, retention windows) → `constants/`. Those are shared values, not
//     switches; a switch has a small number of discrete states. `constants/` is
//     static too — the difference is that this file is where you come to CHANGE
//     the app's behaviour, not to look up a value it is built from.
// =============================================================================

export const STATIC_CONFIG = {
  /**
   * `CollapsingHeaderScreen` — shared by every screen with a collapsing themed
   * header (Home, Accounts).
   */
  header: {
    /**
     * As the header collapses, cross-fade the gradient bar into a light one
     * (`theme.card` + hairline + elevation — the tab bar's surface language), so
     * what stays pinned over the content is chrome rather than a saturated band.
     *
     * `false` → the gradient look only: the header still collapses to a pinned
     * strip, but it stays the gradient the whole way and the status-bar glyphs
     * stay light. Screens keep passing `renderCollapsedBar`; it simply isn't
     * rendered, so this is a one-line flip with nothing else to undo.
     */
    lightenOnCollapse: false,

    /**
     * When the finger lifts with the header PART-collapsed, animate it the rest
     * of the way — open if it is less than `SNAP_AT` of the way down, pinned
     * otherwise. Direction doesn't matter: one threshold, so a slow scroll up and
     * a slow scroll down resolve to the same place from the same offset.
     *
     * A half-collapsed header is the worst state it has: the hero is mid-fade, so
     * some of its text is legible and some isn't, and it reads as clutter rather
     * than as a transition. Nothing renders a half state deliberately, so there
     * is no reason to let one be RESTED in.
     *
     * `false` → the header sits wherever the scroll leaves it (the pre-Aug-31
     * behaviour).
     */
    snapOnRelease: true,
  },

  /** `DashboardScreen` (Home). */
  dashboard: {
    /**
     * Restore the pre-Aug-26 header wholesale: greeting leads the row, avatar at
     * the END of the right-hand cluster, and the vault back in its rounded-rect
     * chip with its own internal "Xd Aware" label.
     *
     * `false` (current) is the reworked version — avatar on the LEFT, on the same
     * alignment spine as the greeting and the whole hero below it; right cluster
     * is vault + bell, both 42pt circles with the streak day as a corner badge.
     *
     * NOT reverted by this flag, deliberately — these were correctness fixes, not
     * style: the avatar's accessibility label (a screen reader used to announce
     * the header's main nav target as the letter "P"), the 44pt tap targets, and
     * `badgeOnGradient` replacing a hardcoded violet badge that measured 1.02:1
     * on Platinum. Reverting a LOOK should not reintroduce a defect.
     */
    useOriginalHeader: false,

    /**
     * How the D/W/M/Y period selector is drawn.
     *   'segmented'  — one 32pt translucent track, active cell filled white.
     *                  Shares its language with the Income/Refunds block.
     *   'original'   — four separate 38pt circles, active filled solid white.
     *   'underline'  — plain text, 2pt underline under the active one.
     * The handler and the whole a11y contract are written once regardless; only
     * the chrome and the tap geometry change.
     */
    periodSelector: 'segmented' as 'segmented' | 'original' | 'underline',
  },
} as const;

export default STATIC_CONFIG;
