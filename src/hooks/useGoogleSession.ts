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

export function useGoogleSession() {
  const googleAccount = useEPurseStore((s: any) => s.googleAccount);
  const isLoggedIn = useEPurseStore((s: any) => s.isLoggedIn);
  const sessionExpired = useEPurseStore((s: any) => s.sessionExpired);
  const setGoogleAccount = useEPurseStore((s: any) => s.setGoogleAccount);
  const setSessionExpired = useEPurseStore((s: any) => s.setSessionExpired);

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
      return account;
    } catch (e) {
      setError(e as googleAuth.AuthError);
      throw e;
    } finally {
      setPending(false);
    }
  }, [setGoogleAccount, setSessionExpired]);

  const signOut = useCallback(async () => {
    await googleAuth.signOut();
    setGoogleAccount(null);
  }, [setGoogleAccount]);

  return { googleAccount, isLoggedIn, sessionExpired, pending, error, signIn, signOut };
}

export default useGoogleSession;
