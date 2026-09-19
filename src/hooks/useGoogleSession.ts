// =============================================================================
// useGoogleSession — the ONE seam between googleAuth.ts (credential lifecycle)
// and the store (app-gating state). Screens never call googleAuth.ts directly
// for sign-in/out; they go through this hook instead.
//
// A screen that only needs to DISPLAY the signed-in email/name (no action)
// should use a plain selector — useEPurseStore(s => s.googleAccount) — rather
// than this hook, so it doesn't pull in sign-in/out/pending/error it never uses.
// =============================================================================
import { useCallback, useState } from 'react';

import * as googleAuth from '../backup/googleAuth';
import { useEPurseStore } from '../store/ePurseStore';
import { suppressAppLockOnce } from '../utils/appLockSuppress';
import { IS_DEV_BUILD } from '../constants/buildVariant';

export function useGoogleSession() {
  const googleAccount = useEPurseStore((s: any) => s.googleAccount);
  const isLoggedIn = useEPurseStore((s: any) => s.isLoggedIn);
  const sessionExpired = useEPurseStore((s: any) => s.sessionExpired);
  const setGoogleAccount = useEPurseStore((s: any) => s.setGoogleAccount);
  const setSessionExpired = useEPurseStore((s: any) => s.setSessionExpired);
  const setJustDeletedAccount = useEPurseStore((s: any) => s.setJustDeletedAccount);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<googleAuth.AuthError | null>(null);

  const signIn = useCallback(async () => {
    setPending(true);
    setError(null);
    // The OAuth round trip leaves the app for the system browser — without this,
    // AppLockGate reads that as backgrounding and re-locks/re-prompts Face ID
    // underneath the sign-in flow.
    suppressAppLockOnce();
    try {
      const account = await googleAuth.signIn();
      setGoogleAccount(account.email ? account : null);
      setSessionExpired(false);
      setJustDeletedAccount(false);
      return account;
    } catch (e) {
      setError(e as googleAuth.AuthError);
      throw e;
    } finally {
      setPending(false);
    }
  }, [setGoogleAccount, setSessionExpired, setJustDeletedAccount]);

  const signOut = useCallback(async () => {
    await googleAuth.signOut();
    setGoogleAccount(null);
  }, [setGoogleAccount]);

  /**
   * The Google half of "Delete Account & Data" (SettingsScreen owns the rest:
   * `deleteAllUserData()` + `Storage.wipeEverything()`). Unlike `signOut`,
   * this REVOKES the grant at Google's end rather than only forgetting it
   * locally — see `googleAuth.revokeAndSignOut`'s own doc comment for why
   * that's the more correct behaviour for an actual deletion.
   *
   * NAME COLLISION, not the same thing: `s.deleteAccount(accountId)` on
   * `ePurseStore` deletes one FINANCIAL account (a bank/card). This deletes
   * the user's Google grant. Different modules, different `accountId`-less
   * signature, but worth a second look at a call site before assuming which
   * one a bare `deleteAccount` import means.
   */
  const deleteAccount = useCallback(async () => {
    await googleAuth.revokeAndSignOut();
    setGoogleAccount(null);
  }, [setGoogleAccount]);

  // IS_DEV_BUILD-only escape hatch (local Metro dev / EAS "development" client
  // ONLY — never a preview build someone else might run): real Google sign-in
  // needs Cloud Console setup (scopes, test users) that's easy to have broken
  // mid-development — this keeps that from blocking work on everything else.
  // A login bypass is more sensitive than the app's other IS_STAGE_BUILD-gated
  // debug tools, so it stays on the narrower flag on purpose.
  const devBypass = useCallback(() => {
    if (!IS_DEV_BUILD) return null;
    const account = { email: 'dev-bypass@local', name: 'Dev Bypass', picture: null };
    setGoogleAccount(account);
    setSessionExpired(false);
    setJustDeletedAccount(false);
    return account;
  }, [setGoogleAccount, setSessionExpired, setJustDeletedAccount]);

  return { googleAccount, isLoggedIn, sessionExpired, pending, error, signIn, signOut, deleteAccount, devBypass };
}

export default useGoogleSession;
