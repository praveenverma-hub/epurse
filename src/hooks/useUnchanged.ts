// =============================================================================
// useUnchanged — true while an edit form still holds what it opened with, so its
// Save can stay off (footer forms hide it, single-button forms grey it out).
//
// The baseline is taken once the values have SETTLED, not on the first render:
// forms seed their state in effects (and hooks like useGroupSplit seed off that
// state a render later), so the first render still holds the empty defaults.
// Until a baseline exists this answers false — Save behaves as it always did.
// =============================================================================
import { useEffect, useRef, useState } from 'react';

const SETTLE_MS = 150;

/**
 * @param values everything the save would write, as plain data (JSON-compared).
 * @param enabled false for a create form — never "unchanged". Turning it off and on takes a new baseline.
 */
export function useUnchanged(values: unknown, enabled = true): boolean {
  const key = JSON.stringify(values ?? null);
  const latest = useRef(key);
  latest.current = key;
  const [base, setBase] = useState<string | null>(null);
  useEffect(() => {
    // Off → forget it: an in-place editor (Goals' plan) re-baselines on its next open.
    if (!enabled) { if (base !== null) setBase(null); return undefined; }
    if (base !== null) return undefined;
    // Re-armed by every seeding render (key in deps): the baseline is the first quiet value.
    const id = setTimeout(() => setBase(latest.current), SETTLE_MS);
    return () => clearTimeout(id);
  }, [enabled, base, key]);
  return enabled && base !== null && key === base;
}

export default useUnchanged;
