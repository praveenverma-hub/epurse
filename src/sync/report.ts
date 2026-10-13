// Sync problems → Sentry. Event names and numbers only — never group names, people or amounts.
import * as Sentry from '@sentry/react-native';

export function report(event: string, extra?: Record<string, unknown>) {
  try { Sentry.captureMessage(`sync: ${event}`, { level: 'warning', tags: { sync: event }, extra }); } catch { /* best effort */ }
}
