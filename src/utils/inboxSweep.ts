// =============================================================================
// inboxSweep — one-time onboarding inbox sweep
// -----------------------------------------------------------------------------
// The first-launch SMS sweep that discovers accounts and back-fills 3 months of
// transactions. Shared by the OnboardingDeck registration handshake (single
// source of truth, no drift). Pure orchestration over store actions + the SMS
// service.
// =============================================================================

import { readInbox } from '../services/smsService';

export interface SweepActions {
  ingestMessage: (body: string, opts: { sender?: string; receivedAt?: string; smsId?: string; preOnboarding?: boolean }) => unknown;
  setLastSmsDate: (date: number) => void;
  setLastSmsSync: (ts: number) => void;
  compactTransactions: (force?: boolean) => void;
  capOnboardingQueue: (limit: number) => void;
}

export interface SweepProgress {
  current: number;
  total: number;
  label: string;
}

export interface SweepResult {
  total: number;
}

const BATCH = 25;

/**
 * Sweep the SMS inbox from the 1st of the month 3 months ago (matching the raw
 * retention window), ingest every message oldest→newest so balances accumulate
 * chronologically, advance the date cursor, then compact + cap the review queue.
 *
 * @param actions    store actions to drive ingestion
 * @param onProgress optional progress callback for a live UI
 */
export async function runInitialInboxSweep(
  actions: SweepActions,
  onProgress?: (p: SweepProgress) => void,
): Promise<SweepResult> {
  onProgress?.({ current: 0, total: 0, label: 'Reading inbox…' });

  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime();

  let inbox: Array<{ body?: string; address?: string; date?: number; _id?: string | number }> = [];
  try {
    inbox = await readInbox(since);
  } catch (e: any) {
    console.warn('[inboxSweep] readInbox failed', e?.message);
  }

  const total = inbox.length;
  if (total === 0) {
    actions.setLastSmsSync(Date.now());
    onProgress?.({ current: 0, total: 0, label: 'No financial messages found' });
    return { total: 0 };
  }

  // Oldest → newest so account balances accumulate in order.
  const sorted = [...inbox].sort((a, b) => (a.date || 0) - (b.date || 0));

  let processed = 0;
  let maxSmsDate = 0;
  onProgress?.({ current: 0, total, label: 'Categorising messages…' });

  for (let i = 0; i < sorted.length; i += BATCH) {
    const chunk = sorted.slice(i, i + BATCH);
    chunk.forEach((m) => {
      actions.ingestMessage(m.body || '', {
        sender: m.address,
        receivedAt: new Date(m.date || Date.now()).toISOString(),
        smsId: String(m._id), // Android SMS unique ID — prevents re-ingestion
        // Fresh start: everything swept at onboarding is historical — archived for
        // account discovery + Account Details reference only, never counted.
        preOnboarding: true,
      });
      if ((m.date || 0) > maxSmsDate) maxSmsDate = m.date || 0;
    });
    processed += chunk.length;
    onProgress?.({ current: processed, total, label: 'Categorising messages…' });
    // Yield to the UI thread so progress can repaint.
    await new Promise((r) => setTimeout(r, 0));
  }

  // Advance the cursor so the background sync never re-fetches these.
  if (maxSmsDate > 0) actions.setLastSmsDate(maxSmsDate);
  actions.setLastSmsSync(Date.now());
  actions.compactTransactions(true); // first run: force a compaction pass
  actions.capOnboardingQueue(5);     // keep only the 5 newest in the review queue

  onProgress?.({ current: total, total, label: 'Done!' });
  return { total };
}
