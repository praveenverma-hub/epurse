// =============================================================================
// Server calls for shared-group sync — one function per RPC in
// supabase/migrations/. Reads go through row-level security; every write is a
// security-definer function. Errors come back as SyncError with a message a
// screen can show as-is.
// =============================================================================

import type * as TClient from './client';
import { SyncError } from './errors';

// Same lazy load as session.ts: supabase-js only for users who share.
const sb = () => (require('./client') as typeof TClient).getSupabase();

export type SealedRow = { event_id: string; key_epoch: number; nonce: string; ciphertext: string };

export type EventRow = {
  seq: number;
  event_id: string;
  author_id: string | null;
  key_epoch: number | null;
  nonce: string | null;
  ciphertext: string | null;
  system_type: string | null;
  system_subject: string | null;
  /** On `member_joined`: the member the invite was for (20261024000000_audit_fixes.sql). */
  system_member?: string | null;
  created_at: string;
};

// The server raises these messages (see the migrations); anything else is generic.
const KNOWN: [RegExp, SyncError['code'], string][] = [
  [/not a member/, 'NOT_MEMBER', 'You are no longer in this group.'],
  [/invalid invite/, 'INVITE_INVALID', 'This invite link isn\'t valid.'],
  [/invite expired or used/, 'INVITE_USED', 'This invite link has expired or was already used. Ask for a new one.'],
  [/group has ended/, 'GROUP_ENDED', 'This group is no longer shared.'],
  [/group is full/, 'GROUP_FULL', 'This group already has 50 people using the app, the most it can have.'],
  [/member has too many groups/, 'GROUP_FULL', 'They\'re already in the most shared groups allowed (100).'],
  [/not a former member/, 'NOT_MEMBER', 'Couldn\'t add them back. Send them a new invite instead.'],
  [/too many groups/, 'GROUP_FULL', 'You\'re in the most shared groups allowed (100). Leave one first.'],
  [/too many open invites/, 'TOO_MANY_INVITES', 'This group has 20 invite links nobody has used yet. Wait for one to be used or expire (48 hours).'],
  [/stale key epoch/, 'SERVER', 'This group changed on another phone. Try again in a moment.'],
  [/not signed in|JWT|jwt/, 'SIGN_IN_FAILED', 'You\'re signed out of group sharing. Open the app again to sign back in.'],
  [/bad request|batch must hold|event id in use|bad push token/, 'SERVER', 'This change couldn\'t be sent. Update the app, then try again.'],
];

/** The error a screen shows for a server message (also used by the test server). */
export function syncErrorFor(msg: string): SyncError {
  for (const [re, code, text] of KNOWN) if (re.test(msg)) return new SyncError(code, text);
  if (/fetch|network|timed? ?out/i.test(msg)) {
    return new SyncError('NETWORK', 'Couldn\'t reach the server. Check your connection and try again.');
  }
  return new SyncError('SERVER', 'Something went wrong on our side. Try again.');
}

function fail(error: { message?: string } | null): never {
  throw syncErrorFor(error?.message ?? '');
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await sb().rpc(fn, args);
  } catch (e) {
    fail(e as Error);
  }
  if (res.error) fail(res.error);
  return res.data as T;
}

export const rpcCreateGroup = (groupId: string) => rpc<void>('create_group', { p_group_id: groupId });

export const rpcAppendEvents = (groupId: string, events: SealedRow[]) =>
  rpc<{ r_event_id: string; r_seq: number }[]>('append_events', { p_group_id: groupId, p_events: events });

export const rpcAppendCheckpoint = (groupId: string, baseSeq: number, event: SealedRow) =>
  rpc<boolean>('append_checkpoint', { p_group_id: groupId, p_base_seq: baseSeq, p_event: event });

/** Returns when the invite stops working. `memberId` = the group member it's for (null = a new person). */
export const rpcCreateInvite = (inviteId: string, groupId: string, tokenHashHex: string, memberId: string | null = null) =>
  rpc<string>('create_invite', { p_invite_id: inviteId, p_group_id: groupId, p_token_hash: tokenHashHex, p_member_id: memberId });

/** `memberId` = who the INVITER said this is for — the server's word, not the link's. */
export async function rpcRedeemInvite(inviteId: string, token: string) {
  const rows = await rpc<{ r_group_id: string; r_key_epoch: number; r_last_seq: number; r_member_id: string | null }[]>(
    'redeem_invite', { p_invite_id: inviteId, p_token: token },
  );
  if (!rows?.length) throw new SyncError('INVITE_INVALID', 'This invite link isn\'t valid.');
  return { groupId: rows[0].r_group_id, keyEpoch: rows[0].r_key_epoch, lastSeq: rows[0].r_last_seq, memberId: rows[0].r_member_id ?? null };
}

export const rpcLeaveGroup = (groupId: string) => rpc<void>('leave_group', { p_group_id: groupId });
export const rpcRemoveMember = (groupId: string, userId: string) =>
  rpc<void>('remove_member', { p_group_id: groupId, p_user_id: userId });

/** My phone checked the group's latest checkpoint against its full history and it matched. */
export const rpcAckCheckpoint = (groupId: string, seq: number) =>
  rpc<boolean>('ack_checkpoint', { p_group_id: groupId, p_seq: seq });

export const rpcReaddMember = (groupId: string, userId: string) =>
  rpc<void>('readd_member', { p_group_id: groupId, p_user_id: userId });

export const rpcRegisterPushToken = (token: string) => rpc<void>('register_push_token', { p_token: token });
export const rpcUnregisterPushToken = (token: string) => rpc<void>('unregister_push_token', { p_token: token });

/** A session already on this phone — never signs in (for background work like push and realtime). */
export const hasSyncSession = async (): Promise<boolean> => !!(await sb().auth.getSession()).data.session;

export async function fetchEvents(groupId: string, afterSeq: number, limit = 500): Promise<EventRow[]> {
  let res;
  try {
    res = await sb().from('group_events')
      .select('seq,event_id,author_id,key_epoch,nonce,ciphertext,system_type,system_subject,system_member,created_at')
      .eq('group_id', groupId).gt('seq', afterSeq).order('seq', { ascending: true }).limit(limit);
  } catch (e) {
    fail(e as Error);
  }
  if (res.error) fail(res.error);
  return (res.data ?? []) as EventRow[];
}

/** Server ids of the groups I'm still in (expired ones are hidden by row-level security). */
export async function fetchMyGroupIds(userId: string): Promise<Set<string>> {
  let res;
  try {
    res = await sb().from('group_members').select('group_id').eq('user_id', userId);
  } catch (e) {
    fail(e as Error);
  }
  if (res.error) fail(res.error);
  return new Set((res.data ?? []).map((r: { group_id: string }) => r.group_id));
}
