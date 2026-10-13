// Every failure the sync layer reports to a screen: a code to branch on, a message to show.
export type SyncErrorCode =
  | 'DISABLED' | 'SIGN_IN_FAILED' | 'DELETE_FAILED' | 'NETWORK' | 'SERVER'
  | 'NOT_MEMBER' | 'INVITE_INVALID' | 'INVITE_USED' | 'GROUP_ENDED' | 'GROUP_FULL'
  | 'NOT_SETTLED' | 'CLAIM_TAKEN' | 'LINK_DAMAGED' | 'NOT_ADMIN';

export class SyncError extends Error {
  code: SyncErrorCode;
  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
  }
}
