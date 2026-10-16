// The account a new manual entry starts on: the user's PRIMARY (the store
// guarantees exactly one via `ensurePrimary`), else the first live account.
interface AccountLike {
  id: string;
  primary?: boolean;
  archived?: boolean;
}

export const defaultAccountId = (accounts: AccountLike[]): string | null =>
  accounts.find((a) => a.primary && !a.archived)?.id
  ?? accounts.find((a) => !a.archived)?.id
  ?? null;

/**
 * Where an entry books while tracking is switched off (pickers hidden): the primary —
 * unless it's Cash, whose ₹0 floor would block entries against an account the user
 * can't see or fix; those save with no account instead.
 */
export const hiddenBookingAccountId = (accounts: (AccountLike & { type?: string })[]): string | null => {
  const id = defaultAccountId(accounts);
  return accounts.find((a) => a.id === id)?.type === 'Cash' ? null : id;
};
