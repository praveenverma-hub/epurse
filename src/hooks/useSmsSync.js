// =============================================================================
// useSmsSync — wires the Android SMS pipeline into the ePurse store
// -----------------------------------------------------------------------------
// Key design decisions (dedup strategy):
//
//   lastSmsDate cursor
//     The store persists `lastSmsDate` (see `ePurseStore` partialize) = the max
//     SMS `date` field (epoch ms) we have successfully swept. Each inbox query
//     uses `date >= since` with `since = lastSmsDate`, so rows sharing that
//     timestamp can appear again; dedup + `suppressedSmsIds` prevent replays.
//
//   smsId on every transaction
//     Each inbox message carries Android's content-provider `_id` (a unique
//     monotonically-increasing integer). We store it as `smsId` on the
//     transaction object. isDuplicate() checks this first — if two code paths
//     try to ingest the same `_id`, the second attempt is rejected instantly
//     regardless of timing.
//
//   sync lock
//     A MODULE-level flag (`sweeping`) prevents concurrent sweeps. Without this,
//     useEffect's initial call and an AppState 'active' event that fires
//     simultaneously would both sweep the same date range. It lives on the module
//     rather than in a ref so it also covers callers outside this hook — see below.
//
//   two entry points, one sweep
//     `syncNow()` is a plain exported function (not a hook) because the sweep is
//     needed from two unrelated places: this hook's mount/foreground lifecycle,
//     and the Dashboard's pull-to-refresh, which has no access to the hook
//     instance mounted in App.js. Both call the SAME function, so the dedup
//     rules, cursor advance and compaction can't drift apart. Only the live
//     listener stays inside the hook — it owns an unsubscribe lifecycle.
// =============================================================================

import { useEffect, useRef, useCallback } from 'react';
import { Platform, AppState } from 'react-native';

import { useEPurseStore } from '../store/ePurseStore';
import {
  smsSupported,
  hasSmsPermission,
  readInbox,
  subscribeToIncomingSms,
} from '../services/smsService';
import { getLocationIfGranted } from '../services/locationService';

// Mutex shared by EVERY caller of syncNow() — the hook's mount/foreground path
// and the Dashboard's pull-to-refresh. A per-hook ref wouldn't cover both.
let sweeping = false;

/**
 * Sweep the SMS inbox once, from the persisted date cursor forward.
 *
 * Reads the store through `getState()` rather than taking hook-bound actions so
 * non-React callers (pull-to-refresh) can reuse it without rebuilding the same
 * bundle of store actions — one sweep implementation, no drift.
 *
 * Never throws. Resolves to `{ status, scanned, added }`:
 *   status  'ok' | 'unsupported' | 'no-permission' | 'busy' | 'error'
 *   scanned messages read from the inbox this pass (includes duplicates)
 *   added   NEW rows in the active ledger — what the user actually gained.
 *           Counted from the transaction-list length, not from ingestMessage's
 *           return value: one SMS can book several transactions, and it returns
 *           only the first.
 */
/**
 * Resolves once the FIRST inbox sweep of this app session has settled — however it
 * settled, including "this device will never sweep" (iOS, no permission).
 *
 * Anything that reasons about the ABSENCE of transactions has to wait for this.
 * Yesterday's bank SMS only enter the store when the sweep imports them, so a
 * question like "did I spend anything yesterday?" asked before the sweep gets the
 * answer "no" for every user who didn't open the app yesterday — which is exactly
 * the population that question is asked about. That misfired the Aware Run's
 * Zero-Transaction bonus (see DashboardScreen's check-in).
 *
 * Resolves rather than rejects on error: a device whose inbox we cannot read is
 * still finished trying, and blocking a daily check-in for ever is worse than
 * acting on what we have. `syncNow` never throws, so this always settles.
 */
let firstSweepSettled = false;
const sweepWaiters = [];
const settleFirstSweep = () => {
  if (firstSweepSettled) return;
  firstSweepSettled = true;
  while (sweepWaiters.length) sweepWaiters.shift()();
};
export const whenFirstSweepSettled = () =>
  (firstSweepSettled ? Promise.resolve() : new Promise((resolve) => { sweepWaiters.push(resolve); }));

/** Test seam: forget that a sweep ever ran. */
export const __resetSweepSignalForTests = () => { firstSweepSettled = false; sweepWaiters.length = 0; };

export async function syncNow() {
  if (Platform.OS !== 'android' || !smsSupported) {
    settleFirstSweep();
    return { status: 'unsupported', scanned: 0, added: 0 };
  }

  const st = useEPurseStore.getState();
  if (!st.smsPermissionGranted && !st.smsAutoImport) {
    settleFirstSweep();
    return { status: 'no-permission', scanned: 0, added: 0 };
  }

  // ── Sync lock: bail if a sweep is already running ───────────────────────
  if (sweeping) return { status: 'busy', scanned: 0, added: 0 };
  sweeping = true;

  try {
    // Double-check OS permission — user may have revoked it in settings
    const ok = await hasSmsPermission();
    if (!ok) { settleFirstSweep(); return { status: 'no-permission', scanned: 0, added: 0 }; }

    // ── Inbox sweep ────────────────────────────────────────────────────────
    //
    // `since` uses the highest SMS date we've seen (not +1 ms). This keeps
    // same-timestamp messages eligible on the next sweep — some banks emit
    // multiple SMS rows with identical `date` values.
    //
    // If we have a cursor, resume from that timestamp (inclusive).
    // On first run (no cursor yet) go back 3 full months — the same window
    // that raw retention keeps — so the background sync covers the same
    // history as the onboarding sweep.
    const lastSmsDate = st.lastSmsDate;
    const now2 = new Date();
    const since = lastSmsDate
      ? lastSmsDate
      : new Date(now2.getFullYear(), now2.getMonth() - 3, 1).getTime();

    const inbox = await readInbox(since); // has 15 s hard timeout

    // Count the ledger before ingesting so we can report what actually landed.
    const before = useEPurseStore.getState().transactions.length;
    let added = 0;

    if (inbox.length > 0) {
      // Sort oldest → newest so account balances accumulate correctly
      const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));

      let maxDate = lastSmsDate || 0;

      sorted.forEach((m) => {
        useEPurseStore.getState().ingestMessage(m.body, {
          sender:     m.address,
          receivedAt: new Date(m.date).toISOString(),
          smsId:      String(m._id), // Android content-provider unique ID
        });
        // Advance the date cursor past this message regardless of whether
        // it was new or a duplicate — we never want to re-fetch it.
        if ((m.date || 0) > maxDate) maxDate = m.date;
      });

      // Persist the cursor so the next sweep starts from here
      useEPurseStore.getState().setLastSmsDate(maxDate);

      // Counted BEFORE compaction, deliberately. Compaction drops rows past the
      // 90-day window, so measuring after it would net the two together and
      // under-report: a sweep that booked 5 new transactions while compacting 3
      // old ones would announce "2 new transactions".
      added = Math.max(0, useEPurseStore.getState().transactions.length - before);

      // Move any newly-ingested messages that are older than 90 days
      // straight into monthly aggregates — keeps raw[] lean immediately
      // instead of waiting for the next CompactionBoot foreground trigger.
      useEPurseStore.getState().compactTransactions();
    }

    useEPurseStore.getState().setLastSmsSync(Date.now());
    return { status: 'ok', scanned: inbox.length, added };
  } catch (e) {
    console.warn('[useSmsSync] syncNow() error', e?.message);
    return { status: 'error', scanned: 0, added: 0 };
  } finally {
    // Always release the lock so future sweeps can run. Settling here rather than
    // on the success path covers the error case too — a sweep that failed has
    // still finished. 'busy' is the one status that must NOT settle: the sweep
    // already in flight is the first one, and it will settle on its own.
    sweeping = false;
    settleFirstSweep();
  }
}

export function useSmsSync() {
  const permissionGranted = useEPurseStore((s) => s.smsPermissionGranted);
  const enabled           = useEPurseStore((s) => s.smsAutoImport);
  const ingestMessage     = useEPurseStore((s) => s.ingestMessage);
  const setLastSmsSync      = useEPurseStore((s) => s.setLastSmsSync);
  const setLastSmsDate      = useEPurseStore((s) => s.setLastSmsDate);

  const unsubRef  = useRef(null);   // live-listener unsubscribe fn

  // ── Stop the live listener ────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (typeof unsubRef.current === 'function') {
      unsubRef.current();
      unsubRef.current = null;
    }
  }, []);

  // ── Full start: sweep inbox + attach live listener ────────────────────────
  const start = useCallback(async () => {
    const { status } = await syncNow();
    // 'busy' means another sweep is mid-flight and will attach the listener
    // itself; the other two mean we have nothing to listen with. Matches the
    // previous behaviour, where each of these returned before the attach.
    if (status === 'busy' || status === 'unsupported' || status === 'no-permission') return;

    // NOTE a deliberate change: 'error' still falls through to the attach. The
    // old code wrapped sweep + attach in one try, so a thrown readInbox (its 15s
    // timeout, most likely) also silently skipped the listener — the backfill
    // failed AND live capture never started, on a device whose permission we had
    // just confirmed. A failed backfill shouldn't cost the user live capture.

    try {
      // ── Live listener ─────────────────────────────────────────────────────
      // Re-attach every time to avoid stale closures after a sweep.
      stop();
      unsubRef.current = subscribeToIncomingSms(async (sms) => {
        // LIVE message → the device's current point ≈ where the purchase happened.
        // Only if location permission is already granted (never prompts in the
        // background). The backfill sweep above intentionally skips this.
        const location = await getLocationIfGranted();
        ingestMessage(sms.body, {
          sender:     sms.originatingAddress,
          receivedAt: new Date(sms.timestamp).toISOString(),
          ...(location ? { location } : {}),
          // Live messages don't carry an _id — content-based dedup applies.
          // Advance the date cursor so the next sweep skips this message too.
        });
        // Push the cursor past this live SMS date so inbox sweep skips it
        setLastSmsDate(sms.timestamp || Date.now());
        setLastSmsSync(Date.now());
      });

    } catch (e) {
      console.warn('[useSmsSync] listener attach failed', e?.message);
    }
    // No `finally` unlocking here any more — syncNow() owns the mutex and has
    // already released it by the time we reach the attach.
  }, [ingestMessage, setLastSmsSync, setLastSmsDate, stop]);

  // ── Mount / permission change ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const safeStart = () => {
      if (!cancelled) start();
    };

    safeStart();

    // Re-sweep when app returns to foreground (OS may have paused the listener)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (permissionGranted || enabled) && Platform.OS === 'android') {
        safeStart();
      }
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [permissionGranted, enabled]); // intentionally exclude start/stop — they're stable callbacks
}
