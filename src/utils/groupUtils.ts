/**
 * Utility helpers for the Groups feature.
 * Pure functions — no store imports, safe to call anywhere.
 */
import type {
  Group,
  GroupTxnLike,
  GroupMemberBalance,
  GroupSettlement,
} from '../types/group';

/**
 * Derive per-member running balances for a shared group.
 *
 * Returns Map<memberId, GroupMemberBalance>
 *   net > 0  → this person is owed money by the group
 *   net < 0  → this person owes money to the group
 *
 * Logic per expense:
 *   • payer's `paid` += expense.amount
 *   • each share recipient's `owes` += share.shareAmount
 *
 * NOTE: unused by the screens since group debts moved to the LB ledger; kept as
 * a pure helper for analytics / potential reuse.
 */
export function computeGroupBalances(
  group: Group,
  transactions: GroupTxnLike[],
): Map<string, GroupMemberBalance> {
  const members = new Map<string, GroupMemberBalance>(
    (group.members || []).map((m) => [
      m.memberId,
      { ...m, paid: 0, owes: 0, net: 0 },
    ]),
  );

  const groupTxns = transactions.filter(
    (t) => t.groupId === group.id && t.groupSplit && !t.isIgnored,
  );

  for (const txn of groupTxns) {
    const { paidByMemberId, shares } = txn.groupSplit!;
    const payer = members.get(paidByMemberId);
    if (payer) payer.paid += Number(txn.amount) || 0;

    for (const share of shares || []) {
      const m = members.get(share.memberId);
      if (m) m.owes += Number(share.shareAmount) || 0;
    }
  }

  members.forEach((m) => { m.net = m.paid - m.owes; });
  return members;
}

/**
 * Minimal-transfer settlement algorithm.
 * Creditors (net > 0) are matched against debtors (net < 0) greedily.
 */
export function deriveSettlements(
  balances: Map<string, GroupMemberBalance>,
): GroupSettlement[] {
  const creditors: Array<{ id: string; name: string; amount: number }> = [];
  const debtors: Array<{ id: string; name: string; amount: number }> = [];

  balances.forEach((b) => {
    if (b.net > 0.005)  creditors.push({ id: b.memberId, name: b.name, amount: b.net });
    if (b.net < -0.005) debtors.push({ id: b.memberId, name: b.name, amount: -b.net });
  });

  const settlements: GroupSettlement[] = [];

  while (creditors.length && debtors.length) {
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.amount, d.amount);

    settlements.push({
      from: d.id, fromName: d.name,
      to:   c.id, toName:   c.name,
      amount: Math.round(amount * 100) / 100,
    });

    c.amount -= amount;
    d.amount -= amount;

    if (c.amount < 0.005) creditors.shift();
    if (d.amount < 0.005) debtors.shift();
  }

  return settlements;
}

/**
 * Total spend for a group derived live from transactions.
 * Used when the materialised group.totalSpend is unavailable or suspect.
 */
export function computeGroupTotalSpend(
  groupId: string,
  transactions: GroupTxnLike[],
): number {
  return transactions
    .filter((t) => t.groupId === groupId && !t.isIgnored && !t.isGroupMemo)
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

/**
 * Generates a short display label for a group member balance.
 * e.g. "+₹1,200 received" | "−₹500 you owe" | "Settled"
 */
export function memberBalanceLabel(net: number, isMe: boolean): string {
  if (Math.abs(net) < 0.5) return 'Settled';
  const absAmt = Math.abs(net).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (net > 0) return isMe ? `+₹${absAmt} received` : `+₹${absAmt} paid more`;
  return isMe ? `−₹${absAmt} you owe` : `−₹${absAmt} owes you`;
}
