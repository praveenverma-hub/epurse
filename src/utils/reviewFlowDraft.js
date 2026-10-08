// Ephemeral handoff between the review queue and its full-screen editors.
// Never persisted: a cancelled or interrupted review cannot change the ledger.
let pending = null;

export function setReviewFlowDraft(txnId, draft) {
  pending = { txnId, draft };
}

/** Read without consuming — editors prefill from it, then merge their result back. */
export function peekReviewFlowDraft(txnId) {
  return pending && pending.txnId === txnId ? pending.draft : null;
}

export function takeReviewFlowDraft(txnId) {
  if (!pending || pending.txnId !== txnId) return null;
  const value = pending.draft;
  pending = null;
  return value;
}

export function takePendingReviewFlowDraft() {
  if (!pending) return null;
  const value = pending;
  pending = null;
  return value;
}

export function clearReviewFlowDraft() {
  pending = null;
}
