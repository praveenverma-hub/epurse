// =============================================================================
// useAutoCategory — fills an entry form's Category from what the user types as
// the merchant (utils/categorySuggest), until the user picks one themselves.
// Shared by AddTransactionScreen and GroupExpenseForm.
//
//   • a match fills the category and marks it `isAuto` (the row shows "Auto")
//   • the text changing to something with no match clears an AUTO category —
//     never one the user chose
//   • `markManual()` (call it from the picker) stops auto-fill for this entry
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useEPurseStore } from '../store/ePurseStore';
import { LB_ALL_CATS } from '../constants/twoTierCategories';
import { buildCategoryHistory, suggestCategory } from '../utils/categorySuggest';

interface Options {
  merchant: string;
  /** Income entries only take Income categories; expenses never do. */
  isIncome: boolean;
  /** Off for edits and flows where the category is already decided. */
  enabled: boolean;
  /** Writes the category into the form ('' clears it). */
  apply: (parentCategory: string, childCategory: string) => void;
}

export function useAutoCategory({ merchant, isIncome, enabled, apply }: Options) {
  const transactions = useEPurseStore((s: any) => s.transactions);
  const userRules = useEPurseStore((s: any) => s.userCustomRules);

  const history = useMemo(
    () => buildCategoryHistory(transactions || [], (id) => LB_ALL_CATS.has(id ?? '')),
    [transactions],
  );

  const suggestion = useMemo(
    () =>
      suggestCategory(merchant, {
        history,
        userRules: userRules || undefined,
        // Transfers (self / P2P / Lent / Borrowed) carry their own semantics and
        // are never guessed; Income only for income, never for an expense.
        allowParent: (p) => p !== 'Transfers' && (isIncome ? p === 'Income' : p !== 'Income'),
      }),
    [merchant, history, userRules, isIncome],
  );

  const [isAuto, setIsAuto] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!enabled || touched) return;
    if (suggestion) {
      apply(suggestion.parentCategory, suggestion.childCategory);
      setIsAuto(true);
    } else if (isAuto) {
      apply('', '');
      setIsAuto(false);
    }
    // `apply` is a fresh closure each render — keyed on the suggestion itself.
  }, [suggestion?.parentCategory, suggestion?.childCategory, enabled, touched]);

  const markManual = useCallback(() => {
    setTouched(true);
    setIsAuto(false);
  }, []);

  /** For a form that stays mounted between entries (the group sheet). */
  const reset = useCallback(() => {
    setTouched(false);
    setIsAuto(false);
  }, []);

  return { isAuto: isAuto && !touched, markManual, reset };
}
