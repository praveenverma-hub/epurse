// =============================================================================
// "Always for this payee" — a category the user picks once for an SMS payee, saved as a
// merchant rule (store `userCustomRules`, keyed like merchantEnricher looks it up) so the
// payee's next SMS lands there by itself. Mostly people paid by UPI: the maid, the
// milkman, the tutor — they arrive as P2P transfers every month otherwise. PURE.
// =============================================================================
import { sanitizeRawMerchant, type UserRule } from './merchantEnricher';

type TxnLike = {
  source?: string;
  type?: string;
  isRefund?: boolean;
  isGroupMemo?: boolean;
  syncOrigin?: string;
  rawMerchant?: string;
  merchant?: string;
};

type DraftLike = {
  parentCategory?: string;
  childCategory?: string;
  specialCategory?: string | null;
  isIgnored?: boolean;
};

/** The rule key for a bank-SMS transaction ('' = this one can't have a rule). */
export const payeeRuleKey = (txn: TxnLike | null | undefined): string =>
  txn && txn.source === 'sms' && !txn.isGroupMemo && txn.syncOrigin !== 'remote'
    ? sanitizeRawMerchant(txn.rawMerchant || txn.merchant)
    : '';

export const payeeRuleFor = (txn: TxnLike | null | undefined, rules?: Record<string, UserRule> | null): UserRule | null => {
  const key = payeeRuleKey(txn);
  return (key && rules?.[key]) || null;
};

/** A plain category pick on an SMS payee — never Transfers (self/P2P/lend need their own flows). */
export const canRememberCategory = (txn: TxnLike | null | undefined, draft: DraftLike): boolean =>
  !!payeeRuleKey(txn) && !!draft.parentCategory && !!draft.childCategory
  && draft.parentCategory !== 'Transfers' && !draft.specialCategory && !draft.isIgnored;

/**
 * A rule only fits money moving its way: an Income rule on money in, any other on money
 * out (or a refund, which keeps its purchase category). The salary payer's rule must
 * never turn a payment TO them into income.
 */
export const ruleFitsDirection = (parentCategory: string, txn: TxnLike): boolean =>
  parentCategory === 'Income'
    ? txn.type === 'credit' && !txn.isRefund
    : txn.type !== 'credit' || !!txn.isRefund;
