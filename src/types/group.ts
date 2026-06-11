// =============================================================================
// Group domain types — shared across the Groups feature (store is still JS, so
// these are the canonical shapes the screens/components/utils type against).
// =============================================================================

export type GroupType = 'personal' | 'shared';

export interface GroupMember {
  /** 'me' for the built-in self member, else `c_<contactId>`. */
  memberId: string;
  name: string;
  isMe?: boolean;
  contactId?: string | null;
  phone?: string | null;
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

/** Payload emitted by GroupExpenseSheet → addGroupExpense / tagTransactionToGroup. */
export interface GroupExpenseData {
  amount: number;
  merchant: string;
  parentCategory?: string;
  childCategory?: string;
  paidByMemberId: string;
  paidByName: string;
  shares: GroupShare[];
  accountId?: string | null;
}
