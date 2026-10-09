// =============================================================================
// useGroupSplit — the ONE owner of a group expense's split state: payer, method,
// member shares, member ticks, and turning them into the `shares` the store books.
// Used by GroupExpenseForm (Groups tab / tagging sheet) and AddTransactionScreen
// (Home, when a group is picked), so both behave identically by construction.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../utils/format';
import { evenAmounts, fullOwedShares } from '../utils/splitShares';
import { SPLIT_MODE_LABEL, type SplitMode, type SplitPageRow } from '../components/SplitPage';
import type { Group, GroupShare } from '../types/group';

interface Options {
  group: Group | null;
  /** Live bill total in ₹. */
  amount: number;
  /** Sheet shells pass `visible`; state resets each time it turns true. */
  active?: boolean;
  /** Existing group txn being edited — its split is restored. */
  editTxn?: any;
  /** A real account debit: the payer is fixed to You (see GroupExpenseForm). */
  lockPayerToMe?: boolean;
}

export type GroupSplitResult =
  | { ok: true; paidByMemberId: string; paidByName: string; shares: GroupShare[] }
  | { ok: false; title: string; message: string };

const ME = { memberId: 'me', name: 'You', isMe: true };

export function useGroupSplit({ group, amount, active = true, editTxn, lockPayerToMe = false }: Options) {
  const [payerIdx, setPayerIdx] = useState(0); // index into allMembers
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [shares, setShares] = useState<GroupShare[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());

  const isShared = group?.type === 'shared';
  // Guarantee the built-in 'me' member for shared groups (a stored group may have
  // lost it). Personal groups have no members: You are the implicit sole payer.
  const allMembers = useMemo(() => {
    if (!isShared) return [ME];
    const ms = group?.members || [];
    return ms.some((m) => m.memberId === 'me') ? ms : [ME, ...ms];
  }, [group, isShared]);
  const meIdx = useMemo(() => Math.max(0, allMembers.findIndex((m) => m.isMe || m.memberId === 'me')), [allMembers]);
  const payerMemberId = allMembers[payerIdx]?.memberId;
  const payerIsMe = !!allMembers[payerIdx]?.isMe || payerMemberId === 'me';

  // Reset (new entry) or restore (edit) the split whenever the form opens or the group changes.
  useEffect(() => {
    if (!active) return;
    const eg = editTxn?.groupSplit;
    if (eg && eg.shares?.length) {
      const pIdx = allMembers.findIndex((m) => m.memberId === eg.paidByMemberId);
      setPayerIdx(pIdx >= 0 ? pIdx : 0);
      const amt = Number(editTxn.amount) || 0;
      setShares(
        eg.shares.map((sh: any) => ({
          memberId: sh.memberId,
          name: sh.name,
          shareAmount: Number(sh.shareAmount) || 0,
          percent: amt > 0 ? Math.round(((Number(sh.shareAmount) || 0) / amt) * 100) : 0,
        })),
      );
      // Restore the ORIGINAL shape so equal / full-owed keep auto-rebalancing on an
      // amount change; only a genuinely custom split opens as manual ₹ entry.
      const eq = (vals: number[]) => vals.length > 0 && vals.every((v) => Math.abs(v - vals[0]) <= 1);
      const payerId = eg.paidByMemberId;
      const allVals = eg.shares.map((x: any) => Number(x.shareAmount) || 0);
      const payerShare = Number(eg.shares.find((x: any) => x.memberId === payerId)?.shareAmount) || 0;
      const otherVals = eg.shares.filter((x: any) => x.memberId !== payerId).map((x: any) => Number(x.shareAmount) || 0);
      setSplitMode(
        eg.shares.length > 1 && eq(allVals)
          ? 'equal'
          : payerShare === 0 && otherVals.length > 0 && eq(otherVals)
            ? 'fullOwed'
            : 'amount',
      );
      setSelectedMembers(
        new Set<string>(eg.shares.filter((s: any) => (Number(s.shareAmount) || 0) > 0).map((s: any) => String(s.memberId))),
      );
      return;
    }
    setPayerIdx(0);
    setSplitMode('equal');
    setShares(allMembers.map((m) => ({
      memberId: m.memberId, name: m.name, shareAmount: 0, percent: Math.round(100 / allMembers.length),
    })));
    setSelectedMembers(new Set(allMembers.map((m) => m.memberId)));
  }, [active, group, editTxn, allMembers]);

  // Runs after the reset so it overrides any restored payer.
  useEffect(() => {
    if (lockPayerToMe) setPayerIdx(meIdx);
  }, [lockPayerToMe, meIdx, active, editTxn]);

  // Display preview for the auto methods. The SAVED shares are recomputed live in
  // resolveShares — a footer submit can fire before this effect has caught up.
  useEffect(() => {
    if ((splitMode !== 'equal' && splitMode !== 'fullOwed') || !allMembers.length) return;
    const amt = amount || 0;
    if (splitMode === 'fullOwed') {
      const owed = fullOwedShares(amt, allMembers.length, payerIdx);
      setShares(allMembers.map((m, i) => ({
        memberId: m.memberId, name: m.name, shareAmount: owed[i], percent: amt > 0 ? Math.round((owed[i] / amt) * 100) : 0,
      })));
      return;
    }
    const selected = allMembers.filter((m) => selectedMembers.has(m.memberId));
    const parts = evenAmounts(amt, selected.length);
    const n = selected.length || 1;
    setShares(allMembers.map((m) => {
      const k = selected.findIndex((x) => x.memberId === m.memberId);
      return { memberId: m.memberId, name: m.name, shareAmount: k >= 0 ? parts[k] : 0, percent: k >= 0 ? Math.round(100 / n) : 0 };
    }));
  }, [amount, splitMode, allMembers, payerIdx, selectedMembers]);

  const updateShare = useCallback((idx: number, value: number, field: 'percent' | 'shareAmount') => {
    setShares((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  const handleSetMode = useCallback((m: SplitMode) => {
    setSplitMode((prev) => {
      // Into manual ₹ entry → start every amount from empty.
      if (m === 'amount' && prev !== 'amount') setShares((s) => s.map((x) => ({ ...x, shareAmount: 0 })));
      return m;
    });
  }, []);

  /** Final per-member ₹ shares for the store, validated against the bill. */
  const resolveShares = (): GroupSplitResult => {
    const payer = allMembers[payerIdx] || ME;
    const base = { paidByMemberId: payer.memberId, paidByName: payer.name };
    if (!isShared) return { ok: true, ...base, shares: [] };

    if (splitMode === 'percent') {
      const sumPct = shares.reduce((s, x) => s + (Number(x.percent) || 0), 0);
      if (Math.abs(sumPct - 100) > 0.5) {
        return { ok: false, title: 'Percentages must total 100%', message: `Currently ${Math.round(sumPct)}%.` };
      }
      // % → ₹; the last member absorbs the rounding so the shares sum exactly.
      let allocated = 0;
      return {
        ok: true, ...base,
        shares: shares.map((x, i) => {
          const amt = i === shares.length - 1
            ? parseFloat((amount - allocated).toFixed(2))
            : parseFloat(((amount * (Number(x.percent) || 0)) / 100).toFixed(2));
          allocated = parseFloat((allocated + amt).toFixed(2));
          return { memberId: x.memberId, name: x.name, shareAmount: amt };
        }),
      };
    }
    if (splitMode === 'amount') {
      const sumAmt = shares.reduce((s, x) => s + (Number(x.shareAmount) || 0), 0);
      if (Math.abs(sumAmt - amount) > 0.5) {
        return { ok: false, title: 'Shares must total the amount', message: `Currently ${formatCurrency(sumAmt)} of ${formatCurrency(amount)}.` };
      }
      return { ok: true, ...base, shares: shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: Number(x.shareAmount) || 0 })) };
    }
    if (splitMode === 'fullOwed') {
      // Payer takes 0; others owe — equal unless edited, in which case the total must match.
      const others = shares.filter((x) => x.memberId !== payerMemberId);
      const sumOthers = others.reduce((s, x) => s + (Number(x.shareAmount) || 0), 0);
      if (sumOthers <= 0.005) {
        const parts = evenAmounts(amount, others.length || 1);
        const amtBy: Record<string, number> = {};
        others.forEach((x, k) => { amtBy[x.memberId] = parts[k]; });
        return { ok: true, ...base, shares: shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: x.memberId === payerMemberId ? 0 : (amtBy[x.memberId] || 0) })) };
      }
      if (Math.abs(sumOthers - amount) > 0.5) {
        return { ok: false, title: 'Shares must total the amount', message: `Others total ${formatCurrency(sumOthers)} of ${formatCurrency(amount)}.` };
      }
      return { ok: true, ...base, shares: shares.map((x) => ({ memberId: x.memberId, name: x.name, shareAmount: x.memberId === payerMemberId ? 0 : (Number(x.shareAmount) || 0) })) };
    }
    // equal — computed fresh from the live amount + ticked members; the `shares`
    // STATE may still hold a stale preview (the old ₹0-share bug).
    const selected = allMembers.filter((m) => selectedMembers.has(m.memberId));
    if (selected.length === 0) {
      return { ok: false, title: 'No members selected', message: 'Select at least one member for equal split.' };
    }
    const parts = evenAmounts(amount, selected.length);
    return {
      ok: true, ...base,
      shares: allMembers.map((m) => {
        const k = selected.findIndex((x) => x.memberId === m.memberId);
        return { memberId: m.memberId, name: m.name, shareAmount: k >= 0 ? parts[k] : 0 };
      }),
    };
  };

  // ── Display ──────────────────────────────────────────────────────────────────
  const payerName = payerIsMe ? 'You' : allMembers[payerIdx]?.name || 'You';
  const summary = `${payerName} paid · ${SPLIT_MODE_LABEL[splitMode]}`;
  // Percent mode stores only `percent` until submit, so derive ₹ from it.
  const breakdownRows = shares
    .map((x) => ({
      name: x.memberId === 'me' ? 'You' : x.name || 'Member',
      amount: splitMode === 'percent' ? (amount * (Number(x.percent) || 0)) / 100 : Number(x.shareAmount) || 0,
      isPayer: x.memberId === payerMemberId,
    }))
    // Keep the payer even at a 0 share (full owed) — otherwise who paid disappears.
    .filter((r) => r.amount > 0 || r.isPayer);

  const pageRows: SplitPageRow[] = shares.map((s, idx) => {
    const isPayer = s.memberId === payerMemberId;
    return {
      id: s.memberId,
      name: s.name || 'Member',
      isMe: s.memberId === 'me',
      isPayer,
      percent: Number(s.percent) || 0,
      amount: Number(s.shareAmount) || 0,
      // equal → ticks; fullOwed → only the payer is locked (0).
      editable: splitMode === 'amount' || splitMode === 'percent' || (splitMode === 'fullOwed' && !isPayer),
      onChange: (v: number) => updateShare(idx, v, splitMode === 'percent' ? 'percent' : 'shareAmount'),
      checked: selectedMembers.has(s.memberId),
      onToggle: splitMode === 'equal'
        ? () => setSelectedMembers((prev) => {
            const next = new Set(prev);
            if (next.has(s.memberId)) next.delete(s.memberId); else next.add(s.memberId);
            return next;
          })
        : undefined,
    };
  });

  /** Spread straight into <SplitPage /> (plus onBack / onDone / accentColor). */
  const pageProps = {
    payer: {
      options: allMembers.map((m) => ({ id: m.memberId, label: m.isMe ? 'You' : m.name })),
      selectedId: payerMemberId ?? 'me',
      onSelect: (id: string) => setPayerIdx(Math.max(0, allMembers.findIndex((m) => m.memberId === id))),
      lockedNote: lockPayerToMe ? "You — the money already left your account, so this can't change." : undefined,
    },
    mode: splitMode,
    onModeChange: handleSetMode,
    valueUnit: (splitMode === 'percent' ? 'percent' : 'amount') as 'percent' | 'amount',
    total: amount,
    rows: pageRows,
  };

  return { isShared, payerIsMe, summary, breakdownRows, pageProps, resolveShares };
}
