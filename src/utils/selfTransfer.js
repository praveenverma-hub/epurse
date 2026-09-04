// =============================================================================
// Self-transfer detection — pure helpers (no React-Native / store deps)
// -----------------------------------------------------------------------------
// A "self transfer" is money moving between the user's OWN accounts (or to their
// own linked mobile / name). Real money moves, so balances still update, but it
// is neither income nor expense and must be excluded from all spend/income
// totals (categoryId = 'self').
//
// These functions live here (not inline in the store) so the parser test suite
// can exercise the REAL detection logic without importing the heavy store —
// keeping tests permanently in sync with shipping behaviour.
//
// A transaction is self when its OWN leg is a user account AND any one of:
//   (a) it names a counterparty mask that is ALSO a user account — either a
//       dual-leg SMS reporting both sides ("Acct XX171 debited … & Acct XX972
//       credited") or a solo leg that still names its destination/source via
//       transfer language ("debited from A/c X and transferred to A/c Y"),
//       which is what each half of a two-SEPARATE-SMS self-transfer looks
//       like on its own, or
//   (b) the counterparty mobile is the user's own registered number, or
//   (c) the counterparty NAME matches the user's own name
//       ("credited by a/c linked to mobile 7XXXXXX221-PRAVEEN VE"), or
//   (d) it shares a transfer reference (IMPS/UPI ref) with another leg that is
//       already known to be self — see propagateSelfByRef().
// =============================================================================

export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

/** Two masks match if one is a suffix of the other (≥3 shared trailing digits). */
export const maskMatch = (a, b) => {
  const x = onlyDigits(a);
  const y = onlyDigits(b);
  if (x.length < 3 || y.length < 3) return false;
  return x.endsWith(y) || y.endsWith(x);
};

export const maskInList = (mask, masks) =>
  !!mask && (masks || []).some((m) => maskMatch(mask, m));

/** A counterparty phone is the user's if a stored number shares ≥4 trailing digits. */
export const phoneIsUser = (cp, userPhones) => {
  const c = onlyDigits(cp);
  if (c.length < 4) return false;
  return (userPhones || []).some((p) => {
    const x = onlyDigits(p);
    return x.length >= 4 && (x.endsWith(c) || c.endsWith(x));
  });
};

/** Lowercase, strip non-alphanumerics → compact comparable token. */
const nameKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The counterparty name is the user's own if, after normalising, one is a
 * prefix of the other (banks truncate names, e.g. "PRAVEEN VE" for
 * "PRAVEEN VERMA"). Requires the shorter form to be ≥5 chars so short names
 * can't trivially collide and mis-tag a real incoming payment as self.
 */
export const nameIsUser = (counterpartyName, userName) => {
  const c = nameKey(counterpartyName);
  const u = nameKey(userName);
  if (!c || !u) return false;
  const shorter = c.length <= u.length ? c : u;
  if (shorter.length < 5) return false;
  return u.startsWith(c) || c.startsWith(u);
};

export const SELF_TXN_FIELDS = {
  categoryId: 'self',
  parentCategory: 'Transfers',
  childCategory: 'Self',
  isSelfTransfer: true,
};

/**
 * @param {object} txn        parsed transaction (with self-transfer hints)
 * @param {string[]} userMasks every known account mask (all the user's own)
 * @param {string[]} userPhones the user's registered mobile numbers
 * @param {string} [userName]  the user's name (for name-based matching)
 */
export const isSelfTransfer = (txn, userMasks, userPhones, userName) => {
  if (!txn) return false;
  if (!maskInList(txn.accountMask, userMasks)) return false; // own leg must be a user account
  // `counterpartyMask` already requires EITHER selfDualLeg OR transfer language
  // (see messageParser.js) — no need to re-check selfDualLeg here.
  if (maskInList(txn.counterpartyMask, userMasks)) return true;
  if (txn.counterpartyPhone && phoneIsUser(txn.counterpartyPhone, userPhones)) return true;
  if (txn.counterpartyName && nameIsUser(txn.counterpartyName, userName)) return true;
  return false;
};

/**
 * Cross-leg linkage: a single self transfer is often reported twice — once by
 * the sending bank (dual-leg "171 debited & 972 credited") and once by the
 * receiving bank ("972 credited by mobile …"). Both legs carry the SAME
 * transfer reference (IMPS/UPI ref). Once either leg is known to be self, the
 * shared reference lets us tag the other leg too — an exact-match link with no
 * false positives.
 *
 * Deliberately does NOT originate a self-tag from a shared ref alone (i.e. two
 * untagged legs sharing a ref are not, on their own, treated as self) — real
 * IMPS/NEFT/UPI reference numbers can coincidentally collide between totally
 * UNRELATED transactions from different banks (see the regression case in
 * `storeIntegration.test.mjs`: an unrelated ₹1500 credit and ₹15,000 transfer
 * between other people's accounts, sharing one ref by chance). A ref is only
 * trustworthy once ONE leg is already confirmed self by a stronger signal —
 * see `isSelfTransfer`'s case (a) for how the common two-SEPARATE-SMS
 * self-transfer is actually originated (each leg names the other account
 * directly, not via ref).
 *
 * Returns a NEW array; transactions on a user account that share a transferRef
 * with an already-self transaction are tagged self. Leaves user-edited and
 * lent/borrow-locked rows untouched.
 *
 * @param {object[]} transactions
 * @param {string[]} userMasks
 */
export const propagateSelfByRef = (transactions, userMasks) => {
  const selfRefs = new Set(
    (transactions || [])
      .filter((t) => t && t.categoryId === 'self' && t.transferRef)
      .map((t) => t.transferRef),
  );
  if (selfRefs.size === 0) return transactions;
  return (transactions || []).map((t) => {
    if (!t || t.userEditedCategory || t.lbLocked || t.categoryId === 'self') return t;
    if (t.transferRef && selfRefs.has(t.transferRef) && maskInList(t.accountMask, userMasks)) {
      return { ...t, ...SELF_TXN_FIELDS };
    }
    return t;
  });
};
