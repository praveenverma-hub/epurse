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
import type { AutoModalId } from '../constants/autoModals';
import MonthlyRecapCard from './MonthlyRecapCard';
import RecapModalShell from './RecapModalShell';
import type { MonthlyReport } from '../utils/monthlyReportHtml';

type Props = {
  explicitlyRequested?: boolean;
  activeAutoModal: AutoModalId | null;
  previewReport?: MonthlyReport;
  onPreviewClose?: () => void;
  onViewFull?: (monthKey: string, previewReport?: MonthlyReport) => void;
};

const MonthlyRecapModal: React.FC<Props> = ({ activeAutoModal, explicitlyRequested = false, previewReport, onPreviewClose, onViewFull }) => {
  const pendingMonthlyRecap      = useEPurseStore((s) => s.pendingMonthlyRecap);
  const showMonthlyRecap         = useEPurseStore((s) => s.showMonthlyRecap);
  const clearPendingMonthlyRecap = useEPurseStore((s) => s.clearPendingMonthlyRecap);

  // Only when this is the top of the auto-modal queue — otherwise it would
  // stack on whatever is already open (§8b). Held back, not dropped: the pending
  // flag is persisted, so it shows on the next open.
  // HOOK FIRST, unconditionally. Putting `useAutoModalQueue()` inside the `&&`
  // chain below skipped the call whenever the left side was falsy, so the hook
  // COUNT changed between renders and React threw "rendered fewer hooks than
  // expected" — on the Dashboard, which re-renders constantly. Hooks can never
  // sit behind a short-circuit.
  const monthKey = previewReport?.monthKey ?? pendingMonthlyRecap;
  const visible = !!monthKey
    && (previewReport || explicitlyRequested || showMonthlyRecap)
    && activeAutoModal === 'monthlyRecap';
  const close = () => previewReport ? onPreviewClose?.() : clearPendingMonthlyRecap();

  return (
    <RecapModalShell
      visible={visible}
      onClose={close}
      align="center"
    >
      {/* No separate heading — the card's own header ("{month} recap") already
          says what this is; a second title outside its background just floated
          oddly over the backdrop. */}
      {monthKey && (
        <MonthlyRecapCard
          monthKey={monthKey}
          isNew
          onDownloaded={close}
          previewReport={previewReport}
          onViewFull={onViewFull ? () => onViewFull(monthKey, previewReport) : undefined}
        />
      )}
    </RecapModalShell>
  );
};

export default MonthlyRecapModal;
