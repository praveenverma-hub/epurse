// =============================================================================
// SplashOverlay — the branded (gradient + bubbles + wordmark) splash on ANDROID.
//
// Android 12+'s SplashScreen API is icon-only by platform mandate: no app can
// make the OS-drawn cold-start splash show a gradient, shapes, or text — see
// docs/BRAND_PALETTE.md and the splash-screen memory. The only way to show the
// full `assets/splash.png` art (which iOS already gets natively via its launch
// screen storyboard) on Android is to paint it ourselves the instant JS can,
// timed so the OS icon splash and this overlay's first frame are back-to-back
// with no gap — the standard pattern most branded apps use, not a workaround.
//
// `App.js` calls `SplashScreen.preventAutoHideAsync()` at module scope, before
// anything else runs, so the OS splash stays up until THIS component's own
// Image has actually painted a frame — never hidden on a bare mount, which
// would leave a blank gap between the native icon and this view.
//
// THE MECHANISM IS NOT "an overlay sits on top" — read this before touching
// the release timing again. expo-splash-screen's Android module
// (`SplashScreenManager.kt`) installs an `OnPreDrawListener` on the Activity's
// content view that returns `false` — i.e. BLOCKS RN's own content view from
// drawing ANY frame at all — for as long as `keepSplashScreenOnScreen` is
// true. `hideAsync()` flips that flag, which does two things at once: (1) RN's
// content view is now ALLOWED to draw, and (2) the native SplashScreenView
// independently starts a 400ms fade-out, revealing whatever is behind it RIGHT
// THEN. Those two are a RACE, not a sequence — `hideAsync()` does not wait for
// RN to actually have a frame ready.
//
// `Image.onLoad` only confirms the bitmap DECODED, not that a frame containing
// it has been LAID OUT and PAINTED — calling `hideAsync()` straight from
// `onLoad` (the first, buggy version of this fix) loses that race often enough
// to matter: reported live as "android splash, then BLACK, then android splash
// again, then the bubble bg" — black is the fade revealing an RN content view
// with no committed frame yet; the second "splash" is the app's own
// `windowBackground` mirror (see `withEPurseAndroid.js`) showing through an
// Image view whose bitmap hasn't rasterised into a frame yet.
//
// Fixed by requiring BOTH `onLoad` (bitmap ready) AND the Image's own
// `onLayout` (RN has actually laid this view out natively) before releasing,
// THEN a double `requestAnimationFrame` — the standard "wait for a real
// committed+submitted frame" pattern — before calling `hideAsync()`. Do not
// shortcut this back to a single callback; the race is real and only shows up
// intermittently in casual testing (it's timing-dependent on device speed).
//
// EVEN THAT WASN'T ENOUGH on a real release-build measurement: a locked-down
// device-clock capture (adb screencap + `adb shell date`, not host time —
// host/device clocks drift enough to mislead) showed the gradient+bubbles
// layer holding on screen for ~500-600ms with the mark/wordmark/tagline
// completely absent — flat, UNCHANGING colour the whole span, then an abrupt
// cut straight to app content. Flat-then-abrupt rules out the native splash's
// own 400ms alpha fade (that would show a smooth gradual blend, not a static
// frame); it looks like this specific composite (gradient + 3 translucent
// circles + antialiased mark + two lines of text) genuinely takes longer to
// finish compositing on-device than two animation frames covers, on this
// class of hardware. `EXTRA_PAINT_SETTLE_MS` below is the pragmatic fix —
// exact root cause (Fresco tiered decode vs. something else) not pinned down
// further; the fix is to wait longer, not to explain precisely why.
//
// Stays mounted until `useStoreHydrated()` AND a minimum display floor —
// **both**, not either. `useStoreHydrated`'s own doc notes rehydration "can
// finish BEFORE a component mounts" (a small payload, a fast device): on a
// real device this measured as hydrated=true on this component's VERY FIRST
// render, which with only a hydration check meant an immediate `return null`
// — the Image never rendered a single frame, so the branded art was skipped
// entirely and the user saw the plain OS icon splash and nothing else. Two
// independent conditions now, so neither alone can cut the display short:
//   MIN_DISPLAY_MS — the art needs to actually be ON SCREEN long enough to
//                     read, regardless of how fast the store loads.
//   hydrated       — never dismiss into an empty-store first paint, the exact
//                     gap useStoreHydrated exists to close elsewhere.
//
// Renders on iOS too: harmless and seamless there, since iOS's native launch
// screen shows this exact same file already — same pixels, no visible jump.
//
// Sep-22-2026: THIRD real bug, same family as the two above — MIN_DISPLAY_MS
// counted from MOUNT, not from `painted`. Reported live as "1st the splash
// without branding, then the bubble bg without any icon or text, then
// onboarding" — reproduced via `adb shell screenrecord` + logcat on the exact
// build: Android's own `Displayed +3sNNNms` telemetry showed 3+ seconds just
// for RN's first frame to be ALLOWED to draw (native module loading — Skia,
// Reanimated, worklets, Sentry, screens, image-pipeline — is not free on a
// cold JIT). The OnPreDrawListener blocks EVERY draw for that whole window,
// so nothing but the native icon splash is visible regardless — confirmed on
// video, zero frames of assets/splash.png ever appeared. Extracted the
// exact bundled image straight out of the release APK to rule out a bad
// asset first: it was the correct, complete gradient+bubbles+mark+wordmark+
// tagline composite — the bug was never the artwork. With the OLD
// mount-keyed timer, on a device this slow MIN_DISPLAY_MS's 1200ms could
// fully elapse before the Image even finished `onLoad`+`onLayout`, so
// `hydrated && minTimeElapsed` unmounted this component having painted
// NOTHING — the very first frame RN ever drew was onboarding. Fixed by
// keying the MIN_DISPLAY_MS timer to `painted` instead of mount (below), so
// the floor now means "visible for ≥1200ms AFTER it's actually on screen",
// never "1200ms after an arbitrary mount time that may predate any paint".
//
// That fix surfaced a FOURTH, separate bug underneath it: once the overlay
// was actually guaranteed to paint, what it painted (on the same device,
// via `adb shell screenrecord`) was a heavily zoomed-in crop of just the
// gradient — a smooth, borderless curve, no mark, no wordmark, no tagline —
// held static for several frames, i.e. THIS is the exact "bubble bg without
// any icon or text" the user reported, not a decode-timing artifact at all.
// `resizeMode="cover"` was the culprit — or at least, changing it fixed the
// symptom; the cover math itself checks out on paper (design canvas
// 1290x2796 vs. a 1080x2400 device crops a harmless ~13px sliver per side,
// nowhere near enough to lose the centred mark+text), so whatever actually
// produced that extreme a crop at runtime was not chased down further.
// Switched to `resizeMode="contain"` instead: it CANNOT crop the subject out
// under any scaling discrepancy, full stop, at the cost of a thin letterbox
// sliver on an aspect ratio that isn't a pixel-perfect match — invisible in
// practice since the fill's own backgroundColor matches the art's edge tone.
// =============================================================================
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

import { useStoreHydrated } from '../hooks/useStoreHydrated';

/** Long enough to read "ePurse" + the tagline; short enough not to feel slow
 *  on a repeat launch where the store hydrates instantly. */
const MIN_DISPLAY_MS = 1200;
/** Failsafe only — releases the OS splash even if the Image never fires
 *  onLoad/onError for some unforeseen reason, so a stuck native splash can
 *  never outlive the app itself. Decoupled from `hydrated` on purpose: that
 *  can go true almost immediately (see above), which is far too early to
 *  trust as "our art is definitely painted by now". */
const HIDE_FAILSAFE_MS = 4000;
/** Extra real wall-clock time given to the device AFTER the double-rAF
 *  confirms a frame was submitted, before trusting it's the FULL-detail
 *  frame (mark + wordmark + tagline), not just the broad gradient/bubbles.
 *  Measured on-device at ~500-600ms worst case (see the doc above) — the
 *  ORIGINAL value here was 400, which does NOT clear that (400 < 500-600,
 *  despite what the comment claimed — an arithmetic mistake, not a
 *  measurement). Raised to 700 for actual margin. It compounds with, not
 *  replaces, the two-rAF wait: that wait proves a frame exists; this one
 *  covers the extra time THIS SPECIFIC composite's fine detail took to
 *  finish rendering on top of it, on real hardware, beyond what two frames
 *  covers. */
const EXTRA_PAINT_SETTLE_MS = 700;

const SplashOverlay: React.FC = () => {
  const hydrated = useStoreHydrated();
  const [loaded, setLoaded] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const [framesConfirmed, setFramesConfirmed] = useState(false);
  const [painted, setPainted] = useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);

  // Gated on `painted`, NOT mount: a cold start on a real device measured
  // 3+ SECONDS just for RN's first frame to be allowed to draw at all
  // (Android's own `Displayed +3sNNNms` telemetry) — the native
  // OnPreDrawListener blocks every draw until `hideAsync()` fires, so
  // nothing is visible regardless. If this timer ran from mount, on a slow
  // enough device MIN_DISPLAY_MS could fully elapse BEFORE the image even
  // finishes loading — `hydrated && minTimeElapsed` would then unmount this
  // component having shown NOTHING, and the very first frame RN ever draws
  // is onboarding, not the branded art. Reproduced exactly this way: video +
  // logcat showed native icon splash for ~4s then a hard cut straight to
  // onboarding, zero frames of assets/splash.png ever on screen. Starting
  // the clock at `painted` instead guarantees the art is actually ON SCREEN
  // for at least MIN_DISPLAY_MS before anything can unmount it.
  useEffect(() => {
    if (!painted) return undefined;
    const t = setTimeout(() => setMinTimeElapsed(true), MIN_DISPLAY_MS);
    return () => clearTimeout(t);
  }, [painted]);

  // Both signals, not one: `loaded` is the bitmap decoded, `laidOut` is RN
  // having actually run a native layout pass on this view. Neither alone
  // proves a real frame is about to be submitted — see the doc above for the
  // bug this replaced. Once both are true, wait for two animation frames
  // (schedules after THIS commit, then after THAT one is actually submitted
  // to the surface) — the standard "a real frame is now on screen" signal.
  useEffect(() => {
    if (!loaded || !laidOut) return undefined;
    let cancelled = false;
    let secondFrameId = 0;
    const firstFrameId = requestAnimationFrame(() => {
      secondFrameId = requestAnimationFrame(() => {
        if (!cancelled) setFramesConfirmed(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrameId);
      cancelAnimationFrame(secondFrameId);
    };
  }, [loaded, laidOut]);

  // A real frame existing (framesConfirmed) is NOT the same as it being the
  // FULL-detail frame — see EXTRA_PAINT_SETTLE_MS above. Only after this
  // second wait do we trust the composite is actually complete on screen.
  useEffect(() => {
    if (!framesConfirmed) return undefined;
    const t = setTimeout(() => setPainted(true), EXTRA_PAINT_SETTLE_MS);
    return () => clearTimeout(t);
  }, [framesConfirmed]);

  // Release the OS splash the instant OUR art is confirmed painted — an
  // invisible handoff, independent of the minimum-display timer or hydration
  // below (those only control when THIS overlay stops RENDERING, not when the
  // native one underneath lets go). The failsafe timer is cleared once
  // `painted` fires, so the normal path never double-calls it.
  useEffect(() => {
    if (painted) {
      SplashScreen.hideAsync().catch(() => {});
      return undefined;
    }
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), HIDE_FAILSAFE_MS);
    return () => clearTimeout(t);
  }, [painted]);

  if (hydrated && minTimeElapsed) return null;

  return (
    <Image
      source={require('../../assets/splash.png')}
      resizeMode="contain"
      style={styles.fill}
      onLoad={() => setLoaded(true)}
      // A bundled asset realistically cannot fail, but treat it as loaded
      // anyway: a stuck native splash is far worse than a missing image.
      onError={() => setLoaded(true)}
      onLayout={() => setLaidOut(true)}
    />
  );
};

export default SplashOverlay;

const styles = StyleSheet.create({
  // `absoluteFill`, NOT `absoluteFillObject` — the latter was removed in RN 0.86
  // and silently evaluates to undefined, which drops `position: absolute`
  // without any error. `test:parse` lints for it.
  //
  // `backgroundColor` matters here: `resizeMode="contain"` can letterbox a
  // thin sliver at top/bottom or left/right (design canvas is 1290x2796,
  // ~0.4614 aspect; most phones are close but not identical — e.g. 1080x2400
  // is ~0.45). Same brand violet as App.js's ROOT_BG so that sliver reads as
  // "still the splash", not a visible seam.
  fill: { ...StyleSheet.absoluteFill, zIndex: 2000, backgroundColor: '#5B3CC4' },
});
