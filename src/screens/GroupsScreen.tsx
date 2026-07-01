// =============================================================================
// GroupsScreen — "Groups" tab (2-level: tab → transaction detail sheet).
// Horizontal tile selector (Swiggy-style) picks the active group; its expense
// summary + balances + transactions render inline below. FAB adds an expense to
// the selected group; the first tile creates a new group.
// =============================================================================
import React, { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography as typographyBase, shadows } from '../constants/theme';
// The JS theme widens fontWeight to `string`; re-type as TextStyle for StyleSheet spreads.
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme, useGradient } from '../hooks/useTheme';
import { formatCurrency, monthKey } from '../utils/format';
import { debitDisplayAmount } from '../utils/split';
import { TAB_BAR_HEIGHT } from '../context/TabBarVisibilityContext';
import { useTabBarScroll } from '../hooks/useTabBarScroll';
import FAB from '../components/FAB';
import EmptyState from '../components/EmptyState';
import TransactionItemRaw from '../components/TransactionItem';
import CreateGroupModal, { type CreateGroupData } from '../components/CreateGroupModal';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import CategoryPickerModal from '../components/CategoryPickerModal';
import CenterModal from '../components/CenterModal';
import InfoSheet from '../components/InfoSheet';
import MonthDivider from '../components/MonthDivider';
import { useToast } from '../components/Toast';
import type { Group, GroupExpenseData } from '../types/group';

/** Mix a hex colour toward white by `amt` (0..1) — used for the soft "glow" on the active tile. */
function lightenHex(hex: string, amt = 0.4): string {
  const h = (hex || '#6366F1').replace('#', '');
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const to2 = (n: number) => n.toString(16).padStart(2, '0');
  return `#${to2(mix(r))}${to2(mix(g))}${to2(mix(b))}`;
}

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

export default function GroupsScreen({ navigation }: { navigation: any }) {
  const theme = useTheme();
  const gradient = useGradient();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<any>>(null);
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
  const setTransactionHidden = useEPurseStore((s: any) => s.setTransactionHidden) as (id: string, hidden: boolean) => void;
  const ignoreTransaction = useEPurseStore((s: any) => s.ignoreTransaction) as (id: string) => void;
  const unignoreTransaction = useEPurseStore((s: any) => s.unignoreTransaction) as (id: string) => void;
  const deleteTransaction = useEPurseStore((s: any) => s.deleteTransaction) as (id: string) => void;
  const untagTransactionFromGroup = useEPurseStore((s: any) => s.untagTransactionFromGroup) as (id: string) => void;
  const activeGroupZoneId = useEPurseStore((s: any) => s.activeGroupZoneId) as string | null;
  const setGroupZone = useEPurseStore((s: any) => s.setGroupZone) as (id: string | null) => void;
  const toast = useToast();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createVisible, setCreateVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Group | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [detailTxn, setDetailTxn] = useState<any | null>(null);
  const [categoryTxn, setCategoryTxn] = useState<any | null>(null);
  const [balancesVisible, setBalancesVisible] = useState(false);
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

  // Tile order: purely by recency (most recently updated first). We do NOT hoist
  // the selected tile to the front — that made tiles jump around on every tap.
  const tileGroups = orderedGroups;

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

  // Per-calendar-month total for this group (your share via debitDisplayAmount).
  // Personal-group tracking is monthly — the card headline shows the CURRENT
  // month and each older month gets its own total on a divider.
  const groupMonthTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of groupTxns) m[monthKey(t.createdAt)] = (m[monthKey(t.createdAt)] || 0) + debitDisplayAmount(t);
    return m;
  }, [groupTxns]);
  const currentMonthTotal = groupMonthTotals[monthKey(new Date())] || 0;

  // Transactions with month-boundary dividers (each older month's divider carries
  // that month's total). No divider above the first/current group; none if one month.
  const groupListData = useMemo(() => {
    const out: any[] = [];
    let lastMonth: string | null = null;
    for (const t of groupTxns) {
      const mk = monthKey(t.createdAt);
      if (lastMonth !== null && mk !== lastMonth) {
        out.push({ _divider: true, id: `div-${mk}`, monthKey: mk, total: groupMonthTotals[mk] || 0 });
      }
      lastMonth = mk;
      out.push(t);
    }
    return out;
  }, [groupTxns, groupMonthTotals]);

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

  // Group Zone toggle — exclusive (one at a time). Toast on switch-on and switch-off.
  const handleToggleZone = (g: Group, on: boolean) => {
    setGroupZone(on ? g.id : null);
    if (on) {
      toast.info(`${g.name} zone on`, 'New transactions will be added to this group by default.');
    } else {
      toast.info(`${g.name} zone off`, `New transactions won't be auto-tagged to this group.`);
    }
  };

  // ── Tiles ──
  const renderTiles = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tileRow}
    >
      {/* Add tile — flat gray, no outline */}
      <TouchableOpacity style={styles.addTile} onPress={openCreate} activeOpacity={0.8}>
        <Text style={styles.addTilePlus}>＋</Text>
        <Text style={styles.addTileLabel} numberOfLines={1}>New</Text>
      </TouchableOpacity>

      {tileGroups.map((g) => {
        const active = g.id === selectedGroupId;
        const accent = g.color || theme.primary;
        return (
          <TouchableOpacity
            key={g.id}
            // Outer ring with a 1px transparent gap to the fill.
            style={[styles.tileWrap, { borderColor: active ? accent : colors.divider }]}
            onPress={() => { setSelectedId(g.id); listRef.current?.scrollToOffset({ offset: 0, animated: true }); }}
            activeOpacity={0.85}
          >
            {active ? (
              <LinearGradient
                colors={[lightenHex(accent, 0.5), accent]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={styles.tileFill}
              >
                <Text style={styles.tileEmoji}>{g.emoji || (g.type === 'shared' ? '👥' : '📁')}</Text>
                <Text style={[styles.tileLabel, styles.tileLabelActive]} numberOfLines={1}>{g.name}</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.tileFill, styles.tileFillIdle]}>
                <Text style={styles.tileEmoji}>{g.emoji || (g.type === 'shared' ? '👥' : '📁')}</Text>
                <Text style={[styles.tileLabel, { color: colors.textPrimary }]} numberOfLines={1}>{g.name}</Text>
              </View>
            )}
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
    // Net across everyone in this group: > 0 you're owed, < 0 you owe.
    const netBalance = groupBalances.reduce((acc, pb) => acc + pb.net, 0);

    return (
      <View>
        {renderTiles()}

        {/* Expense summary card — accent on the BOTTOM edge. The whole card (header
            + amount + balances) opens the members/settle modal; only the Group Zone
            area below is excluded so its switch keeps working. */}
        <View style={[styles.expenseCard, { borderBottomColor: (g.color || '#6366F1') + '76' }]}>
          {(() => {
            const cardTop = (
              <>
                {/* Header strip: group-color tint → white, inset 1px from the card edge */}
                <LinearGradient
                  colors={[lightenHex(g.color || '#6366F1', 0.72), '#FFFFFF']}
                  locations={[0, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.cardHeaderGrad}
                >
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
                </LinearGradient>

                <View style={styles.cardSummary}>
                  <View style={styles.amountRow}>
                    {isShared ? (
                      <>
                        <Text style={styles.amountBig}>{formatCurrency(myShare)}</Text>
                        <Text style={styles.amountSub}>your share · of {formatCurrency(total)}</Text>
                      </>
                    ) : (
                      <>
                        {/* Personal-group tracking is monthly — headline = THIS month;
                            older months live on the list dividers below. */}
                        <Text style={styles.amountBig}>{formatCurrency(currentMonthTotal)}</Text>
                        <Text style={styles.amountSub}>this month</Text>
                      </>
                    )}
                  </View>

                  {isShared && groupBalances.length > 0 && (
                    <View style={styles.balancesSummary}>
                      <View style={[{ flex: 1 }, groupBalances.length === 0 && { justifyContent: 'center' }]}>
                          <>
                            <Text style={styles.balancesSummaryTitle}>
                              Balances · {groupBalances.length} {groupBalances.length === 1 ? 'person' : 'people'}
                            </Text>
                            <Text style={[styles.balancesSummarySub, { color: netBalance >= 0 ? colors.success : colors.danger }]}>
                              {Math.abs(netBalance) < 0.01
                                ? 'Settled up · tap to view'
                                : netBalance > 0
                                  ? `You lent ${formatCurrency(netBalance)} · tap to settle`
                                  : `You borrowed ${formatCurrency(Math.abs(netBalance))} · tap to settle`}
                            </Text>
                          </>
                        </View>
                      <Text style={styles.balancesChevron}>›</Text>
                    </View>
                  )}
                </View>
              </>
            );
            // Shared groups → the whole top opens the members/settle modal.
            return isShared ? (
              <TouchableOpacity activeOpacity={0.85} onPress={() => setBalancesVisible(true)}>
                {cardTop}
              </TouchableOpacity>
            ) : cardTop;
          })()}

          {/* Group Zone — OUTSIDE the card tap so its switch toggles independently */}
          <View style={styles.zoneArea}>
            <View style={styles.zoneRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.zoneTitle}>🧭 Group Zone</Text>
                <Text style={styles.zoneSub}>Auto-add new transactions to this group</Text>
              </View>
              <Switch
                value={activeGroupZoneId === g.id}
                onValueChange={(on) => handleToggleZone(g, on)}
                trackColor={{ true: g.color || theme.primary, false: '#D1D5DB' }}
                thumbColor="#fff"
                ios_backgroundColor="#D1D5DB"
              />
            </View>
          </View>
        </View>

        {/* Transactions sub-header */}
        <View style={styles.txnHeader}>
          <Text style={styles.sectionTitle}>Transactions ({groupTxns.length})</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGrad}
      >
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Groups</Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setInfoVisible(true)} hitSlop={10} style={styles.infoBtn}>
                <Ionicons name="information-circle-outline" size={22} color="#FFFFFFCC" />
              </TouchableOpacity>
            </View>
            <Text style={styles.subheading}>Track shared and personal transactions</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>

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
          ref={listRef}
          data={groupListData}
          style={styles.flatList}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={renderHeader()}
          renderItem={({ item: t }) =>
            t._divider ? (
              // Month boundary — a rounded container in the middle carries that
              // month's total (personal-group tracking is monthly).
              <MonthDivider monthKey={t.monthKey} total={t.total} />
            ) : (
              // The card's LENT/BORROWED chip now conveys who-paid framing (was a "Paid by X"
              // line here); the full payer + per-member breakdown lives in the detail sheet.
              <TransactionItem
                txn={t}
                hideGroupChip
                onPress={() => setDetailTxn(t)}
                onPressCategory={() => setCategoryTxn(t)}
              />
            )
          }
          ListEmptyComponent={
            <EmptyState
              compact
              emoji="🧾"
              title="No transactions yet"
              subtitle={'Tap + to add one, or tag existing transactions from the Activity tab.'}
              style={styles.emptyTxn}
            />
          }
          contentContainerStyle={[styles.list, { paddingBottom: TAB_BAR_HEIGHT + insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
          {...scrollProps}
        />
      )}

      {/* FAB → add a transaction to the selected group (full screen) */}
      {selectedGroup && (
        <FAB
          onPress={() => navigation.navigate('AddGroupExpense', { groupId: selectedGroupId })}
          icon="+"
          bottomInset={TAB_BAR_HEIGHT + insets.bottom}
        />
      )}

      <CreateGroupModal
        visible={createVisible}
        group={editTarget}
        onClose={() => { setCreateVisible(false); setEditTarget(null); }}
        onSave={handleSaveGroup}
      />

      <GroupTxnDetailSheet
        txn={detailTxn}
        onClose={() => setDetailTxn(null)}
        onEdit={(t: any) => {
          setDetailTxn(null);
          navigation.navigate('AddGroupExpense', { groupId: t.groupId, editTxnId: t.id });
        }}
      />

      {/* Member balances + settle — opened from the group card (kept off the card
          so a long member list never stretches it). */}
      <Modal
        visible={balancesVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setBalancesVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={styles.sheetDismiss} activeOpacity={1} onPress={() => setBalancesVisible(false)} />
          <View style={styles.balancesSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {selectedGroup?.emoji || '👥'} {selectedGroup?.name} · Balances
            </Text>
            {groupBalances.length > 0 ? (
              <ScrollView style={styles.balancesSheetList} showsVerticalScrollIndicator={false}>
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
              </ScrollView>
            ) : (
              <Text style={styles.balancesEmpty}>✓ Everyone&apos;s settled up in this group.</Text>
            )}
            <TouchableOpacity style={styles.balancesClose} onPress={() => setBalancesVisible(false)}>
              <Text style={styles.balancesCloseTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Manage modal — full parity with a normal transaction (category, Private,
          Ignore, Delete, Remove-from-group). Split is omitted (it conflicts with the
          group's own split) and Lent/Borrowed linkage is not offered (the group
          already posts its own LB legs — onSelectLentBorrow intentionally unset). */}
      <CategoryPickerModal
        visible={!!categoryTxn}
        categories={categories}
        selectedCategoryId={categoryTxn?.categoryId}
        selectedParent={categoryTxn?.parentCategory}
        selectedChild={categoryTxn?.childCategory}
        isHidden={!!categoryTxn?.isHidden}
        isIgnored={!!categoryTxn?.isIgnored}
        canSplit={false}
        isSplitTxn={false}
        categoryLocked={!!categoryTxn?.lbLocked}
        currentGroupId={categoryTxn?.groupId || null}
        onSelectCategory={(categoryId) => {
          if (categoryTxn) updateTransactionCategory(categoryTxn.id, categoryId);
          setCategoryTxn(null);
        }}
        onSelectTwoTier={(parent, child) => {
          if (categoryTxn) updateTwoTierCategory(categoryTxn.id, parent, child);
          setCategoryTxn(null);
        }}
        onToggleHidden={(hidden) => {
          if (categoryTxn) setTransactionHidden(categoryTxn.id, hidden);
          setCategoryTxn(null);
        }}
        onIgnore={() => {
          const t = categoryTxn;
          setCategoryTxn(null);
          if (!t) return;
          setConfirm({
            title: 'Ignore transaction?',
            message: 'It will be removed from balances, totals and charts — as if it never happened.',
            primaryText: 'Ignore',
            secondaryText: 'Cancel',
            destructive: true,
            onPrimary: () => { ignoreTransaction(t.id); setConfirm(null); },
            onSecondary: () => setConfirm(null),
          });
        }}
        onRestore={() => {
          if (categoryTxn) unignoreTransaction(categoryTxn.id);
          setCategoryTxn(null);
        }}
        onPressRemoveFromGroup={() => {
          if (categoryTxn) untagTransactionFromGroup(categoryTxn.id);
          setCategoryTxn(null);
        }}
        onDelete={() => {
          const t = categoryTxn;
          setCategoryTxn(null);
          if (!t) return;
          setConfirm({
            title: 'Delete transaction?',
            message: 'This action cannot be undone.',
            primaryText: 'Delete',
            secondaryText: 'Cancel',
            destructive: true,
            onPrimary: () => { deleteTransaction(t.id); setConfirm(null); },
            onSecondary: () => setConfirm(null),
          });
        }}
        onClose={() => setCategoryTxn(null)}
      />

      <InfoSheet
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        icon={<Ionicons name="people" size={36} color="#6366F1" />}
        title="About Groups"
        body="Group shared and personal expenses together. Shared-group splits flow into your Lent/Borrowed balances, so a friend across several groups nets to one total you can settle in one place."
        bullets={[
          { label: 'Shared', value: 'Split expenses; balances appear in Lent/Borrowed.' },
          { label: 'Personal', value: 'Track a theme (house, trip); optionally exclude from totals. The total resets each month — the card shows this month, older months sit on the list dividers.' },
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
    </View>
  );
}

const TILE = 84;

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.background },
  headerGrad: { borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  headingRow: { flexDirection: 'row', alignItems: 'center' },
  heading:    { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: '#fff' },
  infoBtn:    { marginLeft: spacing.xs, padding: 2 },
  subheading: { ...typography.small, color: '#FFFFFFCC', marginTop: 2 },
  // flex:1 bounds the list to the viewport below the header so its content
  // (card detail + transactions) is fully scrollable instead of clipped.
  flatList:   { flex: 1 },
  list:       { paddingHorizontal: spacing.md, paddingTop: spacing.xs },

  // Tiles. flexGrow:1 fills the viewport when there are few tiles so the row isn't
  // scrollable — fixes the "items jump right on scroll" glitch with a short list.
  tileRow: { paddingVertical: spacing.sm, gap: spacing.sm, flexGrow: 1 },
  // Outer ring; 1px padding creates a transparent gap between the border and the fill.
  tileWrap: {
    width: TILE, height: TILE, borderRadius: radius.lg,
    borderWidth: 1, padding: 1, backgroundColor: 'transparent',
    ...shadows.card,
  },
  tileFill: {
    flex: 1, borderRadius: radius.lg - 1,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6, overflow: 'hidden',
  },
  tileFillIdle: { backgroundColor: colors.card },
  addTile: {
    width: TILE, height: TILE, borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#E6E8EC',   // flat gray, no outline
  },
  addTilePlus:  { fontSize: 28, fontWeight: '300', lineHeight: 32, color: colors.textSecondary },
  addTileLabel: { ...typography.tiny, fontWeight: '700', marginTop: 2, color: colors.textSecondary },
  tileEmoji:   { fontSize: 26 },
  tileLabel:   { ...typography.tiny, fontWeight: '700', marginTop: 6, maxWidth: TILE - 12, textAlign: 'center' },
  tileLabelActive: { color: '#fff' },

  // Expense summary card — accent on the BOTTOM edge
  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    borderBottomWidth: 4,
    ...shadows.card,
  },
  // Gray→white gradient header strip; 1px inset reveals a thin card-coloured edge around it.
  cardHeaderGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 1,
    borderTopLeftRadius: radius.lg - 1,
    borderTopRightRadius: radius.lg - 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  // Tappable top region (amount + balances summary). Zone area is separate below.
  cardSummary: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  zoneArea:    { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  cardEmoji:  { fontSize: 26, marginRight: spacing.sm },
  cardName:   { ...typography.h3, color: colors.textPrimary },
  cardMeta:   { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  cardActions:{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardActionBtn: { padding: 4 },
  amountRow:  { marginTop: spacing.sm },
  amountBig:  { ...typography.display, color: colors.textPrimary },
  amountSub:  { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  // Compact, tappable balances summary on the card (full breakdown is in the modal).
  balancesSummary: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: spacing.md, paddingTop: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.divider,
  },
  balancesSummaryTitle: { ...typography.small, color: colors.textPrimary, fontWeight: '700' },
  balancesSummarySub:   { ...typography.tiny, fontWeight: '700', marginTop: 1 },
  balancesSettled: { ...typography.small, color: colors.success, fontWeight: '700', paddingVertical: 2 },
  balancesChevron:      { ...typography.h2, color: colors.textMuted, marginLeft: spacing.sm },
  // balanceRow/avatar/settleBtn are shared by the card summary and the balances modal.
  balanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  avatar:     { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  avatarTxt:  { fontWeight: '800', fontSize: 12 },
  balanceName:{ ...typography.body, color: colors.textPrimary },
  balanceSub: { ...typography.tiny, fontWeight: '700', marginTop: 1 },
  settleBtn:  { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, marginLeft: spacing.sm },
  settleBtnTxt:{ ...typography.small, fontWeight: '700' },

  // Balances bottom-sheet modal (opened from the card)
  sheetBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  sheetDismiss:  { flex: 1 },
  balancesSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.lg, paddingBottom: spacing.xl, maxHeight: '80%',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle:  { ...typography.h3, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.md },
  balancesSheetList: { maxHeight: 360 },
  balancesEmpty: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.lg, textAlign: 'center' },
  balancesClose: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  balancesCloseTxt: { ...typography.body, color: colors.textSecondary },

  // Group Zone toggle row
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  zoneTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  zoneSub:   { ...typography.tiny, color: colors.textMuted, marginTop: 1 },

  // Transactions list
  txnHeader: { marginBottom: spacing.sm },
  sectionTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  // Plain (no card) — just centred text + emoji.
  emptyTxn: { paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },

  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
});
