// =============================================================================
// splitPosition — the ONE answer to "what happened to my money on this split?"
// for a plain split AND a group split, so every surface tells the same story.
//
//   bill · who paid · your share · net (lent / borrowed) · who owes whom
//
// WORDING RULE (Oct-9-26, ui-consistency §3e-1):
//   • "lent" / "borrowed" = YOUR net result on one transaction ("You lent ₹600"),
//     same words as the Lent/Borrowed ledger and the card chips.
//   • "owes" / "owe" = person → person, both named ("Rohit owes you ₹300",
//     "You owe Rohit ₹300"). Never a bare "Owes".
//   • "Paid" always carries the BILL ("Paid ₹900") — never sits beside a share,
//     which read as "the payer only paid their share".
// Pure: no React Native, so it's unit-tested (test:txnCard).
// =============================================================================
import type { CardGroup, CardTxn } from './txnCardModel';

export type SplitRelation = 'payer' | 'owes_you' | 'you_owe' | 'owes_payer' | 'not_involved';
export interface SplitPerson { key: string; name: string; isMe: boolean; isPayer: boolean; share: number; relation: SplitRelation }
export interface SplitPositionResult {
  bill: number;
  payer: { name: string; isMe: boolean };
  youPaid: number;
  yourShare: number;
  net: { kind: 'lent' | 'borrowed' | 'even'; amount: number };
  /** Payer first, then me, then the rest. */
  people: SplitPerson[];
}
interface Entry { key: string; name: string; isMe: boolean; share: number }

const round2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

/** `group` resolves member names for a group split. Null when the txn isn't split. */
export function splitPosition(txn: CardTxn | null | undefined, { group = null }: { group?: CardGroup | null } = {}): SplitPositionResult | null {
  if (!txn) return null;
  const bill = round2(txn.amount);
  const member = (id: string): { name?: string } => (group?.members || []).find((m) => m.memberId === id) || {};

  let entries: Entry[];
  let payerKey: string;
  if (txn.groupSplit?.shares?.length) {
    const gs = txn.groupSplit;
    entries = gs.shares.map((s) => ({
      key: s.memberId,
      name: s.memberId === 'me' ? 'You' : (member(s.memberId).name || s.name || 'Member'),
      isMe: s.memberId === 'me',
      share: round2(s.shareAmount),
    }));
    payerKey = gs.paidByMemberId || 'me';
    // A payer with no share row (full-owed by someone else) still belongs in the list.
    if (!entries.some((e) => e.key === payerKey)) {
      entries.push({ key: payerKey, name: member(payerKey).name || gs.paidByName || 'Someone', isMe: payerKey === 'me', share: 0 });
    }
  } else if (txn.isSplit && Array.isArray(txn.splitWith)) {
    const others: Entry[] = txn.splitWith.map((p, i) => ({
      key: p.contactId || `o_${i}`,
      name: p.name || 'Friend',
      isMe: false,
      share: round2(p.shareAmount),
    }));
    const sumOthers = others.reduce((t, e) => t + e.share, 0);
    const mine = typeof txn.myShareAmount === 'number' ? round2(txn.myShareAmount) : round2(Math.max(0, bill - sumOthers));
    entries = [{ key: 'me', name: 'You', isMe: true, share: mine }, ...others];
    if (txn.isSplitMemo && txn.splitPaidBy) {
      const p = txn.splitPaidBy;
      const hit = others.find((e) => (p.contactId && e.key === p.contactId) || e.name.trim().toLowerCase() === (p.name || '').trim().toLowerCase());
      payerKey = hit ? hit.key : 'payer';
      if (!hit) entries.push({ key: 'payer', name: p.name || 'Someone', isMe: false, share: 0 });
    } else payerKey = 'me';
  } else {
    return null;
  }

  const payerEntry = entries.find((e) => e.key === payerKey);
  const iPaid = payerKey === 'me';
  const payerName = iPaid ? 'You' : firstName(payerEntry?.name) || 'Someone';
  const yourShare = entries.find((e) => e.isMe)?.share || 0;
  const youPaid = iPaid ? bill : 0;

  const people: SplitPerson[] = entries.map((e) => {
    let relation: SplitRelation;
    if (e.key === payerKey) relation = 'payer';
    else if (e.share <= 0) relation = 'not_involved';
    else if (iPaid) relation = 'owes_you';
    else if (e.isMe) relation = 'you_owe';
    else relation = 'owes_payer'; // between them — not in my ledger
    return { key: e.key, name: e.isMe ? 'You' : e.name, isMe: e.isMe, isPayer: e.key === payerKey, share: e.share, relation };
  });
  // Payer first, then me, then the rest — the order the story is read in.
  people.sort((a, b) => rank(a) - rank(b));

  const owedToMe = round2(youPaid - yourShare);
  const net: SplitPositionResult['net'] = iPaid
    ? (owedToMe > 0 ? { kind: 'lent', amount: owedToMe } : { kind: 'even', amount: 0 })
    : (yourShare > 0 ? { kind: 'borrowed', amount: yourShare } : { kind: 'even', amount: 0 });

  return { bill, payer: { name: payerName, isMe: iPaid }, youPaid, yourShare, net, people };
}

/**
 * Sub-label under a person in a split list — follows the wording rule above.
 * `billLabel` is the caller's formatCurrency(bill), so money formats one way app-wide.
 */
export function splitRelationLabel(person: { relation: SplitRelation }, { billLabel, payerName }: { billLabel: string; payerName: string }): string {
  switch (person.relation) {
    case 'payer': return `Paid ${billLabel}`;
    case 'owes_you': return 'Owes you';
    case 'you_owe': return `You owe ${payerName}`;
    case 'owes_payer': return `Owes ${payerName}`;
    default: return 'Not involved';
  }
}

function rank(p: SplitPerson): number {
  if (p.isPayer) return 0;
  if (p.isMe) return 1;
  return 2;
}

function firstName(name: string | null | undefined): string {
  const s = (name || '').trim();
  return s ? s.split(/\s+/)[0] : '';
}
