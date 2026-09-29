// Keep the first-run route decision independent from the onboarding UI so every
// permission outcome follows the same rule and the edge cases remain testable.

/**
 * The account confirmation screen is useful only after the onboarding inbox
 * sweep has both read messages and produced an account to confirm.
 *
 * @param {{
 *   smsPermissionGranted: boolean;
 *   messagesRead: number;
 *   discoveredAccountCount: number;
 * }} result
 */
export const shouldShowAccountConfirmation = ({
  smsPermissionGranted,
  messagesRead,
  discoveredAccountCount,
}) => (
  smsPermissionGranted === true
  && Number(messagesRead) > 0
  && Number(discoveredAccountCount) > 0
);
