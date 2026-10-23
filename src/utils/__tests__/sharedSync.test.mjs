import { readFileSync } from 'node:fs';
// =============================================================================
// Shared-group sync — crypto, invite links, event parsing, fold rules
//     npm run test:sync
// docs/SHARED_GROUP_SYNC.md §5–§8a. All pure: no Supabase, no device.
// =============================================================================
import {
  generateGroupKey, randomUuid, isUuid, sealEvent, openEvent, sha256Hex, toBase64Url, fromBase64Url,
} from '../../sync/crypto.ts';
import { newInvite, buildInviteLink, parseInviteLink, INVITE_BASE, APP_INVITE_BASE } from '../../sync/invite.ts';
import { encodeEvent, parseEvent, V1_LIMITS } from '../../sync/events.ts';
import { emptyFold, foldEvents, buildCheckpoint, buildCorrection, debtList, frozenTag, sameCheckpoint } from '../../sync/fold.ts';
import { membersFromFold, planGroupChanges, toLocalMember, toRemoteMember, unclaimedMembers, metaOf, memberBalancePaise, memberStatus } from '../../sync/localGroup.ts';
import { projectExpense, planOutgoing, planIncoming, reconcileOutbox, skippedBySend, UNSENDABLE } from '../../sync/expenses.ts';
import { checkpointDue } from '../../sync/checkpoint.ts';
import { lbRowMember } from '../../sync/settlements.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};

// Seeded, so a failure is reproducible. The app injects expo-crypto's CSPRNG.
// High bits only: an LCG's low byte repeats every 256 outputs, which made "random" ids collide.
let seed = 7;
const rand = (n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[i] = (seed >>> 16) & 0xff; }
  return out;
};

console.log('\n— crypto —');
{
  // Hermes has neither: prove the crypto path never needs them (the backup suite's lesson).
  const TE = globalThis.TextEncoder, TD = globalThis.TextDecoder;
  delete globalThis.TextEncoder; delete globalThis.TextDecoder;
  try {
    const key = generateGroupKey(rand);
    const g = randomUuid(rand), e = randomUuid(rand);
    const sealed = sealEvent(key, g, e, 1, 'Dinner ₹3,000 — गोवा', rand);
    check('round-trips unicode without TextEncoder/TextDecoder', openEvent(key, g, e, 1, sealed) === 'Dinner ₹3,000 — गोवा');
    check('nonce is 24 bytes (32 base64 chars, matches the server check)', sealed.nonce.length === 32);
    check('wrong key → null', openEvent(generateGroupKey(rand), g, e, 1, sealed) === null);
    check('moved to another group → null', openEvent(key, randomUuid(rand), e, 1, sealed) === null);
    check('replayed under another event id → null', openEvent(key, g, randomUuid(rand), 1, sealed) === null);
    check('other key epoch → null', openEvent(key, g, e, 2, sealed) === null);
    const flipped = sealed.ciphertext[0] === 'A' ? 'B' + sealed.ciphertext.slice(1) : 'A' + sealed.ciphertext.slice(1);
    check('tampered ciphertext → null', openEvent(key, g, e, 1, { ...sealed, ciphertext: flipped }) === null);
    check('garbage nonce → null, no throw', openEvent(key, g, e, 1, { nonce: 'xx', ciphertext: sealed.ciphertext }) === null);
    const again = sealEvent(key, g, e, 1, 'Dinner ₹3,000 — गोवा', rand);
    check('fresh nonce per seal', again.nonce !== sealed.nonce && again.ciphertext !== sealed.ciphertext);
  } finally {
    globalThis.TextEncoder = TE; globalThis.TextDecoder = TD;
  }
  check('sha256Hex matches the standard "abc" vector',
    sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const ids = Array.from({ length: 50 }, () => randomUuid(rand));
  check('randomUuid makes valid, distinct v4 uuids', ids.every(isUuid) && new Set(ids).size === 50 && ids.every((u) => u[14] === '4'));
  const bytes = rand(32);
  const back = fromBase64Url(toBase64Url(bytes));
  check('base64url round-trips with no + / =', !/[+/=]/.test(toBase64Url(bytes)) && back.every((b, i) => b === bytes[i]));
  check('base64url rejects other characters', fromBase64Url('ab+c') === null);
}

console.log('\n— invite links —');
{
  const key = generateGroupKey(rand);
  const inv = newInvite(rand);
  const link = buildInviteLink(inv.inviteId, inv.token, key);
  const parsed = parseInviteLink(link);
  check('link round-trips id, token and key', parsed && parsed.inviteId === inv.inviteId && parsed.token === inv.token
    && parsed.key.every((b, i) => b === key[i]), link);
  check('everything secret is after the #', link.startsWith(`${INVITE_BASE}#`) && !link.slice(0, link.indexOf('#')).includes(inv.token));
  check('token hash is what the server compares', inv.tokenHashHex === sha256Hex(inv.token) && inv.tokenHashHex.length === 64);
  check('another host → rejected', parseInviteLink(link.replace('epurse.co.in', 'epurse.co.evil')) === null);
  const appForm = APP_INVITE_BASE + link.slice(link.indexOf('#'));
  check('the app-scheme form (from the /join page) parses the same', JSON.stringify(parseInviteLink(appForm)) === JSON.stringify(parsed));
  check('…but not another scheme or path', parseInviteLink(appForm.replace('epurse://', 'evil://')) === null && parseInviteLink(appForm.replace('://join', '://joinx')) === null);
  check('query string instead of fragment → rejected', parseInviteLink(link.replace('#', '?')) === null);
  check('short key → rejected', parseInviteLink(link.replace(/k=[^&]+/, 'k=AAAA')) === null);
  check('bad invite id → rejected', parseInviteLink(link.replace(/i=[^&]+/, 'i=not-a-uuid')) === null);
  check('missing token → rejected', parseInviteLink(link.replace(/&t=[^&]+/, '')) === null);
  check('not a string → rejected', parseInviteLink(undefined) === null);
  const same = (x) => JSON.stringify(parseInviteLink(x)) === JSON.stringify(parsed);
  check('the whole shared message pasted (not just the link) parses the same', same(`Join "Goa" on ePurse: ${link}`));
  check('…with text, a full stop or a newline after it too', same(`Join here: ${link}. See you!`) && same(`${link}\nThanks`));
  check('a link on another host inside a message → rejected', parseInviteLink(`Join: ${link.replace('epurse.co.in', 'epurse.co.evil')}`) === null);
  check('a generic link has no person', parsed.memberId === null);
  const forPriya = randomUuid(rand);
  const personal = parseInviteLink(buildInviteLink(inv.inviteId, inv.token, key, forPriya));
  check('a link made for one person carries who', personal?.memberId === forPriya && personal.inviteId === inv.inviteId);
  check('…in the fragment, never the part a server sees', !buildInviteLink(inv.inviteId, inv.token, key, forPriya).split('#')[0].includes(forPriya));
  check('a malformed person id → rejected', parseInviteLink(`${link}&m=not-a-uuid`) === null);
  const named = buildInviteLink(inv.inviteId, inv.token, key, forPriya, 'Priyā Śharma');
  check('a person\'s link carries their name (any script), for the Join screen', parseInviteLink(named)?.name === 'Priyā Śharma' && parseInviteLink(named).memberId === forPriya);
  check('…still found inside a pasted message', parseInviteLink(`Join "Goa": ${named} thanks`)?.name === 'Priyā Śharma');
  check('a name that doesn\'t decode is just not shown — the invite still works', parseInviteLink(`${buildInviteLink(inv.inviteId, inv.token, key, forPriya)}&n=@@`)?.name === null
    && parseInviteLink(`${buildInviteLink(inv.inviteId, inv.token, key, forPriya)}&n=_w`)?.name === null);
  check('no name without a person, and none on a generic link', parseInviteLink(`${link}&n=UHJpeWE`)?.name === null && parsed.name === null);
}

// ── fold scenario: Goa trip, Rahul (admin), Priya, Amit ──
const U = { rahul: randomUuid(rand), priya: randomUuid(rand), amit: randomUuid(rand), outsider: randomUuid(rand) };
const M = { rahul: randomUuid(rand), priya: randomUuid(rand), amit: randomUuid(rand), dev: randomUuid(rand) };
let seq = 0;
const serverTime = (n) => new Date(Date.UTC(2026, 9, 13, 10, n)).toISOString();
const sys = (type, subject) => {
  seq += 1;
  return { seq, eventId: randomUuid(rand), authorId: null, systemType: type, systemSubject: subject, plaintext: null, createdAt: serverTime(seq) };
};
const data = (author, event) => {
  seq += 1;
  return {
    seq, eventId: randomUuid(rand), authorId: author, systemType: null, systemSubject: null,
    plaintext: encodeEvent(event, '2026-10-13T10:00:00.000Z'), createdAt: serverTime(seq),
  };
};
const expense = (entityId, amountPaise, paidBy, shares, title = 'Dinner') =>
  ({ type: 'expense.upsert', entityId, amountPaise, title, categoryId: 'food', date: '2026-10-13', paidBy, shares });
const equal3 = (amount) => [M.rahul, M.priya, M.amit].map((m, i) => ({ memberId: m, paise: Math.floor(amount / 3) + (i < amount % 3 ? 1 : 0) }));

console.log('\n— invite QR code —');
{
  // Hermes has no TextEncoder: the vendored encoder must load and run without it.
  const TE = globalThis.TextEncoder;
  delete globalThis.TextEncoder;
  let qr;
  try {
    qr = (await import('../../utils/qr/index.ts')).qrMatrix;
    const link = buildInviteLink(randomUuid(rand), toBase64Url(rand(32)), generateGroupKey(rand), randomUuid(rand));
    const m = qr(link);
    check('encodes an invite link without TextEncoder (57×57 at level M)', m.size === 57 && m.modules.length === 57 * 57, String(m.size));
    const dark = (x, y) => m.modules[y * m.size + x] === 1;
    const finder = (ox, oy) => [0, 6].every((i) => [0, 1, 2, 3, 4, 5, 6].every((j) => dark(ox + i, oy + j) && dark(ox + j, oy + i))) && dark(ox + 3, oy + 3) && !dark(ox + 1, oy + 1);
    check('…with the three finder squares in place', finder(0, 0) && finder(m.size - 7, 0) && finder(0, m.size - 7));
    globalThis.TextEncoder = TE;
    const original = (await import('toqr')).toQR(link, 0);
    check('…module-for-module the same as upstream toqr', original.length === m.modules.length && original.every((v, i) => v === m.modules[i]));
  } finally {
    globalThis.TextEncoder = TE;
  }
}

console.log('\n— event parsing —');
{
  const ok = parseEvent(encodeEvent(expense(randomUuid(rand), 300000, M.rahul, equal3(300000)), 'x'));
  check('valid expense parses', ok && ok.event.type === 'expense.upsert' && ok.event.shares.length === 3);
  check('shares must sum to the amount', parseEvent(encodeEvent(expense(randomUuid(rand), 300000, M.rahul, equal3(299999)), 'x')) === null);
  check('fractional paise rejected', parseEvent(encodeEvent(expense(randomUuid(rand), 100.5, M.rahul, [{ memberId: M.rahul, paise: 100.5 }]), 'x')) === null);
  check('over ₹10 crore rejected', parseEvent(encodeEvent(expense(randomUuid(rand), V1_LIMITS.MAX_PAISE + 1, M.rahul, [{ memberId: M.rahul, paise: V1_LIMITS.MAX_PAISE + 1 }]), 'x')) === null);
  check('duplicate member in shares rejected', parseEvent(encodeEvent(expense(randomUuid(rand), 200, M.rahul, [{ memberId: M.rahul, paise: 100 }, { memberId: M.rahul, paise: 100 }]), 'x')) === null);
  check('settlement to self rejected', parseEvent(encodeEvent({ type: 'settlement.upsert', entityId: randomUuid(rand), from: M.priya, to: M.priya, amountPaise: 100, date: '2026-10-13' }, 'x')) === null);
  check('unknown type rejected', parseEvent(JSON.stringify({ v: 1, at: 'x', type: 'expense.merge' })) === null);
  check('other version rejected', parseEvent(JSON.stringify({ v: 2, at: 'x', type: 'member.archive', memberId: M.amit })) === null);
  check('not JSON rejected', parseEvent('{oops') === null && parseEvent(null) === null);
  const extra = parseEvent(JSON.stringify({ v: 1, at: 'x', type: 'member.add', memberId: M.dev, name: 'Dev', phone: '9999999999' }));
  check('unknown fields are dropped, not kept', extra && !('phone' in extra.event));
  check('blank name rejected', parseEvent(encodeEvent({ type: 'member.add', memberId: M.dev, name: '   ' }, 'x')) === null);
}

console.log('\n— fold: trip balances —');
const dinner = randomUuid(rand), cab = randomUuid(rand);
const base = [
  sys('group_created', U.rahul),
  data(U.rahul, { type: 'group.meta', name: 'Goa Trip', emoji: '🏖️', color: '#7C3AED' }),
  data(U.rahul, { type: 'member.add', memberId: M.rahul, name: 'Rahul' }),
  data(U.rahul, { type: 'member.add', memberId: M.priya, name: 'Priya' }),
  data(U.rahul, { type: 'member.add', memberId: M.amit, name: 'Amit' }),
  data(U.rahul, { type: 'member.claim', memberId: M.rahul, userId: U.rahul }),
  sys('member_joined', U.priya),
  data(U.priya, { type: 'member.claim', memberId: M.priya, userId: U.priya }),
  sys('member_joined', U.amit),
  data(U.amit, { type: 'member.claim', memberId: M.amit, userId: U.amit }),
  data(U.rahul, expense(dinner, 300000, M.rahul, equal3(300000))),
  data(U.priya, expense(cab, 90000, M.priya, equal3(90000), 'Cab')),
];
let { fold: f, rejected } = foldEvents(emptyFold(), base);
check('setup applies cleanly', rejected.length === 0, JSON.stringify(rejected));
check('meta + members + claims', f.meta.name === 'Goa Trip' && f.memberOrder.length === 3 && f.members[M.priya].userId === U.priya);
check('Rahul is owed ₹2,000 − ₹300 = ₹1,700', f.balances[M.rahul] === 300000 - 100000 - 30000, String(f.balances[M.rahul]));
check('Priya owes ₹1,000 − ₹600 = ₹400', f.balances[M.priya] === -100000 + 90000 - 30000, String(f.balances[M.priya]));
check('Amit owes ₹1,300', f.balances[M.amit] === -130000, String(f.balances[M.amit]));
check('balances always sum to zero', Object.values(f.balances).reduce((a, b) => a + b, 0) === 0);
check('cursor = last seq', f.seq === seq);

console.log('\n— fold: determinism + idempotency —');
{
  const phoneA = foldEvents(emptyFold(), base).fold;
  const phoneB = foldEvents(foldEvents(emptyFold(), base.slice(0, 7)).fold, base.slice(7)).fold;
  const shuffled = foldEvents(emptyFold(), [...base].reverse()).fold;
  check('one batch vs two batches → identical state', JSON.stringify(phoneA) === JSON.stringify(phoneB));
  check('arrival order doesn\'t matter (seq does)', JSON.stringify(phoneA) === JSON.stringify(shuffled));
  const replay = foldEvents(phoneA, base);
  check('re-pulling the same events changes nothing', JSON.stringify(replay.fold) === JSON.stringify(phoneA) && replay.rejected.length === 0);
  const before = JSON.stringify(f);
  foldEvents(f, [data(U.rahul, expense(randomUuid(rand), 600, M.rahul, equal3(600)))]);
  check('never mutates the input fold', JSON.stringify(f) === before);
}

console.log('\n— fold: rules —');
const step = (ev) => { const r = foldEvents(f, [ev]); f = r.fold; return r.rejected[0]?.reason ?? null; };
const snapshot = () => JSON.stringify(f.balances);

{
  check('any member can edit; balances move by the difference', step(data(U.priya, expense(dinner, 330000, M.rahul, equal3(330000)))) === null
    && f.balances[M.rahul] === 330000 - 110000 - 30000);
  const priyaSeq = seq;
  check('…creator is unchanged by someone else\'s edit', f.entries[dinner].createdBy === U.rahul);
  check('…and the history keeps both versions with who and when',
    f.entries[dinner].versions.length === 2
    && f.entries[dinner].versions[0].by === U.rahul && f.entries[dinner].versions[0].data.amountPaise === 300000
    && f.entries[dinner].versions[1].by === U.priya && f.entries[dinner].versions[1].at === serverTime(priyaSeq));
  // Two edits made at the same time: the later seq wins on every phone (choice B — overwrite).
  const amitEdit = data(U.amit, expense(dinner, 360000, M.rahul, equal3(360000)));
  const rahulEdit = data(U.rahul, expense(dinner, 345000, M.rahul, equal3(345000)));
  const one = foldEvents(f, [amitEdit, rahulEdit]).fold, other = foldEvents(f, [rahulEdit, amitEdit]).fold;
  check('concurrent edits: last by seq wins, the same on every phone',
    one.entries[dinner].data.amountPaise === 345000 && JSON.stringify(one) === JSON.stringify(other));
  check('…the overwritten edit is still in the history', one.entries[dinner].versions.some((v) => v.by === U.amit && v.data.amountPaise === 360000));
  check('back to ₹3,300 for the next tests', step(data(U.rahul, expense(dinner, 330000, M.rahul, equal3(330000)))) === null
    && f.entries[dinner].data.amountPaise === 330000);
  check('outsider (not a member) rejected', step(data(U.outsider, expense(randomUuid(rand), 300, M.rahul, equal3(300)))) === 'not_member');
  check('unreadable ciphertext rejected', step({ ...data(U.rahul, expense(randomUuid(rand), 300, M.rahul, equal3(300))), plaintext: null }) === 'unreadable');
  check('unknown member in shares rejected', step(data(U.rahul, expense(randomUuid(rand), 300, M.rahul, [{ memberId: M.dev, paise: 300 }]))) === 'unknown_member');
  check('claiming for someone else rejected', step(data(U.rahul, { type: 'member.claim', memberId: M.amit, userId: U.amit })) === 'claim_for_other');
  check('claiming a second member rejected', (step(data(U.priya, { type: 'member.add', memberId: M.dev, name: 'Dev' })) === null)
    && step(data(U.priya, { type: 'member.claim', memberId: M.dev, userId: U.priya })) === 'claimed_twice');
  check('archiving someone who owes rejected', step(data(U.rahul, { type: 'member.archive', memberId: M.amit })) === 'not_settled');
}

{
  // Amit settles everything, then leaves.
  const owes = -f.balances[M.amit];
  check('settlement applies', step(data(U.amit, { type: 'settlement.upsert', entityId: randomUuid(rand), from: M.amit, to: M.rahul, amountPaise: owes, date: '2026-10-14' })) === null
    && (f.balances[M.amit] ?? 0) === 0);
  check('archive at ₹0 applies', step(data(U.amit, { type: 'member.archive', memberId: M.amit })) === null && f.members[M.amit].archived);
  check('archived member can\'t join a NEW expense', step(data(U.rahul, expense(randomUuid(rand), 300, M.rahul, equal3(300)))) === 'archived_member');
  const b = snapshot();
  check('…but the OLD dinner still lists them and can be edited', step(data(U.rahul, expense(dinner, 330000, M.rahul, equal3(330000), 'Dinner at Thalassa'))) === null
    && snapshot() === b && f.entries[dinner].data.shares.some((s) => s.memberId === M.amit));
  check('…but not its amount: that would move a balance of someone who left',
    step(data(U.rahul, expense(dinner, 360000, M.rahul, equal3(360000), 'Dinner at Thalassa'))) === 'past_member' && snapshot() === b);
  check('…nor can it be deleted', step(data(U.rahul, { type: 'expense.delete', entityId: dinner })) === 'past_member' && snapshot() === b);
  const frozenF = { ...f, entries: { ...f.entries, [dinner]: { ...f.entries[dinner], frozen: true } }, frozenTags: { ...f.frozenTags, [frozenTag(dinner)]: 'e' } };
  const fix = buildCorrection(frozenF, randomUuid(rand), dinner, { ...f.entries[dinner].data, amountPaise: 360000, shares: equal3(360000) });
  check('…nor corrected once frozen', fix && fix.debts.some((d) => d.from === M.amit || d.to === M.amit)
    && foldEvents(frozenF, [data(U.rahul, { type: "expense.correct", ...fix })]).rejected[0]?.reason === 'past_member');
  step(sys('member_left', U.amit));
  check('history keeps Amit after he leaves', f.members[M.amit].name === 'Amit' && !f.activeUsers.includes(U.amit));
  check('a member who left can\'t send events', step(data(U.amit, { type: 'member.rename', memberId: M.amit, name: 'A' })) === 'not_member');
  // Amit comes back with a new invite (a copy of the fold — later tests need him gone).
  const back = foldEvents(f, [sys('member_joined', U.amit)]);
  check('rejoining: the same member again, un-archived, in the group',
    back.rejected.length === 0 && !back.fold.members[M.amit].archived && back.fold.members[M.amit].userId === U.amit && back.fold.activeUsers.includes(U.amit));
  const again = foldEvents(back.fold, [data(U.rahul, expense(randomUuid(rand), 300, M.rahul, equal3(300)))]);
  check('…and can be put in new expenses again', again.rejected.length === 0);
}

{
  const lunch = randomUuid(rand);
  step(data(U.priya, expense(lunch, 2000, M.priya, [{ memberId: M.priya, paise: 1000 }, { memberId: M.rahul, paise: 1000 }])));
  const b = snapshot();
  check('any member deletes (not only its creator); balances reverse exactly', step(data(U.rahul, { type: 'expense.delete', entityId: lunch })) === null
    && f.balances[M.priya] === JSON.parse(b)[M.priya] - 1000);
  check('…the delete records who and when', f.entries[lunch].deleted?.by === U.rahul && f.entries[lunch].deleted?.at === serverTime(seq));
  check('delete wins: a later edit is rejected', step(data(U.priya, expense(lunch, 4000, M.priya, [{ memberId: M.priya, paise: 4000 }]))) === 'deleted');
  check('deleting twice rejected', step(data(U.priya, { type: 'expense.delete', entityId: lunch })) === 'unknown_entry');
  check('expense id can\'t be reused as a settlement', step(data(U.rahul, { type: 'settlement.upsert', entityId: dinner, from: M.priya, to: M.rahul, amountPaise: 100, date: '2026-10-14' })) === 'wrong_kind');
}

{
  // Priya deletes her account: her events stay; anyone may now remove her entries.
  const snack = randomUuid(rand);
  step(data(U.priya, expense(snack, 600, M.priya, [{ memberId: M.priya, paise: 300 }, { memberId: M.rahul, paise: 300 }])));
  const b = snapshot();
  step(sys('member_deleted', U.priya));
  check('account deletion changes no balance (history intact)', snapshot() === b && f.deletedUsers.includes(U.priya));
  check('…and her expense can now be deleted by another member', step(data(U.rahul, { type: 'expense.delete', entityId: snack })) === null);
  check('balances still sum to zero after everything', Object.values(f.balances).reduce((a, x) => a + x, 0) === 0);
}

// ── checkpoints: a fresh group ──
console.log('\n— checkpoints —');
seq = 0;
// What every phone must agree on (frozen history and the cursor may differ by design).
const shared = (x) => JSON.stringify({
  meta: x.meta, members: x.memberOrder.map((id) => [id, x.members[id]]),
  active: [...x.activeUsers].sort(), deleted: [...x.deletedUsers].sort(),
  debts: debtList(x.debts), balances: Object.keys(x.balances).sort().map((k) => [k, x.balances[k]]),
  live: Object.keys(x.entries).filter((k) => !x.entries[k].frozen).sort().map((k) => [k, x.entries[k].data, x.entries[k].deleted]),
});
const balancesFromDebts = (x) => {
  const b = {};
  for (const d of debtList(x.debts)) { b[d.to] = (b[d.to] ?? 0) + d.paise; b[d.from] = (b[d.from] ?? 0) - d.paise; }
  return Object.keys(b).filter((k) => b[k] !== 0).sort().map((k) => [k, b[k]]);
};
const checkpointEvent = (author, fold) => data(author, { type: 'group.checkpoint', ...buildCheckpoint(fold) });

{
  const hotel = randomUuid(rand), fuel = randomUuid(rand);
  const setup = [
    sys('group_created', U.rahul),
    data(U.rahul, { type: 'group.meta', name: 'Manali', emoji: null, color: null }),
    data(U.rahul, { type: 'member.add', memberId: M.rahul, name: 'Rahul' }),
    data(U.rahul, { type: 'member.add', memberId: M.priya, name: 'Priya' }),
    data(U.rahul, { type: 'member.add', memberId: M.amit, name: 'Amit' }),
    data(U.rahul, { type: 'member.claim', memberId: M.rahul, userId: U.rahul }),
    sys('member_joined', U.priya),
    data(U.priya, { type: 'member.claim', memberId: M.priya, userId: U.priya }),
    // Hotel split only between Rahul and Priya — Amit was left out by mistake.
    data(U.rahul, expense(hotel, 600000, M.rahul, [{ memberId: M.rahul, paise: 300000 }, { memberId: M.priya, paise: 300000 }], 'Hotel')),
    data(U.priya, expense(fuel, 90000, M.priya, equal3(90000), 'Fuel')),
  ];
  const full = foldEvents(emptyFold(), setup).fold;
  check('per-person debts match balances', JSON.stringify(balancesFromDebts(full)) === JSON.stringify(Object.keys(full.balances).sort().map((k) => [k, full.balances[k]])));
  check('debts: Priya owes Rahul ₹3,000 − ₹300, Amit owes Priya ₹300',
    JSON.stringify(debtList(full.debts).map((d) => [d.from, d.to, d.paise]).sort()) === JSON.stringify([[M.priya, M.rahul, 270000], [M.amit, M.priya, 30000]].sort()));

  const cp = checkpointEvent(U.rahul, full);
  const historyPhone = foldEvents(full, [cp]);
  check('phone with history verifies the checkpoint', historyPhone.rejected.length === 0 && historyPhone.fold.checkpointMismatch === null, JSON.stringify(historyPhone.rejected));
  check('…and freezes every earlier entry', Object.values(historyPhone.fold.entries).every((x) => x.frozen));
  // Server compacted: a late joiner only ever receives the checkpoint onwards.
  const joiner = foldEvents(emptyFold(), [cp]);
  check('late joiner adopts it (missing history)', joiner.rejected.length === 0 && joiner.fold.historyFrom === cp.seq);
  check('…and has the same people, debts and balances', shared(joiner.fold) === shared(historyPhone.fold), shared(joiner.fold));
  check('…with no old expenses', Object.keys(joiner.fold.entries).length === 0);

  // Fresh start after the checkpoint: same group, nothing re-uploaded.
  const snack = randomUuid(rand);
  const after = [sys('member_joined', U.amit), data(U.amit, { type: 'member.claim', memberId: M.amit, userId: U.amit }),
    data(U.amit, expense(snack, 30000, M.amit, equal3(30000), 'Snacks'))];
  let h = foldEvents(historyPhone.fold, after).fold, j = foldEvents(joiner.fold, after).fold;
  check('new activity applies the same on both phones', shared(h) === shared(j));

  // Fix the hotel: Amit should have been in it — Rahul edits the frozen expense.
  const fixed = expense(hotel, 600000, M.rahul, equal3(600000), 'Hotel');
  const corr = buildCorrection(h, randomUuid(rand), hotel, fixed);
  check('buildCorrection: only the change in who-owes-whom',
    corr && JSON.stringify(corr.debts.map((d) => [d.from, d.to, d.paise]).sort()) === JSON.stringify([[M.amit, M.rahul, 200000], [M.rahul, M.priya, 100000]].sort()),
    JSON.stringify(corr?.debts));
  const corrEv = data(U.rahul, { type: 'expense.correct', ...corr });
  h = foldEvents(h, [corrEv]).fold; j = foldEvents(j, [corrEv]).fold;
  check('correction applies the same on both phones', shared(h) === shared(j));
  // Same history with no checkpoint and a plain edit — the numbers must be identical.
  const plain = foldEvents(emptyFold(), [...setup, ...after, data(U.rahul, fixed)]).fold;
  check('correction = the same balances a plain edit gives', JSON.stringify(h.balances) === JSON.stringify(plain.balances)
    && JSON.stringify(debtList(h.debts)) === JSON.stringify(debtList(plain.debts)));
  check('phone with the original shows it updated in place', h.entries[hotel].data.shares.length === 3 && h.entries[hotel].versions.length === 2);
  check('late joiner shows the correction as its own entry', j.entries[corr.entityId]?.kind === 'correction' && !j.entries[hotel]);

  const live = randomUuid(rand);
  const liveEv = data(U.amit, expense(live, 3000, M.amit, equal3(3000), 'Tea'));
  h = foldEvents(h, [liveEv]).fold; j = foldEvents(j, [liveEv]).fold;
  check('buildCorrection refuses a live expense (just edit it)', buildCorrection(h, randomUuid(rand), live, null) === null);
  const badCorr = data(U.rahul, { type: 'expense.correct', entityId: randomUuid(rand), correctsId: live, base: live, title: 'Tea', date: '2026-10-14', debts: [], expense: null });
  const rh = foldEvents(h, [badCorr]), rj = foldEvents(j, [badCorr]);
  check('a correction aimed at a live expense is rejected on both', rh.rejected[0]?.reason === 'not_frozen' && rj.rejected[0]?.reason === 'not_frozen');
  // Two corrections of the same frozen expense built on the same version: only the first counts.
  const frozenId = Object.keys(h.entries).find((id) => h.entries[id].kind === 'expense' && h.entries[id].frozen && !h.entries[id].deleted);
  if (frozenId) {
    const v = h.entries[frozenId].data;
    const c1 = buildCorrection(h, randomUuid(rand), frozenId, { ...v, title: 'One' });
    const c2 = buildCorrection(h, randomUuid(rand), frozenId, { ...v, title: 'Two' });
    const both = foldEvents(h, [data(U.rahul, { type: 'expense.correct', ...c1 }), data(U.amit, { type: 'expense.correct', ...c2 })]);
    check('two corrections built on the same version: the second is refused as stale, the same on every phone',
      both.rejected.length === 1 && both.rejected[0].reason === 'stale_correction' && both.fold.corrections[frozenId].head === c1.entityId);
    const c3 = buildCorrection(both.fold, randomUuid(rand), frozenId, { ...v, title: 'Three' });
    check('…the next one, built on the first, goes through', c3.base === c1.entityId && foldEvents(both.fold, [data(U.amit, { type: 'expense.correct', ...c3 })]).rejected.length === 0);
  } else {
    check('(a frozen expense to correct)', false);
  }
  h = rh.fold; j = rj.fold;
  // A tampered app re-sending a frozen id as a plain edit: both phones treat it as new.
  const reuse = data(U.priya, expense(fuel, 1500, M.priya, [{ memberId: M.priya, paise: 1500 }], 'Fuel'));
  h = foldEvents(h, [reuse]).fold; j = foldEvents(j, [reuse]).fold;
  check('frozen ids are invisible to the rules on every phone', shared(h) === shared(j));
  check('balances still sum to zero', Object.values(h.balances).reduce((a, x) => a + x, 0) === 0);
}

{
  const fresh = [sys('group_created', U.rahul),
    data(U.rahul, { type: 'member.add', memberId: M.rahul, name: 'Rahul' }),
    data(U.rahul, { type: 'member.add', memberId: M.priya, name: 'Priya' }),
    data(U.rahul, expense(randomUuid(rand), 1000, M.rahul, [{ memberId: M.rahul, paise: 500 }, { memberId: M.priya, paise: 500 }]))];
  const g = foldEvents(emptyFold(), fresh).fold;
  const lie = buildCheckpoint(g);
  lie.debts = [];
  const lieEv = data(U.rahul, { type: 'group.checkpoint', ...lie });
  const hp = foldEvents(g, [lieEv]);
  check('a wrong checkpoint: phone with history keeps its own numbers', hp.rejected[0]?.reason === 'checkpoint_mismatch'
    && hp.fold.checkpointMismatch === lieEv.seq && hp.fold.balances[M.rahul] === 500);
  const stale = data(U.rahul, { type: 'group.checkpoint', ...buildCheckpoint(g), baseSeq: 1 });
  const rs = foldEvents(hp.fold, [stale]);
  check('a checkpoint not based on the latest seq is rejected', rs.rejected[0]?.reason === 'bad_checkpoint');
  const outsiderCp = data(U.outsider, { type: 'group.checkpoint', ...buildCheckpoint(rs.fold) });
  check('a non-member\'s checkpoint is rejected by a phone with history', foldEvents(rs.fold, [outsiderCp]).rejected[0]?.reason === 'not_member');
}

console.log('\n— local group mapping —');
seq = 0;
{
  // Rahul's phone: Priya existed as a contact before sharing; Dev joined from his own phone.
  const DEV = randomUuid(rand);
  const fold = foldEvents(emptyFold(), [
    sys('group_created', U.rahul),
    data(U.rahul, { type: 'group.meta', name: 'Goa Trip', emoji: '🏖️', color: '#7C3AED' }),
    data(U.rahul, { type: 'member.add', memberId: M.rahul, name: 'Rahul' }),
    data(U.rahul, { type: 'member.claim', memberId: M.rahul, userId: U.rahul }),
    data(U.rahul, { type: 'member.add', memberId: M.priya, name: 'Priya S' }),
    sys('member_joined', U.amit),
    data(U.amit, { type: 'member.add', memberId: DEV, name: 'Dev' }),
  ]).fold;
  const shared = { remoteId: randomUuid(rand), keys: {}, keyEpoch: 1, myMemberId: M.rahul, memberMap: { me: M.rahul, c_42: M.priya }, fold, status: 'active', syncedAt: null };
  const local = [{ memberId: 'me', name: 'You', isMe: true }, { memberId: 'c_42', name: 'Priya', contactId: '42', phone: '98765' }, { memberId: 'c_77', name: 'Zoya', contactId: '77' }];

  check('my server member is "me" here, and back', toLocalMember(shared, M.rahul) === 'me' && toRemoteMember(shared, 'me') === M.rahul);
  check('a pre-existing contact keeps its local id', toLocalMember(shared, M.priya) === 'c_42' && toRemoteMember(shared, 'c_42') === M.priya);
  check('someone who joined elsewhere uses the server id', toLocalMember(shared, DEV) === DEV && toRemoteMember(shared, DEV) === DEV);
  const members = membersFromFold(local, shared);
  check('members follow the server: names, order, contact kept',
    JSON.stringify(members.map((m) => [m.memberId, m.name, m.contactId ?? null])) === JSON.stringify([['c_42', 'Priya S', '42'], [DEV, 'Dev', null], ['c_77', 'Zoya', '77']]),
    JSON.stringify(members));
  check('"me" is left for the store to add', !members.some((m) => m.memberId === 'me'));
  // Dev's phone after "Who Are You? → Dev": the list still holds Dev under his server id from before the claim.
  const devShared = { ...shared, myMemberId: DEV, memberMap: { me: DEV } };
  const devLocal = [{ memberId: 'me', name: 'You', isMe: true }, { memberId: M.rahul, name: 'Rahul' }, { memberId: M.priya, name: 'Priya S' }, { memberId: DEV, name: 'Dev' }];
  check('after claiming, I\'m not listed a second time under the admin\'s name',
    JSON.stringify(membersFromFold(devLocal, devShared).map((m) => m.memberId)) === JSON.stringify([M.rahul, M.priya]));
  const twice = projectExpense({ id: 'x', type: 'debit', amount: 300, merchant: 'Cab', categoryId: 'travel', createdAt: '2026-10-15T00:00:00.000Z',
    groupSplit: { paidByMemberId: 'me', paidByName: 'You', shares: [{ memberId: 'me', shareAmount: 100 }, { memberId: DEV, shareAmount: 100 }, { memberId: M.rahul, shareAmount: 100 }] } }, 'e-x', devShared, new Set(['travel']));
  check('…and an expense split with both of those sends as ONE share of mine (it used to never send)',
    twice && JSON.stringify(twice.shares) === JSON.stringify([{ memberId: DEV, paise: 20000 }, { memberId: M.rahul, paise: 10000 }]), JSON.stringify(twice));

  let n = 0;
  const plan = planGroupChanges(
    { name: 'Goa Trip 2026', emoji: '🏖️', color: '#7C3AED', members: [...local, { memberId: DEV, name: 'Dev K' }] },
    shared, () => `00000000-0000-4000-8000-00000000000${++n}`,
  );
  const types = plan.events.map((e) => e.type);
  check('edit plan: new name → group.meta', types[0] === 'group.meta' && plan.events[0].name === 'Goa Trip 2026');
  check('edit plan: renamed contact → member.rename on its server id', plan.events.some((e) => e.type === 'member.rename' && e.memberId === M.priya && e.name === 'Priya'));
  check('edit plan: new person → member.add + mapped', plan.events.some((e) => e.type === 'member.add' && e.name === 'Zoya') && plan.memberMap.c_77 === '00000000-0000-4000-8000-000000000001');
  check('edit plan: rename of a remote-only member', plan.events.some((e) => e.type === 'member.rename' && e.memberId === DEV && e.name === 'Dev K'));
  const same = planGroupChanges({ name: 'Goa Trip', emoji: '🏖️', color: '#7C3AED', members: [local[0], { ...local[1], name: 'Priya S' }] }, shared, () => 'x');
  check('nothing changed → nothing sent', same.events.length === 0);
  const noColour = { ...shared, fold: { ...shared.fold, meta: { name: 'Goa Trip', emoji: '🏖️', color: null } } };
  check('server has no colour → this phone\'s default isn\'t sent as an edit',
    planGroupChanges({ name: 'Goa Trip', emoji: '🏖️', color: '#6366F1', members: [local[0], { ...local[1], name: 'Priya S' }] }, noColour, () => 'x').events.length === 0);
  check('metaOf drops a colour that isn\'t #rrggbb', metaOf({ name: 'G', emoji: '', color: 'rgb(1,2,3)' }).color === null && metaOf({ name: 'G', emoji: '', color: 'x' }).emoji === null);
  check('who an invite can be for: people nobody has joined as', JSON.stringify(unclaimedMembers(shared).map((m) => m.name)) === JSON.stringify(['Priya S', 'Dev']));
  // Members tab: tag + what I may do, per person (memberStatus). No admin: every member may do it.
  const st = (sh, m) => { const r = memberStatus(sh, m); return `${r.tag}|${+r.canRemove}${+r.canAddBack}`; };
  const amitUser = U.amit;
  const base = { ...shared, fold: { ...shared.fold, members: { ...shared.fold.members, [DEV]: { ...shared.fold.members[DEV], userId: amitUser } }, activeUsers: [U.rahul, amitUser] } };
  check('never shared: no tag on me, others plain members, nothing to do', st(undefined, { memberId: 'me', isMe: true }) === 'null|00' && st(undefined, { memberId: 'c_42' }) === 'Member|00');
  check('live: Dev joined and Priya not — any member may remove either', st(base, { memberId: DEV }) === 'Joined|10' && st(base, { memberId: 'c_42' }) === 'Not Joined|10');
  check('…me: no tag, no actions on myself', st(base, { memberId: 'me', isMe: true }) === 'null|00');
  const left = { ...base, fold: { ...base.fold, activeUsers: [U.rahul] } };
  check('left (archived, no access): any member may Add Back', st(left, { memberId: DEV, archived: true }) === 'Left|01');
  check('archived but still with access (a removal cut short): Remove again', st(base, { memberId: DEV, archived: true }) === 'Left|10');
  const gone = { ...left, fold: { ...left.fold, deletedUsers: [amitUser] } };
  check('deleted account: shown so, a past member here (out of new splits), nothing to do',
    st(gone, { memberId: DEV, archived: true }) === 'Deleted Account|00'
    && membersFromFold(local, { ...gone, myMemberId: M.rahul }).find((m) => m.memberId === DEV)?.archived === true);
  check('sharing ended: tags stay, no actions', st({ ...base, status: 'ended' }, { memberId: 'c_42' }) === 'Not Joined|00');
  const owing = { ...shared, fold: { ...shared.fold, balances: { [M.priya]: -500 } } };
  check('a member\'s balance by their LOCAL id', memberBalancePaise(owing, 'c_42') === -500 && memberBalancePaise(owing, 'me') === 0);
}

console.log('\n— expense sync: two phones —');
seq = 0;
{
  const BUILT = new Set(['food', 'travel', 'other']);
  const AT = '2026-10-14T09:00:00.000Z';
  let idn = 0;
  const nid = () => `aaaaaaaa-0000-4000-8000-${String(++idn).padStart(12, '0')}`;
  // The server: every queued event becomes the next seq, authored by that phone's user.
  let log = [sys('group_created', U.rahul),
    data(U.rahul, { type: 'group.meta', name: 'Goa Trip', emoji: null, color: null }),
    data(U.rahul, { type: 'member.add', memberId: M.rahul, name: 'Rahul' }),
    data(U.rahul, { type: 'member.claim', memberId: M.rahul, userId: U.rahul }),
    data(U.rahul, { type: 'member.add', memberId: M.priya, name: 'Priya' }),
    sys('member_joined', U.priya),
    data(U.priya, { type: 'member.claim', memberId: M.priya, userId: U.priya })];
  // As append_events: each unsent item becomes the next seq; it stays (with that seq) until a pull folds it.
  const upload = (phone, user) => {
    const outbox = (phone.group.shared.outbox ?? []).map((o) => {
      if (o.seq) return o;
      log.push(data(user, o.event));
      return { ...o, seq };
    });
    phone.group = { ...phone.group, shared: { ...phone.group.shared, outbox } };
  };
  const pull = (phone) => {
    const fold = foldEvents(phone.group.shared.fold, log).fold;
    const pulled = { ...phone.group.shared, fold };
    // As groupSync's commit: skipped sends read first, then the outbox reconciled; members follow the server.
    const skipped = skippedBySend(pulled);
    const shared = { ...pulled, outbox: reconcileOutbox(pulled) };
    phone.group = { ...phone.group, shared, members: [phone.group.members[0], ...membersFromFold(phone.group.members, shared)] };
    const ops = planIncoming(phone.group, phone.txns, BUILT, phone.lb, skipped);
    for (const op of ops) {
      if (op.kind === 'lbCreate') phone.lb = [op.row, ...phone.lb];
      if (op.kind === 'lbUpdate') phone.lb = phone.lb.map((l) => (l.id === op.rowId ? { ...l, ...op.fields } : l));
      if (op.kind === 'lbRemove') phone.lb = phone.lb.filter((l) => l.id !== op.rowId);
      if (op.kind === 'lbFlag') phone.lb = phone.lb.map((l) => (l.id === op.rowId ? { ...l, syncRejected: op.syncRejected ?? undefined } : l));
      if (op.kind === 'create') phone.txns = [op.txn, ...phone.txns];
      if (op.kind === 'update') phone.txns = phone.txns.map((t) => (t.id === op.txnId ? { ...t, ...op.fields } : t));
      if (op.kind === 'remove') phone.txns = phone.txns.filter((t) => t.id !== op.txnId);
      if (op.kind === 'flag') phone.txns = phone.txns.map((t) => (t.id === op.txnId ? { ...t, syncRejected: op.syncRejected ?? undefined } : t));
    }
    return ops;
  };
  const queue = (phone) => {
    const plan = planOutgoing(phone.group, phone.txns, nid, BUILT, AT, phone.lb);
    if (!plan) return null;
    phone.group = { ...phone.group, shared: plan.shared };
    phone.txns = phone.txns.map((t) => (plan.syncIds[t.id] ? { ...t, syncId: plan.syncIds[t.id] } : t));
    phone.lb = phone.lb.map((l) => (plan.lbSyncIds[l.id] ? { ...l, syncId: plan.lbSyncIds[l.id] } : l));
    phone.txns = phone.txns.map((t) => (t.id in plan.flags ? { ...t, syncRejected: plan.flags[t.id] ?? undefined } : t));
    return plan;
  };
  const sharedFor = (me, map) => ({ remoteId: 'r', keys: {}, keyEpoch: 1, myMemberId: me, memberMap: map, fold: emptyFold(), status: 'active', syncedAt: null, outbox: [] });
  const A = { group: { id: 'gA', name: 'Goa Trip', type: 'shared', members: [{ memberId: 'me', name: 'You', isMe: true }, { memberId: 'c_42', name: 'Priya', contactId: '42' }], shared: sharedFor(M.rahul, { me: M.rahul, c_42: M.priya }) }, txns: [], lb: [] };
  const B = { group: { id: 'gB', name: 'Goa Trip', type: 'shared', members: [{ memberId: 'me', name: 'You', isMe: true }], shared: sharedFor(M.priya, { me: M.priya }) }, txns: [], lb: [] };
  pull(A); pull(B);
  check('both phones start in step (nothing to send)', queue(A) === null && queue(B) === null);

  // Rahul pays ₹1,000 (a manual entry — an SMS one is covered below), split equally with Priya.
  A.txns = [{ id: 'IdM0001', type: 'debit', amount: 1000, merchant: 'Shack Dinner', categoryId: 'food', createdAt: '2026-10-14T20:00:00.000Z', accountId: 'acc1', groupId: 'gA', source: 'manual',
    groupSplit: { paidByMemberId: 'me', paidByName: 'You', shares: [{ memberId: 'me', name: 'You', shareAmount: 500 }, { memberId: 'c_42', name: 'Priya', shareAmount: 500 }] } }];
  const p1 = queue(A);
  const ev = p1?.shared.outbox[0]?.event;
  check('a new expense queues one upsert, in server terms', p1 && p1.shared.outbox.length === 1 && ev.type === 'expense.upsert'
    && ev.paidBy === M.rahul && ev.shares[1].memberId === M.priya && ev.amountPaise === 100000, JSON.stringify(ev));
  check('…and gives the transaction its server id', A.txns[0].syncId === ev.entityId);
  check('queuing again adds nothing (no duplicates)', queue(A) === null);
  const dinner = ev.entityId;
  upload(A, U.rahul);
  check('Rahul\'s own expense comes back with no changes', pull(A).length === 0);
  const opsB = pull(B);
  const got = B.txns[0];
  check('Priya\'s phone creates it as a memo she owes on',
    opsB.length === 1 && got.syncOrigin === 'remote' && got.isGroupMemo === true && !got.accountId && got.amount === 1000
    && got.groupSplit.paidByMemberId === M.rahul && got.groupSplit.shares.some((s) => s.memberId === 'me' && s.shareAmount === 500), JSON.stringify(got));
  check('…and has nothing to send back', queue(B) === null);

  // Priya edits it: the bill was ₹1,200.
  B.txns = B.txns.map((t) => ({ ...t, amount: 1200, groupSplit: { ...t.groupSplit, shares: t.groupSplit.shares.map((s) => ({ ...s, shareAmount: 600 })) } }));
  const p2 = queue(B);
  check('an edit queues an upsert of the same expense', p2 && p2.shared.outbox[0].event.entityId === dinner && p2.shared.outbox[0].event.amountPaise === 120000);
  upload(B, U.priya);
  const opsA = pull(A);
  check('Rahul\'s phone takes the edit in place (same transaction, account kept)',
    opsA.length === 1 && opsA[0].kind === 'update' && A.txns[0].id === 'IdM0001' && A.txns[0].amount === 1200 && A.txns[0].accountId === 'acc1');
  check('…without echoing it back', queue(A) === null && pull(B).length === 0);

  // An expense in the group with no split can't go to the server: it says so instead of staying silent.
  A.txns = [{ id: 'IdM0002', type: 'debit', amount: 250, merchant: 'Snacks', categoryId: 'food', createdAt: AT, accountId: 'acc1', groupId: 'gA' }, ...A.txns];
  const p3 = queue(A);
  check('unsendable (no split) → flagged NOT SYNCED, nothing queued', p3 && p3.flags.IdM0002 === UNSENDABLE && p3.shared.outbox.length === 0
    && A.txns[0].syncRejected === UNSENDABLE);
  check('…once, not on every check', queue(A) === null);
  A.txns = A.txns.map((t) => (t.id === 'IdM0002' ? { ...t, groupSplit: { paidByMemberId: 'me', paidByName: 'You', shares: [{ memberId: 'me', shareAmount: 125 }, { memberId: 'c_42', shareAmount: 125 }] } } : t));
  const p4 = queue(A);
  check('…given a split: the flag clears and it goes out', p4 && p4.flags.IdM0002 === null && p4.shared.outbox.some((o) => o.event.type === 'expense.upsert' && o.event.amountPaise === 25000)
    && !A.txns.find((t) => t.id === 'IdM0002').syncRejected);
  A.txns = A.txns.filter((t) => t.id !== 'IdM0002');
  A.group = { ...A.group, shared: { ...A.group.shared, outbox: A.group.shared.outbox.filter((o) => o.event.amountPaise !== 25000) } };

  // Paisa rounding: ₹100 three ways.
  A.group = { ...A.group, members: [...A.group.members] };
  const odd = projectExpense({ id: 'x', type: 'debit', amount: 100, merchant: 'Tea', categoryId: 'food', createdAt: AT,
    groupSplit: { paidByMemberId: 'me', shares: [{ memberId: 'me', shareAmount: 33.33 }, { memberId: 'c_42', shareAmount: 33.33 }, { memberId: 'me2', shareAmount: 33.34 }] } }, 'e', A.group.shared, BUILT);
  check('a member not on the server yet → not sendable', odd === null);
  const tea = projectExpense({ id: 'x', type: 'debit', amount: 100, merchant: 'Tea', categoryId: 'custom_x', createdAt: AT,
    groupSplit: { paidByMemberId: 'c_42', shares: [{ memberId: 'me', shareAmount: 33.33 }, { memberId: 'c_42', shareAmount: 33.33 }] } }, 'e', A.group.shared, BUILT);
  check('rupee shares that miss the total by a paisa: the payer absorbs it', tea && tea.shares[1].paise === 6667 && tea.shares[0].paise + tea.shares[1].paise === 10000, JSON.stringify(tea));
  check('a custom category goes out as "other"', tea.categoryId === 'other');

  // A pending change is never overwritten by the server's older copy.
  A.txns = A.txns.map((t) => ({ ...t, merchant: 'Shack Dinner + Drinks' }));
  queue(A);
  log.push(data(U.priya, { type: 'member.rename', memberId: M.priya, name: 'Priya S' }));
  const opsPending = pull(A);
  check('pull skips an expense with an unsent change', opsPending.length === 0 && A.txns[0].merchant === 'Shack Dinner + Drinks');
  upload(A, U.rahul); pull(A); pull(B);
  check('…which lands everywhere once sent', B.txns[0].merchant === 'Shack Dinner + Drinks');

  // Rejected: Rahul adds an expense naming someone the server doesn't know.
  const GHOST = 'bbbbbbbb-0000-4000-8000-000000000001';
  A.group = { ...A.group, shared: { ...A.group.shared, memberMap: { ...A.group.shared.memberMap, c_9: GHOST } } };
  A.txns = [{ id: 'IdM0002', type: 'debit', amount: 300, merchant: 'Cab', categoryId: 'travel', createdAt: AT, accountId: 'acc1', groupId: 'gA', source: 'manual',
    groupSplit: { paidByMemberId: 'me', shares: [{ memberId: 'me', shareAmount: 150 }, { memberId: 'c_9', shareAmount: 150 }] } }, ...A.txns];
  const pr = queue(A);
  check('it is queued like any other', pr && pr.shared.outbox.some((o) => o.event.type === 'expense.upsert' && o.event.title === 'Cab'));
  upload(A, U.rahul);
  pull(A);
  const cab = A.txns.find((t) => t.id === 'IdM0002');
  check('the rules skip it → marked as not synced', !!cab.syncRejected && !B.txns.some((t) => t.merchant === 'Cab'));
  check('…and it is not re-sent while unchanged', queue(A) === null);
  A.txns = A.txns.map((t) => (t.id === 'IdM0002' ? { ...t, groupSplit: { paidByMemberId: 'me', shares: [{ memberId: 'me', shareAmount: 150 }, { memberId: 'c_42', shareAmount: 150 }] } } : t));
  const retry = queue(A);
  upload(A, U.rahul); pull(A); pull(B);
  check('fixing it sends it again; it syncs and the flag clears', retry && !A.txns.find((t) => t.id === 'IdM0002').syncRejected && B.txns.some((t) => t.merchant === 'Cab'));

  // Rahul removes the dinner from the group (or ignores/deletes it).
  A.txns = A.txns.map((t) => (t.id === 'IdM0001' ? { ...t, isIgnored: true } : t));
  const pd = queue(A);
  check('ignoring a synced expense queues a delete', pd && pd.shared.outbox.some((o) => o.event.type === 'expense.delete' && o.event.entityId === dinner));
  upload(A, U.rahul);
  pull(A);
  const opsDel = pull(B);
  check('Priya\'s copy (someone else\'s expense) is removed', opsDel.some((o) => o.kind === 'remove') && !B.txns.some((t) => t.syncId === dinner));
  check('both phones end with nothing left to send', queue(A) === null && queue(B) === null);

  // ── Settlements. Left: the ₹300 cab Rahul paid; Priya owes ₹150. She settles on her phone.
  const owed = () => A.group.shared.fold.balances[M.priya] ?? 0;
  check('before settling, the server says Priya owes ₹150', owed() === -15000, String(owed()));
  B.lb = [{ id: 'lbB1', kind: 'borrow_repaid', person: 'Rahul', memberId: M.rahul, amount: 150, date: AT, groupId: 'gB', note: 'Group settle · Goa Trip' }];
  const ps = queue(B);
  const sev = ps?.shared.outbox[0]?.event;
  check('a settle row queues one settlement, Priya → Rahul', ps && ps.shared.outbox.length === 1 && sev.type === 'settlement.upsert'
    && sev.from === M.priya && sev.to === M.rahul && sev.amountPaise === 15000, JSON.stringify(sev));
  check('…and gives the row its server id', B.lb[0].syncId === sev.entityId);
  check('queuing again adds nothing', queue(B) === null);
  upload(B, U.priya); pull(B); pull(A);
  const recv = A.lb.find((l) => l.syncId === sev.entityId);
  check('Rahul\'s phone gets a "received" row for Priya, in this group',
    recv && recv.kind === 'lent_settled' && recv.amount === 150 && recv.groupId === 'gA' && recv.memberId === 'c_42' && recv.contactId === '42' && recv.syncOrigin === 'remote', JSON.stringify(recv));
  check('…the server balance is ₹0, so either can leave', owed() === 0 && (A.group.shared.fold.balances[M.rahul] ?? 0) === 0);
  check('…and nothing echoes back', queue(A) === null && queue(B) === null && pull(A).length === 0);

  check('a row is about the member it names (and only a member of this group)',
    lbRowMember(A.group, { id: 'x', kind: 'lent_settled', amount: 1, memberId: 'c_42' }) === 'c_42'
    && lbRowMember(A.group, { id: 'x', kind: 'lent_settled', amount: 1, memberId: 'c_99' }) === null
    && lbRowMember(A.group, { id: 'x', kind: 'lent_settled', amount: 1, contactId: '42' }) === null);

  // Settlements between two OTHER people change nothing on this phone.
  log.push(data(U.rahul, { type: 'member.add', memberId: M.amit, name: 'Amit' }));
  log.push(data(U.priya, { type: 'settlement.upsert', entityId: nid(), from: M.amit, to: M.rahul, amountPaise: 5000, date: AT }));
  pull(A); pull(B);
  check('Amit → Rahul is on Rahul\'s phone, not on Priya\'s', A.lb.length === 2 && B.lb.length === 1 && queue(B) === null && queue(A) === null);

  // Priya deletes her Repayment transaction, which drops its settle row.
  B.lb = B.lb.filter((l) => l.id !== 'lbB1');
  const pdel = queue(B);
  check('a settle row that\'s gone queues settlement.delete', pdel && pdel.shared.outbox.some((o) => o.event.type === 'settlement.delete' && o.event.entityId === sev.entityId));
  upload(B, U.priya); pull(B); pull(A);
  check('Rahul\'s "received" row goes too, and Priya owes ₹150 again',
    !A.lb.some((l) => l.syncId === sev.entityId) && owed() === -15000 && queue(A) === null && queue(B) === null);

  // Any member may delete a settlement Priya made (decided Oct-15-26).
  B.lb = [{ id: 'lbB2', kind: 'borrow_repaid', person: 'Rahul', memberId: M.rahul, amount: 150, date: AT, groupId: 'gB' }];
  queue(B); upload(B, U.priya); pull(B); pull(A);
  const second = A.lb.find((l) => l.kind === 'lent_settled' && l.memberId === 'c_42');
  A.lb = A.lb.filter((l) => l !== second);
  queue(A); upload(A, U.rahul); pull(A); pull(B);
  check('Rahul deletes a settlement Priya made: gone on both phones, she owes ₹150 again',
    !A.lb.some((l) => l.syncId === second.syncId) && !B.lb.some((l) => l.syncId === second.syncId) && owed() === -15000);
  B.lb = [{ id: 'lbB3', kind: 'borrow_repaid', person: 'Rahul', memberId: M.rahul, amount: 150, date: AT, groupId: 'gB' }];
  queue(B); upload(B, U.priya); pull(B); pull(A);
  check('…she records it again', owed() === 0);
  const third = A.lb.find((l) => l.kind === 'lent_settled' && l.memberId === 'c_42' && l.syncOrigin === 'remote');

  // ── Checkpoints + corrections. Amit owes nothing; Rahul owes Amit ₹50 → unsettled.
  const DAY = 86400000;
  const lastAt = Date.parse(A.group.shared.fold.lastAt);
  const due = (sh, days) => checkpointDue(sh, lastAt + days * DAY);
  check('fold keeps the server time of the last event', A.group.shared.fold.lastAt === log[log.length - 1].createdAt);
  check('unsettled: no checkpoint at 29 quiet days, one at 30', !due(A.group.shared, 29) && due(A.group.shared, 30));
  const settledSh = { ...A.group.shared, fold: { ...A.group.shared.fold, balances: {} } };
  check('settled: one at 7 quiet days', !due(settledSh, 6) && due(settledSh, 7));
  check('…not with something waiting to send, nor after disagreeing with one',
    !due({ ...A.group.shared, outbox: [{ eventId: 'x', at: AT, event: { type: 'expense.delete', entityId: dinner } }] }, 60)
    && !due({ ...A.group.shared, fold: { ...A.group.shared.fold, checkpointMismatch: 3 } }, 60));
  check('no server time yet → not due', !due({ ...A.group.shared, fold: { ...A.group.shared.fold, lastAt: undefined } }, 400));

  // Rahul's phone posts one.
  log.push(data(U.rahul, { type: 'group.checkpoint', ...buildCheckpoint(A.group.shared.fold) }));
  const cpSeq = seq;
  pull(A); pull(B);
  check('both phones accept it and freeze the expenses before it',
    A.group.shared.fold.lastCheckpoint === cpSeq && B.group.shared.fold.lastCheckpoint === cpSeq
    && A.group.shared.fold.entries[cab.syncId].frozen && !A.group.shared.fold.checkpointMismatch);
  check('…nothing is due right after it', !checkpointDue(A.group.shared, lastAt + 400 * DAY));
  check('…and nothing changes on either phone', queue(A) === null && queue(B) === null);

  // Priya edits the frozen cab: ₹300 → ₹400, then (before it's sent) → ₹500.
  const cabOn = (P) => P.txns.find((t) => t.syncId === cab.syncId);
  const cabTo = (P, amt) => { P.txns = P.txns.map((t) => (t.syncId === cab.syncId ? { ...t, amount: amt, groupSplit: { ...t.groupSplit, shares: t.groupSplit.shares.map((x) => ({ ...x, shareAmount: amt / 2 })) } } : t)); };
  cabTo(B, 400);
  const pc = queue(B);
  const corr = pc?.shared.outbox[0]?.event;
  check('an edit of a frozen expense goes as a correction, not an edit',
    pc && pc.shared.outbox.length === 1 && corr.type === 'expense.correct' && corr.correctsId === cab.syncId
    && JSON.stringify(corr.debts) === JSON.stringify([{ from: M.priya, to: M.rahul, paise: 5000 }]), JSON.stringify(corr));
  check('…queued once', queue(B) === null);
  cabTo(B, 500);
  const pc2 = queue(B);
  check('a second edit builds on the first (only the extra ₹100 share)',
    pc2 && pc2.shared.outbox.length === 2 && JSON.stringify(pc2.shared.outbox[1].event.debts) === JSON.stringify([{ from: M.priya, to: M.rahul, paise: 5000 }]));
  upload(B, U.priya); pull(B); pull(A);
  check('Rahul\'s phone updates the same transaction in place', cabOn(A).id === 'IdM0002' && cabOn(A).amount === 500 && cabOn(A).accountId === 'acc1');
  check('…its edit history gains both versions', A.group.shared.fold.entries[cab.syncId].versions.length === 3, String(A.group.shared.fold.entries[cab.syncId].versions.length));
  check('…Priya owes ₹100 more than she paid back (₹250 share − ₹150)', owed() === -10000, String(owed()));
  check('…and nothing echoes', queue(A) === null && queue(B) === null);

  // A late joiner (history from the checkpoint only) computes the same balances.
  const late = foldEvents(emptyFold(), log.filter((e) => e.seq >= cpSeq)).fold;
  check('a late joiner adopts the checkpoint and agrees on every balance',
    JSON.stringify(late.balances) === JSON.stringify(A.group.shared.fold.balances) && JSON.stringify(late.debts) === JSON.stringify(B.group.shared.fold.debts),
    JSON.stringify([late.balances, A.group.shared.fold.balances]));
  check('…without holding the old expense', !late.entries[cab.syncId] && late.historyFrom === cpSeq);

  // Rahul deletes the frozen cab.
  A.txns = A.txns.filter((t) => t.syncId !== cab.syncId);
  const pdc = queue(A);
  check('deleting a frozen expense sends a correction with no expense',
    pdc && pdc.shared.outbox.some((o) => o.event.type === 'expense.correct' && o.event.expense === null && o.event.correctsId === cab.syncId));
  upload(A, U.rahul); pull(A); pull(B);
  check('Priya\'s copy goes; she\'s now owed her ₹150 back', !cabOn(B) && owed() === 15000, String(owed()));
  const late2 = foldEvents(emptyFold(), log.filter((e) => e.seq >= cpSeq)).fold;
  check('…the late joiner agrees', JSON.stringify(late2.balances) === JSON.stringify(A.group.shared.fold.balances));

  // Offline edit queued BEFORE a checkpoint landed: it must not go as a plain edit.
  A.txns = [{ id: 'IdM0003', type: 'debit', amount: 200, merchant: 'Snacks', categoryId: 'food', createdAt: AT, accountId: 'acc1', groupId: 'gA',
    groupSplit: { paidByMemberId: 'me', shares: [{ memberId: 'me', shareAmount: 100 }, { memberId: 'c_42', shareAmount: 100 }] } }, ...A.txns];
  queue(A); upload(A, U.rahul); pull(A); pull(B);
  const snack = A.txns[0].syncId;
  A.txns = A.txns.map((t) => (t.id === 'IdM0003' ? { ...t, merchant: 'Snacks + Water' } : t));
  queue(A);
  log.push(data(U.priya, { type: 'group.checkpoint', ...buildCheckpoint(B.group.shared.fold) }));
  A.group = { ...A.group, shared: { ...A.group.shared, fold: foldEvents(A.group.shared.fold, log).fold } };
  const fixed = reconcileOutbox(A.group.shared);
  check('after a pull, an unsent edit of a now-frozen expense becomes a correction (same event id)',
    fixed.length === 1 && fixed[0].event.type === 'expense.correct' && fixed[0].event.expense.title === 'Snacks + Water'
    && fixed[0].eventId === A.group.shared.outbox[0].eventId && fixed[0].event.debts.length === 0, JSON.stringify(fixed));
  check('…and sent items are dropped once the history has them',
    reconcileOutbox({ ...A.group.shared, outbox: [{ ...fixed[0], seq: 1 }] }).length === 0
    && reconcileOutbox({ ...A.group.shared, outbox: [{ ...fixed[0], seq: seq + 5 }] }).length === 1);
  A.group = { ...A.group, shared: { ...A.group.shared, outbox: fixed } };
  upload(A, U.rahul); pull(A); pull(B);
  check('…which lands as the new title everywhere', B.txns.find((t) => t.syncId === snack)?.merchant === 'Snacks + Water');

  // A frozen settlement's row deleted here can't be deleted on the server: it comes back.
  const frozenRow = A.lb.find((l) => l.syncId === third.syncId);
  A.lb = A.lb.filter((l) => l !== frozenRow);
  check('a frozen settlement sends no delete', queue(A) === null);
  pull(A);
  check('…and the pull puts its row back', A.lb.some((l) => l.syncId === third.syncId));
}

console.log('\n— phone fingerprints: linking group members to contacts (Oct-17-26) —');
{
  const { cachedPhoneKey, phoneKeySecret, isPhoneKey } = await import('../../sync/phoneKey.ts');
  const { bytesToBase64 } = await import('../../backup/envelope.ts');
  const newKey = () => bytesToBase64(generateGroupKey(rand));
  const keys = { 1: newKey() };
  const k = cachedPhoneKey(keys, '+91 98765 43210');
  check('same number written any way → same fingerprint', isPhoneKey(k) && k === cachedPhoneKey(keys, '09876543210'));
  check('the number itself is nowhere in it', !k.includes('9876543210') && !k.includes('43210'));
  check('another group → a different fingerprint', k !== cachedPhoneKey({ 1: newKey() }, '9876543210'));
  check('too short to be a mobile → none', cachedPhoneKey(keys, '12345') === null);
  const later = { 2: newKey(), 1: keys[1] };
  check('a rotated key keeps the fingerprint (first epoch is the secret)', cachedPhoneKey(later, '9876543210') === k);
  check('no keys → none', phoneKeySecret({}) === null);

  const add = parseEvent(encodeEvent({ type: 'member.add', memberId: M.dev, name: 'Dev', phoneKey: k }, 'x'));
  check('member.add carries a valid fingerprint', add?.event.phoneKey === k);
  const bad = parseEvent(encodeEvent({ type: 'member.add', memberId: M.dev, name: 'Dev', phoneKey: 'not-hex' }, 'x'));
  check('…a malformed one is dropped, the person kept', bad && !('phoneKey' in bad.event));
  check('member.phone needs a valid fingerprint', parseEvent(encodeEvent({ type: 'member.phone', memberId: M.dev, phoneKey: 'x' }, 'x')) === null);

  const start = foldEvents(emptyFold(), base).fold;
  const ev = (event) => ({
    seq: start.seq + 1, eventId: randomUuid(rand), authorId: U.priya, systemType: null, systemSubject: null,
    plaintext: encodeEvent(event, '2026-10-13T10:00:00.000Z'), createdAt: serverTime(start.seq + 1),
  });
  const res = foldEvents(start, [ev({ type: 'member.phone', memberId: M.amit, phoneKey: k })]);
  check('any member\'s member.phone lands in phoneKeys', res.rejected.length === 0 && res.fold.phoneKeys[M.amit] === k, JSON.stringify(res.rejected));
  check('…never in a checkpoint (phones without it build the same one)',
    JSON.stringify(buildCheckpoint(res.fold)) === JSON.stringify(buildCheckpoint({ ...res.fold, phoneKeys: {} })));
  check('…balances untouched', JSON.stringify(res.fold.balances) === JSON.stringify(start.balances));
  check('member.phone for someone not in the group is rejected',
    foldEvents(start, [ev({ type: 'member.phone', memberId: randomUuid(rand), phoneKey: k })]).rejected.length === 1);

  const shared = { remoteId: randomUuid(rand), keys, keyEpoch: 1, myMemberId: M.rahul, memberMap: {}, fold: start, status: 'active' };
  const keyOf = (phone) => cachedPhoneKey(keys, phone);
  const g = (members) => ({ name: 'Goa Trip', emoji: '🏖️', color: '#7C3AED', members });
  const amit = { memberId: M.amit, name: 'Amit', phone: '9876543210' };
  let plan = planGroupChanges(g([{ memberId: 'me', name: 'Me', isMe: true }, { memberId: 'c_neha', name: 'Neha', phone: '9123456780' }, amit]), shared, () => M.dev, keyOf);
  check('a new person with a number → member.add WITH their fingerprint',
    plan.events.some((e) => e.type === 'member.add' && e.name === 'Neha' && e.phoneKey === keyOf('9123456780')), JSON.stringify(plan.events));
  check('someone already there, now linked to a number → member.phone',
    plan.events.some((e) => e.type === 'member.phone' && e.memberId === M.amit && e.phoneKey === k));
  plan = planGroupChanges(g([amit]), { ...shared, fold: res.fold }, () => M.dev, keyOf);
  check('…not again once the group has it', !plan.events.some((e) => e.type === 'member.phone'));
  plan = planGroupChanges(g([{ ...amit, contactName: 'Amit Kumar' }]), shared, () => M.dev);
  check('a local contact name is never sent as a rename', !plan.events.some((e) => e.type === 'member.rename'));
  const pulled = membersFromFold([{ ...amit, contactId: 'c1', contactName: 'Amit Kumar' }], { ...shared, fold: res.fold });
  check('a pull keeps this phone\'s contact link and name', pulled.some((m) => m.memberId === M.amit && m.contactId === 'c1' && m.contactName === 'Amit Kumar' && m.name === 'Amit'));

  // My OWN number (Oct-20-26): without its fingerprint nobody can show me under their contact name.
  const mine = (sh, phone) => planGroupChanges(g([]), sh, () => M.dev, keyOf, phone).events.filter((e) => e.type === 'member.phone' && e.memberId === M.rahul);
  check('my number in Profile → member.phone for MY member', mine(shared, '9000000001').length === 1 && mine(shared, '9000000001')[0].phoneKey === keyOf('9000000001'));
  check('…none without a number', mine(shared, null).length === 0 && mine(shared, '').length === 0);
  const withMine = { ...shared, fold: { ...start, phoneKeys: { [M.rahul]: keyOf('9000000001') } } };
  check('…not again once the group has mine', mine(withMine, '9000000001').length === 0);
  check('…but a CHANGED number goes out again (the group must hold the current one)',
    mine(withMine, '9000000002').length === 1 && mine(withMine, '9000000002')[0].phoneKey === keyOf('9000000002'));
  check('a +91 / spaced number fingerprints the same as its 10 digits', keyOf('+91 90000 00001') === keyOf('9000000001'));
  check('…not before I am in the group (no claim yet)', mine({ ...shared, myMemberId: null }, '9000000001').length === 0);
  const archivedMe = { ...shared, fold: { ...start, members: { ...start.members, [M.rahul]: { ...start.members[M.rahul], archived: true } } } };
  check('…not once I have left', mine(archivedMe, '9000000001').length === 0);
  const engineSrc = readFileSync(new URL('../../sync/engine.ts', import.meta.url), 'utf8');
  check('the engine re-plans when my number changes, and passes it in',
    /s\.userPhones === prev\?\.userPhones/.test(engineSrc) && /now\.userPhones\?\.\[0\] \?\? null/.test(engineSrc));
  check('the engine links people to my contacts when a fingerprint lands, not only when the group is opened',
    /useEPurseStore\.subscribe\(followLinks\)/.test(engineSrc) && /void autoLinkGroupMembers\(g\.id\)/.test(engineSrc));
  const linkSrc = readFileSync(new URL('../../sync/contactLink.ts', import.meta.url), 'utf8');
  check('autoLink fills / refreshes the contact name of members linked by contact id',
    /contactLinkedMembers\(group, refreshNames\)/.test(linkSrc) && /old\.contactName !== c\.name/.test(linkSrc));
  check('…and never drops a call that arrives mid-run', /again\.set\(groupId/.test(linkSrc) && /void autoLinkGroupMembers\(groupId, \{ refreshNames: refresh \}\)/.test(linkSrc));
}

console.log('\n— audit fixes (docs/audits/shared-groups-2026-10-23, Oct-24-26) —');
{
  // Its own group, after the legacy-claim cut-off: every join goes through the new rules.
  const id = () => randomUuid(rand);
  const u = { a: id(), b: id(), c: id() };
  const m = { a: id(), b: id(), c: id() };
  let n = 0;
  const at = (s) => new Date(Date.UTC(2026, 10, 1, 10, s)).toISOString();
  const s = (type, subject, member = null) => ({ seq: ++n, eventId: id(), authorId: null, systemType: type, systemSubject: subject, systemMember: member, plaintext: null, createdAt: at(n) });
  const d = (author, event) => ({ seq: ++n, eventId: id(), authorId: author, systemType: null, systemSubject: null, plaintext: encodeEvent(event, at(n)), createdAt: at(n) });
  const exp = (entityId, paise, paidBy, debtor) => ({ type: 'expense.upsert', entityId, amountPaise: paise, title: 'Dinner', categoryId: 'food', date: '2026-11-01', paidBy, shares: [{ memberId: debtor, paise }] });
  const fold = (evs, from = emptyFold()) => foldEvents(from, evs);

  const start = [
    s('group_created', u.a),
    d(u.a, { type: 'member.add', memberId: m.a, name: 'A', self: true }),
    d(u.a, { type: 'member.add', memberId: m.b, name: 'B' }),
    d(u.a, { type: 'member.add', memberId: m.c, name: 'C' }),
  ];
  const g0 = fold(start);
  check('the creator joins by adding themselves (member.add self)', g0.rejected.length === 0 && g0.fold.members[m.a].userId === u.a);

  // F05 — invites bind a person.
  const asB = fold([s('member_joined', u.b, m.b), d(u.b, { type: 'member.claim', memberId: m.b, userId: u.b })], g0.fold);
  check('an invite made for B lets its joiner become B', asB.rejected.length === 0 && asB.fold.members[m.b].userId === u.b && !asB.fold.bindings[u.b]);
  const grab = fold([s('member_joined', u.b, m.b), d(u.b, { type: 'member.claim', memberId: m.c, userId: u.b })], g0.fold);
  check('…but not C (editing the link\'s m changes nothing)', grab.rejected[0]?.reason === 'not_invited_as' && !grab.fold.members[m.c].userId);
  const plain = fold([s('member_joined', u.c), d(u.c, { type: 'member.claim', memberId: m.c, userId: u.c })], g0.fold);
  check('a plain invite can\'t claim anyone', plain.rejected[0]?.reason === 'not_invited_as');
  const selfAdd = fold([s('member_joined', u.c), d(u.c, { type: 'member.add', memberId: id(), name: 'Cee', self: true })], g0.fold);
  check('…it joins as a new person instead', selfAdd.rejected.length === 0 && Object.values(selfAdd.fold.members).some((x) => x.userId === u.c));
  const twice = fold([d(u.a, { type: 'member.add', memberId: id(), name: 'A2', self: true })], g0.fold);
  check('adding myself twice is refused', twice.rejected[0]?.reason === 'claimed_twice');
  const legacy = foldEvents(emptyFold(), base);
  check('claims from before the cut-off still replay (existing test groups)', legacy.rejected.length === 0);

  // A checkpoint carries the pending binding: a phone that starts from it agrees.
  const pend = fold([s('member_joined', u.b, m.b)], g0.fold).fold;
  const cpB = d(u.a, { type: 'group.checkpoint', ...buildCheckpoint(pend) });
  const claimB = d(u.b, { type: 'member.claim', memberId: m.b, userId: u.b });
  const full = fold([cpB, claimB], pend);
  const fresh = fold([cpB, claimB]);
  check('a binding survives a checkpoint: the claim lands on full and fresh phones alike',
    full.rejected.length === 0 && fresh.rejected.length === 0 && fresh.fold.members[m.b].userId === u.b
    && JSON.stringify(full.fold.members) === JSON.stringify(fresh.fold.members));

  // F06 — losing access makes a past member, however it happened.
  const owes = fold([d(u.a, exp(id(), 10000, m.a, m.b))], asB.fold).fold;
  const removed = fold([s('member_removed', u.b)], owes).fold;
  check('removed by a direct server call while owing: archived, balance kept', removed.members[m.b].archived && removed.balances[m.b] === -10000);
  check('…so nothing new can include them', fold([d(u.a, exp(id(), 500, m.a, m.b))], removed).rejected[0]?.reason === 'archived_member');
  check('…until they\'re back', !fold([s('member_joined', u.b)], removed).fold.members[m.b].archived);

  // F03 — a frozen id can't come back as a new expense.
  const e1 = id();
  const pre = fold([d(u.a, exp(e1, 10000, m.a, m.b))], asB.fold).fold;
  const cp = d(u.a, { type: 'group.checkpoint', ...buildCheckpoint(pre) });
  const reuse = d(u.b, exp(e1, 10000, m.a, m.b));
  const fullR = fold([cp, reuse], pre), freshR = fold([cp, reuse]);
  check('re-sending a frozen expense as new is refused (was: counted twice)',
    fullR.rejected.some((r) => r.reason === 'frozen') && fullR.fold.balances[m.a] === 10000, JSON.stringify(fullR.rejected));
  check('…on a phone that only has the checkpoint too (same tags)',
    freshR.rejected.some((r) => r.reason === 'frozen') && JSON.stringify(freshR.fold.balances) === JSON.stringify(fullR.fold.balances));
  check('…and its history isn\'t replaced', fullR.fold.entries[e1].versions.length === 1);

  // F04 — a correction must name a real frozen expense.
  const ghost = id();
  const fake = d(u.b, { type: 'expense.correct', entityId: id(), correctsId: ghost, base: ghost, title: 'Invented', date: '2026-11-01', debts: [{ from: m.b, to: m.a, paise: 50000 }], expense: null });
  check('a correction of an expense that never existed is refused (was: +₹500)',
    fold([cp, fake], pre).rejected.some((r) => r.reason === 'unknown_entry') && fold([cp, fake]).rejected.some((r) => r.reason === 'unknown_entry'));
  const real = buildCorrection(fold([cp], pre).fold, id(), e1, null);
  const fixR = fold([cp, d(u.b, { type: 'expense.correct', ...real })], pre);
  check('…a real one still lands', fixR.rejected.length === 0 && (fixR.fold.balances[m.a] ?? 0) === 0);

  // F11 — legitimately huge totals still make a readable checkpoint.
  const big = V1_LIMITS.MAX_PAISE;
  const huge = fold([d(u.a, exp(id(), big, m.a, m.b)), d(u.a, exp(id(), big, m.a, m.b))], asB.fold).fold;
  const hcp = buildCheckpoint(huge);
  const back = parseEvent(encodeEvent({ type: 'group.checkpoint', ...hcp }, at(99)))?.event;
  check('two ₹10-crore expenses: the checkpoint still parses and matches', huge.balances[m.a] === 2 * big && back && sameCheckpoint(back, hcp));

  // F02 — which checkpoints this phone may vouch for.
  const v = fold([cp], pre).fold;
  check('a matching checkpoint is recorded as verified, with its author', v.verifiedCheckpoint?.seq === cp.seq && v.verifiedCheckpoint?.by === u.a);
  check('…not on a phone that adopted it', !fold([cp]).fold.verifiedCheckpoint);
  const lie = { ...d(u.b, { type: 'group.checkpoint', ...buildCheckpoint(pre), debts: [] }), seq: pre.seq + 1 };
  const lied = fold([lie], pre).fold;
  check('…nor a false one (mismatch kept, never vouched for)', lied.checkpointMismatch === lie.seq && !lied.verifiedCheckpoint);
  const legacyCp = { ...buildCheckpoint(pre) };
  delete legacyCp.bindings; delete legacyCp.frozenExpenses; delete legacyCp.frozenOther;
  check('a checkpoint from before Oct-24 still verifies (missing fields aren\'t compared)',
    !fold([d(u.a, { type: 'group.checkpoint', ...legacyCp })], pre).fold.checkpointMismatch);

  // F12 — the status line says when it isn't really live.
  const { groupSyncStatus, STALE_AFTER_MS } = await import('../../utils/groupSyncStatus.ts');
  const members = { [m.a]: { name: 'A', userId: u.a, archived: false }, [m.b]: { name: 'B', userId: u.b, archived: false } };
  const sh = (extra) => ({ type: 'shared', shared: { status: 'active', outbox: [], syncedAt: new Date(0).toISOString(), fold: { ...pre, members }, ...extra } });
  const now = Date.parse('2026-11-02T00:00:00Z');
  check('two people, no trouble → live', groupSyncStatus(sh({}), now) === 'live');
  check('balances disagree → mismatch, not live', groupSyncStatus(sh({ fold: { ...pre, members, checkpointMismatch: 6 } }), now) === 'mismatch');
  check('sync failing and last good one long ago → stale', groupSyncStatus(sh({ syncFailedAt: new Date(now).toISOString() }), now) === 'stale');
  check('…a failure right after a good sync isn\'t (the retry is on it)',
    groupSyncStatus(sh({ syncFailedAt: new Date(now).toISOString(), syncedAt: new Date(now - STALE_AFTER_MS + 1000).toISOString() }), now) === 'live');
}

console.log('\n— my bank record vs a peer\'s edit (F07) —');
{
  const BUILT = new Set(['food', 'other']);
  const me = randomUuid(rand), priya = randomUuid(rand), e = randomUuid(rand);
  const bodyOf = (paise, paidBy = me) => ({ entityId: e, amountPaise: paise, title: 'Dinner', categoryId: 'food', date: '2026-11-01', paidBy, shares: [{ memberId: me, paise: paise / 2 }, { memberId: priya, paise: paise / 2 }] });
  const foldWith = (body) => ({ ...emptyFold(), members: { [me]: { name: 'Me', userId: 'u1', archived: false }, [priya]: { name: 'Priya', userId: 'u2', archived: false } }, memberOrder: [me, priya],
    entries: { [e]: { kind: 'expense', createdBy: 'u1', data: body, versions: [], deleted: null, frozen: false } } });
  const group = (body) => ({ id: 'g', name: 'Trip', type: 'shared', members: [{ memberId: 'me', name: 'You', isMe: true }, { memberId: 'c_1', name: 'Priya' }],
    shared: { remoteId: 'r', keys: {}, keyEpoch: 1, myMemberId: me, memberMap: { me, c_1: priya }, fold: foldWith(body), status: 'active', syncedAt: null, outbox: [] } });
  const sms = { id: 't1', type: 'debit', amount: 1000, merchant: 'Dinner', categoryId: 'food', createdAt: '2026-11-01', accountId: 'acc1', groupId: 'g', syncId: e, source: 'sms',
    groupSplit: { paidByMemberId: 'me', shares: [{ memberId: 'me', shareAmount: 500 }, { memberId: 'c_1', shareAmount: 500 }] } };

  const bumped = group(bodyOf(120000));
  check('Priya changes the amount of my SMS expense: my phone doesn\'t apply it', !planIncoming(bumped, [sms], BUILT).some((o) => o.kind === 'update'));
  const back = planOutgoing(bumped, [sms], () => randomUuid(rand), BUILT, '2026-11-01T00:00:00Z');
  check('…and sends my bank\'s amount back as the newest version',
    back?.shared.outbox.some((o) => o.event.type === 'expense.upsert' && o.event.amountPaise === 100000));
  check('…same when she says someone else paid', !planIncoming(group(bodyOf(100000, priya)), [sms], BUILT).some((o) => o.kind === 'update'));
  const resplit = group({ ...bodyOf(100000), shares: [{ memberId: me, paise: 30000 }, { memberId: priya, paise: 70000 }] });
  const ops = planIncoming(resplit, [sms], BUILT);
  check('a new split of the same amount and payer still applies', ops.some((o) => o.kind === 'update' && o.fields.groupSplit.shares.some((x) => x.memberId === 'c_1' && x.shareAmount === 700)));
  const manual = { ...sms, source: 'manual' };
  check('a manual entry follows the group as before', planIncoming(bumped, [manual], BUILT).some((o) => o.kind === 'update' && o.fields.amount === 1200));
}

console.log('\n— a paisa known only from a checkpoint (F18) —');
{
  const { planBalanceRows } = await import('../../sync/balances.ts');
  const me = randomUuid(rand), priya = randomUuid(rand);
  const fold = { ...emptyFold(), members: { [me]: { name: 'Me', userId: 'u1', archived: false }, [priya]: { name: 'Priya', userId: 'u2', archived: false } }, memberOrder: [me, priya] };
  const [a, b] = me < priya ? [me, priya] : [priya, me];
  fold.debts = { [`${a}|${b}`]: a === me ? 1 : -1 };   // Priya owes me ₹0.01
  const g = { id: 'g', name: 'Trip', type: 'shared', members: [{ memberId: 'me', name: 'You', isMe: true }, { memberId: 'c_1', name: 'Priya' }],
    shared: { remoteId: 'r', keys: {}, keyEpoch: 1, myMemberId: me, memberMap: { me, c_1: priya }, fold, status: 'active', syncedAt: null, outbox: [] } };
  const rows = planBalanceRows(g, [], [], '2026-11-01T00:00:00Z');
  check('₹0.01 with no rows here → an Earlier Balance row, so Settle and Leave agree', rows.length === 1 && rows[0].kind === 'lbCreate' && rows[0].row.amount === 0.01, JSON.stringify(rows));
}

console.log(`\n${'─'.repeat(34)}\n  ${fail ? '\x1b[31m' : '\x1b[32m'}${pass}/${pass + fail} passed\x1b[0m`);
if (fail) process.exit(1);
