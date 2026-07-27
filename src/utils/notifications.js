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

// ─── Credit-card bill-due reminder ───────────────────────────────────────────

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a CC-bill due-date string as surfaced by the parser (CC_DUE_DATE_REGEX):
 *   "05-Aug-26" / "5 Aug 2026" / "05-08-26" / "05/08/2026".
 * Returns a Date at 00:00 local, or null if it can't be parsed. Two-digit years
 * map to 2000+YY. Numeric form is treated as DD-MM-YY (Indian convention).
 */
export function parseDueDate(dueStr) {
  if (!dueStr) return null;
  const s = String(dueStr).trim();
  let m = s.match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3,9})[\/\-\s](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let yr = parseInt(m[3], 10);
    if (mon == null) return null;
    if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10) - 1;
    let yr = parseInt(m[3], 10);
    if (mon < 0 || mon > 11) return null;
    if (yr < 100) yr += 2000;
    const d = new Date(yr, mon, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Schedule a local reminder ahead of a credit-card bill due date. Fires at 10:00
 * the day BEFORE the due date; if that moment has already passed, falls back to
 * 10:00 on the due date itself. Returns the scheduled id, or null if the date is
 * unparseable / already in the past / permission not granted.
 */
export async function scheduleCCBillDueReminder({ amount, cardLast4, bankName, dueDate }) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

  const due = parseDueDate(dueDate);
  if (!due) return null;

  const dayBefore = new Date(due); dayBefore.setDate(due.getDate() - 1); dayBefore.setHours(10, 0, 0, 0);
  const onDue     = new Date(due); onDue.setHours(10, 0, 0, 0);
  const now = Date.now();
  const when = dayBefore.getTime() > now + 60_000 ? dayBefore
             : (onDue.getTime() > now + 60_000 ? onDue : null);
  if (!when) return null; // due date already here/passed — the in-app chip covers it

  const amtFmt  = `₹${Math.round(Number(amount) || 0).toLocaleString('en-IN')}`;
  const cardStr = cardLast4 ? `${bankName || 'Credit Card'} XX${cardLast4}` : (bankName || 'your credit card');
  const secondsFromNow = Math.round((when.getTime() - now) / 1000);

  return Notifications.scheduleNotificationAsync({
    content: {
      title: '💳 Credit card bill due soon',
      body:  `${amtFmt} due on ${cardStr}. Pay to avoid late fees + interest.`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.HIGH,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: { seconds: secondsFromNow },
  });
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
 * Fire an immediate notification when a CC bill payment is received by the bank.
 * Silently no-ops if permission isn't granted.
 */
export async function fireCCPaymentNotification({ amount, accountMask, bankName }) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;

  const amtFmt  = `₹${Number(amount).toLocaleString('en-IN')}`;
  const cardStr = accountMask ? `XX${accountMask}` : 'your credit card';
  const bankStr = bankName ? `${bankName} ` : '';

  return Notifications.scheduleNotificationAsync({
    content: {
      title: '✅ CC Bill Payment Received',
      body:  `${amtFmt} received on ${bankStr}Credit Card ${cardStr}`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.DEFAULT,
      ...(Platform.OS === 'android' ? { channelId: BUDGET_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

/**
 * Fire an immediate notification when a recurring subscription's price is detected
 * to have increased. No-ops without notification permission.
 */
export async function fireSubscriptionHikeNotification({ merchant, oldAmount, newAmount }) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;
  const oldFmt = `₹${Math.round(Number(oldAmount) || 0).toLocaleString('en-IN')}`;
  const newFmt = `₹${Math.round(Number(newAmount) || 0).toLocaleString('en-IN')}`;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `📈 ${merchant} price went up`,
      body:  `Your ${merchant} subscription rose from ${oldFmt} to ${newFmt}. Still using it?`,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.DEFAULT,
      ...(Platform.OS === 'android' ? { channelId: BUDGET_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}

/**
 * Fires a "monthly recap is ready" notification on the first open of a new
 * month. No-ops without notification permission. Carries `data.monthKey` so
 * tapping it (handled by the listener in App.js) re-opens that month's recap.
 */
export async function fireMonthlyRecapNotification({ monthLabel, monthKey }) {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: `📊 Your ${monthLabel} recap is ready`,
      body:  'Tap to view and download.',
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority?.DEFAULT,
      data: { type: 'monthly_recap', monthKey },
      ...(Platform.OS === 'android' ? { channelId: BUDGET_CHANNEL_ID } : {}),
    },
    trigger: null,
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
