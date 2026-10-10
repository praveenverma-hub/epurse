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
