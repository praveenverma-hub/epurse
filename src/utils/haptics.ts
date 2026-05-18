// =============================================================================
// haptics.ts — tactile feedback helpers
//
// Uses RN's built-in Vibration so no native module install is required.
// If expo-haptics is added later, swap these implementations — call sites
// stay identical.
// =============================================================================

import { Vibration } from 'react-native';

/** Quick light tick — for ordinary button presses. */
export const hapticLight = (): void => {
  Vibration.vibrate(8);
};

/** Medium thud — for confirmation actions (e.g. opening a sheet). */
export const hapticMedium = (): void => {
  Vibration.vibrate(20);
};

/** Two-pulse celebratory pattern — for successful purchases / unlocks. */
export const hapticSuccess = (): void => {
  Vibration.vibrate([0, 28, 80, 28]);
};

/** Two-pulse warning pattern — for rejected actions (insufficient funds, etc). */
export const hapticError = (): void => {
  Vibration.vibrate([0, 70, 60, 70]);
};
