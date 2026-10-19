// =============================================================================
// Linking group members to THIS phone's contacts (Oct-17-26).
//
// Group members carry the name whoever added them typed and, on a joiner's phone, no
// contact — so "Rohit" in a group and the contact "Rohit Sharma" were two people in
// Lent/Borrowed. Three steps, most-automatic first:
//   1. Fingerprints (sync/phoneKey.ts): this phone hashes its contacts' numbers and links
//      every member whose fingerprint matches — no prompt, no step.
//   2. Name match: a member whose name is exactly one contact's / ledger person's name is
//      SUGGESTED (one tap), never linked silently — names aren't proof.
//   3. One reminder on the Members tab for the rest; "Not in My Contacts" stops it.
// =============================================================================

import type { Group, GroupMember } from '../types/group';
import { useEPurseStore } from '../store/ePurseStore';
import { fetchContactsForPicker } from '../services/contactsService';
import { toRemoteMember } from './localGroup';
import { cachedPhoneKey } from './phoneKey';
import { normalizePhone } from '../utils/validation';

export interface LinkCandidate { name: string; contactId: string | null; phone: string | null }

/**
 * Linked by contact id but missing my contact's name (picked before Oct-20-26) — or, with
 * `all`, every contact-linked member, so a contact renamed on this phone shows its new name.
 */
export const contactLinkedMembers = (group: Group | null | undefined, all = false): GroupMember[] =>
  group?.type === 'shared'
    // Past members too: their names still show on old expenses and in history.
    ? (group.members || []).filter((m) => !m.isMe && m.memberId !== 'me' && !!m.contactId && (all || !m.contactName))
    : [];

/** Members still to link: not me, not a past member, not linked, not marked "Not in My Contacts". */
export const unlinkedMembers = (group: Group | null | undefined): GroupMember[] =>
  group?.type === 'shared'
    ? (group.members || []).filter((m) => !m.isMe && m.memberId !== 'me' && !m.archived && !m.contactId && !m.phone && !m.noContact)
    : [];

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();

/** The ONE candidate whose name is exactly the member's — else null (a guess isn't a suggestion). */
export function suggestByName(member: Pick<GroupMember, 'name'>, candidates: LinkCandidate[]): LinkCandidate | null {
  const n = norm(member.name);
  if (!n) return null;
  const hits = candidates.filter((c) => norm(c.name) === n && (c.contactId || c.phone));
  return hits.length === 1 ? hits[0] : null;
}

const running = new Set<string>();
/** A call that arrived mid-run — run once more after, so a fingerprint landing then isn't lost. */
const again = new Map<string, boolean>();

/**
 * Step 1: link every unlinked member whose fingerprint matches one of my contacts. Needs
 * contacts permission ALREADY granted — never asks. Hashing is slow, so it yields to the
 * UI as it goes. Returns how many were linked.
 */
export async function autoLinkGroupMembers(groupId: string, { refreshNames = false }: { refreshNames?: boolean } = {}): Promise<number> {
  if (running.has(groupId)) {
    again.set(groupId, (again.get(groupId) ?? false) || refreshNames);
    return 0;
  }
  running.add(groupId);
  try {
    const group = (useEPurseStore.getState() as any).groups.find((g: Group) => g.id === groupId) as Group | undefined;
    const shared = group?.shared;
    if (!shared) return 0;
    const want = new Map<string, string>(); // fingerprint → local memberId
    for (const m of unlinkedMembers(group)) {
      const key = shared.fold.phoneKeys?.[toRemoteMember(shared, m.memberId)];
      if (key) want.set(key, m.memberId);
    }
    const byId = new Map(contactLinkedMembers(group, refreshNames).map((m) => [m.contactId!, m]));
    if (!want.size && !byId.size) return 0;
    const contacts = await fetchContactsForPicker();
    let linked = 0;
    let n = 0;
    for (const c of contacts) {
      const old = byId.get(c.id);
      if (old) {
        if (old.contactName !== c.name) {
          (useEPurseStore.getState() as any).linkGroupMemberContact(groupId, old.memberId, {
            contactId: c.id, phone: old.phone || normalizePhone(c.phones[0] || '') || null, name: c.name,
          });
          linked += 1;
        }
        byId.delete(c.id);
      }
      for (const phone of c.phones) {
        if (++n % 15 === 0) await new Promise((r) => setTimeout(r, 0));
        const memberId = want.get(cachedPhoneKey(shared.keys, phone) || '');
        if (!memberId) continue;
        (useEPurseStore.getState() as any).linkGroupMemberContact(groupId, memberId, { contactId: c.id, phone: normalizePhone(phone) || phone, name: c.name });
        want.delete(cachedPhoneKey(shared.keys, phone)!);
        linked += 1;
        if (!want.size && !byId.size) return linked;
      }
    }
    return linked;
  } finally {
    running.delete(groupId);
    if (again.has(groupId)) {
      const refresh = again.get(groupId)!;
      again.delete(groupId);
      void autoLinkGroupMembers(groupId, { refreshNames: refresh });
    }
  }
}
