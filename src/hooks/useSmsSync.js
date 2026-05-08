// =============================================================================
// useSmsSync — wires the Android SMS pipeline into the ePurse store
// -----------------------------------------------------------------------------
// When `smsPermissionGranted` is true:
//   1. Pulls every inbox message newer than the last sync (or 30 days back
//      on first run) and pushes each through `ingestMessage()`.
//   2. Subscribes to the live broadcast for new SMS as they arrive.
//   3. Re-syncs whenever the app returns to foreground (in case the OS paused
//      the listener while the app was backgrounded).
//
// The hook is a no-op on iOS / Expo Go / web — iOS does not allow third-party
// apps to read SMS. Mount it once at app root (App.js).
// =============================================================================

import { useEffect, useRef } from 'react';
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
  // Watch the permission flag — when it flips to true (right after the user
  // taps "Allow" on the PermissionScreen) we immediately kick off a sync.
  const permissionGranted = useEPurseStore((s) => s.smsPermissionGranted);
  const enabled = useEPurseStore((s) => s.smsAutoImport);
  const lastSync = useEPurseStore((s) => s.lastSmsSync);
  const ingestMessage = useEPurseStore((s) => s.ingestMessage);
  const setLastSmsSync = useEPurseStore((s) => s.setLastSmsSync);

  const unsubRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const stop = () => {
      if (typeof unsubRef.current === 'function') {
        unsubRef.current();
        unsubRef.current = null;
      }
    };

    const start = async () => {
      // Guard: must be Android, native module must be linked, and permission
      // must be held at the OS level (double-check in case the user revoked it).
      if (Platform.OS !== 'android' || !smsSupported) return;
      if (!permissionGranted && !enabled) return;

      const ok = await hasSmsPermission();
      if (!ok || cancelled) return;

      // ── Catch-up inbox sweep ──────────────────────────────────────────────
      try {
        const since = lastSync
          ? Math.max(lastSync, Date.now() - THIRTY_DAYS_MS)
          : Date.now() - THIRTY_DAYS_MS;

        const inbox = await readInbox(since);
        if (cancelled) return;

        // Sort oldest → newest so balances accumulate in the right order.
        const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));
        sorted.forEach((m) => {
          ingestMessage(m.body, {
            sender: m.address,
            receivedAt: new Date(m.date).toISOString(),
          });
        });
        setLastSmsSync(Date.now());
      } catch (e) {
        console.warn('[useSmsSync] inbox sweep failed', e?.message);
      }

      if (cancelled) return;

      // ── Live listener for new incoming SMS ────────────────────────────────
      // Stop any existing subscription before creating a new one.
      stop();
      unsubRef.current = subscribeToIncomingSms((sms) => {
        ingestMessage(sms.body, {
          sender: sms.originatingAddress,
          receivedAt: new Date(sms.timestamp).toISOString(),
        });
        setLastSmsSync(Date.now());
      });
    };

    start();

    // Re-sweep inbox when app comes back to foreground — handles the case
    // where the OS killed the background listener.
    const onAppState = (state) => {
      if (state === 'active' && (permissionGranted || enabled) && Platform.OS === 'android') {
        start();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
    // Re-run whenever the permission flag or the enabled toggle changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionGranted, enabled]);
}
