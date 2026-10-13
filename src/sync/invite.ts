// =============================================================================
// Invite links (docs/SHARED_GROUP_SYNC.md §5). PURE.
//
//   https://epurse.co.in/join#i=<inviteId>&t=<token>&k=<groupKey>
//
// Everything sits in the #fragment, which is never sent to a web server. The app
// sends only `i` + `t` to Supabase (`redeem_invite`); `k` never leaves the phone.
// The key epoch isn't in the link: redeem_invite returns it.
// =============================================================================

import {
  GROUP_KEY_BYTES, randomUuid, isUuid, sha256Hex, toBase64Url, fromBase64Url, type RandomBytes,
} from './crypto';

export const INVITE_BASE = 'https://epurse.co.in/join';
const TOKEN_BYTES = 32;

export type NewInvite = { inviteId: string; token: string; tokenHashHex: string };
export type ParsedInvite = { inviteId: string; token: string; key: Uint8Array };

export function newInvite(rand: RandomBytes): NewInvite {
  const token = toBase64Url(rand(TOKEN_BYTES));
  return { inviteId: randomUuid(rand), token, tokenHashHex: sha256Hex(token) };
}

export const buildInviteLink = (inviteId: string, token: string, key: Uint8Array): string =>
  `${INVITE_BASE}#i=${inviteId}&t=${token}&k=${toBase64Url(key)}`;

/** null for anything that isn't a well-formed ePurse invite. */
export function parseInviteLink(url: string): ParsedInvite | null {
  if (typeof url !== 'string') return null;
  const hash = url.indexOf('#');
  if (hash < 0 || url.slice(0, hash).replace(/\/+$/, '') !== INVITE_BASE) return null;

  const params: Record<string, string> = {};
  for (const part of url.slice(hash + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const { i, t, k } = params;
  if (!isUuid(i) || !t || !k) return null;

  const tokenBytes = fromBase64Url(t);
  const key = fromBase64Url(k);
  if (!tokenBytes || tokenBytes.length !== TOKEN_BYTES || !key || key.length !== GROUP_KEY_BYTES) return null;
  return { inviteId: i, token: t, key };
}
