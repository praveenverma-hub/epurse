// =============================================================================
// locationService — capture a coarse point for a transaction.
// -----------------------------------------------------------------------------
// Two entry points by context:
//   • requestAndGetLocation() — FOREGROUND, user-initiated (manual add). May
//     show the OS permission prompt the first time.
//   • getLocationIfGranted()  — BACKGROUND (a live incoming SMS). NEVER prompts;
//     returns null unless permission was already granted. Stamping a card-swipe
//     SMS that arrives in real time ≈ where the purchase happened.
// Both are defensive: any failure (no permission, GPS off, timeout) → null, so
// transaction creation never blocks on location. Field is optional everywhere
// (backward compatible — older transactions simply have no `location`).
// =============================================================================
import * as Location from 'expo-location';

export interface TxnLocation {
  latitude: number;
  longitude: number;
  /** ISO timestamp of the fix. */
  capturedAt: string;
}

const FIX_TIMEOUT_MS = 6000;

async function readPosition(): Promise<TxnLocation | null> {
  try {
    // Race a cold-GPS fix against a timeout so saving a transaction never hangs.
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!pos) return null;
    return {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      capturedAt: new Date(pos.timestamp || Date.now()).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Manual add: prompt for permission if needed, then read the current point. */
export async function requestAndGetLocation(): Promise<TxnLocation | null> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Location.requestForegroundPermissionsAsync());
    }
    if (status !== 'granted') return null;
    return await readPosition();
  } catch {
    return null;
  }
}

/** Live SMS: read the current point ONLY if permission is already granted (no prompt). */
export async function getLocationIfGranted(): Promise<TxnLocation | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    return await readPosition();
  } catch {
    return null;
  }
}
