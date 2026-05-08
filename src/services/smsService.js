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

/** True if the app currently holds READ_SMS + RECEIVE_SMS at runtime. */
export const hasSmsPermission = async () => {
  if (Platform.OS !== 'android') return false;
  const read = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  const recv = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  return read && recv;
};

/**
 * Show the native runtime permission prompt.
 * @returns {Promise<{granted: boolean, neverAskAgain: boolean}>}
 */
export const requestSmsPermission = async () => {
  if (Platform.OS !== 'android') return { granted: false, neverAskAgain: false };
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.READ_SMS,
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  ]);
  const read = result[PermissionsAndroid.PERMISSIONS.READ_SMS];
  const recv = result[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS];
  return {
    granted: read === 'granted' && recv === 'granted',
    neverAskAgain: read === 'never_ask_again' || recv === 'never_ask_again',
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
export const readInbox = (sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000) =>
  new Promise((resolve, reject) => {
    if (!smsSupported) return resolve([]);
    const filter = JSON.stringify({
      box: 'inbox',
      minDate: sinceMs,
      maxCount: 500,
    });
    SmsAndroid.list(
      filter,
      (failure) => reject(new Error(failure)),
      (count, smsList) => {
        try {
          const parsed = JSON.parse(smsList || '[]');
          resolve(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          resolve([]);
        }
      }
    );
  });

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
