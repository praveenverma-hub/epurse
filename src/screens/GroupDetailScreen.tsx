// =============================================================================
// GroupDetailScreen — transaction list + my LB-derived balances + group-scoped
// settle for a group.
// =============================================================================
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
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
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import TransactionItemRaw from '../components/TransactionItem';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import GroupExpenseSheet from '../components/GroupExpenseSheet';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import CreateGroupModal from '../components/CreateGroupModal';
import CategoryPickerModal from '../components/CategoryPickerModal';
import CenterModal from '../components/CenterModal';
import EmptyState from '../components/EmptyState';
import type { Group, GroupExpenseData } from '../types/group';

// TransactionItem.js has no TS declarations — cast to the props we use here.
const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any;
  hideGroupChip?: boolean;
  onPress?: () => void;
  onPressCategory?: () => void;
}>;

interface NavLike {
  goBack: () => void;
}

interface PbEntry {
  kind: string;
  amount: number;
  groupId?: string;
}
interface PersonBalance {
  personKey: string;
  person: string;
  net: number;
  entries?: PbEntry[];
}
interface GroupBalanceRow {
  personKey: string;
  person: string;
  net: number;
}

interface ConfirmState {
  title?: string;
  message?: string;
  primaryText?: string;
  secondaryText?: string;
  destructive?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

interface GroupDetailScreenProps {
  route: { params: { groupId: string } };
  navigation: NavLike;
}

export default function GroupDetailScreen({ route, navigation }: GroupDetailScreenProps) {
  const { groupId } = route.params;
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const group = useEPurseStore((s: any) => s.groups.find((g: Group) => g.id === groupId)) as Group | undefined;
  const transactions = useEPurseStore((s: any) => s.transactions) as any[];
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed) as any[];
  const categories = useEPurseStore((s: any) => s.categories) as any[];
  const updateTransactionCategory = useEPurseStore((s: any) => s.updateTransactionCategory) as (id: string, categoryId: string) => void;
  const updateTwoTierCategory = useEPurseStore((s: any) => s.updateTwoTierCategory) as (id: string, parent: string, child: string) => void;
  const updateGroup = useEPurseStore((s: any) => s.updateGroup) as (id: string, patches: Partial<Group>) => void;
  const deleteGroup = useEPurseStore((s: any) => s.deleteGroup) as (id: string) => void;
  const addGroupExpense = useEPurseStore((s: any) => s.addGroupExpense) as (id: string, data: GroupExpenseData) => void;
  const getPersonBalances = useEPurseStore((s: any) => s.getPersonBalances) as () => PersonBalance[];
  const settleGroupPersonBalance = useEPurseStore((s: any) => s.settleGroupPersonBalance) as (id: string, personKey: string) => void;

  const [expenseVisible, setExpenseVisible] = useState(false);
  const [editVisible, setEditVisible] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [detailTxn, setDetailTxn] = useState<any | null>(null);
  const [categoryTxn, setCategoryTxn] = useState<any | null>(null);

  // Group transactions sorted newest-first, including memos
  const groupTxns = useMemo(
    () =>
      transactions
        .filter((t) => t.groupId === groupId && !t.isIgnored)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [transactions, groupId],
  );

  // My balances for THIS group, derived from the global LB ledger (single source of truth).
  const groupBalances = useMemo<GroupBalanceRow[]>(() => {
    if (group?.type !== 'shared') return [];
    return getPersonBalances()
      .map((p) => {
        const rows = (p.entries || []).filter((e) => e.groupId === groupId);
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
    // lentBorrowed in deps so this recomputes after settle / expense changes.
  }, [getPersonBalances, group, groupId, lentBorrowed]);

  const handleAddExpense = useCallback((expenseData: GroupExpenseData) => {
    addGroupExpense(groupId, expenseData);
    setExpenseVisible(false);
  }, [addGroupExpense, groupId]);

  const handleSettle = (pb: GroupBalanceRow) => {
    const owesYou = pb.net > 0;
    setConfirm({
      title: owesYou ? 'Settle up' : 'Mark repaid',
      message:
        `${pb.person} · ${formatCurrency(Math.abs(pb.net))}\n\n` +
        `Settles this group's portion only — their balance in other groups and direct splits stays untouched.`,
      primaryText: owesYou ? 'Settle' : 'Mark repaid',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => {
        settleGroupPersonBalance(groupId, pb.personKey);
        setConfirm(null);
      },
      onSecondary: () => setConfirm(null),
    });
  };

  const handleDeleteGroup = () => {
    setConfirm({
      title: 'Delete group?',
      message: "Transactions tagged to this group won't be deleted — just untagged.",
      primaryText: 'Delete',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => {
        deleteGroup(groupId);
        setConfirm(null);
        navigation.goBack();
      },
      onSecondary: () => setConfirm(null),
    });
  };

  if (!group) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
        <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.missing}>Group not found.</Text>
      </SafeAreaView>
    );
  }

  const isShared = group.type === 'shared';

  // FlatList header
  const ListHeader = (
    <View>
      {/* ── Group header card ── */}
      <View style={[styles.headerCard, { borderLeftColor: group.color || '#6366F1' }]}>
        <Text style={styles.groupEmoji}>{group.emoji || (isShared ? '👥' : '📁')}</Text>
        <View style={styles.headerMid}>
          <Text style={styles.groupName}>{group.name}</Text>
          <Text style={styles.groupMeta}>
            {isShared ? `${group.members?.length ?? 0} members` : 'Personal'}
            {group.excludeFromTotals ? ' · excluded from totals' : ''}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.totalSpend}>{formatCurrency(group.totalSpend || 0)}</Text>
          <Text style={styles.totalLabel}>total spend</Text>
        </View>
      </View>

      {/* ── My balances for this group (from the global LB ledger) ── */}
      {isShared && groupBalances.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Balances</Text>
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
                <TouchableOpacity
                  style={[styles.settleBtn, { borderColor: theme.primary }]}
                  onPress={() => handleSettle(pb)}
                >
                  <Text style={[styles.settleBtnTxt, { color: theme.primary }]}>Settle</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* ── Transactions header row ── */}
      <View style={styles.txnHeader}>
        <Text style={styles.sectionTitle}>Expenses ({groupTxns.length})</Text>
        <TouchableOpacity
          style={[styles.addExpenseBtn, { backgroundColor: theme.primary }]}
          onPress={() => setExpenseVisible(true)}
        >
          <Text style={styles.addExpenseTxt}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {groupTxns.length === 0 && (
        <EmptyState
          compact
          emoji="🧾"
          title="No expenses yet"
          subtitle={'Tap "Add" to record one, or tag existing transactions from the Activity tab.'}
          style={styles.emptyTxn}
        />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      {/* Nav row */}
      <View style={styles.navRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.navActions}>
          <TouchableOpacity onPress={() => setEditVisible(true)} style={styles.navBtn}>
            <Ionicons name="create-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDeleteGroup} style={styles.navBtn}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={groupTxns}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={ListHeader}
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
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      />

      <GroupExpenseSheet
        visible={expenseVisible}
        group={group}
        onClose={() => setExpenseVisible(false)}
        onAdd={handleAddExpense}
      />

      <GroupTxnDetailSheet
        txn={detailTxn}
        onClose={() => setDetailTxn(null)}
      />

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

      <CreateGroupModal
        visible={editVisible}
        group={group}
        onClose={() => setEditVisible(false)}
        onSave={(data) => { updateGroup(groupId, data); setEditVisible(false); }}
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

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.background },
  navRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn:    { padding: spacing.sm },
  navActions: { flexDirection: 'row', gap: spacing.xs },
  navBtn:     { padding: spacing.sm },
  list:       { paddingHorizontal: spacing.md },
  headerCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    ...shadows.card,
  },
  groupEmoji: { fontSize: 28, marginRight: spacing.md },
  headerMid:  { flex: 1 },
  groupName:  { ...typography.h2, color: colors.textPrimary },
  groupMeta:  { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  headerRight:    { alignItems: 'flex-end' },
  totalSpend:     { ...typography.h3, color: colors.textPrimary, fontWeight: '700' },
  totalLabel:     { ...typography.tiny, color: colors.textMuted },
  section: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  sectionTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.sm },
  balanceRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  avatarTxt:    { fontWeight: '800', fontSize: 12 },
  balanceName:  { ...typography.body, color: colors.textPrimary },
  balanceSub:   { ...typography.tiny, fontWeight: '700', marginTop: 1 },
  settleBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, borderWidth: 1,
    marginLeft: spacing.sm,
  },
  settleBtnTxt:   { ...typography.small, fontWeight: '700' },
  txnHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  addExpenseBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill,
  },
  addExpenseTxt: { ...typography.small, color: '#fff', fontWeight: '700' },
  txnWrapper:    { marginBottom: 2 },
  memoTag: {
    ...typography.tiny, color: colors.textMuted,
    marginBottom: 2, marginLeft: spacing.xs,
  },
  emptyTxn: {
    backgroundColor: colors.card, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.sm,
    ...shadows.card,
  },
  backRow:    { padding: spacing.md },
  missing:    { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
