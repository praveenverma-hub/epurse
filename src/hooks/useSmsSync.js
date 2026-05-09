// =============================================================================
// useSmsSync — wires the Android SMS pipeline into the ePurse store
// -----------------------------------------------------------------------------
// Key design decisions (dedup strategy):
//
//   lastSmsDate cursor
//     The store persists `lastSmsDate` = the max SMS `date` field (epoch ms)
//     we have ever successfully ingested. On every sweep we filter the inbox
//     to `date > lastSmsDate`, so we never re-read an already-processed
//     message — even if the app restarts or the live listener already ingested
//     it during a previous session.
//
//   smsId on every transaction
//     Each inbox message carries Android's content-provider `_id` (a unique
//     monotonically-increasing integer). We store it as `smsId` on the
//     transaction object. isDuplicate() checks this first — if two code paths
//     try to ingest the same `_id`, the second attempt is rejected instantly
//     regardless of timing.
//
//   sync lock
//     A ref flag (`syncingRef`) prevents concurrent `start()` invocations.
//     Without this, useEffect's initial call and an AppState 'active' event
//     that fires simultaneously would both sweep the same date range.
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function useSmsSync() {
  const permissionGranted = useEPurseStore((s) => s.smsPermissionGranted);
  const enabled           = useEPurseStore((s) => s.smsAutoImport);
  const lastSmsDate       = useEPurseStore((s) => s.lastSmsDate);    // SMS date cursor
  const ingestMessage     = useEPurseStore((s) => s.ingestMessage);
  const setLastSmsSync      = useEPurseStore((s) => s.setLastSmsSync);
  const setLastSmsDate      = useEPurseStore((s) => s.setLastSmsDate);
  const compactTransactions = useEPurseStore((s) => s.compactTransactions);

  const unsubRef  = useRef(null);   // live-listener unsubscribe fn
  const syncingRef = useRef(false); // mutex: true while a sweep is in-flight

  // ── Stop the live listener ────────────────────────────────────────────────
  const stop = useCallback(() => {
    if (typeof unsubRef.current === 'function') {
      unsubRef.current();
      unsubRef.current = null;
    }
  }, []);

  // ── Full start: sweep inbox + attach live listener ────────────────────────
  const start = useCallback(async () => {
    if (Platform.OS !== 'android' || !smsSupported) return;
    if (!permissionGranted && !enabled) return;

    // ── Sync lock: bail if a sweep is already running ─────────────────────
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      // Double-check OS permission — user may have revoked it in settings
      const ok = await hasSmsPermission();
      if (!ok) return;

      // ── Inbox sweep ──────────────────────────────────────────────────────
      //
      // `since` uses the highest SMS date we've seen (not +1 ms). This keeps
      // same-timestamp messages eligible on the next sweep — some banks emit
      // multiple SMS rows with identical `date` values.
      //
      // On first run (lastSmsDate === null) we fall back to 30 days ago.
      // If we have a cursor, resume from that timestamp (inclusive).
      // On first run (no cursor yet) go back 3 full months — the same window
      // that raw retention keeps — so the background sync covers the same
      // history as the onboarding sweep.
      const now2 = new Date();
      const since = lastSmsDate
        ? lastSmsDate
        : new Date(now2.getFullYear(), now2.getMonth() - 3, 1).getTime();

      const inbox = await readInbox(since); // has 15 s hard timeout

      if (inbox.length > 0) {
        // Sort oldest → newest so account balances accumulate correctly
        const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));

        let maxDate = lastSmsDate || 0;

        sorted.forEach((m) => {
          ingestMessage(m.body, {
            sender:     m.address,
            receivedAt: new Date(m.date).toISOString(),
            smsId:      String(m._id), // Android content-provider unique ID
          });
          // Advance the date cursor past this message regardless of whether
          // it was new or a duplicate — we never want to re-fetch it.
          if ((m.date || 0) > maxDate) maxDate = m.date;
        });

        // Persist the cursor so the next sweep starts from here
        setLastSmsDate(maxDate);

        // Move any newly-ingested messages that are older than 90 days
        // straight into monthly aggregates — keeps raw[] lean immediately
        // instead of waiting for the next CompactionBoot foreground trigger.
        compactTransactions();
      }

      setLastSmsSync(Date.now());

      // ── Live listener ─────────────────────────────────────────────────────
      // Re-attach every time to avoid stale closures after a sweep.
      stop();
      unsubRef.current = subscribeToIncomingSms((sms) => {
        ingestMessage(sms.body, {
          sender:     sms.originatingAddress,
          receivedAt: new Date(sms.timestamp).toISOString(),
          // Live messages don't carry an _id — content-based dedup applies.
          // Advance the date cursor so the next sweep skips this message too.
        });
        // Push the cursor past this live SMS date so inbox sweep skips it
        setLastSmsDate(sms.timestamp || Date.now());
        setLastSmsSync(Date.now());
      });

    } catch (e) {
      console.warn('[useSmsSync] start() error', e?.message);
    } finally {
      // Always release the lock so future sweeps can run
      syncingRef.current = false;
    }
  }, [permissionGranted, enabled, lastSmsDate, ingestMessage, setLastSmsSync, setLastSmsDate, compactTransactions, stop]);

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
