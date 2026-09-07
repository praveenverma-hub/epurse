import { useCallback, useRef, useState } from 'react';

/**
 * Guards a submit handler against double-firing — the #1 way this app's "Add"
 * forms create duplicate rows. Every store write mints a fresh id on every
 * call (manual transaction ids, LB entries, accounts, groups, custom
 * categories…), so nothing de-dupes for you: two taps really do create two
 * persisted records, two account-balance deltas, two LB legs.
 *
 * A `useRef` lock — not just a `submitting` state — is what actually closes
 * the race: two touch events dispatched close together can both fire before
 * React re-renders the now-`disabled` button, but the ref updates
 * synchronously with no render in between, so the second call sees the lock
 * immediately. `submitting` is purely for the UI: wire it into
 * `GradientButton`'s existing `loading` prop, or swap a hand-rolled button's
 * label/spinner the same way.
 *
 * Works whether the handler is sync (`addTransaction` is a plain `set()`) or
 * async (a screen that awaits a permission prompt or a GPS fix before
 * writing) — `submit` always awaits, so both are covered the same way.
 *
 * const { submit, submitting } = useSubmitGuard();
 * const handleSave = () => submit(async () => {
 *   await commitTransaction();
 *   navigation.goBack();
 * });
 * <GradientButton onPress={handleSave} loading={submitting} disabled={!isValid} />
 */
export function useSubmitGuard() {
  const lockRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(async (fn: () => unknown | Promise<unknown>) => {
    if (lockRef.current) return undefined;
    lockRef.current = true;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      lockRef.current = false;
      setSubmitting(false);
    }
  }, []);

  return { submit, submitting };
}

export default useSubmitGuard;
