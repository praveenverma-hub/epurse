// =============================================================================
// Backup payload — what actually goes into the encrypted envelope.
//
// PURE: takes plain state objects in, gives a plain object out. No store import,
// no storage, no network — so a backup→restore round trip can be proved
// headlessly against the REAL selectors (see backupPayload.test.mjs).
//
// The rule
// --------
// Back up the PARSED result, never the source message. A restored app must list
// every transaction, compute identical analytics, and keep every balance — while
// the original SMS text stays on the device that received it.
//
// Transaction fields are therefore an ALLOW-LIST, not a strip-list. With a strip
// list, any field added later ships to Google Drive by default and someone has
// to notice; with an allow-list the default is "stays on device", and a field
// that's genuinely needed is caught by the round-trip test rather than by a
// privacy incident. `smsText`, `rawSms` and `rawSender` are excluded by simply
// never being named here.
//
// The inverse risk — omitting a field the app NEEDS — is covered by
// backupPayload.test.mjs, which restores into a fresh store and asserts every
// selector (spend, breakdown, balances, budget, aggregates) returns identical
// values. That test is the reason this allow-list can be trusted; don't add a
// field here without it.
// =============================================================================

/** Payload schema version — bump when the PAYLOAD shape changes (not the envelope's). */
export const PAYLOAD_VERSION = 1;

/**
 * Every transaction field the app reads. Sourced from the union of the store
 * selectors, split.js, behavioralSelectors.js and the row/detail UI.
 *
 * NOT here, deliberately: `smsText`, `rawSms`, `rawSender` — the original
 * message body. `smsId` IS kept: it's an opaque id, and without it a restored
 * device re-scanning the inbox would re-import every transaction as a duplicate.
 */
export const TXN_FIELDS = [
  // identity / money
  'id', 'amount', 'type', 'createdAt', 'source',
  // categorisation
  'categoryId', 'parentCategory', 'childCategory', 'userEditedCategory',
  // merchant + user text. `cleanMerchant` is the display-ready enriched name;
  // `rawMerchant` is the extracted token and is the KEY for userCustomRules, so
  // dropping it would silently break every rule the user has saved. Both are
  // parser OUTPUT (capped at 40 chars), not message bodies.
  'merchant', 'cleanMerchant', 'rawMerchant', 'userEditedMerchant', 'note', 'location',
  // account linkage
  'accountId', 'accountType', 'accountMask', 'bankName', 'coAccountMask',
  // status flags
  'isRefund', 'isReviewed', 'isIgnored', 'isHidden', 'isSubscription', 'lbLocked',
  // direct split
  'isSplit', 'splitWith', 'myShareAmount', 'myPercent', 'isSplitMemo', 'splitPaidBy', 'memoAccountId',
  // groups
  'groupId', 'groupSplit', 'isGroupMemo',
  // self-transfer hints — still needed AFTER a restore, because ingesting new SMS
  // re-checks earlier transactions against the grown mask set.
  'counterpartyMask', 'counterpartyPhone', 'counterpartyName', 'transferRef', 'selfDualLeg',
  // dedup + provenance
  'smsId', 'derivedFromTxnId',
] as const;

type Txn = Record<string, unknown>;

/**
 * Copy only allow-listed keys, and only when actually present — so a transaction
 * that never had `groupId` doesn't gain `groupId: undefined` and change shape.
 */
export function pickTxn(t: Txn): Txn {
  const out: Txn = {};
  for (const k of TXN_FIELDS) if (t[k] !== undefined) out[k] = t[k];
  return out;
}

/** Fields present on a transaction that this build would NOT back up. */
export function unknownTxnFields(t: Txn): string[] {
  const allowed = new Set<string>(TXN_FIELDS as readonly string[]);
  return Object.keys(t).filter((k) => !allowed.has(k));
}

/**
 * Persisted ePurse-store keys carried verbatim (no per-item filtering needed —
 * none of them hold message text). Mirrors the store's `partialize`; a key added
 * there must be added here or it silently won't survive a restore.
 */
export const STORE_KEYS = [
  // money + ledger
  'accounts', 'monthlyAggregates', 'lentBorrowed', 'groups',
  // categories
  'categories', 'customParents', 'customChildren', 'excludedExpenseParents',
  // budget
  'budget', 'lastBudgetPlan', 'budgetHistory', 'budgetStreak', 'budgetBreachNotified',
  // profile / prefs
  'userName', 'userPhones', 'userOnboardedAt', 'hasOnboarded',
  'themeId', 'darkMode', 'recapOptions', 'smsAutoImport',
  'showWeeklySummary', 'showMonthlyRecap',
  // ingest bookkeeping — ids only, and required so a restored device doesn't
  // re-import or re-prompt for SMS it has already handled.
  'lastSmsSync', 'lastSmsDate', 'suppressedSmsIds', 'ccHandledSmsIds', 'manualTxnSeq',
  'lastCompactedAt',
  // Outstanding CC bills (amount + due date per card). Restored because a bill is
  // a future obligation — losing it means the new device silently stops warning
  // about a payment that's still due. Contains nothing that isn't already in the
  // backed-up accounts and transactions (mask, bank, amount).
  // NOTE `ccDueReminderIds` is deliberately NOT here: those are OS notification
  // ids, meaningless on another device.
  'ccBills',
  // one-shot UI state, so a restore doesn't replay tutorials the user finished
  'welcomeReviewSeen', 'planBannerDismissed', 'anchorNudgeDismissed',
  'weeklyRecapHandled', 'recapMonthHandled', 'monthlyRecapCardDismissed',
  'declinedAccountLinks', 'activeGroupZoneId', 'userCustomRules',
] as const;

/**
 * Reward economy (coins / XP / streak / owned widgets). Backed up so a restored
 * device doesn't silently reset progress the user paid attention to.
 * NOT security-sensitive, but it IS user progress.
 */
export const REWARD_KEYS = [
  'coins', 'xp', 'level', 'streak', 'longestStreak', 'lastCheckInAt',
  'ownedItems', 'activeWidgets',
] as const;

export type BackupPayload = {
  payloadVersion: number;
  epurse: Record<string, unknown>;
  rewards: Record<string, unknown>;
};

const pickKeys = (src: Record<string, unknown> | null | undefined, keys: readonly string[]) => {
  const out: Record<string, unknown> = {};
  if (!src) return out;
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
};

export function buildBackupPayload(
  epurseState: Record<string, unknown>,
  rewardState?: Record<string, unknown> | null,
): BackupPayload {
  const txns = Array.isArray(epurseState.transactions) ? epurseState.transactions : [];
  const archived = Array.isArray(epurseState.archivedTransactions) ? epurseState.archivedTransactions : [];

  return {
    payloadVersion: PAYLOAD_VERSION,
    epurse: {
      ...pickKeys(epurseState, STORE_KEYS),
      transactions: (txns as Txn[]).map(pickTxn),
      archivedTransactions: (archived as Txn[]).map(pickTxn),
    },
    rewards: pickKeys(rewardState, REWARD_KEYS),
  };
}

/**
 * Turn a payload back into state patches. Returns them instead of calling
 * setState so the caller controls ordering — and so this stays pure and testable.
 * Throws on a payload from a FUTURE app version, which we can't safely interpret.
 */
export function readBackupPayload(payload: BackupPayload): {
  epurse: Record<string, unknown>;
  rewards: Record<string, unknown>;
} {
  if (!payload || typeof payload !== 'object') throw new Error('Empty backup payload.');
  if (typeof payload.payloadVersion !== 'number' || payload.payloadVersion > PAYLOAD_VERSION) {
    throw new Error('This backup was made by a newer version of ePurse.');
  }
  return { epurse: payload.epurse || {}, rewards: payload.rewards || {} };
}
