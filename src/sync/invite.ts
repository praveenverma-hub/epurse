// =============================================================================
// Invite links (docs/SHARED_GROUP_SYNC.md §5). PURE.
//
//   https://epurse.co.in/join#i=<inviteId>&t=<token>&k=<groupKey>[&m=<memberId>]
//
// Tapped, it opens the app (Android App Links) — or, where that isn't set up, the
// /join page on epurse.co.in, which hands the same fragment to `epurse://join#…`.
//
// Everything sits in the #fragment, which is never sent to a web server. The app
// sends only `i` + `t` to Supabase (`redeem_invite`); `k` never leaves the phone.
// The key epoch isn't in the link: redeem_invite returns it. `m` (optional) is the
// person the link was made for — their phone claims that name without asking.
// =============================================================================

import {
  GROUP_KEY_BYTES, randomUuid, isUuid, sha256Hex, toBase64Url, fromBase64Url, type RandomBytes,
} from './crypto';

export const INVITE_BASE = 'https://epurse.co.in/join';
/** The same invite as the app's own scheme — what the /join web page opens. */
export const APP_INVITE_BASE = 'epurse://join';
const TOKEN_BYTES = 32;

export type NewInvite = { inviteId: string; token: string; tokenHashHex: string };
export type ParsedInvite = { inviteId: string; token: string; key: Uint8Array; memberId: string | null };

export function newInvite(rand: RandomBytes): NewInvite {
  const token = toBase64Url(rand(TOKEN_BYTES));
  return { inviteId: randomUuid(rand), token, tokenHashHex: sha256Hex(token) };
}

export const buildInviteLink = (inviteId: string, token: string, key: Uint8Array, memberId?: string | null): string =>
  `${INVITE_BASE}#i=${inviteId}&t=${token}&k=${toBase64Url(key)}${memberId ? `&m=${memberId}` : ''}`;

// The link inside whatever was pasted — usually the whole shared message, not just the link.
const LINK_IN_TEXT = /(?:https:\/\/epurse\.co\.in|epurse:\/)\/join\/*#[A-Za-z0-9_\-=&]+/;

/** null for anything that doesn't hold a well-formed ePurse invite (either form). */
export function parseInviteLink(text: string): ParsedInvite | null {
  if (typeof text !== 'string') return null;
  const url = text.match(LINK_IN_TEXT)?.[0];
  if (!url) return null;
  const hash = url.indexOf('#');
  const base = hash < 0 ? '' : url.slice(0, hash).replace(/\/+$/, '');
  if (base !== INVITE_BASE && base !== APP_INVITE_BASE) return null;

  const params: Record<string, string> = {};
  for (const part of url.slice(hash + 1).split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  const { i, t, k, m } = params;
  if (!isUuid(i) || !t || !k || (m !== undefined && !isUuid(m))) return null;

  const tokenBytes = fromBase64Url(t);
  const key = fromBase64Url(k);
  if (!tokenBytes || tokenBytes.length !== TOKEN_BYTES || !key || key.length !== GROUP_KEY_BYTES) return null;
  return { inviteId: i, token: t, key, memberId: m ?? null };
}
