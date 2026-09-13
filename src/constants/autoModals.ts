// =============================================================================
// autoModals — which self-opening modal wins when several want the screen.
// -----------------------------------------------------------------------------
// Pure and dependency-free so `autoModalQueue.test.mjs` can pin the ordering
// headlessly — same reason `constants/carousel.ts` holds its geometry. The store
// wiring lives in `hooks/useAutoModalQueue.ts`.
// =============================================================================

export type AutoModalId = 'ccPayment' | 'monthlyRecap' | 'weeklyRecap' | 'epcClaim';

/**
 * Highest priority first — the first one with something pending wins, and every
 * other surface stays PENDING for next time rather than stacking on top of it
 * (ui-consistency §8b: two Modals racing to mount leaves the user answering a
 * dialog they can't tell apart, and one un-dismissable on Android).
 *
 * THE ORDER, and why:
 *   1. ccPayment    — a QUESTION about the user's own money. Answering it changes
 *                     stored balances, so every number the other surfaces would
 *                     show is only correct AFTER it. It also has a real deadline.
 *   2. monthlyRecap — the rarest (12 a year) and the biggest payoff, tied to a
 *                     boundary that has just passed and won't come round again.
 *   3. weeklyRecap  — same family, 4x more often. In the week a month closes both
 *                     are pending, the monthly one wins, and the weekly shows on
 *                     the next open rather than being lost.
 *   4. epcClaim     — always claimable, no deadline, nothing expires. It can wait
 *                     for any of the above and the coins are still there.
 *
 * ADDING A NEW SELF-OPENING SURFACE? Add it here rather than letting it open
 * itself, and make sure its `pending*` flag is PERSISTED (see the note in the
 * store's `partialize`). Deferring a modal is only safe if the queue survives a
 * restart — otherwise being held back silently throws it away, which is exactly
 * how the weekly recap was being lost.
 */
export const AUTO_MODAL_PRIORITY: AutoModalId[] = [
  'ccPayment',
  'monthlyRecap',
  'weeklyRecap',
  'epcClaim',
];

/** The queue's decision. Keys not in `AUTO_MODAL_PRIORITY` are ignored. */
export const pickAutoModal = (
  pending: Partial<Record<AutoModalId, boolean>>,
): AutoModalId | null => AUTO_MODAL_PRIORITY.find((id) => pending[id]) ?? null;
