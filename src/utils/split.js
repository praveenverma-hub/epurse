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
  // A shared-group expense already carries its split (groupSplit → LB legs). A second
  // independent split would wipe the group's lent rows and double-track, so block it.
  if (txn.groupSplit) return false;
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

/** Short label: first other name + "+N" for the rest. */
export function splitParticipantsLabel(splitWith) {
  if (!splitWith || splitWith.length === 0) return '';
  const first = (splitWith[0].name || '?').trim().split(/\s+/)[0] || '?';
  if (splitWith.length === 1) return first;
  return `${first} +${splitWith.length - 1}`;
}
