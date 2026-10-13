// =============================================================================
// Shared-group sync — crypto, invite links, event parsing, fold rules
//     npm run test:sync
// docs/SHARED_GROUP_SYNC.md §5–§8a. All pure: no Supabase, no device.
// =============================================================================
import {
  generateGroupKey, randomUuid, isUuid, sealEvent, openEvent, sha256Hex, toBase64Url, fromBase64Url,
} from '../../sync/crypto.ts';
import { newInvite, buildInviteLink, parseInviteLink, INVITE_BASE } from '../../sync/invite.ts';
import { encodeEvent, parseEvent, V1_LIMITS } from '../../sync/events.ts';
import { emptyFold, foldEvents, buildCheckpoint, buildCorrection, debtList } from '../../sync/fold.ts';
import { membersFromFold, planGroupChanges, toLocalMember, toRemoteMember, unclaimedMembers, metaOf } from '../../sync/localGroup.ts';

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
  check('query string instead of fragment → rejected', parseInviteLink(link.replace('#', '?')) === null);
  check('short key → rejected', parseInviteLink(link.replace(/k=[^&]+/, 'k=AAAA')) === null);
  check('bad invite id → rejected', parseInviteLink(link.replace(/i=[^&]+/, 'i=not-a-uuid')) === null);
  check('missing token → rejected', parseInviteLink(link.replace(/&t=[^&]+/, '')) === null);
  check('not a string → rejected', parseInviteLink(undefined) === null);
  check('a generic link has no person', parsed.memberId === null);
  const forPriya = randomUuid(rand);
  const personal = parseInviteLink(buildInviteLink(inv.inviteId, inv.token, key, forPriya));
  check('a link made for one person carries who', personal?.memberId === forPriya && personal.inviteId === inv.inviteId);
  check('…in the fragment, never the part a server sees', !buildInviteLink(inv.inviteId, inv.token, key, forPriya).split('#')[0].includes(forPriya));
  check('a malformed person id → rejected', parseInviteLink(`${link}&m=not-a-uuid`) === null);
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
  step(sys('member_left', U.amit));
  check('history keeps Amit after he leaves', f.members[M.amit].name === 'Amit' && !f.activeUsers.includes(U.amit));
  check('a member who left can\'t send events', step(data(U.amit, { type: 'member.rename', memberId: M.amit, name: 'A' })) === 'not_member');
}

{
  const lunch = randomUuid(rand);
  step(data(U.priya, expense(lunch, 2000, M.priya, [{ memberId: M.priya, paise: 1000 }, { memberId: M.rahul, paise: 1000 }])));
  const b = snapshot();
  check('only the creator deletes while they\'re a member', step(data(U.rahul, { type: 'expense.delete', entityId: lunch })) === 'not_creator');
  check('creator deletes; balances reverse exactly', step(data(U.priya, { type: 'expense.delete', entityId: lunch })) === null
    && f.balances[M.priya] === JSON.parse(b)[M.priya] - 1000);
  check('…the delete records who and when', f.entries[lunch].deleted?.by === U.priya && f.entries[lunch].deleted?.at === serverTime(seq));
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
  const badCorr = data(U.rahul, { type: 'expense.correct', entityId: randomUuid(rand), correctsId: live, title: 'Tea', date: '2026-10-14', debts: [], expense: null });
  const rh = foldEvents(h, [badCorr]), rj = foldEvents(j, [badCorr]);
  check('a correction aimed at a live expense is rejected on both', rh.rejected[0]?.reason === 'not_frozen' && rj.rejected[0]?.reason === 'not_frozen');
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
  check('metaOf drops a colour that isn\'t #rrggbb', metaOf({ name: 'G', emoji: '', color: 'rgb(1,2,3)' }).color === null && metaOf({ name: 'G', emoji: '', color: 'x' }).emoji === null);
  check('unclaimed list for "Who Are You?"', JSON.stringify(unclaimedMembers(shared).map((m) => m.name)) === JSON.stringify(['Priya S', 'Dev']));
}

console.log(`\n${'─'.repeat(34)}\n  ${fail ? '\x1b[31m' : '\x1b[32m'}${pass}/${pass + fail} passed\x1b[0m`);
if (fail) process.exit(1);
