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
import { useAutoModalQueue } from '../hooks/useAutoModalQueue';
import RecapModalShell from './RecapModalShell';
import WeeklySummaryCard from './WeeklySummaryCard';

const WeeklyRecapModal: React.FC = () => {
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
  const topAutoModal = useAutoModalQueue();
  const visible = pendingWeeklyRecap != null && showWeeklySummary && topAutoModal === 'weeklyRecap';

  return (
    <RecapModalShell
      visible={visible}
      onClose={clearPendingWeeklyRecap}
      align="center"
      dismissLabel="Done"
    >
      {/* No separate heading — the card's own header ("This Week" + date range)
          already says what this is; a second title outside its background just
          floated oddly over the backdrop. */}
      {pendingWeeklyRecap != null && (
        <WeeklySummaryCard anchorDate={new Date(pendingWeeklyRecap)} />
      )}
    </RecapModalShell>
  );
};

export default WeeklyRecapModal;
