import { canSplitTransaction } from './split';

export function createManageDraft(txn) {
  return {
    categoryId: txn.categoryId,
    parentCategory: txn.parentCategory,
    childCategory: txn.childCategory,
    isHidden: !!txn.isHidden,
    isIgnored: !!txn.isIgnored,
    isRefund: !!txn.isRefund,
    groupId: txn.groupId || null,
    split: null, // null means untouched, { others: [] } explicitly removes it
    specialCategory: null,
  };
}

export function manageDraftChanged(txn, draft) {
  const original = createManageDraft(txn);
  return Object.keys(original).some((key) => JSON.stringify(original[key]) !== JSON.stringify(draft[key]));
}

/** Commit through the existing ledger actions; never patch transaction fields
 * directly, since ignore/group/split also maintain balances and linked rows. */
export function applyManageDraft(store, txn, draft) {
  const current = store.getState();
  const fresh = current.transactions.find((row) => row.id === txn.id);
  if (!fresh) throw new Error('This transaction is no longer available.');
  // Do not overwrite edits made elsewhere while this sheet was open.
  if (JSON.stringify(createManageDraft(fresh)) !== JSON.stringify(createManageDraft(txn))
    || fresh.amount !== txn.amount || fresh.isSplit !== txn.isSplit
    || fresh.lbLocked !== txn.lbLocked || fresh.accountId !== txn.accountId
    || JSON.stringify(fresh.splitWith) !== JSON.stringify(txn.splitWith)
    || JSON.stringify(fresh.groupSplit) !== JSON.stringify(txn.groupSplit)) {
    throw new Error('This transaction changed. Close Manage and reopen it to use the latest details.');
  }
  if (draft.groupId && !current.groups.some((group) => group.id === draft.groupId)) {
    throw new Error('This group is no longer available. Choose another group.');
  }
  if (draft.split?.others.length && !canSplitTransaction({ ...fresh, ...draft, isIgnored: false })) {
    throw new Error('This transaction uses a different split flow. Keep its existing group or category setup.');
  }
  if (draft.split?.others.length) {
    const { others, meta } = draft.split;
    const amountMode = meta?.mode === 'amount';
    const values = [amountMode ? meta.myAmount : meta?.myPercent,
      ...others.map((person) => amountMode ? person.shareAmount : person.percent)].map(Number);
    const target = amountMode ? Number(fresh.amount) : 100;
    if (values.some((value) => !Number.isFinite(value) || value < 0)
      || Math.abs(values.reduce((total, value) => total + value, 0) - target) > (amountMode ? 0.01 : 0)) {
      throw new Error('Check the split: all shares must add up to the full amount.');
    }
  }
  const categoryChanged = draft.categoryId !== txn.categoryId
    || draft.parentCategory !== txn.parentCategory || draft.childCategory !== txn.childCategory;
  if (categoryChanged && !draft.specialCategory && !txn.lbLocked) {
    if (draft.parentCategory && draft.childCategory) {
      current.updateTwoTierCategory(txn.id, draft.parentCategory, draft.childCategory);
    } else current.updateTransactionCategory(txn.id, draft.categoryId);
  }
  if (draft.isRefund !== !!txn.isRefund) current.setTransactionRefund(txn.id, draft.isRefund);
  // Restore first so the existing split/group guards see an active transaction —
  // and so Private can apply (the store refuses Private on an ignored txn).
  if (txn.isIgnored && !draft.isIgnored) current.unignoreTransaction(txn.id);
  if (draft.isHidden !== !!txn.isHidden) current.setTransactionHidden(txn.id, draft.isHidden);
  if (draft.groupId !== (txn.groupId || null)) {
    if (draft.groupId) current.tagTransactionToGroup(txn.id, draft.groupId);
    else current.untagTransactionFromGroup(txn.id);
  }
  if (draft.split) current.setTransactionSplit(txn.id, draft.split.others, draft.split.meta);
  if (!txn.isIgnored && draft.isIgnored) current.ignoreTransaction(txn.id);
}
