import React, { useCallback, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Modal from './AppModal';
import GradientButton from './GradientButton';
import SheetCloseButton from './SheetCloseButton';
import SplitConfigModal from './SplitConfigModal';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree } from '../hooks/useCategoryTree';
import { useEPurseStore } from '../store/ePurseStore';
import { DIVIDER_W, radius, spacing, typography } from '../constants/theme';
import { LB_CHILD_LABEL_TO_ID, LB_ALL_CATS, LB_SETTLEMENT_IDS, twoTierToLegacyCatId } from '../constants/twoTierCategories';
import { CategoryTreeList } from './CategoryPickerModal';
import { useFocusBorder } from './FormField';
import { buildCategoryHistory, suggestCategory } from '../utils/categorySuggest';
import { quickPicks, searchCategories } from '../utils/categoryQuickPick';
import { canSplitTransaction } from '../utils/split';
import { formatCurrency } from '../utils/format';
import { applyManageDraft, createManageDraft, manageDraftChanged } from '../utils/manageTransactionDraft';

// A fresh draft per opening. Closing never writes to the ledger.
export default function ManageTransactionModal(props) {
  if (!props.visible || !props.transaction) return null;
  return <ManageSession key={props.transaction.id} {...props} />;
}

function ManageSession({ transaction: txn, categories, categoryLocked, linkedPerson,
  onClose, onManaged, fromQueue = false, onSelectCategory,
  onSelectLentBorrow, onPressSplit, onToggleHidden, onIgnore, onRestore, onDelete,
  onPressAddToGroup, onPressRemoveFromGroup, canRefund, onToggleRefund }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const navigation = useNavigation();
  const tree = useCategoryTree();
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const [draft, setDraft] = useState(() => createManageDraft(txn));
  const [panel, setPanel] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [splitValid, setSplitValid] = useState(true);
  const [splitStarted, setSplitStarted] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const searchFocus = useFocusBorder();
  const transactions = useEPurseStore((s) => s.transactions);
  const userRules = useEPurseStore((s) => s.userCustomRules);
  const committing = useRef(false);
  const changed = manageDraftChanged(txn, draft);
  const patch = (values) => { setError(''); setDraft((old) => ({ ...old, ...values })); };
  const account = accounts.find((item) => item.id === txn.accountId);
  // Account names are usually already "HDFC ··4521" — only add the mask when missing.
  const accountName = account?.name || txn.bankName || txn.accountType || '';
  const accountLabel = txn.accountMask && !accountName.includes(txn.accountMask)
    ? `${accountName}${accountName ? ' ' : ''}··${txn.accountMask}` : accountName;
  const date = txn.createdAt ? new Date(txn.createdAt) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
    : '';
  // Header is two lines max: merchant + amount, then account · date.
  const contextMeta = [accountLabel, dateLabel].filter(Boolean).join(' · ');
  const group = groups.find((item) => item.id === draft.groupId);
  const directSplit = draft.split ? draft.split.others.length > 0 : !!txn.isSplit;
  // Actions that don't apply to this transaction are hidden, never shown disabled.
  const ignoreAvailable = txn.isIgnored ? !!onRestore : !!onIgnore;
  const groupAvailable = !!(onPressAddToGroup || onPressRemoveFromGroup);
  const splitAllowed = !!onPressSplit && canSplitTransaction({ ...txn, ...draft }) && !draft.specialCategory;
  // Groups are for money out, and never on top of a direct split (picking a group
  // would silently drop it — remove the split first).
  const groupAllowed = !draft.isIgnored && !txn.lbLocked && !draft.specialCategory
    && txn.type !== 'credit' && !directSplit;
  const splitTransaction = useMemo(() => ({ ...txn, categoryId: draft.categoryId,
    isIgnored: draft.isIgnored, groupId: draft.groupId }), [txn, draft.categoryId, draft.isIgnored, draft.groupId]);

  const changePanel = (next) => { setPanel((old) => old === next ? null : next); setError(''); };
  // Closing never writes, so it needs no confirm — the draft is simply dropped.
  const close = onClose;
  const back = () => setPanel(null);
  const selectCategory = (categoryId, parentCategory, childCategory, specialCategory = null) => {
    if (specialCategory && draft.split?.others.length) {
      setError('Save or remove the person split before switching to a linked payment or settlement.');
      return;
    }
    patch({ categoryId, parentCategory, childCategory, specialCategory });
    back();
  };
  // A sub-category tap from chips, search or the full list. Lent/Borrowed children
  // become a special category that opens the person-link flow on Done.
  const chooseChild = (item, child) => {
    const special = onSelectLentBorrow ? LB_CHILD_LABEL_TO_ID[child.label] : null;
    setQuery('');
    selectCategory(special || child.legacyId || item.legacyId || twoTierToLegacyCatId(item.label, child.label), item.label, child.label, special || null);
  };
  const chooseSpecial = (id) => { setQuery(''); selectCategory(id, undefined, undefined, id); };

  // One-tap picks: current → what this merchant was tagged before → most used.
  // Lent/Borrowed stay out (they need a person — search or the full list);
  // Income only for money in.
  // The add form's merchant → category suggester (history → user rules → brand /
  // keyword dictionary), here for the merchant AND for typed search text.
  // Never Transfers (Lent/Borrowed need a person); Income only for money in.
  const others = useMemo(() => transactions.filter((t) => t.id !== txn.id), [transactions, txn.id]);
  const suggest = useMemo(() => {
    const history = buildCategoryHistory(others, (id) => LB_ALL_CATS.has(id ?? ''));
    const allowParent = (p) => p !== 'Transfers' && (txn.type === 'credit' || p !== 'Income');
    return (text) => suggestCategory(text, { history, userRules: userRules || undefined, allowParent });
  }, [others, userRules, txn.type]);
  const picks = useMemo(() => {
    const suggestion = suggest(txn.merchant || '');
    return quickPicks({
      tree,
      transactions: others,
      current: { parentCategory: txn.parentCategory, childCategory: txn.childCategory },
      suggestion,
      allow: (p, c) => !LB_CHILD_LABEL_TO_ID[c.label] && (txn.type === 'credit' || p.label !== 'Income'),
    });
  }, [tree, others, suggest, txn]);
  // Settlements + Credit Card Bill aren't tree children — searchable by name.
  const specials = useMemo(() => [
    ...categories.filter((item) => LB_SETTLEMENT_IDS.has(item.id)),
    categories.find((item) => item.id === 'cc_bill') || { id: 'cc_bill', name: 'Credit Card Bill', emoji: '💳' },
  ], [categories]);
  // A pick made via search / the full list joins the chips (front), so it shows as selected.
  const draftParent = tree.find((item) => item.label === draft.parentCategory);
  const draftChild = draftParent?.children.find((c) => c.label === draft.childCategory);
  const shownPicks = draftChild && !picks.some((p) => p.parent.label === draftParent.label && p.child.label === draftChild.label)
    ? [{ parent: draftParent, child: draftChild }, ...picks.slice(0, 4)] : picks;
  const q = query.trim().toLowerCase();
  // Search results are chips too, capped (no inner scroll inside the sheet's own
  // scroll). A parent-name match lists its children; the parent is implied.
  const SEARCH_MAX = 8;
  const specialResults = q ? specials.filter((item) => item.name.toLowerCase().includes(q)).slice(0, 2) : [];
  // Typed text as a merchant/item ("petrol", "swiggy") → one suggested chip, AFTER
  // the category-name matches so it never pushes a direct match down.
  const typedSuggestion = q ? suggest(q) : null;
  const typedPick = typedSuggestion ? tree.find((p) => p.label === typedSuggestion.parentCategory) : null;
  const typedChild = typedPick?.children.find((c) => c.label === typedSuggestion.childCategory);
  const nameMatches = q ? searchCategories(tree, q, SEARCH_MAX - specialResults.length) : [];
  const typedExtra = typedChild && !nameMatches.some((r) => r.parent.label === typedPick.label && r.child.label === typedChild.label)
    ? [{ parent: typedPick, child: typedChild }] : [];
  const results = [...nameMatches.slice(0, SEARCH_MAX - specialResults.length - typedExtra.length), ...typedExtra];
  // Labels like "Other" exist under several parents — name the parent only then.
  const dupLabels = new Set(results.map((r) => r.child.label).filter((l, i, a) => a.indexOf(l) !== i));
  const currentSpecial = !draft.parentCategory ? specials.find((item) => item.id === draft.categoryId) : null;
  const openAll = () => { setQuery(''); setPanel('category'); };

  const onSplitDraft = useCallback(({ edited, valid, others, meta }) => {
    setSplitValid(valid);
    if (edited) setDraft((old) => ({ ...old, split: { others, meta } }));
  }, []);

  const commit = () => {
    if (committing.current) return;
    committing.current = true;
    try {
      // Shared groups retain their existing who-paid/who-owes editor. Choosing
      // one here does not prematurely attach it or invent a second split model.
      const shared = group?.type === 'shared' && draft.groupId !== (txn.groupId || null);
      applyManageDraft(useEPurseStore, txn, shared ? { ...draft, groupId: txn.groupId || null } : draft);
      if (draft.specialCategory) {
        if (draft.specialCategory === 'cc_bill') onSelectCategory('cc_bill');
        else (onSelectLentBorrow || onSelectCategory)(draft.specialCategory);
        return;
      }
      if (shared) {
        onClose();
        navigation.navigate('AddGroupExpense', { groupId: group.id, tagTxnId: txn.id, ...(fromQueue ? { fromQueue: true } : {}) });
        return;
      }
      if (!draft.isIgnored) onManaged?.(txn.id);
      onClose();
    } catch (e) {
      setConfirmation(null);
      setError(e.message || 'Could not save these changes. Please try again.');
    } finally { committing.current = false; }
  };
  const done = () => {
    if (draft.isIgnored !== !!txn.isIgnored) setConfirmation('save');
    else commit();
  };
  // One size everywhere; each action keeps its own colour. `selected` = on in the draft.
  const action = (label, icon, tone, selected, onPress, flex = 1) => (
    <TouchableOpacity key={label} onPress={onPress} activeOpacity={0.85}
      accessibilityRole="button" accessibilityState={{ selected }}
      style={[styles.action, { flex, backgroundColor: tone + (selected ? '2E' : '14'), borderColor: tone + (selected ? 'CC' : '55') }]}>
      <Ionicons name={selected ? 'checkmark-circle' : icon} size={18} color={tone} />
      <Text style={[styles.actionTitle, { color: tone }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
  const chip = (key, emoji, label, on, color, onPress) => (
    <TouchableOpacity key={key} onPress={onPress} activeOpacity={0.72}
      accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[styles.chip, on && { backgroundColor: color, borderColor: color }]}>
      <Text style={styles.chipEmoji}>{emoji}</Text>
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
  // A sub-category chip; picking it sets its parent too (from the tree).
  const childChip = (item, child, showParent) => chip(`${item.id}-${child.id}`, child.emoji,
    showParent ? `${child.label} · ${item.label}` : child.label,
    draft.parentCategory === item.label && draft.childCategory === child.label, item.color, () => chooseChild(item, child));
  // Last chip of the search results — opens the full category list.
  const allChip = (
    <TouchableOpacity key="all" onPress={() => { setQuery(''); setPanel('category'); }} activeOpacity={0.72}
      accessibilityRole="button" accessibilityLabel="All categories"
      style={[styles.chip, styles.allChip]}>
      <Text style={[styles.chipLabel, { color: theme.primary }]}>All</Text>
      <Ionicons name="chevron-forward" size={14} color={theme.primary} />
    </TouchableOpacity>
  );
  const row = (label, emoji, selected, onPress, subtitle) => (
    <TouchableOpacity key={label} style={[styles.row, selected && styles.selectedRow]} onPress={onPress}
      accessibilityRole="button" accessibilityState={{ selected }} activeOpacity={0.75}>
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.grow}><Text style={styles.rowTitle}>{label}</Text>{!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}</View>
      <Ionicons name={selected ? 'checkmark-circle' : 'chevron-forward'} size={20} color={selected ? theme.primary : theme.textMuted} />
    </TouchableOpacity>
  );
  const splitEditing = panel === 'split';
  const saveDisabled = !changed || (draft.split !== null && !splitValid)
    || (splitEditing && !splitValid && !draft.isIgnored);
  // Only Ignore / Restore asks before saving (balances and totals move).
  let confirmTitle = draft.isIgnored ? 'Ignore Transaction?' : 'Restore Transaction?';
  const sharedGroupSplit = !!txn.groupId && groups.find((g) => g.id === txn.groupId)?.type === 'shared';
  let confirmBody = draft.isIgnored
    ? `Ignore removes it from your balances and every total and chart. It will be treated as if it never happened.${
      txn.isSplit || txn.isSplitMemo ? ' Its split is removed too — Restore brings it back without one.'
      : sharedGroupSplit ? ' It also leaves its group and that split — Restore brings it back without them.' : ''}`
    : 'Restore adds it back to balances, totals, and charts.';
  if (confirmation === 'delete') { confirmTitle = 'Delete Transaction?'; confirmBody = 'This action cannot be undone.'; }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => confirmation ? setConfirmation(null) : panel === 'category' ? back() : close()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={close} accessibilityLabel="Close Manage transaction" />
        <SheetCloseButton onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.heading}>
            {(panel === 'category' || confirmation) && <TouchableOpacity onPress={() => confirmation ? setConfirmation(null) : back()} style={styles.backButton} accessibilityLabel="Back to Manage transaction"><Ionicons name="chevron-back" size={22} color={theme.textPrimary} /></TouchableOpacity>}
            <Text style={styles.title}>{confirmation ? confirmTitle : panel === 'category' ? 'Select Category' : 'Manage Transaction'}</Text>
          </View>
          {confirmation ? <>
            <Text style={styles.confirmBody}>{confirmBody}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.cancel} onPress={() => setConfirmation(null)}><Text style={styles.rowTitle}>Cancel</Text></TouchableOpacity>
              <GradientButton style={styles.grow} title={confirmation === 'delete' ? 'Delete' : draft.isIgnored ? 'Ignore' : 'Restore'}
                {...(confirmation === 'delete' ? { colors: [theme.danger, theme.danger], textStyle: { color: '#FFFFFF' } } : {})}
                onPress={() => {
                  if (confirmation === 'delete') { useEPurseStore.getState().deleteTransaction(txn.id); onClose(); }
                  else commit();
                }} />
            </View>
          </> : <>
            {panel !== 'category' && <View style={styles.context}>
              <View style={styles.avatar}><Ionicons name="receipt-outline" size={23} color={theme.primary} /></View>
              <View style={styles.grow}>
                <Text style={styles.merchant} numberOfLines={1}>{txn.merchant || 'Transaction'}</Text>
                {!!contextMeta && <Text style={styles.meta} numberOfLines={1}>{contextMeta}</Text>}
              </View>
              <Text style={styles.amount}>{formatCurrency(txn.amount)}</Text>
            </View>}
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyContent}>
              {panel === 'category' ? <>
                {/* The pre-revamp accordion picker (shared CategoryTreeList). */}
                <CategoryTreeList
                  categories={categories}
                  selectedCategoryId={draft.categoryId}
                  selectedParent={draft.parentCategory}
                  selectedChild={draft.childCategory}
                  onSelectTwoTier={chooseChild}
                  onSelectSettlement={chooseSpecial}
                  onSelectCategory={chooseSpecial}
                />
              </> : <>
                {!!txn.note && txn.note.trim().toLowerCase() !== (txn.merchant || '').trim().toLowerCase() && <Text style={styles.note}>{txn.note}</Text>}
                <Text style={styles.sectionLabel}>Category</Text>
                {categoryLocked ? <View style={styles.notice}><Ionicons name="lock-closed-outline" size={20} color={theme.primary} /><Text style={styles.noticeText}>{linkedPerson ? `Linked to ${linkedPerson}. Category is locked.` : 'Linked to a lent/borrow record. Category is locked.'}</Text></View>
                  : <>
                    <View style={[styles.search, searchFocus.focusStyle]}>
                      <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
                      <TextInput value={query} onChangeText={setQuery} placeholder="Search categories"
                        placeholderTextColor={theme.textMuted} style={styles.searchInput} returnKeyType="search"
                        onFocus={searchFocus.onFocus} onBlur={searchFocus.onBlur} accessibilityLabel="Search categories" />
                      {/* Arrow while empty; once typing, the "All" chip ends the results instead. */}
                      {!q && <TouchableOpacity onPress={openAll} hitSlop={8} style={styles.searchAll}
                        accessibilityRole="button" accessibilityLabel="All categories">
                        <Ionicons name="chevron-forward" size={18} color={theme.primary} />
                      </TouchableOpacity>}
                    </View>
                    {q ? (results.length || specialResults.length ? <View style={styles.chips}>
                      {results.map(({ parent: item, child }) => childChip(item, child, dupLabels.has(child.label)))}
                      {specialResults.map((item) => chip(item.id, item.emoji, item.name, draft.categoryId === item.id, theme.primary, () => chooseSpecial(item.id)))}
                      {allChip}
                    </View> : <TouchableOpacity style={styles.link} onPress={openAll}>
                      <Text style={styles.linkText}>No match — Browse All Categories</Text>
                    </TouchableOpacity>) : <View style={styles.chips}>
                      {currentSpecial && chip(currentSpecial.id, currentSpecial.emoji, currentSpecial.name, true, theme.primary, () => {})}
                      {shownPicks.map(({ parent: item, child }) => childChip(item, child, false))}
                    </View>}
                  </>}
                {draft.specialCategory && <Text style={styles.explanation}>Done opens {draft.specialCategory === 'cc_bill' ? 'the credit-card payment reconciliation' : 'the person-link'} flow to finish this change.</Text>}
                <Text style={styles.sectionLabel}>Actions</Text>
                <View style={styles.actions}>
                  {/* Ignore and Private are exclusive — Private hides while ignored. */}
                  {!!onToggleHidden && !draft.isIgnored && action('Private', 'eye-off-outline', theme.success, draft.isHidden, () => { patch({ isHidden: !draft.isHidden }); changePanel('private'); })}
                  {ignoreAvailable && action(txn.isIgnored ? 'Restore' : 'Ignore', txn.isIgnored ? 'refresh-outline' : 'ban-outline', txn.isIgnored ? theme.success : theme.warning, draft.isIgnored !== !!txn.isIgnored, () => { patch(draft.isIgnored ? { isIgnored: false, isHidden: !!txn.isHidden && !txn.isIgnored } : { isIgnored: true, isHidden: false }); changePanel('ignore'); })}
                  {splitAllowed && action(directSplit ? 'Edit Split' : 'Split', 'pie-chart-outline', theme.info, splitEditing, () => { setSplitStarted(true); changePanel('split'); })}
                </View>
                {!!(onDelete || (groupAvailable && groupAllowed)) && <View style={styles.actionsSecond}>
                  {!!onDelete && <TouchableOpacity style={styles.deleteIcon} onPress={() => setConfirmation('delete')} activeOpacity={0.85}
                    accessibilityRole="button" accessibilityLabel="Delete transaction">
                    <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
                    {!(groupAvailable && groupAllowed) && <Text style={styles.deleteText}>Delete Transaction</Text>}
                  </TouchableOpacity>}
                  {groupAvailable && groupAllowed && action(group ? group.name : 'Add to Group', 'people-outline', theme.primary, panel === 'group', () => changePanel('group'), 4)}
                </View>}
                {panel === 'private' && <Text style={styles.explanation}>{draft.isHidden ? 'Hidden from default views, but still counted in totals. Find it using the Private filter in Activity.' : 'Visible in default views again.'}</Text>}
                {panel === 'ignore' && <Text style={styles.explanation}>{draft.isIgnored ? 'Excluded from balances, totals and charts. Your existing category and tags are retained.' : 'Included in balances, totals and charts.'}</Text>}
                {splitStarted && <View style={panel === 'split' && splitAllowed ? undefined : { display: 'none' }}>
                  <SplitConfigModal embedded visible transaction={splitTransaction} initialDraft={draft.split} onDraftChange={onSplitDraft} onClose={() => setPanel(null)} onApply={(others, meta) => { patch({ split: { others, meta } }); setSplitValid(true); setSplitStarted(false); setPanel(null); }} />
                </View>}
                {panel === 'group' && groupAllowed && <View>
                  <Text style={styles.sectionLabel}>Select Group</Text>
                  {!!onPressRemoveFromGroup && row('No group', '−', !draft.groupId, () => patch({ groupId: null }))}
                  {!!onPressAddToGroup && groups.map((item) => row(item.name, item.emoji || '👥', item.id === draft.groupId,
                    () => { if (draft.split?.others.length) { setError('Finish or remove the person split before choosing a group. Group splits use the existing group editor.'); return; } patch({ groupId: item.id }); }, item.type === 'shared' ? 'Shared · opens group expense editor' : 'Personal group'))}
                  {!groups.length && <Text style={styles.explanation}>No groups yet.</Text>}
                  {!!onPressAddToGroup && <TouchableOpacity style={styles.link} onPress={() => { if (changed) { setError('Save or discard your changes before creating a group.'); return; } onClose(); navigation.navigate('Groups'); }}><Text style={styles.linkText}>Create a Group</Text></TouchableOpacity>}
                </View>}
                {!!canRefund && !!onToggleRefund && !draft.isIgnored && <View style={styles.actionsSecond}>
                  {action(draft.isRefund ? 'Refund — Reduces Your Spend' : 'Mark as Refund / Cashback', 'return-down-back-outline', draft.isRefund ? theme.income : theme.textSecondary, draft.isRefund, () => patch({ isRefund: !draft.isRefund }))}
                </View>}
              </>}
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            </ScrollView>
            {panel !== 'category' && <View style={styles.footer}><GradientButton flat title="Done" onPress={done} disabled={saveDisabled} /></View>}
          </>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '75%', backgroundColor: t.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.lg },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.divider, alignSelf: 'center', marginBottom: spacing.md },
  heading: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  backButton: { paddingVertical: 6, paddingRight: spacing.sm },
  title: { ...typography.h3, fontWeight: '700', color: t.textPrimary, flex: 1 },
  context: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: DIVIDER_W, borderBottomColor: t.divider },
  avatar: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: t.primary + '12', alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  merchant: { ...typography.bodyBold, color: t.textPrimary },
  amount: { ...typography.bodyBold, color: t.textPrimary, maxWidth: '38%' },
  meta: { ...typography.tiny, color: t.textSecondary, marginTop: 3 },
  body: { flexShrink: 1 },
  bodyContent: { paddingTop: spacing.sm, paddingBottom: spacing.sm },
  sectionLabel: { ...typography.small, fontWeight: '700', color: t.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: t.background, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent', marginBottom: spacing.xs },
  selectedRow: { borderColor: t.primary, backgroundColor: t.primary + '0D' },
  rowTitle: { ...typography.bodyBold, color: t.textPrimary },
  emoji: { fontSize: 22 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  actionsSecond: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm + 4, paddingHorizontal: spacing.sm, borderWidth: 1, borderRadius: radius.md },
  actionTitle: { ...typography.small, fontWeight: '700', flexShrink: 1 },
  deleteIcon: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm + 4, borderRadius: radius.md, backgroundColor: t.danger },
  deleteText: { ...typography.small, fontWeight: '700', color: '#FFFFFF' },
  explanation: { ...typography.small, color: t.textSecondary, lineHeight: 18, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: t.background, borderRadius: radius.md, marginTop: spacing.sm },
  note: { ...typography.small, color: t.textSecondary, padding: spacing.sm, backgroundColor: t.background, borderRadius: radius.md },
  notice: { flexDirection: 'row', gap: spacing.sm, backgroundColor: t.primary + '0D', padding: spacing.md, borderRadius: radius.md },
  noticeText: { ...typography.small, color: t.textSecondary, flex: 1 },
  link: { paddingVertical: spacing.sm },
  linkText: { ...typography.small, color: t.primary, fontWeight: '700' },
  footer: { paddingTop: spacing.sm, borderTopWidth: DIVIDER_W, borderTopColor: t.divider },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, minHeight: 44, borderWidth: 1, borderColor: t.divider, borderRadius: radius.md, marginBottom: spacing.sm },
  searchInput: { flex: 1, paddingVertical: spacing.sm + 2, color: t.textPrimary, ...typography.body },
  searchAll: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: t.primary + '14' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1.5, borderColor: t.divider, backgroundColor: t.card },
  chipEmoji: { fontSize: 14 },
  chipLabel: { fontSize: 13, fontWeight: '600', color: t.textPrimary, flexShrink: 1 },
  chipLabelOn: { color: '#FFFFFF' },
  allChip: { gap: 2, borderColor: t.primary + '55', backgroundColor: t.primary + '0D' },
  error: { ...typography.small, color: t.danger, marginTop: spacing.sm },
  confirmBody: { ...typography.body, color: t.textSecondary, lineHeight: 23, marginVertical: spacing.lg },
  confirmActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancel: { flex: 1, alignItems: 'center', padding: spacing.md, backgroundColor: t.background, borderRadius: radius.md },
});
