// =============================================================================
// GroupsScreen — "Groups" tab (2-level: tab → transaction detail sheet).
// Horizontal tile selector (Swiggy-style) picks the active group; its expense
// summary + balances + transactions render inline below. FAB adds an expense to
// the selected group; the first tile creates a new group.
// =============================================================================
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import { debitDisplayAmount } from '../utils/split';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import FAB from '../components/FAB';
import EmptyState from '../components/EmptyState';
import TransactionItemRaw from '../components/TransactionItem';
import CreateGroupModal, { type CreateGroupData } from '../components/CreateGroupModal';
import GroupExpenseSheet from '../components/GroupExpenseSheet';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import CategoryPickerModal from '../components/CategoryPickerModal';
import CenterModal from '../components/CenterModal';
import InfoSheet from '../components/InfoSheet';
import type { Group, GroupExpenseData } from '../types/group';

// TransactionItem.js has no TS declarations — cast to the props we use here.
const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any;
  hideGroupChip?: boolean;
  onPress?: () => void;
  onPressCategory?: () => void;
}>;

interface PbEntry { kind: string; amount: number; groupId?: string }
interface PersonBalance { personKey: string; person: string; net: number; entries?: PbEntry[] }
interface GroupBalanceRow { personKey: string; person: string; net: number }

interface ConfirmState {
  title?: string;
  message?: string;
  primaryText?: string;
  secondaryText?: string;
  destructive?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export default function GroupsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const groups = useEPurseStore((s: any) => s.groups) as Group[];
  const transactions = useEPurseStore((s: any) => s.transactions) as any[];
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed) as any[];
  const categories = useEPurseStore((s: any) => s.categories) as any[];
  const createGroup = useEPurseStore((s: any) => s.createGroup) as (d: CreateGroupData) => string;
  const updateGroup = useEPurseStore((s: any) => s.updateGroup) as (id: string, patches: Partial<Group>) => void;
  const deleteGroup = useEPurseStore((s: any) => s.deleteGroup) as (id: string) => void;
  const addGroupExpense = useEPurseStore((s: any) => s.addGroupExpense) as (id: string, data: GroupExpenseData) => void;
  const getPersonBalances = useEPurseStore((s: any) => s.getPersonBalances) as () => PersonBalance[];
  const settleGroupPersonBalance = useEPurseStore((s: any) => s.settleGroupPersonBalance) as (id: string, personKey: string) => void;
  const updateTransactionCategory = useEPurseStore((s: any) => s.updateTransactionCategory) as (id: string, categoryId: string) => void;
  const updateTwoTierCategory = useEPurseStore((s: any) => s.updateTwoTierCategory) as (id: string, parent: string, child: string) => void;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Group | null>(null);
  const [expenseVisible, setExpenseVisible] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [detailTxn, setDetailTxn] = useState<any | null>(null);
  const [categoryTxn, setCategoryTxn] = useState<any | null>(null);
  const scrollProps = useTabBarScroll();

  // Groups newest-activity first.
  const orderedGroups = useMemo(
    () => [...groups].sort(
      (a, b) => new Date(b.lastActivityAt || b.createdAt || 0).getTime()
              - new Date(a.lastActivityAt || a.createdAt || 0).getTime(),
    ),
    [groups],
  );

  // Effective selection: explicit pick if it still exists, else most-recent.
  const selectedGroup = useMemo(() => {
    if (selectedId) {
      const found = groups.find((g) => g.id === selectedId);
      if (found) return found;
    }
    return orderedGroups[0] || null;
  }, [selectedId, groups, orderedGroups]);
  const selectedGroupId = selectedGroup?.id || null;

  // Tile order: selected first, then the rest by recency.
  const tileGroups = useMemo(() => {
    if (!selectedGroupId) return orderedGroups;
    return [
      ...orderedGroups.filter((g) => g.id === selectedGroupId),
      ...orderedGroups.filter((g) => g.id !== selectedGroupId),
    ];
  }, [orderedGroups, selectedGroupId]);

  // Your share per group (live, raw window) for the card primary figure.
  const myShareByGroup = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of transactions) {
      if (!t.groupId || t.isIgnored) continue;
      m[t.groupId] = (m[t.groupId] || 0) + debitDisplayAmount(t);
    }
    return m;
  }, [transactions]);

  const groupTxns = useMemo(
    () => transactions
      .filter((t) => t.groupId === selectedGroupId && !t.isIgnored)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [transactions, selectedGroupId],
  );

  // My balances for the selected group, from the global LB ledger.
  const groupBalances = useMemo<GroupBalanceRow[]>(() => {
    if (selectedGroup?.type !== 'shared') return [];
    return getPersonBalances()
      .map((p) => {
        const rows = (p.entries || []).filter((e) => e.groupId === selectedGroupId);
        if (rows.length === 0) return null;
        const net = rows.reduce((acc, e) => {
          if (e.kind === 'lent')          return acc + e.amount;
          if (e.kind === 'lent_settled')  return acc - e.amount;
          if (e.kind === 'borrowed')      return acc - e.amount;
          if (e.kind === 'borrow_repaid') return acc + e.amount;
          return acc;
        }, 0);
        return { personKey: p.personKey, person: p.person, net };
      })
      .filter((p): p is GroupBalanceRow => !!p && Math.abs(p.net) > 0.005)
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [getPersonBalances, selectedGroup, selectedGroupId, lentBorrowed]);

  // ── Handlers ──
  const handleSaveGroup = (data: CreateGroupData) => {
    if (editTarget) {
      updateGroup(editTarget.id, data);
      setEditTarget(null);
    } else {
      const id = createGroup(data);
      setSelectedId(id);
    }
    setCreateVisible(false);
  };

  const handleAddExpense = (expenseData: GroupExpenseData) => {
    if (selectedGroupId) addGroupExpense(selectedGroupId, expenseData);
    setExpenseVisible(false);
  };

  const handleSettle = (pb: GroupBalanceRow) => {
    if (!selectedGroupId) return;
    const owesYou = pb.net > 0;
    setConfirm({
      title: owesYou ? 'Settle up' : 'Mark repaid',
      message:
        `${pb.person} · ${formatCurrency(Math.abs(pb.net))}\n\n` +
        `Settles this group's portion only — their balance in other groups and direct splits stays untouched.`,
      primaryText: owesYou ? 'Settle' : 'Mark repaid',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => { settleGroupPersonBalance(selectedGroupId, pb.personKey); setConfirm(null); },
      onSecondary: () => setConfirm(null),
    });
  };

  const handleEditGroup = () => {
    if (selectedGroup) { setEditTarget(selectedGroup); setCreateVisible(true); }
  };

  const handleDeleteGroup = () => {
    if (!selectedGroup) return;
    const g = selectedGroup;
    setConfirm({
      title: 'Delete group?',
      message: `"${g.name}" will be removed. Transactions tagged to it won't be deleted — just untagged.`,
      primaryText: 'Delete',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => { deleteGroup(g.id); setSelectedId(null); setConfirm(null); },
      onSecondary: () => setConfirm(null),
    });
  };

  const openCreate = () => { setEditTarget(null); setCreateVisible(true); };

  // ── Tiles ──
  const renderTiles = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tileRow}
    >
      {/* Add tile */}
      <TouchableOpacity style={[styles.tile, styles.addTile, { borderColor: theme.primary + '66' }]} onPress={openCreate} activeOpacity={0.8}>
        <Text style={[styles.addTilePlus, { color: theme.primary }]}>＋</Text>
        <Text style={[styles.tileLabel, { color: theme.primary }]} numberOfLines={1}>New</Text>
      </TouchableOpacity>

      {tileGroups.map((g) => {
        const active = g.id === selectedGroupId;
        const accent = g.color || theme.primary;
        return (
          <TouchableOpacity
            key={g.id}
            style={[styles.tile, active ? { backgroundColor: accent } : styles.tileIdle]}
            onPress={() => setSelectedId(g.id)}
            activeOpacity={0.85}
          >
            <Text style={styles.tileEmoji}>{g.emoji || (g.type === 'shared' ? '👥' : '📁')}</Text>
            <Text
              style={[styles.tileLabel, active ? styles.tileLabelActive : { color: colors.textPrimary }]}
              numberOfLines={1}
            >
              {g.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  // ── Selected group's summary + balances ──
  const renderHeader = () => {
    if (!selectedGroup) return <View>{renderTiles()}</View>;
    const g = selectedGroup;
    const isShared = g.type === 'shared';
    const total = g.totalSpend || 0;
    const myShare = myShareByGroup[g.id] || 0;

    return (
      <View>
        {renderTiles()}

        {/* Expense summary card */}
        <View style={[styles.expenseCard, { borderLeftColor: g.color || '#6366F1' }]}>
          <View style={styles.expenseTop}>
            <Text style={styles.cardEmoji}>{g.emoji || (isShared ? '👥' : '📁')}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName} numberOfLines={1}>{g.name}</Text>
              <Text style={styles.cardMeta}>
                {isShared ? `${g.members?.length ?? 0} members` : 'Personal'}
                {g.excludeFromTotals ? ' · excluded from totals' : ''}
              </Text>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity onPress={handleEditGroup} hitSlop={8} style={styles.cardActionBtn}>
                <Ionicons name="create-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeleteGroup} hitSlop={8} style={styles.cardActionBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.amountRow}>
            {isShared ? (
              <>
                <Text style={styles.amountBig}>{formatCurrency(myShare)}</Text>
                <Text style={styles.amountSub}>your share · of {formatCurrency(total)}</Text>
              </>
            ) : (
              <>
                <Text style={styles.amountBig}>{formatCurrency(total)}</Text>
                <Text style={styles.amountSub}>total spend</Text>
              </>
            )}
          </View>

          {/* Balances (shared) */}
          {isShared && groupBalances.length > 0 && (
            <View style={styles.balancesBox}>
              {groupBalances.map((pb) => {
                const owesYou = pb.net > 0;
                return (
                  <View key={pb.personKey} style={styles.balanceRow}>
                    <View style={[styles.avatar, { backgroundColor: theme.primary + '22' }]}>
                      <Text style={[styles.avatarTxt, { color: theme.primary }]}>{(pb.person || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.balanceName} numberOfLines={1}>{pb.person}</Text>
                      <Text style={[styles.balanceSub, { color: owesYou ? colors.success : colors.danger }]}>
                        {owesYou ? 'owes you ' : 'you owe '}{formatCurrency(Math.abs(pb.net))}
                      </Text>
                    </View>
                    <TouchableOpacity style={[styles.settleBtn, { borderColor: theme.primary }]} onPress={() => handleSettle(pb)}>
                      <Text style={[styles.settleBtnTxt, { color: theme.primary }]}>Settle</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Expenses sub-header */}
        <View style={styles.txnHeader}>
          <Text style={styles.sectionTitle}>Expenses ({groupTxns.length})</Text>
          <TouchableOpacity
            style={[styles.addExpenseBtn, { backgroundColor: theme.primary }]}
            onPress={() => setExpenseVisible(true)}
          >
            <Text style={styles.addExpenseTxt}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />

      <View style={styles.header}>
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Groups</Text>
          <TouchableOpacity onPress={() => setInfoVisible(true)} hitSlop={10} style={styles.infoBtn}>
            <Ionicons name="information-circle-outline" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.subheading}>Track shared and personal expenses</Text>
      </View>

      {groups.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            emoji="🗂"
            title="No groups yet"
            subtitle="Create a personal group to track themed spending (house build, trip) or a shared group to split expenses with friends."
            actionLabel="Create first group"
            onAction={openCreate}
          />
        </View>
      ) : (
        <FlatList
          data={groupTxns}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={renderHeader()}
          renderItem={({ item: t }) => (
            <View style={styles.txnWrapper}>
              {t.isGroupMemo && (
                <Text style={styles.memoTag}>Paid by {t.groupSplit?.paidByName || 'other'}</Text>
              )}
              <TransactionItem
                txn={t}
                hideGroupChip
                onPress={() => setDetailTxn(t)}
                onPressCategory={() => setCategoryTxn(t)}
              />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              compact
              emoji="🧾"
              title="No expenses yet"
              subtitle={'Tap "Add" to record one, or tag existing transactions from the Activity tab.'}
              style={styles.emptyTxn}
            />
          }
          contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      )}

      {/* FAB → add an expense to the selected group */}
      {selectedGroup && (
        <FAB onPress={() => setExpenseVisible(true)} icon="+" bottomInset={TAB_BAR_HEIGHT + insets.bottom} />
      )}

      <CreateGroupModal
        visible={createVisible}
        group={editTarget}
        onClose={() => { setCreateVisible(false); setEditTarget(null); }}
        onSave={handleSaveGroup}
      />

      <GroupExpenseSheet
        visible={expenseVisible}
        group={selectedGroup}
        onClose={() => setExpenseVisible(false)}
        onAdd={handleAddExpense}
      />

      <GroupTxnDetailSheet txn={detailTxn} onClose={() => setDetailTxn(null)} />

      {/* Category-only picker (manage modal restricted to switching category) */}
      <CategoryPickerModal
        visible={!!categoryTxn}
        categories={categories}
        selectedCategoryId={categoryTxn?.categoryId}
        selectedParent={categoryTxn?.parentCategory}
        selectedChild={categoryTxn?.childCategory}
        isHidden={false}
        isIgnored={false}
        canSplit={false}
        isSplitTxn={false}
        categoryLocked={!!categoryTxn?.lbLocked}
        onSelectCategory={(categoryId) => {
          if (categoryTxn) updateTransactionCategory(categoryTxn.id, categoryId);
          setCategoryTxn(null);
        }}
        onSelectTwoTier={(parent, child) => {
          if (categoryTxn) updateTwoTierCategory(categoryTxn.id, parent, child);
          setCategoryTxn(null);
        }}
        onClose={() => setCategoryTxn(null)}
      />

      <InfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="🗂 About Groups"
        body="Group shared and personal expenses together. Shared-group splits flow into your Lent/Borrowed balances, so a friend across several groups nets to one total you can settle in one place."
        bullets={[
          { label: 'Shared', value: 'Split expenses; balances appear in Lent/Borrowed.' },
          { label: 'Personal', value: 'Track a theme (house, trip); optionally exclude from totals.' },
          { label: 'Auto-cleanup', value: 'Groups you haven’t touched in 6 months are removed once everyone is settled.' },
        ]}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        secondaryText={confirm?.secondaryText}
        destructive={!!confirm?.destructive}
        onPrimary={confirm?.onPrimary || (() => setConfirm(null))}
        onSecondary={confirm?.onSecondary || (() => setConfirm(null))}
        onClose={() => setConfirm(null)}
      />
    </SafeAreaView>
  );
}

const TILE = 84;

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  heading:    { ...typography.h1, color: colors.textPrimary },
  infoBtn:    { marginLeft: spacing.xs, padding: 2 },
  subheading: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  list:       { paddingHorizontal: spacing.md, paddingTop: spacing.xs },

  // Tiles
  tileRow: { paddingVertical: spacing.sm, gap: spacing.sm },
  tile: {
    width: TILE, height: TILE, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
    ...shadows.card,
  },
  tileIdle: { backgroundColor: colors.card },
  addTile: {
    backgroundColor: colors.card,
    borderWidth: 1.5, borderStyle: 'dashed',
  },
  addTilePlus: { fontSize: 26, fontWeight: '300', lineHeight: 30 },
  tileEmoji:   { fontSize: 26 },
  tileLabel:   { ...typography.tiny, fontWeight: '700', marginTop: 6, maxWidth: TILE - 12, textAlign: 'center' },
  tileLabelActive: { color: '#fff' },

  // Expense summary card
  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    ...shadows.card,
  },
  expenseTop: { flexDirection: 'row', alignItems: 'center' },
  cardEmoji:  { fontSize: 26, marginRight: spacing.sm },
  cardName:   { ...typography.h3, color: colors.textPrimary },
  cardMeta:   { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  cardActions:{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardActionBtn: { padding: 4 },
  amountRow:  { marginTop: spacing.md },
  amountBig:  { ...typography.display, color: colors.textPrimary },
  amountSub:  { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  balancesBox:{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  balanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  avatar:     { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  avatarTxt:  { fontWeight: '800', fontSize: 12 },
  balanceName:{ ...typography.body, color: colors.textPrimary },
  balanceSub: { ...typography.tiny, fontWeight: '700', marginTop: 1 },
  settleBtn:  { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, marginLeft: spacing.sm },
  settleBtnTxt:{ ...typography.small, fontWeight: '700' },

  // Expenses list
  txnHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  addExpenseBtn: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  addExpenseTxt: { color: '#fff', fontWeight: '700', ...typography.small },
  txnWrapper: { marginBottom: 2 },
  memoTag: { ...typography.tiny, color: colors.textMuted, marginBottom: 2, marginLeft: spacing.xs },
  emptyTxn: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.sm, ...shadows.card },

  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
});
