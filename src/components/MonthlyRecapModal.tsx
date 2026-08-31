// =============================================================================
// MonthlyRecapModal — the one-time month-end moment.
// -----------------------------------------------------------------------------
// Shows once on the first app-open after a new month begins (driven by the
// store's `pendingMonthlyRecap`, set by maybeQueueMonthlyRecap). Wraps the same
// MonthlyRecapCard used on the Dashboard, under a celebratory header. Closing
// leaves the persistent card behind, so the recap is never lost. This replaces
// the old standalone CelebrationModal at rollover — one popup, not two.
//
// CENTRED (Sep-1, user's call; it was bottom-aligned on the theory that the
// taller card reads better rising from the edge). Centred is the better fit
// anyway: the centred branch of the shell SCROLLS, so the recap card — the
// taller of the two — can overflow a small screen or a large font scale and
// still be reachable, which the bottom branch could not do.
//
// The shell is shared with WeeklyRecapModal (RecapModalShell); both are centred
// now, so the only difference left is the dismiss — weekly acknowledges with a
// "Done" button, monthly uses the shared floating ✕.
// =============================================================================

import React from 'react';

import { useEPurseStore } from '../store/ePurseStore';
import MonthlyRecapCard from './MonthlyRecapCard';
import RecapModalShell from './RecapModalShell';

const MonthlyRecapModal: React.FC = () => {
  const pendingMonthlyRecap      = useEPurseStore((s) => s.pendingMonthlyRecap);
  const showMonthlyRecap         = useEPurseStore((s) => s.showMonthlyRecap);
  const clearPendingMonthlyRecap = useEPurseStore((s) => s.clearPendingMonthlyRecap);

  const visible = !!pendingMonthlyRecap && showMonthlyRecap;
  const close = () => clearPendingMonthlyRecap();

  return (
    <RecapModalShell
      visible={visible}
      onClose={close}
      align="center"
    >
      {/* No separate heading — the card's own header ("{month} recap") already
          says what this is; a second title outside its background just floated
          oddly over the backdrop. */}
      {pendingMonthlyRecap && (
        <MonthlyRecapCard monthKey={pendingMonthlyRecap} isNew onDownloaded={close} />
      )}
    </RecapModalShell>
  );
};

export default MonthlyRecapModal;
