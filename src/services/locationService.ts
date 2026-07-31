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
//
// GRANULARITY (Jul-31): we store a DISTRICT-LEVEL LABEL, never coordinates. The GPS
// fix is read, immediately reverse-geocoded, and the lat/lng is thrown away — only
// city / district / region / country are kept. Two reasons:
//   • Privacy — an exact point per transaction is a movement history we don't need.
//     "Spend by city" is the analytics question; a 5-decimal coordinate isn't needed
//     to answer it, and labels group directly whereas raw points would need
//     clustering.
//   • Cost — `reverseGeocodeAsync` uses the PLATFORM geocoder (CLGeocoder on iOS,
//     android.location.Geocoder on Android). No API key, no billing, no Google
//     Geocoding API. Free. It does need connectivity, so an offline capture yields
//     no location at all rather than a coordinate we'd have to store and label later.
// Street number / street / postalCode / name are deliberately NOT read off the
// geocode result — they'd re-introduce the precision we just discarded.
// =============================================================================
import * as Location from 'expo-location';

export interface TxnLocation {
  /** e.g. "Pune". Null when the geocoder can't name it. */
  city: string | null;
  /** Sub-city area / district as the platform reports it. */
  district: string | null;
  /** State / province. */
  region: string | null;
  country: string | null;
  /** ISO timestamp of the fix. */
  capturedAt: string;
}

const FIX_TIMEOUT_MS = 6000;
const GEOCODE_TIMEOUT_MS = 4000;

async function readPosition(): Promise<TxnLocation | null> {
  try {
    // Race a cold-GPS fix against a timeout so saving a transaction never hangs.
    // `Lowest` accuracy is plenty — the fix only has to land in the right city, and
    // it settles faster and uses less battery than a precise one.
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS)),
    ]);
    if (!pos) return null;

    const capturedAt = new Date(pos.timestamp || Date.now()).toISOString();

    // Turn the point into a place NAME and drop the coordinates. Timed out too, so a
    // slow geocoder can't hold up the save.
    const places = await Promise.race([
      Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEOCODE_TIMEOUT_MS)),
    ]);
    const place = places && places.length ? places[0] : null;
    // No name → no location. We deliberately do NOT fall back to the raw coordinate.
    if (!place) return null;

    return {
      city:     place.city ?? place.subregion ?? null,
      district: place.district ?? null,
      region:   place.region ?? null,
      country:  place.country ?? null,
      capturedAt,
    };
  } catch {
    return null;
  }
}

// `formatLocation` / `locationKey` are pure and live in utils/location.js so the store
// can use them without importing expo-location (→ react-native). Re-exported here so a
// UI caller that already imports this service doesn't need a second import.
export { formatLocation, locationKey } from '../utils/location';

/**
 * First-launch / onboarding: surface the OS location prompt and report the
 * outcome. We only ask for permission here — we don't read a fix (the user is
 * still in onboarding, not making a purchase). Once granted, live incoming SMS
 * will stamp transactions via getLocationIfGranted() with no further prompts.
 */
export async function requestLocationPermission(): Promise<boolean> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Location.requestForegroundPermissionsAsync());
    }
    return status === 'granted';
  } catch {
    return false;
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
