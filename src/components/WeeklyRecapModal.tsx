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
import RecapModalShell from './RecapModalShell';
import WeeklySummaryCard from './WeeklySummaryCard';

const WeeklyRecapModal: React.FC = () => {
  const pendingWeeklyRecap      = useEPurseStore((s) => s.pendingWeeklyRecap);
  const showWeeklySummary       = useEPurseStore((s) => s.showWeeklySummary);
  const clearPendingWeeklyRecap = useEPurseStore((s) => s.clearPendingWeeklyRecap);

  const visible = pendingWeeklyRecap != null && showWeeklySummary;

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
