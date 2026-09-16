// Shared "expected interruption" flag for AppLockGate.
//
// A native permission prompt (contacts, camera…) or `Linking.openSettings()`
// flips AppState the same way switching to another real app does —
// AppLockGate's `background`/`active` listener can't tell those apart on its
// own, so it was re-locking and re-prompting Face ID every time a reminder's
// contact picker asked for contacts permission.
//
// A caller about to trigger one of these calls `suppressAppLockOnce()` first.
// AppLockGate consumes it on the very next background→active round trip it
// sees (skips the lock AND the re-auth), then clears it itself — the caller
// never needs to release it manually, which is what makes this safe for
// `Linking.openSettings()` too (there's no promise to await; the user comes
// back whenever they come back). A timeout clears it regardless, so a flag
// can never linger and forgive an unrelated real backgrounding if the
// expected interruption never actually shows any UI (e.g. permission was
// already granted and the OS never surfaces a dialog at all).
let suppressed = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function suppressAppLockOnce(timeoutMs = 20000): void {
  suppressed = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { suppressed = false; timer = null; }, timeoutMs);
}

export function isAppLockSuppressed(): boolean {
  return suppressed;
}

/** AppLockGate calls this once it's consumed the suppressed round trip. */
export function consumeAppLockSuppress(): void {
  suppressed = false;
  if (timer) { clearTimeout(timer); timer = null; }
}
