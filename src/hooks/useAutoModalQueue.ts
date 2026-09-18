// =============================================================================
// useAutoModalQueue — ONE auto-opening modal at a time, in a fixed order.
// -----------------------------------------------------------------------------
// Five surfaces on the Dashboard can decide to open themselves, each from its own
// store flag and none of them aware of the others. On a first open after a month
// rolls over — recap queued, a card bill to reconcile, coins to claim — several
// were `visible` at once, which is the stacked-modal problem ui-consistency §8b
// already documents (two Modals racing to mount leaves one of them un-dismissable
// on Android, and the user cannot tell which one they are answering).
//
// So the decision moves to one place. Each surface asks "am I the top of the
// queue?" and shows only if so; the rest stay PENDING and come back next time,
// which is safe precisely because every `pending*` flag is persisted — see the
// note beside them in the store's `partialize`. Holding one back defers it, it
// never drops it.
//
// THE ORDER, and why:
//   1. ccPayment    — a QUESTION about the user's own money. Answering it changes
//                     stored balances, so every number the other surfaces would
//                     show is only correct AFTER it. It also has a real deadline.
//   2. monthlyRecap — the rarest (12 a year) and the biggest payoff, tied to a
//                     boundary that has just passed and will not come round again.
//   3. weeklyRecap  — same family, 4x more often. In the week a month closes both
//                     are pending and the monthly one wins; the weekly then shows
//                     on the next open rather than being lost.
//   4. epcClaim     — always claimable, no deadline, nothing expires. It can wait
//                     for any of the above, and the coins are still there.
//
// Adding a new auto-opening surface? Put it in this list rather than letting it
// open itself, and make sure its pending flag is persisted. A surface that is not
// in the list will happily stack on top of whichever one is showing.
// =============================================================================
import { useEPurseStore } from '../store/ePurseStore';
import { useRewardStore } from '../store/useRewardStore';
import { pickAutoModal, type AutoModalId } from '../constants/autoModals';
import { EMPTY_ARRAY } from '../constants/empty';

export { AUTO_MODAL_PRIORITY, pickAutoModal, type AutoModalId } from '../constants/autoModals';


export const useAutoModalQueue = (): AutoModalId | null => {
  const ccQueue = useEPurseStore((s: any) => s.pendingCCPaymentQueue) ?? EMPTY_ARRAY;
  const pendingMonthlyRecap = useEPurseStore((s: any) => s.pendingMonthlyRecap);
  const showMonthlyRecap = useEPurseStore((s: any) => s.showMonthlyRecap);
  const pendingWeeklyRecap = useEPurseStore((s: any) => s.pendingWeeklyRecap);
  const showWeeklySummary = useEPurseStore((s: any) => s.showWeeklySummary);
  const pendingSavingsReward = useRewardStore((s: any) => s.pendingSavingsReward);

  return pickAutoModal({
    ccPayment: ccQueue.length > 0,
    monthlyRecap: !!pendingMonthlyRecap && !!showMonthlyRecap,
    weeklyRecap: pendingWeeklyRecap != null && !!showWeeklySummary,
    epcClaim: !!pendingSavingsReward,
  });
};

export default useAutoModalQueue;
