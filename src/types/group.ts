// =============================================================================
// Group domain types — shared across the Groups feature (store is still JS, so
// these are the canonical shapes the screens/components/utils type against).
// =============================================================================

import type { GroupFold } from '../sync/fold';
import type { OutboxItem } from '../sync/expenses';

export type GroupType = 'personal' | 'shared';

export interface GroupMember {
  /** 'me' for the built-in self member, else `c_<contactId>`. */
  memberId: string;
  name: string;
  isMe?: boolean;
  contactId?: string | null;
  phone?: string | null;
  /** Synced groups: left or removed at ₹0, or deleted their account — still in old expenses, not in new ones. */
  archived?: boolean;
  /**
   * THIS phone's contact name for them (linked to a contact) — shown instead of `name`,
   * never sent: `name` stays what the group calls them. See memberName().
   */
  contactName?: string | null;
  /** "Not in My Contacts": stop asking to link them (local only). */
  noContact?: boolean;
}

export interface GroupShare {
  memberId: string;
  name?: string;
  shareAmount: number;
  /** Used only while editing a percent split in the sheet. */
  percent?: number;
}

export interface GroupSplit {
  paidByMemberId: string;
  paidByName?: string;
  shares: GroupShare[];
}

/** A shared group that syncs live (src/sync/, docs/SHARED_GROUP_SYNC.md). */
export interface GroupShared {
  /** Server group id (uuid) — the local `Group.id` stays as it was. */
  remoteId: string;
  /** base64 group key per key epoch. Backed up with the group (inside the encrypted backup). */
  keys: Record<string, string>;
  keyEpoch: number;
  /** My member in the group; null until I've said which one I am. */
  myMemberId: string | null;
  /** Local memberId → remote memberId, for members that existed here before syncing. */
  memberMap: Record<string, string>;
  /** The replayed server history (see sync/fold.ts). */
  fold: GroupFold;
  /**
   * 'pending' = live here, not yet created on the server (first invite offline);
   * 'ended' = no longer on the server (left, or expired) — local data stays.
   */
  status: 'pending' | 'active' | 'ended';
  /** Changes waiting to be sent, oldest first (sync/expenses.ts `planOutgoing`). */
  outbox?: OutboxItem[];
  /** Live again after "Sharing Ended" (Add Back, rejoin): take the server's history before sending anything. */
  resync?: boolean;
  /** Joining: the person the invite was for (the server's word), until I'm someone in the group. */
  claimFor?: string | null;
  /** Last pull that reached the server. */
  syncedAt: string | null;
  /** The last send/pull failed (cleared by the next good pull) — "Not synced" while it's been a while. */
  syncFailedAt?: string;
  /** The last checkpoint this phone confirmed to the server (fold.verifiedCheckpoint). */
  ackedCheckpoint?: number;
}

export interface Group {
  id: string;
  name: string;
  type: GroupType;
  emoji?: string;
  color?: string;
  members: GroupMember[];
  excludeFromTotals?: boolean;
  totalSpend?: number;
  createdAt: string;
  lastActivityAt?: string;
  /** Vestigial — superseded by the LB ledger; kept for back-compat reads. */
  settlements?: unknown[];
  shared?: GroupShared;
  /** "Not Now" on the Members tab's contact-link reminder (local). */
  contactLinksSnoozed?: boolean;
}

/** Minimal transaction shape the group utils need (the store txn is a superset). */
export interface GroupTxnLike {
  id?: string;
  amount: number;
  groupId?: string;
  groupSplit?: GroupSplit;
  isIgnored?: boolean;
  isGroupMemo?: boolean;
  createdAt?: string;
}

/** Per-member running balance for a group (derived). */
export interface GroupMemberBalance extends GroupMember {
  paid: number;
  owes: number;
  net: number; // paid − owes  (>0 owed money, <0 owes money)
}

/** A single creditor→debtor transfer suggestion. */
export interface GroupSettlement {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

/**
 * Coarse place label stamped on a transaction. Re-exported from the one definition in
 * `services/locationService` — it used to be duplicated here, which let the two drift
 * (this copy still had lat/lng after the service switched to district-level labels).
 */
import type { TxnLocation } from '../services/locationService';
export type { TxnLocation };

export interface GroupExpenseData {
  amount: number;
  merchant: string;
  parentCategory?: string;
  childCategory?: string;
  paidByMemberId: string;
  paidByName: string;
  shares: GroupShare[];
  accountId?: string | null;
  /** Captured at save time for manual adds (point of purchase). Optional. */
  location?: TxnLocation;
  note?: string;
  /** ISO date string — when the expense actually happened. Defaults to now. */
  date?: string;
}
