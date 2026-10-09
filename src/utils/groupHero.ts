// =============================================================================
// groupHero — what Group Detail's top card says (Oct-10-26). Pure, tested in
// test:groupHero, so the card, the list under it and the Summary tab agree.
//
//   shared:   TOTAL SPENT (every bill, whoever paid) │ YOUR SHARE (your part of them)
//             + one balance line — what's still OUTSTANDING ("owe" words, §3e-1)
//   personal: TOTAL SPENT │ THIS MONTH   (both = your spend)
//
// Every figure comes from the live transaction list (not the materialised
// group.totalSpend counter), so the numbers always add up with the rows below.
// =============================================================================
import { countsForSpend, spendContribution } from './split';
import { TRANSACTION_TYPES } from '../constants/categories';

interface HeroTxn { type?: string; amount: number; isRefund?: boolean; groupSplit?: unknown; isSplit?: boolean; myShareAmount?: number }

const round2 = (v: number) => Math.round(v * 100) / 100;

/** `yourShare` = your part of every bill (whoever paid), refunds netted — same basis as the Summary chart. */
export function groupHeroFigures(txns: HeroTxn[]): { totalBills: number; yourShare: number } {
  let bills = 0;
  let share = 0;
  for (const t of txns) {
    if (!countsForSpend(t)) continue;
    bills += t.type === TRANSACTION_TYPES.DEBIT ? Number(t.amount) || 0 : -(Number(t.amount) || 0);
    share += spendContribution(t);
  }
  return { totalBills: round2(Math.max(0, bills)), yourShare: round2(Math.max(0, share)) };
}

export type BalanceTone = 'lent' | 'borrowed';
export type BalanceSegment = { text: string } | { amount: number; tone: BalanceTone };
export interface BalanceLine {
  kind: 'owed' | 'owe' | 'mixed' | 'settled';
  segments: BalanceSegment[];
}

/**
 * The card's one-line outstanding balance, from per-person nets in this group
 * (net > 0 = they owe you). Null when the group has no expenses yet.
 */
export function groupBalanceLine(rows: { person: string; net: number }[], hasExpenses: boolean): BalanceLine | null {
  if (!hasExpenses) return null;
  const owedRows = rows.filter((r) => r.net > 0.005);
  const oweRows = rows.filter((r) => r.net < -0.005);
  const owed = round2(owedRows.reduce((s, r) => s + r.net, 0));
  const owe = round2(oweRows.reduce((s, r) => s - r.net, 0));
  const who = (list: { person: string }[]) => (list.length === 1 ? firstName(list[0].person) : `${list.length} people`);

  if (owedRows.length && oweRows.length) {
    return {
      kind: 'mixed',
      segments: [{ text: 'Owed to you ' }, { amount: owed, tone: 'lent' }, { text: ' · You owe ' }, { amount: owe, tone: 'borrowed' }],
    };
  }
  if (owedRows.length) {
    const many = owedRows.length > 1;
    return { kind: 'owed', segments: [{ text: `${who(owedRows)} ${many ? 'owe' : 'owes'} you ` }, { amount: owed, tone: 'lent' }] };
  }
  if (oweRows.length) {
    return { kind: 'owe', segments: [{ text: `You owe ${who(oweRows)} ` }, { amount: owe, tone: 'borrowed' }] };
  }
  return { kind: 'settled', segments: [{ text: 'All settled up' }] };
}

function firstName(name: string): string {
  const s = (name || '').trim();
  return s ? s.split(/\s+/)[0] : 'Someone';
}
