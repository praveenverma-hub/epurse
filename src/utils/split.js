import { TRANSACTION_TYPES } from '../constants/categories';

/** Categories where split does not apply (MVP). */
export const SPLIT_BLOCKED_CATEGORY_IDS = new Set([
  'lent',
  'borrowed',
  'lent_settled',
  'borrow_repaid',
]);

export function canSplitTransaction(txn) {
  if (!txn || txn.isIgnored) return false;
  if (txn.type !== TRANSACTION_TYPES.DEBIT) return false;
  if (SPLIT_BLOCKED_CATEGORY_IDS.has(txn.categoryId)) return false;
  // A group-tagged expense is managed through its GROUP (set "who owes" on the group
  // split — drives the LB legs), never the direct split. This holds even before the
  // split is set: a Group-Zone-tagged txn has `groupId` but no `groupSplit` yet, and a
  // second independent split would wipe/double-track the group's lent rows. Block both.
  if (txn.groupId || txn.groupSplit) return false;
  return true;
}

/**
 * Equal split in paise: you are index 0, remainder rupees go to earliest indices.
 * @param {number} amount total debit
 * @param {{ contactId?: string|null, name: string }[]} others friends only (not you)
 * @returns {{ myShare: number, otherShares: number[] }}
 */
export function computeEqualSplit(amount, others) {
  const n = 1 + others.length;
  const paise = Math.round(Number(amount) * 100);
  const base = Math.floor(paise / n);
  const rem = paise % n;
  const sharesPaise = [];
  for (let i = 0; i < n; i += 1) {
    sharesPaise.push(base + (i < rem ? 1 : 0));
  }
  const shares = sharesPaise.map((p) => p / 100);
  return {
    myShare: shares[0],
    otherShares: shares.slice(1),
  };
}

/**
 * Percent split in paise (largest-remainder rounding).
 * @param {number} amount total debit
 * @param {number} myPercent percentage for current user
 * @param {{ contactId?: string|null, name: string, percent?: number }[]} others friends only
 * @returns {{ myShare: number, otherShares: number[] }}
 */
export function computePercentSplit(amount, myPercent, others) {
  const paiseTotal = Math.round(Number(amount) * 100);
  const all = [
    { key: 'me', percent: Number(myPercent) || 0 },
    ...others.map((o, i) => ({ key: o.contactId || `o_${i}`, percent: Number(o.percent) || 0 })),
  ];

  // clamp & normalise if slightly off due to inputs; we still expect UI to enforce 100.
  all.forEach((p) => {
    if (p.percent < 0) p.percent = 0;
    if (p.percent > 100) p.percent = 100;
  });

  const targets = all.map((p) => {
    const raw = (paiseTotal * p.percent) / 100;
    const flo = Math.floor(raw);
    return { ...p, raw, flo, frac: raw - flo, paise: flo };
  });

  let used = targets.reduce((s, t) => s + t.paise, 0);
  let rem = paiseTotal - used;
  if (rem > 0) {
    targets
      .sort((a, b) => b.frac - a.frac)
      .forEach((t, idx) => {
        if (idx < rem) t.paise += 1;
      });
  } else if (rem < 0) {
    rem = -rem;
    targets
      .sort((a, b) => a.frac - b.frac)
      .forEach((t) => {
        if (rem <= 0) return;
        if (t.paise > 0) {
          t.paise -= 1;
          rem -= 1;
        }
      });
  }

  const me = targets.find((t) => t.key === 'me')?.paise || 0;
  const othersPaise = targets.filter((t) => t.key !== 'me').map((t) => t.paise);
  return { myShare: me / 100, otherShares: othersPaise.map((p) => p / 100) };
}

/** Amount to show for "your" spend / lists (full amount still on txn for bank balance). */
export function debitDisplayAmount(t) {
  if (!t || t.type !== TRANSACTION_TYPES.DEBIT) return t?.amount ?? 0;
  if (t.isSplit && typeof t.myShareAmount === 'number' && !Number.isNaN(t.myShareAmount)) {
    return t.myShareAmount;
  }
  // Shared group expense: only the user's own share counts as personal spend —
  // the rest is owed back by the other members (tracked in the group balance).
  // Memos (paid by someone else) are excluded from totals upstream, so they never
  // reach here for spend purposes.
  if (t.groupSplit && Array.isArray(t.groupSplit.shares)) {
    const mine = t.groupSplit.shares.find((sh) => sh.memberId === 'me');
    if (mine && typeof mine.shareAmount === 'number' && !Number.isNaN(mine.shareAmount)) {
      return mine.shareAmount;
    }
  }
  return t.amount;
}

// Categories where split/group expenses never count toward spend or income totals.
const GROUP_NON_SPEND_CATS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid', 'self']);

/**
 * Returns true when a transaction should be excluded from ALL spend/income totals
 * because of its group membership — either it's a group-memo (paid by someone else)
 * or it belongs to a personal group the user has toggled off from main totals.
 */
export function isGroupExcluded(txn, groups) {
  if (!txn || !txn.groupId) return false;
  if (txn.isGroupMemo) return true;
  const g = (groups || []).find((gr) => gr.id === txn.groupId);
  return !!(g && g.excludeFromTotals);
}

/**
 * Build the user's-leg lent/borrowed rows for a shared-group expense — the SINGLE source of
 * truth for who-owes-whom (mirrors the direct-split → lent pipeline). Tagged with `groupId` +
 * `sourceTxnId` so they net per-person across all groups and are removed when the txn is.
 *   • Paid by me            → one `lent` row per other member's share (they owe me).
 *   • Paid by another (memo) → one `borrowed` row for my own share (I owe the payer).
 * Returns [] for personal groups or txns without a groupSplit.
 */
export function buildGroupLbRows(group, txn) {
  if (!group || group.type !== 'shared' || !txn || !txn.groupSplit) return [];
  const { paidByMemberId, paidByName, shares } = txn.groupSplit;
  if (!Array.isArray(shares) || shares.length === 0) return [];
  const stamp = Date.now();
  const note = `Group · ${group.name}`;
  const memberById = new Map((group.members || []).map((m) => [m.memberId, m]));
  const rnd = () => Math.random().toString(36).slice(2, 8);

  if (paidByMemberId === 'me') {
    return shares
      .filter((sh) => sh.memberId !== 'me' && (Number(sh.shareAmount) || 0) > 0)
      .map((sh, i) => {
        const m = memberById.get(sh.memberId) || {};
        return {
          id: `lb_${stamp}_${i}_${rnd()}`,
          kind: 'lent',
          person: m.name || sh.name || 'Member',
          contactId: m.contactId || null,
          phone: m.phone || null,
          amount: Number(sh.shareAmount) || 0,
          note,
          date: txn.createdAt,
          sourceTxnId: txn.id,
          groupId: group.id,
        };
      });
  }

  // Someone else paid → I owe my own share → borrowed (only the user's leg is tracked globally).
  const myShare = shares.find((sh) => sh.memberId === 'me');
  const amt = Number(myShare && myShare.shareAmount) || 0;
  if (amt <= 0) return [];
  const payer = memberById.get(paidByMemberId) || {};
  return [{
    id: `lb_${stamp}_0_${rnd()}`,
    kind: 'borrowed',
    person: payer.name || paidByName || 'Member',
    contactId: payer.contactId || null,
    phone: payer.phone || null,
    amount: amt,
    note,
    date: txn.createdAt,
    sourceTxnId: txn.id,
    groupId: group.id,
  }];
}

/**
 * Lent/Borrowed framing for a group expense — drives the card's status chip.
 *   'borrowed' — someone else paid and I owe a share (I borrowed; any amount, full or partial).
 *   'lent'     — I fronted the whole bill and kept NO share for myself (lent it all out).
 *   null       — equal split I paid (primarily my own spend), not-involved, or personal.
 * The chip's amount on the card always matches this framing: a borrow shows my owed share,
 * a lent shows the full bill (debitDisplayAmount falls back to the full amount when my share
 * is 0 and I'm the payer), so the chip never contradicts the number next to it.
 */
export function groupLbChipKind(txn) {
  const gs = txn && txn.groupSplit;
  if (!gs || !Array.isArray(gs.shares)) return null;
  const iPaid = gs.paidByMemberId === 'me';
  const myShare = Number((gs.shares.find((s) => s.memberId === 'me') || {}).shareAmount) || 0;
  if (!iPaid) return myShare > 0 ? 'borrowed' : null;
  if (myShare > 0) return null; // I paid but also kept a share → it's my spend, not a pure loan.
  const othersOwe = gs.shares.some((s) => s.memberId !== 'me' && (Number(s.shareAmount) || 0) > 0);
  return othersOwe ? 'lent' : null;
}

/** Short label: first other name + "+N" for the rest. */
export function splitParticipantsLabel(splitWith) {
  if (!splitWith || splitWith.length === 0) return '';
  const first = (splitWith[0].name || '?').trim().split(/\s+/)[0] || '?';
  if (splitWith.length === 1) return first;
  return `${first} +${splitWith.length - 1}`;
}
