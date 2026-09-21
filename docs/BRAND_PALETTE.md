# Brand palette — purple rebrand (Sep-21-26)

> **What's wired vs what's recorded.** Live today: the accent theme (`violet`
> in `src/constants/themes.js`, now `DEFAULT_THEME_ID`), the app icon, the
> splash screen, and the Lent/Borrowed card colours (`LB_BASE`, now
> **themable** — see §1). Everything else below is the brand brief as given,
> kept here **verbatim** so the exact hexes survive to the surface migration
> (`docs/DARK_MODE.md`) instead of being re-derived from a screenshot. Nothing
> on this page should be read as "already applied" unless the section says so.

## 1. Wired now

### Core brand colours

| Role | Hex |
|---|---|
| Deep Violet | `#321F70` |
| Primary Violet | `#5B3CC4` |
| Bright Violet | `#7B4DFF` |

These are `theme.primaryDark` / `theme.primary` / `theme.primaryLight` on the
new `violet` theme (`THEMES.violet`), and the same three hexes are the app
icon's own gradient (`assets/icon.png`, `assets/adaptive-icon-background.png`).

### Primary brand gradient

`#321F70 → #5B3CC4 → #7B4DFF`, diagonal (deep → primary → bright). Wired as
`THEMES.violet.gradientStops` — every gradient consumer in the app already
reads `gradientStops` (not the start/end pair), so the header, hero cards,
selected states, etc. all pick this up automatically now that `violet` is the
default theme.

### App icon

Uses the user's two `easyappicon.com` exports (`~/Downloads/easyappicon-icons-*`)
as the source art — real pixels, not regenerated — but the Android **adaptive**
icon specifically needed real processing, not a direct drop-in; see the
correction below before touching `assets/adaptive-icon.png` again.

- `assets/icon.png` — the **filled** export (purple-bg/white-mark — "Version 2
  Primary" in the brief), resized to 1024×1024, full-bleed, direct copy. iOS
  icon + legacy/Play Store icon. The raw export has a **2px near-white
  (`#FAFAFA`) border on the top/bottom edges only** (a generator artifact,
  confirmed on the 1536×1536 source before resizing) — cropped 3px off all
  four sides (kept square) before resizing so the shipped asset is clean.
- `assets/favicon.png` — the **outlined** export (white-bg/purple-mark —
  "Version 1 Light" in the brief), resized to 512×512, same crop fix. Suits a
  browser tab's usually-light chrome better than the purple-bg version.
- No monochrome (Android 13+ themed icon) asset — the export kit doesn't
  include one.

**Android adaptive icon — corrected twice after real device reports, keep this
mechanism, don't revert to a direct full-bleed drop-in:**
1. First shipped the filled export directly, full-bleed, as
   `android.adaptiveIcon.foregroundImage` (no separate transparent layer) —
   reasoned this was safe after checking Pillow circle/rounded-square mask
   previews, which showed no clipping. **Wrong**: those previews don't
   reproduce Android's actual adaptive-icon renderer, which assumes the
   foreground has safe-zone padding baked in and zooms into a full-bleed
   opaque image accordingly. On a real emulator this rendered as only the
   spiral's inner loop, badly zoomed in.
2. Fixed by going back to a proper dual-layer adaptive icon: `assets/
   adaptive-icon.png` is now the mark ALONE (extracted from the outlined
   export's alpha, not redrawn) on a transparent background, inset to ~58% of
   the canvas (Android's safe-zone convention) — checked against a circle
   mask, a rounded-square mask, AND a simulated extra 25% OEM-launcher zoom
   before shipping. `assets/adaptive-icon-background.png` is now the user's
   own real gradient export (`android_adaptive_background_432.png` from the
   splash asset kit, resized up to 1024×1024) rather than a self-computed
   gradient — same brand gradient either way, but their actual file, per the
   standing "use provided assets directly" rule. `backgroundColor` `#321F70`
   is a legacy-device fallback only.
3. The first alpha-extraction formula also left the mark semi-transparent
   (max alpha ~226, not 255 — a linear `(255-gray)` remap that never reached
   full opacity for the source's actual purple tone), which read as a washed-
   out, slightly tinted white rather than solid. Fixed with a proper two-point
   threshold remap (full 255 below a "clearly mark" darkness, full 0 above a
   "clearly background" threshold, ramping only the true antialiased edge band
   in between) — alpha now genuinely spans 0–255.

Lesson for any future icon asset swap: verify Android's adaptive icon
specifically against a REAL build/emulator behaviour (or at minimum simulate
the OS's actual zoom assumption), not just a static mask crop — the two are
not the same thing.

### Splash screen

User supplied a complete splash kit (`~/Downloads/epurse_splash_complete_assets`,
README: "Theme 2: Deep Violet + Peach", same primary gradient, "large,
tightly-cropped white epurse spiral, no wordmark/tagline"). See the full
splash-screen memory (`project_splash_screen_sep2026`) before touching any of
this — the splash system has THREE layers that all have to agree
(`app.json`'s `expo-splash-screen` config, `plugins/withEPurseAndroid.js`'s
native `windowBackground` mirror, and iOS's launch-screen storyboard), and
getting them out of sync previously shipped a black flash, a tiny icon, and a
"3 screens at launch" bug in three separate earlier passes.

- `assets/splash.png` — started as their `ios_splash_reference_1290x2796.png`,
  then **recomposed Sep-21-26 to add the wordmark + tagline** (see "Wordmark
  splash" below). Feeds iOS's native launch screen (`expo-splash-screen`'s
  top-level `image`, `resizeMode: "cover"`) AND `SplashOverlay.tsx`, which is
  how it reaches Android — the OS splash there is icon-only by platform
  restriction, so the branded art has to be painted by the app itself.
- `assets/splash-icon.png` (Android OS-splash icon, via `android.image`) ←
  their `epurse_white_logo_foreground_1024.png`, direct copy, real
  transparency kept.
- Both `backgroundColor` (top-level + `android`) → `#5B3CC4` (the gradient's
  own centerColor — the tone directly behind a centred mark on a diagonal
  gradient).
- `android.imageWidth`: **132, not the old 140** — re-derived, not reused,
  because the new mark has no built-in padding (its own alpha bbox is ~100% of
  its canvas) unlike the old asset. Verified by running
  `expo prebuild --clean -p android` and measuring the actual generated
  `drawable-mdpi/splashscreen_logo.png`: 132×132dp mark on the 288×288dp
  canvas, diagonal ≈187dp, just inside this project's ~192dp "no
  icon-background" guidance.
- Deliberately did NOT use the kit's `android_adaptive_background_gradient.xml`
  (a real Android gradient drawable) for the splash background — Android's
  SplashScreen API only accepts a flat colour for the OS-drawn system splash,
  a hard platform limit. Using the gradient only for the post-splash mirror
  while the OS splash stayed flat would reintroduce the earlier "3 screens"
  bug (the two would visibly differ). Both stayed flat and identical.
- `plugins/withEPurseAndroid.js`'s separate `ICON_BG` constant (an
  `iconBackground` colour-resource fallback, unrelated to the splash bug chain
  but caught while in this file) was still the original orange `#FF5A1F` —
  updated to `#321F70` to match the adaptive icon's own fallback.

#### Wordmark splash (iOS only) — how `assets/splash.png` is composed

Repeat this recipe if the tagline, brand gradient or mark ever changes.
Everything is baked into the PNG, so there is **no runtime font dependency** —
the app itself still ships with system fonts only.

- **Typeface: Nunito ExtraBold** (wordmark) + **Nunito Medium** (tagline).
  Chosen because the mark has rounded stroke terminals and Nunito is a rounded
  humanist sans with a weight range that goes heavy enough to anchor a wordmark
  next to that thick spiral. **SIL OFL licensed**, so it is safe to embed and
  ship commercially on any platform — deliberately NOT macOS's `SFNSRounded`
  (Apple licenses SF fonts only for Apple-platform UI work) or `Arial Rounded`
  (Monotype, commercial). Source:
  `github.com/google/fonts/raw/main/ofl/nunito/Nunito[wght].ttf`.
  Quicksand Bold was built as an alternative and looks good too — more
  geometric, echoes the circular mark more literally, but its heaviest weight
  is only Bold so the wordmark reads lighter.
- **Canvas** 1290×2796 (their iOS reference size). **Gradient** rebuilt rather
  than reused, because the mark had to move up to make room for text: it is
  linear with `t = 0.25·(x/w) + 0.75·(y/h)` through the three brand stops —
  fitted against their reference file by least squares, rms **1.24/255**, max
  channel error 3.7 (imperceptible).
- **Layout**: mark 470px wide, then 96px gap, wordmark at 158px, 46px gap,
  tagline at 49px with +3px tracking. The whole group is centred on `0.485·H`
  (a touch above true centre, which reads as optically centred).
- **Bubbles**: three translucent white circles (alpha 13–16/255, radius
  520–640px), corner-anchored so each bleeds off an edge — the same idiom the
  FeatureCarousel settled on (§7 of the ui-consistency skill). At that alpha
  they add depth without reading as shapes.
- **Contrast** (this project measures, it doesn't eyeball): wordmark **7.9:1**,
  tagline **7.6:1** against the gradient behind them — both far above the 4.5
  AA bar.

#### How it reaches Android — `src/components/SplashOverlay.tsx` — **UNPLUGGED Sep-22-2026**

**Not wired into `App.js` any more — read this before touching either file.**
Two real, confirmed-fixed bugs in this component are described below (they're
left in place as a record, and the file itself is untouched, per the user's
explicit "keep the code, just don't use it"). But a THIRD symptom survived
both fixes: on-device video + logcat showed a plain gradient with no mark, no
wordmark, no tagline, appearing between the native splash and onboarding —
and switching `resizeMode` from `cover` to `contain` (which cannot crop
content out, by definition) plus a full uninstall/reinstall (ruling out a
stale Fresco image cache) had ZERO effect on it. That rules out
`SplashOverlay`'s own `<Image>` as the cause — whatever's producing it is most
likely an OS-level window-transition effect, outside this component's
control. Given that, `App.js` no longer calls
`SplashScreen.preventAutoHideAsync()` or renders `<SplashOverlay />` — Android
is back to the plain native-only splash (icon-only, no gradient/bubbles/
wordmark on Android; iOS is unaffected, its native launch screen already
shows the full `splash.png` directly). The rest of this subsection describes
the mechanism and the two bugs that WERE fixed, kept for whoever tries this
again.

Android's OS splash cannot show any of the above (flat colour + centred icon
only, platform mandate). `SplashOverlay.tsx` paints `splash.png` full-screen at
`zIndex: 2000` the instant React mounts — the only way to get the
gradient/bubbles/wordmark onto Android. It replaces an earlier version of the
same component that was removed in Sep-2026 and re-adopted deliberately; see
the splash-screen memory before removing it again.

**It is gated on TWO independent conditions, both required, not one:**
`useStoreHydrated()` AND a `MIN_DISPLAY_MS` (1200ms) timer. A first version
gated on hydration alone shipped a real bug, caught on a real device: on a
fast device the persisted store can finish rehydrating before this component
ever renders once, so `hydrated` was already `true` on the FIRST render —
the branded `<Image>` never got created, `onLoad` never fired, and the app
went straight from the OS icon splash to content with the branded art never
shown at all. The minimum-display timer means hydration speed can never skip
the render, no matter how fast the store loads.

**The release mechanism is a RACE, not a sequence — a second real bug came
from misunderstanding this.** Android's splash module blocks RN's own content
view from drawing at all (an `OnPreDrawListener` returning `false`) until
`hideAsync()` is called; the moment it is, the native splash independently
starts a 400ms fade-out, revealing whatever's behind it RIGHT THEN — it does
not wait for RN to have produced a real frame. `Image.onLoad` only confirms
the bitmap decoded, not that a frame containing it has painted. Calling
`hideAsync()` straight from `onLoad` shipped exactly this, device-verified:
*"android splash, then black, then android splash again, then the bubble
bg"* — black was the fade revealing nothing committed yet; the second
"splash" was the app's own `windowBackground` mirror drawable showing through
an Image view whose bitmap hadn't rasterised into a frame yet.

Fixed by requiring BOTH `onLoad` (bitmap decoded) AND the Image's own
`onLayout` (RN actually laid it out natively), THEN a double
`requestAnimationFrame` — schedules after this commit, then after THAT frame
is actually submitted — before calling `hideAsync()`. **Do not simplify this
back to one callback**; the race is timing-dependent on device speed, so it
passes on a fast test device and reappears elsewhere.

**Device-verified on a real release build (not debug — the original report
was from a debug/dev-client build, whose 11.6s cold start vs. release's ~1.0s
is itself a separate, distinct boot path; see the memory file).** Zero black
frames across 30+ locked-down, device-clock-labelled screenshots. Found a
SECOND, smaller issue this way: even with the fix above, the gradient+bubbles
layer held for ~500-600ms with the mark/wordmark/tagline flatly absent (not a
gradual fade — a static plateau) before cutting to app content — this
specific composite needed more real time than two animation frames to finish
rendering its fine detail on this hardware. Fixed with `EXTRA_PAINT_SETTLE_MS`
(400ms), a plain wall-clock wait chained after the double-rAF confirmation
before calling `hideAsync()` — pragmatic, not root-caused further. Re-measured
after: the flat plateau is gone, replaced by a smooth monotonic fade.

Three more things to preserve if this is ever edited:
- `App.js` holds the OS splash open with `SplashScreen.preventAutoHideAsync()`
  at module scope, so **only** this component's `hideAsync()` releases it —
  and that call is keyed on the double-rAF-confirmed paint above or a
  `HIDE_FAILSAFE_MS` (4000ms) timer, **never on `hydrated`**. Tying the
  release to hydration was the root cause of the FIRST bug above: hydration is
  about data readiness, not about whether this component's own pixels have
  painted, and conflating the two let the native splash get released before
  the overlay had drawn a single frame.
- `App.js`'s root `GestureHandlerRootView` has an explicit
  `backgroundColor: '#5B3CC4'` — a safety net, not the fix: if the race above
  is somehow still lost on some device, the reveal is brand violet instead of
  Android's black default, reading as "still the splash" rather than a glitch.
- `resizeMode` must stay `"cover"` in `app.json`. The overlay draws `cover`, so
  a `contain` launch screen would letterbox with flat `#5B3CC4` bars and then
  visibly jump to full-bleed when React mounts.

Known and accepted: on Android the mark shifts up slightly and grows at the
handoff (132dp centred → ~150dp higher up, making room for the wordmark).
Inherent to a flat icon-only OS splash preceding a branded screen with text.

### Lent / Borrowed (Lent/Borrowed ledger)

Finalised by the user Sep-21-26 to the brand brief's own "You Lent" /
"You Borrowed" card colours — `LB_BASE` in `src/constants/theme.js`:

- `lent`: `#16A673 → #22C55E` (was `#059669`/`#10B981`)
- `borrowed`: `#FF7657 → #FF9B76` (was violet `#6D28D9`/`#8B5CF6` until the
  same day's earlier orange-for-brand-clash fix, itself now superseded)

**Also made THEMABLE**, per the user's request — `buildPalette` now merges
`theme.lb || LB_BASE` into every palette, and `useLbGradients()` reads that
merged value instead of the constant directly. No theme defines its own `lb`
override yet, so every accent still shows this one shared pair — the point was
to put the *mechanism* in place now (a theme CAN differ later) without
splitting the colour today, since only one LB palette is finalised.

**Known gap, accepted, recorded not fixed:** white text on `borrowed[1]`
(`#FF9B76`) is **2.06:1** — under both the previous 2.5 floor and the 3:1
large-text bar the 26px amount relies on. The user's own hex choice; flagged
in `LB_BASE`'s comment and bounded (not hidden) by `npm run test:contrast`.

## 2. Recorded, not wired — needs the surface migration

Per-theme *surfaces* (background/card/border/text, not just the accent) don't
exist as a concept yet: every theme shares `LIGHT_NEUTRALS` /`DARK_NEUTRALS`
from `src/constants/themes.js`, and a theme can only override them via its own
`neutrals` — a mechanism built for Carbon's always-dark canvas and gated behind
`STATIC_CONFIG.theme.canvasThemes` (off; see `docs/DARK_MODE.md` for why).
Giving `violet` its own **light-mode** surface set isn't something that
mechanism supports today (it merges one override object regardless of
light/dark, which is correct for an always-dark theme and wrong for a
sometimes-light one) — that needs `lightNeutrals`/`darkNeutrals` as separate
theme fields, which is out of scope for this pass.

### Light mode

| Token | Hex |
|---|---|
| App background | `#FAF8FD` |
| Surface | `#FFFFFF` |
| Secondary surface | `#F5F2FD` |
| Text primary | `#181525` |
| Text secondary | `#625D70` |
| Text tertiary | `#8B8796` |
| Border | `#E4E0EB` |
| Divider | `#ECE9F1` |

### Dark mode

| Token | Hex |
|---|---|
| Background | `#100D18` |
| Surface | `#181329` |
| Secondary surface | `#211A35` |
| Elevated surface | `#2B2244` |
| Primary text | `#F8F7FC` |
| Secondary text | `#C7C2D2` |
| Border | `#383047` |

### Focus/clarity gradient

`#7B4DFF → #B58CFF → #FFD0BE` — for icon/brand storytelling only (the inner
"e" of the spiral, financial info converging toward clarity), not a general UI
gradient. No current consumer; record only.

### Lavender Highlight

`#B58CFF` — no assigned role yet beyond the focus gradient above.

## 3. Financial semantic colours

These are explicitly **theme-independent** in the brief (purple = brand,
these = meaning) — which is exactly what `STATUS_COLORS` in
`src/constants/themes.js` already is as a concept. Not applied in this pass
(scope was the accent theme + the one Borrowed clash); recorded here so a
future pass has the exact target values rather than re-deriving them.

| Meaning | Hex | Current app value |
|---|---|---|
| Income | `#18A878` | `STATUS_COLORS.success` = `#10B981` |
| Expense | `#E05252` | `STATUS_COLORS.danger` = `#EF4444` |
| Savings | `#159A8A` | — (no dedicated key) |
| Budget / Warning | `#E6A52F` | `STATUS_COLORS.warning` = `#F59E0B` |
| Error | `#D9363E` | — (shares `danger`) |
| Information | `#4285D4` | `STATUS_COLORS.info` = `#3B82F6` |
| Lent | `#159A8A` | `LB_BASE.lent` = `['#16A673', '#22C55E']` (**wired**, §1 — the brief's own "You Lent" card colour, not this table's "Lent" row) |
| Borrowed | `#E0783C` | `LB_BASE.borrowed` = `['#FF7657', '#FF9B76']` (**wired**, §1 — the brief's own "You Borrowed" card colour, not this table's "Borrowed" row) |
| Rewards / EP Coins | `#F2C45C` | reward gold constant in `theme.js` (not this exact hex) |
| Active Run | `#FF7657` | — |
| Review Queue | `#E6A52F` | — (shares `warning`) |

Changing any of `success`/`danger`/`warning`/`info` touches
`src/utils/__tests__/themeContrast.test.mjs` (hardcoded expectations) and every
screen that reads those keys — treat as its own pass, not a drive-by edit.

## 4. Feature → colour system (reference only)

Goals → Violet · Budget → Amber · Insights → Bright Violet · Income → Green ·
Expenses → Red · Savings → Teal · Lent → Green/Teal · Borrowed → Orange ·
Accounts → Violet · Credit Cards → Indigo · Transfers → Blue ·
Rewards/EP Coins → Gold · Active Run → Peach · Review Queue → Amber.

Design principle to keep in mind for any future pass: purple is the epurse
brand/clarity colour, the gradient is a **signature**, not a default — most
screens should stay clean surfaces with controlled violet accents, not
purple-gradient everywhere.

## 5. Card / feature gradients (Sep-21-26 addendum)

Given after the theme + icon pass shipped, for a specific per-card gradient
treatment (Home hero, Lent/Borrowed, Budget, Goals, Rewards, Review Queue).

| Card | Gradient / colour | Meaning | Status |
|---|---|---|---|
| Biggest Slice / Hero | `#F5F0FF → #FFF3ED` | Insight / clarity | not implemented |
| You Lent | `#16A673 → #22C55E` | Money to receive | **wired** — `LB_BASE.lent`, §1 |
| You Borrowed | `#FF7657 → #FF9B76` | Money to return | **wired** — `LB_BASE.borrowed`, §1 |
| Budget | `#E6A52F` + neutral surface | Budget status | not implemented |
| Goals | `#5B3CC4 → #7B4DFF` | Progress / goals | not implemented — but already achievable via `theme.primary → theme.primaryLight` on `violet`, no new colour needed |
| Rewards | `#F2C45C → #C99425` | EP Coins | not implemented |
| Review Queue | `#E6A52F` | Needs attention | not implemented |

**Resolved Sep-21-26 (was flagged as a conflict, now settled):** the user
finalised "You Lent"/"You Borrowed" as the app's canonical `LB_BASE`,
superseding the orange picked earlier the same day to dodge the violet-brand
clash. Worth knowing for later: `borrowed[0]` (`#FF7657`) is the exact same
hex as this table's own "Active Run" colour (§3/§4) — not a problem today
(Active Run isn't implemented, and the two features don't appear together),
but don't assume they're independently free to change without checking each
other once Active Run exists.

**Still open when Budget/Goals/Rewards/Review Queue get implemented:** follow
the same pattern used for Lent/Borrowed — add the colour as a themable default
(`theme.<key> || <DEFAULT>` in `buildPalette`) rather than a hardcoded
constant, even though every theme will show the same value until one actually
needs to differ. That was an explicit ask, not just how LB happened to be
built — treat it as the standing approach for new semantic/feature colours.
