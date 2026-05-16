import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const CHANNEL_ID = 'payment_reminders';

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

// Android 8+ requires a channel to display notifications
export async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Payment Reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#6366F1',
    sound: 'default',
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
