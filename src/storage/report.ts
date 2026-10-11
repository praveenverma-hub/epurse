// Storage problems → Sentry. Event names, counts and error messages only — never stored data.
import * as Sentry from '@sentry/react-native';

export function report(event: string, extra?: Record<string, unknown>, level: 'error' | 'info' = 'error') {
  try { Sentry.captureMessage(`storage: ${event}`, { level, tags: { storage: event }, extra }); } catch { /* best effort */ }
}

export const msg = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 200);
