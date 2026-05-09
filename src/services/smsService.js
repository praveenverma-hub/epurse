// =============================================================================
// SMS service — Android-only bridge to the device inbox
// -----------------------------------------------------------------------------
// Two libraries are used together:
//   • react-native-get-sms-android        → query existing inbox messages
//   • react-native-android-sms-listener   → subscribe to live SMS as they arrive
//
// On iOS (Apple does not allow third-party apps to read SMS) and on web /
// Expo Go (no native module), every export below safely no-ops or returns a
// neutral default. Code that consumes this service should still work.
//
// Tied to the parser via `useEPurseStore.ingestMessage()` — *this file*
// doesn't know about the store, keeping it easy to test in isolation.
// =============================================================================

import { Platform, PermissionsAndroid } from 'react-native';

// ---- safe dynamic require ---------------------------------------------------
// We require the native modules lazily so that bundling them on iOS / Expo Go
// (where they don't exist) doesn't crash the app.
let SmsAndroid = null;
let SmsListener = null;
if (Platform.OS === 'android') {
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    SmsAndroid = require('react-native-get-sms-android');
  } catch (e) {
    console.warn('[smsService] react-native-get-sms-android not linked', e?.message);
  }
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    SmsListener = require('react-native-android-sms-listener').default;
  } catch (e) {
    console.warn('[smsService] react-native-android-sms-listener not linked', e?.message);
  }
}

export const smsSupported = Platform.OS === 'android' && !!SmsAndroid && !!SmsListener;

// =============================================================================
// Permissions
// =============================================================================

/**
 * True if the app currently holds READ_SMS at runtime.
 *
 * NOTE: On Android 10+ READ_SMS and RECEIVE_SMS share the same permission
 * group — granting one grants both. We only gate on READ_SMS because:
 *   • It is the permission `react-native-get-sms-android` actually needs.
 *   • On many OEM ROMs (MIUI, One UI, etc.) RECEIVE_SMS still returns
 *     `never_ask_again` via PermissionsAndroid even after the user tapped
 *     "Allow", so checking both causes a false-negative.
 */
export const hasSmsPermission = async () => {
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
};

/**
 * Show the native runtime permission prompt.
 * @returns {Promise<{granted: boolean, neverAskAgain: boolean}>}
 *
 * Strategy (most reliable across OEM ROMs & Android versions):
 *   1. Call requestMultiple to show the system dialog.
 *   2. IGNORE the dialog result — it is unreliable on MIUI, One UI, etc.
 *   3. Immediately re-check with PermissionsAndroid.check(READ_SMS), which
 *      always reflects the real OS state.
 *   4. Only if check() still returns false do we inspect the dialog result
 *      to decide if the user permanently denied (never_ask_again).
 */
export const requestSmsPermission = async () => {
  if (Platform.OS !== 'android') return { granted: false, neverAskAgain: false };

  // On some Android builds (sideloaded APKs, custom ROMs) requestMultiple can
  // hang and never resolve — we race it against a 25 s safety timeout.
  const PERM_TIMEOUT_MS = 25_000;

  let result = null;
  try {
    const permRequest = PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    ]);
    const timedOut = new Promise((res) => setTimeout(() => res('__timeout__'), PERM_TIMEOUT_MS));
    const race = await Promise.race([permRequest, timedOut]);
    result = race === '__timeout__' ? null : race;
    if (result === null) {
      console.warn('[smsService] requestSmsPermission timed out after', PERM_TIMEOUT_MS, 'ms');
    }
  } catch (e) {
    console.warn('[smsService] requestSmsPermission threw', e?.message);
  }

  // Ground-truth verification — always use check() after requestMultiple.
  // This is more reliable than the dialog return value on OEM ROMs.
  const actuallyGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.READ_SMS
  );

  if (actuallyGranted) {
    return { granted: true, neverAskAgain: false };
  }

  // Not granted — inspect the dialog result (if we got one) only to detect
  // permanent denial on READ_SMS.
  const read = result?.[PermissionsAndroid.PERMISSIONS.READ_SMS];
  return {
    granted: false,
    neverAskAgain: read === 'never_ask_again',
  };
};

// =============================================================================
// Inbox query
// =============================================================================

/**
 * Read existing inbox messages newer than `sinceMs` (epoch ms).
 * @param {number} sinceMs   defaults to "30 days ago"
 * @returns {Promise<Array<{ _id, address, body, date }>>}
 */
/**
 * Read inbox messages with date >= sinceMs.
 *
 * Critical performance fix: the `selection` field is passed straight to
 * ContentResolver.query() as a SQL WHERE clause, so Android's SQLite engine
 * filters rows before returning them to Java. Without this, the Java layer
 * has to iterate over every SMS in the inbox (potentially thousands) and
 * check the date in a while loop — on a real device this reliably exceeds
 * the 15 s timeout.
 *
 * `minDate` is kept as a belt-and-suspenders guard inside the native loop.
 * `sortOrder: 'date ASC'` returns oldest-first so callers can ingest in
 * chronological order without needing to re-sort.
 * `maxCount: 2000` is generous enough to cover 3 months for heavy SMS users.
 */
export const readInbox = (sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000) => {
  if (!smsSupported) return Promise.resolve([]);

  // 60 s — large enough for 2 000 messages to parse + serialize to JSON,
  // but still a hard upper bound so the UI never hangs forever.
  const READ_TIMEOUT_MS = 60_000;

  const nativeRead = new Promise((resolve, reject) => {
    const filter = JSON.stringify({
      box:       'inbox',
      selection: `date >= ${sinceMs}`,   // ← SQL WHERE: database-level filter
      minDate:   sinceMs,                // ← belt-and-suspenders Java filter
      sortOrder: 'date ASC',             // oldest → newest for chronological ingest
      maxCount:  2000,
    });
    SmsAndroid.list(
      filter,
      (failure) => reject(new Error(failure)),
      (_count, smsList) => {
        try {
          const parsed = JSON.parse(smsList || '[]');
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (_) {
          resolve([]);
        }
      }
    );
  });

  const timeout = new Promise((resolve) =>
    setTimeout(() => {
      console.warn('[smsService] readInbox timed out after', READ_TIMEOUT_MS, 'ms');
      resolve([]);
    }, READ_TIMEOUT_MS)
  );

  return Promise.race([nativeRead, timeout]).catch(() => []);
};

// =============================================================================
// Live listener
// =============================================================================

/**
 * Subscribe to incoming SMS. Handler receives `{ originatingAddress, body, timestamp }`.
 * @param {(sms: { originatingAddress: string, body: string, timestamp: number }) => void} handler
 * @returns {() => void} unsubscribe function
 */
export const subscribeToIncomingSms = (handler) => {
  if (!smsSupported) return () => {};
  const subscription = SmsListener.addListener((message) => {
    try {
      handler({
        originatingAddress: message?.originatingAddress || '',
        body: message?.body || '',
        timestamp: message?.timestamp || Date.now(),
      });
    } catch (e) {
      console.warn('[smsService] listener handler threw', e);
    }
  });
  return () => {
    try {
      subscription.remove();
    } catch (_) {
      /* noop */
    }
  };
};
