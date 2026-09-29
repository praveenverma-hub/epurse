// =============================================================================
// WeeklyRecapModal — the once-a-week "last week" recap.
// -----------------------------------------------------------------------------
// Shows a CENTERED modal on the first app-open after a week ends (driven by the
// store's `pendingWeeklyRecap`, set by maybeQueueWeeklyRecap). Renders the
// WeeklySummaryCard for the just-ended week. No persistent dashboard card — the
// weekly recap lives only here now.
//
// The modal shell (backdrop, dismiss, safe-area padding, scroll-when-tall) is
// RecapModalShell, shared with MonthlyRecapModal. This file's only job is
// deciding WHEN to show and WHAT to put inside.
// =============================================================================

import React from 'react';

import { useEPurseStore } from '../store/ePurseStore';
import type { AutoModalId } from '../constants/autoModals';
import RecapModalShell from './RecapModalShell';
import WeeklySummaryCard, { type WeeklySummary } from './WeeklySummaryCard';

type Props = {
  activeAutoModal: AutoModalId | null;
  previewSummary?: WeeklySummary;
  onPreviewClose?: () => void;
};

const WeeklyRecapModal: React.FC<Props> = ({ activeAutoModal, previewSummary, onPreviewClose }) => {
  const pendingWeeklyRecap      = useEPurseStore((s) => s.pendingWeeklyRecap);
  const showWeeklySummary       = useEPurseStore((s) => s.showWeeklySummary);
  const clearPendingWeeklyRecap = useEPurseStore((s) => s.clearPendingWeeklyRecap);

  // See MonthlyRecapModal — one auto-modal at a time. In the week a month
  // closes both are pending and the monthly one wins; this shows next open.
  // HOOK FIRST, unconditionally. Putting `useAutoModalQueue()` inside the `&&`
  // chain below skipped the call whenever the left side was falsy, so the hook
  // COUNT changed between renders and React threw "rendered fewer hooks than
  // expected" — on the Dashboard, which re-renders constantly. Hooks can never
  // sit behind a short-circuit.
  const visible = (previewSummary != null || pendingWeeklyRecap != null)
    && (previewSummary ? true : showWeeklySummary)
    && activeAutoModal === 'weeklyRecap';
  const close = () => previewSummary ? onPreviewClose?.() : clearPendingWeeklyRecap();

  return (
    <RecapModalShell
      visible={visible}
      onClose={close}
      align="center"
    >
      {/* No separate heading — the card's own header ("This Week" + date range)
          already says what this is; a second title outside its background just
          floated oddly over the backdrop. */}
      {(previewSummary || pendingWeeklyRecap != null) && (
        <WeeklySummaryCard
          anchorDate={pendingWeeklyRecap != null ? new Date(pendingWeeklyRecap) : undefined}
          previewSummary={previewSummary}
        />
      )}
    </RecapModalShell>
  );
};

export default WeeklyRecapModal;
