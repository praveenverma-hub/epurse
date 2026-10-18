// =============================================================================
// useSettlePeople — the people a settlement of a given kind can close, from the
// ledger (getPersonBalances, grouped by person — never by raw name). Every settle
// picker uses this, so "who owes me" reads the same everywhere.
// =============================================================================
import { useCallback, useMemo } from 'react';
import { useEPurseStore } from '../store/ePurseStore';
import { openBalancePeople, type LbPerson } from '../utils/lbPeopleSearch';
import { lbChildAllowed } from '../constants/twoTierCategories';

/** Everyone on the ledger with their net (getPersonBalances), re-read when the rows change. */
export function usePersonBalances(): LbPerson[] {
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed);
  const getPersonBalances = useEPurseStore((s: any) => s.getPersonBalances);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getPersonBalances() as LbPerson[], [lentBorrowed, getPersonBalances]);
}

export function useSettlePeople(): (kind: string | null | undefined) => LbPerson[] {
  const people = usePersonBalances();
  return useCallback((kind) => openBalancePeople(people, kind), [people]);
}

/**
 * Which Transfers › Lent / Borrowed / Received Back / Repaid options a transaction may
 * pick (lbChildAllowed): its direction, and for a settlement, someone to settle with.
 * None on a group / split bill (`sharedBill`, isSharedBill).
 * Non-lend/borrow labels always pass.
 */
export function useLbChildAllowed(txnType: string | undefined, currentCategoryId: string | undefined, sharedBill = false): (label: string) => boolean {
  const settlePeople = useSettlePeople();
  const owesMe = settlePeople('lent_settled').length > 0;
  const iOwe = settlePeople('borrow_repaid').length > 0;
  return useCallback(
    (label: string) => lbChildAllowed(label, { type: txnType, owesMe, iOwe, current: currentCategoryId, sharedBill }),
    [txnType, owesMe, iOwe, currentCategoryId, sharedBill],
  );
}
