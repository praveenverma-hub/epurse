import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Bumped from `payment_reminders` — Android channels are immutable once created,
// so changing channel settings (sound, importance, vibration) requires a new id.
export const CHANNEL_ID = 'payment_reminders_v2';

// Separate channel for budget alerts so users can mute one without the other.
export const BUDGET_CHANNEL_ID = 'budget_alerts';

// Call once at app startup — no permission required
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Android 8+ requires a channel to display notifications.
// MAX importance + explicit sound is what makes the reminder pop as a heads-up
// with sound + vibration even when the app is killed.
export async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Payment Reminders',
    description: 'Reminders to repay money you owe',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lightColor: '#6366F1',
    sound: 'default',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
    bypassDnd: false,
  });
}

// Lazily request permission (call before scheduling, not at startup)
export async function requestNotificationPermissions() {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function scheduleBorrowReminder({ personName, amount, triggerDate }) {
  const secondsFromNow = Math.round((triggerDate.getTime() - Date.now()) / 1000);
  if (secondsFromNow < 5) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '💸 Payment Reminder',
      body: `You owe ₹${amount.toLocaleString('en-IN')} to ${personName}`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.MAX,
      vibrate: [0, 400, 200, 400, 200, 400],
      sticky: false,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: { seconds: secondsFromNow },
  });
  return id;
}

export async function cancelScheduledNotification(notificationId) {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (_) {}
}

// ─── Budget alerts ────────────────────────────────────────────────────────────

export async function setupBudgetAlertChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(BUDGET_CHANNEL_ID, {
    name: 'Budget Alerts',
    description: 'Heads-up when you cross a category or total budget cap',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 200, 250],
    lightColor: '#EF4444',
    sound: 'default',
    enableLights: true,
    enableVibrate: true,
    showBadge: true,
  });
}

/**
 * Fire an immediate notification when a budget cap is crossed.
 *   scope: 'category' | 'total'
 *   categoryName?: string (for scope='category')
 *   actual, cap: numbers — the spend that triggered the breach
 * Silently no-ops if permission isn't granted (we don't prompt here — the
 * borrow reminder flow already asks, and the budget breach is a follow-up).
 */
export async function fireBudgetBreachNotification({ scope, categoryName, actual, cap }) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

  const overshoot = Math.max(0, (actual || 0) - (cap || 0));
  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
  const actualFmt = `₹${Math.round(actual).toLocaleString('en-IN')}`;
  const capFmt    = `₹${Math.round(cap).toLocaleString('en-IN')}`;
  const overFmt   = `₹${Math.round(overshoot).toLocaleString('en-IN')}`;

  const title = scope === 'total'
    ? `🚨 ${monthName} budget crossed`
    : `🚨 ${categoryName} budget crossed`;
  const body = scope === 'total'
    ? `${actualFmt} of ${capFmt} — ${overFmt} over your ${monthName} cap`
    : `${actualFmt} of ${capFmt} — ${overFmt} over your ${monthName} cap`;

  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.HIGH,
      ...(Platform.OS === 'android' ? { channelId: BUDGET_CHANNEL_ID } : {}),
    },
    trigger: null, // fires immediately
  });
}

/**
 * Fires a soft mid-cycle nudge notification. Same channel as budget breaches
 * but with a friendlier tone (passed in as title/body from the store action).
 * No-ops without notification permission.
 */
export async function fireMidmonthNudgeNotification({ title, body }) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.DEFAULT,
      ...(Platform.OS === 'android' ? { channelId: BUDGET_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}
