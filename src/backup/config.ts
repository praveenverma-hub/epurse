// =============================================================================
// Google Drive backup — configuration.
//
// The ONE place credentials live, so nothing is buried in logic. Values here are
// not secrets: an installed-app OAuth client has NO client secret, which is why
// the flow uses PKCE (a per-request code challenge) instead. Shipping the client
// id in the bundle is the documented, intended design for native apps.
//
// ── What you need to create (Google Cloud Console) ───────────────────────────
//  1. A project → APIs & Services → enable the **Google Drive API**.
//  2. OAuth consent screen → External. Scope: `.../auth/drive.file` ONLY.
//     drive.file is NON-SENSITIVE, so this needs no Google review and has no
//     100-user cap. Adding any broader Drive scope changes that — don't.
//  3. Credentials → OAuth client ID → **Android**:
//       package name : com.epurse.app
//       SHA-1        : your DEBUG keystore AND your release / Play-signing key.
//     A missing SHA-1 is the usual cause of a silent DEVELOPER_ERROR at sign-in.
//  4. Paste the client id below.
// =============================================================================

/**
 * Android OAuth client id. Replace the placeholder — `isBackupConfigured()`
 * gates the whole feature so an unconfigured build shows a clear setup notice
 * instead of failing inside the OAuth redirect.
 */
export const GOOGLE_ANDROID_CLIENT_ID = '32024277404-2b3d0i62i3er57out9qah6n15g3deggt.apps.googleusercontent.com';

/** iOS client id — optional. iOS can't read SMS, but manual data still backs up. */
export const GOOGLE_IOS_CLIENT_ID = '';

/**
 * The ONLY scope requested. `drive.file` limits the app to files it created
 * itself: it can never see the user's other Drive content, which is both the
 * privacy story and the reason no Google verification is required.
 */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Marks our files in Drive so `files.list` can find them without a full scan. */
export const BACKUP_FILE_PREFIX = 'epurse-backup';
export const BACKUP_MIME = 'application/octet-stream';

/**
 * How many backups to keep. Older ones are pruned after a successful upload, so
 * a corrupted or wrongly-passworded recent backup isn't the only copy left.
 */
export const KEEP_BACKUPS = 5;

export const isBackupConfigured = (): boolean =>
  !!GOOGLE_ANDROID_CLIENT_ID && !GOOGLE_ANDROID_CLIENT_ID.startsWith('REPLACE_ME');

/**
 * The redirect a Google ANDROID OAuth client will accept: the client id with its
 * parts reversed, used as a custom scheme.
 *
 *   1234-abc.apps.googleusercontent.com
 *     → com.googleusercontent.apps.1234-abc:/oauthredirect
 *
 * Derived rather than configured, because writing it out by hand is the classic
 * source of `redirect_uri_mismatch` — and it's a pure function of the client id.
 * An arbitrary scheme like `epurse://` is REJECTED by Android client types; only
 * this form works. The same string must also be registered in app.json's
 * `scheme` array or the browser has nothing to hand control back to.
 */
export function googleRedirectScheme(clientId = GOOGLE_ANDROID_CLIENT_ID): string {
  const bare = clientId.replace(/\.apps\.googleusercontent\.com$/, '');
  return `com.googleusercontent.apps.${bare}`;
}

export const googleRedirectUri = (clientId = GOOGLE_ANDROID_CLIENT_ID): string =>
  `${googleRedirectScheme(clientId)}:/oauthredirect`;
