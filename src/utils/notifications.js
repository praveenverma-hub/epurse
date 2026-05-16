import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Bumped from `payment_reminders` — Android channels are immutable once created,
// so changing channel settings (sound, importance, vibration) requires a new id.
export const CHANNEL_ID = 'payment_reminders_v2';

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
