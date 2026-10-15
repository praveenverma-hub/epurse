// =============================================================================
// useSettlePeople — the people a settlement of a given kind can close, from the
// ledger (getPersonBalances, grouped by person — never by raw name). Every settle
// picker uses this, so "who owes me" reads the same everywhere.
// =============================================================================
import { useCallback, useMemo } from 'react';
import { useEPurseStore } from '../store/ePurseStore';
import { openBalancePeople, type LbPerson } from '../utils/lbPeopleSearch';

export function useSettlePeople(): (kind: string | null | undefined) => LbPerson[] {
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed);
  const getPersonBalances = useEPurseStore((s: any) => s.getPersonBalances);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const people = useMemo(() => getPersonBalances() as LbPerson[], [lentBorrowed, getPersonBalances]);
  return useCallback((kind) => openBalancePeople(people, kind), [people]);
}
