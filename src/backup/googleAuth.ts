// =============================================================================
// Google sign-in for Drive backup (OAuth 2.0 + PKCE).
//
// Uses expo-auth-session rather than the native Google SDK: no extra native
// module to keep in step with RN upgrades, and the flow opens in the system
// browser, which is what Google requires for installed apps anyway.
//
// Token handling
// --------------
// The REFRESH token is the long-lived credential — it stays in expo-secure-store
// (Keystore / Keychain), never AsyncStorage, which is plain unencrypted JSON on
// a rooted device. The ACCESS token is kept in memory only: it lives ~1 hour and
// re-deriving it costs one request, so persisting it buys nothing and widens the
// blast radius of a device compromise.
//
// This module owns credentials ONLY. It never sees decrypted backup data — the
// separation means a bug here cannot leak financial data, and a bug in the
// backup code cannot leak tokens.
// =============================================================================
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';

import { GOOGLE_ANDROID_CLIENT_ID, GOOGLE_IOS_CLIENT_ID, DRIVE_SCOPE, isBackupConfigured, googleRedirectUri } from './config';
import { base64ToBytes, bytesToUtf8 } from './envelope';

const REFRESH_KEY = 'epurse.backup.refreshToken';
const EMAIL_KEY = 'epurse.backup.account';

const DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

export class AuthError extends Error {
  code: 'NOT_CONFIGURED' | 'CANCELLED' | 'FAILED' | 'NO_GRANT';
  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** iOS gets its own client only if one is configured; Android is the primary target. */
const clientId = () =>
  (Platform.OS === 'ios' && GOOGLE_IOS_CLIENT_ID) ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;

// Google Android clients accept ONLY the reversed-client-id scheme (see
// googleRedirectUri). `epurse://oauthredirect` — the obvious guess, and what
// this used to be — fails with redirect_uri_mismatch.
const redirectUri = () => AuthSession.makeRedirectUri({ native: googleRedirectUri(clientId()) });

// In-memory only, by design (see header).
let accessToken: string | null = null;
let accessTokenExpiry = 0;

/** Signed in = we hold a refresh token; the access token is disposable. */
export async function isSignedIn(): Promise<boolean> {
  return !!(await SecureStore.getItemAsync(REFRESH_KEY));
}

export async function getSignedInAccount(): Promise<string | null> {
  return SecureStore.getItemAsync(EMAIL_KEY);
}

/**
 * Interactive sign-in. `access_type=offline` + `prompt=consent` are BOTH
 * required to get a refresh token: without them Google returns only an access
 * token, and the user would be re-prompted on every single backup.
 */
export async function signIn(): Promise<{ email: string | null }> {
  if (!isBackupConfigured()) {
    throw new AuthError('NOT_CONFIGURED', 'Google backup is not set up in this build yet.');
  }

  const request = new AuthSession.AuthRequest({
    clientId: clientId(),
    scopes: [DRIVE_SCOPE, 'openid', 'email'],
    redirectUri: redirectUri(),
    usePKCE: true,
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync(DISCOVERY);
  if (result.type === 'dismiss' || result.type === 'cancel') {
    throw new AuthError('CANCELLED', 'Sign-in was cancelled.');
  }
  if (result.type !== 'success' || !result.params?.code) {
    throw new AuthError('FAILED', 'Google sign-in did not complete. Please try again.');
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: clientId(),
      code: result.params.code,
      redirectUri: redirectUri(),
      // Installed apps have NO client secret — PKCE's verifier is the proof.
      extraParams: { code_verifier: request.codeVerifier || '' },
    },
    DISCOVERY,
  );

  if (!token.refreshToken) {
    // Google withholds it when a prior grant already exists; without it we can't
    // back up unattended, so surface it rather than half-working.
    throw new AuthError('NO_GRANT', 'Google did not return a long-lived token. Remove ePurse from your Google account permissions and sign in again.');
  }

  await SecureStore.setItemAsync(REFRESH_KEY, token.refreshToken);
  accessToken = token.accessToken;
  accessTokenExpiry = Date.now() + (token.expiresIn ?? 3600) * 1000;

  const email = decodeEmail(token.idToken);
  if (email) await SecureStore.setItemAsync(EMAIL_KEY, email);
  return { email };
}

/**
 * A valid access token, refreshed if needed. This is what DriveDeps injects.
 * The 60s skew stops a token expiring mid-request.
 */
export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < accessTokenExpiry - 60_000) return accessToken;

  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!refreshToken) throw new AuthError('NO_GRANT', 'Not signed in to Google.');

  try {
    const token = await AuthSession.refreshAsync(
      { clientId: clientId(), refreshToken, scopes: [DRIVE_SCOPE] },
      DISCOVERY,
    );
    accessToken = token.accessToken;
    accessTokenExpiry = Date.now() + (token.expiresIn ?? 3600) * 1000;
    if (token.refreshToken) await SecureStore.setItemAsync(REFRESH_KEY, token.refreshToken);
    return accessToken;
  } catch {
    // The user revoked access in their Google account, or the token aged out.
    // Clear it so the UI shows "signed out" instead of retrying a dead grant.
    await signOut();
    throw new AuthError('NO_GRANT', 'Google access has expired. Sign in again to back up.');
  }
}

/** Forget the grant locally. Backups already in Drive are untouched. */
export async function signOut(): Promise<void> {
  accessToken = null;
  accessTokenExpiry = 0;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(EMAIL_KEY);
}

/**
 * Read `email` out of the id_token for display. NOT verified — it's only ever
 * shown as "backing up to <account>", never trusted for a security decision, so
 * signature verification would be ceremony without benefit.
 */
function decodeEmail(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    // Our own base64/utf8, not `atob` + percent-decoding: Hermes has neither
    // `atob` nor `TextDecoder` dependably, and because this is wrapped in a
    // try/catch it would fail SILENTLY — you'd be signed in with no email shown
    // and no clue why. base64URL → base64 first (`-_` are not in the alphabet).
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(bytesToUtf8(base64ToBytes(payload)));
    return json.email || null;
  } catch {
    return null;
  }
}
