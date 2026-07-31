// =============================================================================
// Pure helpers for the coarse place label stamped on a transaction.
//
// Deliberately dependency-free and OUTSIDE services/locationService.ts: that module
// imports `expo-location`, which pulls in react-native, and the store needs
// `locationKey` for its monthly aggregates. Importing it from the service would make
// ePurseStore transitively require react-native and break the zero-dep `.mjs` test
// runner. Same reason the pure group/split helpers live in utils/split.js.
//
// Shape (see TxnLocation in services/locationService):
//   { city, district, region, country, capturedAt }
// Never coordinates — see that file for why.
// =============================================================================

/**
 * Aggregation key for "spend by place" — the city, falling back to the district and
 * then the region. Null when nothing was resolved, so callers can skip the row.
 */
export const locationKey = (loc) => {
  if (!loc) return null;
  return loc.city || loc.district || loc.region || null;
};

/** Human-readable label, coarsest-useful first. Null when nothing was resolved. */
export const formatLocation = (loc) => {
  if (!loc) return null;
  const parts = [loc.district, loc.city, loc.region].filter(Boolean);
  // De-dupe: platforms often report the same name as both district and city.
  const seen = new Set();
  const uniq = parts.filter((p) => {
    const k = String(p).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.length ? uniq.join(', ') : (loc.country || null);
};
