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
import { LB_CHILD_LABEL_TO_ID, LB_SETTLEMENT_IDS, twoTierToLegacyCatId } from '../constants/twoTierCategories';
import { canSplitTransaction } from '../utils/split';
import { formatCurrency } from '../utils/format';
import { applyManageDraft, createManageDraft, manageDraftChanged } from '../utils/manageTransactionDraft';

// A fresh draft per opening. Closing never writes to the ledger.
export default function ManageTransactionModal(props) {
  if (!props.visible || !props.transaction) return null;
  return <ManageSession key={props.transaction.id} {...props} />;
}

function ManageSession({ transaction: txn, categories, categoryLocked, linkedPerson,
  onEditPerson, onClose, onManaged, fromQueue = false, onSelectCategory,
  onSelectLentBorrow, onPressSplit, onToggleHidden, onIgnore, onRestore, onDelete,
  onPressAddToGroup, onPressRemoveFromGroup, onPressEditGroup, canRefund, onToggleRefund }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const navigation = useNavigation();
  const tree = useCategoryTree();
  const groups = useEPurseStore((s) => s.groups);
  const accounts = useEPurseStore((s) => s.accounts);
  const [draft, setDraft] = useState(() => createManageDraft(txn));
  const [panel, setPanel] = useState(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [splitValid, setSplitValid] = useState(true);
  const [splitStarted, setSplitStarted] = useState(false);
  const [error, setError] = useState('');
  const committing = useRef(false);
  const changed = manageDraftChanged(txn, draft);
  const patch = (values) => { setError(''); setDraft((old) => ({ ...old, ...values })); };
  const account = accounts.find((item) => item.id === txn.accountId);
  const accountLabel = account?.name || txn.bankName || txn.accountType;
  const date = txn.createdAt ? new Date(txn.createdAt) : null;
  const category = categories.find((item) => item.id === draft.categoryId);
  const parent = tree.find((item) => item.label === draft.parentCategory);
  const categoryLabel = draft.parentCategory || category?.name || 'Uncategorised';
  const categoryEmoji = parent?.emoji || category?.emoji || '📌';
  const group = groups.find((item) => item.id === draft.groupId);
  const directSplit = draft.split ? draft.split.others.length > 0 : !!txn.isSplit;
  const splitAllowed = !!onPressSplit && canSplitTransaction({ ...txn, ...draft }) && !draft.specialCategory;
  const groupAllowed = !draft.isIgnored && !txn.lbLocked && !draft.specialCategory;
  const splitTransaction = useMemo(() => ({ ...txn, categoryId: draft.categoryId,
    isIgnored: draft.isIgnored, groupId: draft.groupId }), [txn, draft.categoryId, draft.isIgnored, draft.groupId]);

  const changePanel = (next) => { setPanel((old) => old === next ? null : next); setError(''); };
  const close = () => changed ? setConfirmation('discard') : onClose();
  const back = () => { setQuery(''); setPanel(null); };
  const selectCategory = (categoryId, parentCategory, childCategory, specialCategory = null) => {
    if (specialCategory && draft.split?.others.length) {
      setError('Save or remove the person split before switching to a linked payment or settlement.');
      return;
    }
    patch({ categoryId, parentCategory, childCategory, specialCategory });
    back();
  };
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
    if (draft.isIgnored !== !!txn.isIgnored || draft.isHidden !== !!txn.isHidden) setConfirmation('save');
    else commit();
  };
  const action = (label, icon, selected, onPress, disabled = false, hint) => (
    <TouchableOpacity key={label} onPress={onPress} disabled={disabled} activeOpacity={0.75}
      accessibilityRole="button" accessibilityState={{ selected, disabled }}
      style={[styles.action, !!panel && styles.actionCompact, selected && styles.actionSelected, disabled && styles.disabled]}>
      <Ionicons name={icon} size={22} color={selected ? theme.primary : theme.textSecondary} />
      <Text style={[styles.actionTitle, selected && { color: theme.primary }]}>{label}</Text>
      {!!hint && !panel && <Text style={styles.actionHint}>{hint}</Text>}
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
  const filteredTree = tree.map((item) => ({ ...item, children: item.label.toLowerCase().includes(query.toLowerCase().trim())
    ? item.children : item.children.filter((child) => child.label.toLowerCase().includes(query.toLowerCase().trim())) }))
    .filter((item) => item.children.length > 0 || item.label.toLowerCase().includes(query.toLowerCase().trim()));
  const specialRows = [
    ...categories.filter((item) => LB_SETTLEMENT_IDS.has(item.id)),
    { id: 'cc_bill', name: 'Credit Card Bill', emoji: '💳' },
  ].filter((item) => item.name.toLowerCase().includes(query.toLowerCase().trim()));
  const splitEditing = panel === 'split';
  const saveDisabled = !changed || (draft.split !== null && !splitValid)
    || (splitEditing && !splitValid && !draft.isIgnored);
  let confirmTitle = 'Save changes?';
  let confirmBody = '';
  if (confirmation === 'delete') { confirmTitle = 'Delete transaction?'; confirmBody = 'This action cannot be undone.'; }
  else if (confirmation === 'discard') { confirmTitle = 'Discard changes?'; confirmBody = 'Your transaction has not been changed. Discard this draft and close Manage?'; }
  else {
    const messages = [];
    if (draft.isHidden !== !!txn.isHidden) messages.push(draft.isHidden
      ? 'This transaction will be private — hidden from default views but still counted in totals.'
      : 'This transaction will be visible again in all default views.');
    if (draft.isIgnored !== !!txn.isIgnored) messages.push(draft.isIgnored
      ? 'Ignore removes it from your balances and every total and chart. It will be treated as if it never happened.'
      : 'Restore adds it back to balances, totals, and charts.');
    confirmBody = messages.join('\n\n');
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => confirmation ? setConfirmation(null) : panel === 'category' ? back() : close()}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.dismiss} activeOpacity={1} onPress={close} accessibilityLabel="Close Manage transaction" />
        <SheetCloseButton onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.heading}>
            {(panel === 'category' || confirmation) && <TouchableOpacity onPress={() => confirmation ? setConfirmation(null) : back()} style={styles.backButton} accessibilityLabel="Back to Manage transaction"><Ionicons name="chevron-back" size={22} color={theme.textPrimary} /></TouchableOpacity>}
            <Text style={styles.title}>{confirmation ? confirmTitle : panel === 'category' ? 'Select category' : 'Manage transaction'}</Text>
          </View>
          {confirmation ? <>
            <Text style={styles.confirmBody}>{confirmBody}</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.cancel} onPress={() => setConfirmation(null)}><Text style={styles.rowTitle}>Cancel</Text></TouchableOpacity>
              <GradientButton style={styles.grow} title={confirmation === 'delete' ? 'Delete' : confirmation === 'discard' ? 'Discard' : 'Confirm'}
                {...(confirmation === 'delete' ? { colors: [theme.danger, theme.danger], textStyle: { color: '#FFFFFF' } } : {})}
                onPress={() => {
                  if (confirmation === 'delete') { useEPurseStore.getState().deleteTransaction(txn.id); onClose(); }
                  else if (confirmation === 'discard') onClose();
                  else commit();
                }} />
            </View>
          </> : <>
            {panel !== 'category' && <View style={styles.context}>
              <View style={styles.avatar}><Ionicons name="receipt-outline" size={23} color={theme.primary} /></View>
              <View style={styles.grow}>
                <Text style={styles.merchant} numberOfLines={2}>{txn.merchant || 'Transaction'}</Text>
                {!!accountLabel && <Text style={styles.meta} numberOfLines={1}>{accountLabel}{txn.accountMask ? ` ··${txn.accountMask}` : ''}</Text>}
                {date && !Number.isNaN(date.getTime()) && <Text style={styles.meta}>{date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>}
              </View>
              <Text style={styles.amount}>{formatCurrency(txn.amount)}</Text>
            </View>}
            {panel === 'category' && <View style={styles.search}>
              <Ionicons name="search-outline" size={19} color={theme.textSecondary} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Search categories" placeholderTextColor={theme.textMuted} style={styles.searchInput} accessibilityLabel="Search categories" />
            </View>}
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.bodyContent}>
              {panel === 'category' ? <>
                {filteredTree.map((item) => <View key={item.id}>
                  {row(item.label, item.emoji, draft.parentCategory === item.label, () => setExpanded((old) => old === item.id ? null : item.id))}
                  {(expanded === item.id || !!query.trim()) && <View style={styles.children}>
                    {item.children.map((child) => row(child.label, child.emoji, draft.childCategory === child.label && draft.parentCategory === item.label, () => {
                      const special = onSelectLentBorrow ? LB_CHILD_LABEL_TO_ID[child.label] : null;
                      selectCategory(special || child.legacyId || item.legacyId || twoTierToLegacyCatId(item.label, child.label), item.label, child.label, special || null);
                    }))}
                  </View>}
                </View>)}
                {!!specialRows.length && <Text style={styles.sectionLabel}>Payments & settlements</Text>}
                {specialRows.map((item) => row(item.name, item.emoji, draft.categoryId === item.id,
                  () => selectCategory(item.id, undefined, undefined, item.id), 'Opens the existing linked-record flow'))}
                {!filteredTree.length && !specialRows.length && <Text style={styles.explanation}>No categories match your search.</Text>}
              </> : <>
                {!!txn.note && txn.note.trim().toLowerCase() !== (txn.merchant || '').trim().toLowerCase() && <Text style={styles.note}>{txn.note}</Text>}
                <Text style={styles.sectionLabel}>Category</Text>
                {categoryLocked ? <View style={styles.notice}><Ionicons name="lock-closed-outline" size={20} color={theme.primary} /><Text style={styles.noticeText}>{linkedPerson ? `Linked to ${linkedPerson}. Category is locked.` : 'Linked to a lent/borrow record. Category is locked.'}</Text></View>
                  : row(categoryLabel, categoryEmoji, false, () => { setExpanded(parent?.id || null); setPanel('category'); }, draft.childCategory)}
                {onEditPerson && <TouchableOpacity style={styles.link} onPress={onEditPerson}><Text style={styles.linkText}>Edit linked person</Text></TouchableOpacity>}
                {draft.specialCategory && <Text style={styles.explanation}>Done opens {draft.specialCategory === 'cc_bill' ? 'the credit-card payment reconciliation' : 'the person-link'} flow to finish this change.</Text>}
                <Text style={styles.sectionLabel}>Actions</Text>
                <View style={styles.actions}>
                  {!!onToggleHidden && action('Private', 'eye-off-outline', draft.isHidden, () => { patch({ isHidden: !draft.isHidden }); changePanel('private'); }, false, 'Visibility in lists')}
                  {!!(onIgnore || onRestore) && action(draft.isIgnored ? 'Restore' : 'Ignore', 'ban-outline', draft.isIgnored, () => { patch({ isIgnored: !draft.isIgnored }); setPanel('ignore'); }, draft.isIgnored ? !onRestore : !onIgnore, draft.isIgnored ? 'Include again' : 'Exclude from tracking')}
                  {!!onPressSplit && action(directSplit ? 'Edit split' : 'Split', 'git-network-outline', directSplit || splitEditing, () => { setSplitStarted(true); changePanel('split'); }, !splitAllowed, 'Split with people')}
                  {!!(onPressAddToGroup || onPressRemoveFromGroup) && action(group ? 'Group' : 'Add to group', 'people-outline', !!group, () => changePanel('group'), !groupAllowed, group?.name || 'Organise this transaction')}
                </View>
                {panel === 'private' && <Text style={styles.explanation}>{draft.isHidden ? 'Hidden from default views, but still counted in totals. Find it using the Private filter in Activity.' : 'Visible in default views again.'}</Text>}
                {panel === 'ignore' && <Text style={styles.explanation}>{draft.isIgnored ? 'Excluded from balances, totals and charts. Your existing category and tags are retained.' : 'Included in balances, totals and charts.'}</Text>}
                {splitStarted && <View style={panel === 'split' && splitAllowed ? undefined : { display: 'none' }}>
                  <SplitConfigModal embedded visible transaction={splitTransaction} initialDraft={draft.split} onDraftChange={onSplitDraft} onClose={() => setPanel(null)} onApply={(others, meta) => { patch({ split: { others, meta } }); setSplitValid(true); setSplitStarted(false); setPanel(null); }} />
                </View>}
                {panel === 'group' && groupAllowed && <View>
                  <Text style={styles.sectionLabel}>Select group</Text>
                  {!!onPressRemoveFromGroup && row('No group', '−', !draft.groupId, () => patch({ groupId: null }))}
                  {!!onPressAddToGroup && groups.map((item) => row(item.name, item.emoji || '👥', item.id === draft.groupId,
                    () => { if (draft.split?.others.length) { setError('Finish or remove the person split before choosing a group. Group splits use the existing group editor.'); return; } patch({ groupId: item.id }); }, item.type === 'shared' ? 'Shared · opens group expense editor' : 'Personal group'))}
                  {!groups.length && <Text style={styles.explanation}>No groups yet.</Text>}
                  {!!onPressAddToGroup && <TouchableOpacity style={styles.link} onPress={() => { if (changed) { setError('Save or discard your changes before creating a group.'); return; } onClose(); navigation.navigate('Groups'); }}><Text style={styles.linkText}>Create a group</Text></TouchableOpacity>}
                </View>}
                {!!txn.groupId && !!onPressEditGroup && <TouchableOpacity style={styles.link} onPress={() => { if (changed) { setError('Save these changes before opening the group split editor.'); return; } onPressEditGroup(); }}><Text style={styles.linkText}>{txn.groupSplit ? 'Edit group split · who owes' : 'Set who owes in this group'}</Text></TouchableOpacity>}
                {!!canRefund && !!onToggleRefund && !draft.isIgnored && row('Refund / cashback', '↩', draft.isRefund, () => patch({ isRefund: !draft.isRefund }), 'Reduces spend instead of counting as income')}
                {!!onDelete && <TouchableOpacity style={styles.delete} onPress={() => setConfirmation('delete')} accessibilityRole="button"><Ionicons name="trash-outline" size={18} color={theme.danger} /><Text style={styles.deleteText}>Delete transaction</Text></TouchableOpacity>}
              </>}
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            </ScrollView>
            {panel !== 'category' && <View style={styles.footer}><GradientButton title="Done" onPress={done} disabled={saveDisabled} /></View>}
          </>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '88%', backgroundColor: t.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.lg },
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
  sectionLabel: { ...typography.small, fontWeight: '700', color: t.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: t.background, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent', marginBottom: spacing.sm },
  selectedRow: { borderColor: t.primary, backgroundColor: t.primary + '0D' },
  rowTitle: { ...typography.bodyBold, color: t.textPrimary },
  emoji: { fontSize: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 5, padding: spacing.sm, minHeight: 90, backgroundColor: t.background, borderWidth: 1, borderColor: t.divider, borderRadius: radius.md },
  actionSelected: { borderColor: t.primary, backgroundColor: t.primary + '12' },
  actionTitle: { ...typography.small, fontWeight: '700', color: t.textPrimary },
  actionCompact: { flexBasis: '21%', minHeight: 72, paddingHorizontal: 4 },
  actionHint: { ...typography.tiny, color: t.textSecondary, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  explanation: { ...typography.small, color: t.textSecondary, lineHeight: 20, padding: spacing.md, backgroundColor: t.background, borderRadius: radius.md, marginTop: spacing.sm },
  note: { ...typography.small, color: t.textSecondary, padding: spacing.sm, backgroundColor: t.background, borderRadius: radius.md },
  notice: { flexDirection: 'row', gap: spacing.sm, backgroundColor: t.primary + '0D', padding: spacing.md, borderRadius: radius.md },
  noticeText: { ...typography.small, color: t.textSecondary, flex: 1 },
  link: { paddingVertical: spacing.md },
  linkText: { ...typography.small, color: t.primary, fontWeight: '700' },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: t.danger + '0D' },
  deleteText: { ...typography.small, fontWeight: '700', color: t.danger },
  footer: { paddingTop: spacing.sm, borderTopWidth: DIVIDER_W, borderTopColor: t.divider },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: t.background, borderRadius: radius.md },
  searchInput: { flex: 1, paddingVertical: spacing.md, color: t.textPrimary, ...typography.body },
  children: { paddingLeft: spacing.md },
  error: { ...typography.small, color: t.danger, marginTop: spacing.sm },
  confirmBody: { ...typography.body, color: t.textSecondary, lineHeight: 23, marginVertical: spacing.lg },
  confirmActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cancel: { flex: 1, alignItems: 'center', padding: spacing.md, backgroundColor: t.background, borderRadius: radius.md },
});
