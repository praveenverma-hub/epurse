// =============================================================================
// GroupDetailScreen — level 2 of the Groups feature (pushed from GroupsScreen's
// list). Top card is the pre-revamp GroupsScreen's own "expense summary card"
// (gradient header strip, bottom accent border, big amount, tappable balances
// row), Add Expense + Settle Up actions, a Group Zone toggle, then three text
// tabs (Transactions / Members / Summary — Members is skipped for a personal
// group, which has no split).
// =============================================================================
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { colors, radius, spacing, typography as typographyBase, shadows, BUTTON_H } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatCompact, monthKey, titleCaseName } from '../utils/format';
import { countsForSpend, spendContribution } from '../utils/split';
import { buildCategoryBreakdown } from '../analytics/behavioralSelectors';
import EmptyState from '../components/EmptyState';
import SectionHeader from '../components/SectionHeader';
import ProgressBar from '../components/ProgressBar';
import UnderlineTabBar from '../components/UnderlineTabBar';
import TransactionItemRaw from '../components/TransactionItem';
import GroupTxnDetailSheet from '../components/GroupTxnDetailSheet';
import CategoryPickerModal from '../components/CategoryPickerModal';
import CCBillPaymentSheet from '../components/CCBillPaymentSheet';
import CenterModal from '../components/CenterModal';
import AccountPickerSheet from '../components/AccountPickerSheet';
import MonthDivider from '../components/MonthDivider';
import WhatsAppIcon from '../components/WhatsAppIcon';
import { useToast } from '../components/Toast';
import type { Group } from '../types/group';

const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any;
  hideGroupChip?: boolean;
  onPress?: () => void;
  onPressCategory?: () => void;
}>;

interface GroupBalanceRow { personKey: string; person: string; phone?: string | null; net: number }
interface ConfirmState {
  title?: string; message?: string; primaryText?: string; secondaryText?: string;
  destructive?: boolean; onPrimary?: () => void; onSecondary?: () => void;
}

const MONTH_LABEL = (d: Date) => d.toLocaleDateString('en-IN', { month: 'short' });

/** Mix a hex colour toward white by `amt` (0..1) — the top card's header-strip
 * tint. Ported from the pre-revamp `GroupsScreen.tsx` (local there too). */
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

function MonthlyBarChart({ data, color }: { data: { key: string; label: string; total: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const H = 96;
  return (
    <View style={styles.chartRow}>
      {data.map((d) => {
        const h = Math.max(3, (d.total / max) * H);
        return (
          <View key={d.key} style={styles.chartCol}>
            <Text style={styles.chartValue} numberOfLines={1}>
              {d.total > 0 ? formatCompact(d.total) : ''}
            </Text>
            <View style={styles.chartBarTrack}>
              <View style={[styles.chartBar, { height: h, backgroundColor: d.total > 0 ? color : colors.divider }]} />
            </View>
            <Text style={styles.chartLabel}>{d.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function GroupDetailScreen({ navigation, route }: { navigation: any; route: any }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const groupId = route?.params?.groupId as string | undefined;

  const groups = useEPurseStore((s: any) => s.groups) as Group[];
  const transactions = useEPurseStore((s: any) => s.transactions) as any[];
  const lentBorrowed = useEPurseStore((s: any) => s.lentBorrowed) as any[];
  const categories = useEPurseStore((s: any) => s.categories) as any[];
  const accounts = useEPurseStore((s: any) => s.accounts) as any[];
  const deleteGroup = useEPurseStore((s: any) => s.deleteGroup) as (id: string) => void;
  const getPersonBalances = useEPurseStore((s: any) => s.getPersonBalances) as () => any[];
  const settleGroupPersonBalance = useEPurseStore((s: any) => s.settleGroupPersonBalance) as (id: string, personKey: string, opts?: { accountId?: string }) => void;
  const updateTransactionCategory = useEPurseStore((s: any) => s.updateTransactionCategory) as (id: string, categoryId: string) => void;
  const updateTwoTierCategory = useEPurseStore((s: any) => s.updateTwoTierCategory) as (id: string, parent: string, child: string) => void;
  const setTransactionHidden = useEPurseStore((s: any) => s.setTransactionHidden) as (id: string, hidden: boolean) => void;
  const ignoreTransaction = useEPurseStore((s: any) => s.ignoreTransaction) as (id: string) => void;
  const unignoreTransaction = useEPurseStore((s: any) => s.unignoreTransaction) as (id: string) => void;
  const deleteTransaction = useEPurseStore((s: any) => s.deleteTransaction) as (id: string) => void;
  const untagTransactionFromGroup = useEPurseStore((s: any) => s.untagTransactionFromGroup) as (id: string) => void;
  const activeGroupZoneId = useEPurseStore((s: any) => s.activeGroupZoneId) as string | null;
  const setGroupZone = useEPurseStore((s: any) => s.setGroupZone) as (id: string | null) => void;

  const group = useMemo(() => groups.find((g) => g.id === groupId) || null, [groups, groupId]);
  const isShared = group?.type === 'shared';

  const [activeTab, setActiveTab] = useState<'transactions' | 'members' | 'summary'>('transactions');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [settleTarget, setSettleTarget] = useState<GroupBalanceRow | null>(null);
  const [detailTxn, setDetailTxn] = useState<any | null>(null);
  const [categoryTxn, setCategoryTxn] = useState<any | null>(null);
  const [ccBillTxn, setCcBillTxn] = useState<any | null>(null);

  const groupTxns = useMemo(
    () => transactions
      .filter((t) => t.groupId === groupId && !t.isIgnored)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [transactions, groupId],
  );

  const groupMonthTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of groupTxns) {
      if (!countsForSpend(t)) continue;
      m[monthKey(t.createdAt)] = (m[monthKey(t.createdAt)] || 0) + spendContribution(t);
    }
    for (const k of Object.keys(m)) if (m[k] < 0) m[k] = 0;
    return m;
  }, [groupTxns]);
  const currentMonthTotal = groupMonthTotals[monthKey(new Date())] || 0;

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

  // Per-person balances within THIS group, from the global LB ledger.
  const groupBalances = useMemo<GroupBalanceRow[]>(() => {
    if (!isShared) return [];
    const rows: GroupBalanceRow[] = [];
    for (const p of getPersonBalances()) {
      const entries = (p.entries || []).filter((e: any) => e.groupId === groupId);
      if (entries.length === 0) continue;
      const net = entries.reduce((acc: number, e: any) => {
        if (e.kind === 'lent')          return acc + e.amount;
        if (e.kind === 'lent_settled')  return acc - e.amount;
        if (e.kind === 'borrowed')      return acc - e.amount;
        if (e.kind === 'borrow_repaid') return acc + e.amount;
        return acc;
      }, 0);
      if (Math.abs(net) > 0.005) rows.push({ personKey: p.personKey, person: p.person, phone: p.phone, net });
    }
    return rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [getPersonBalances, isShared, groupId, lentBorrowed]);

  const netBalance = groupBalances.reduce((acc, pb) => acc + pb.net, 0);
  const netColor = netBalance > 0 ? theme.lent : netBalance < 0 ? theme.borrowed : theme.success;

  const memberNamesLabel = useMemo(() => {
    if (!isShared || !group) return '';
    const names = (group.members || []).map((m) => (m.isMe ? 'You' : titleCaseName(m.name)));
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }, [group, isShared]);

  // Last 6 calendar months' totals — "your share" of this group's spend, same
  // basis as the current-month figure above (consistent within this screen).
  const monthlySeries = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: monthKey(d), label: MONTH_LABEL(d), total: 0 };
    });
    const byKey: Record<string, typeof months[number]> = Object.fromEntries(months.map((m) => [m.key, m]));
    for (const t of groupTxns) {
      if (!countsForSpend(t)) continue;
      const mk = monthKey(t.createdAt);
      if (byKey[mk]) byKey[mk].total += spendContribution(t);
    }
    months.forEach((m) => { if (m.total < 0) m.total = 0; });
    return months;
  }, [groupTxns]);

  const topCategories = useMemo(() => buildCategoryBreakdown(groupTxns, categories), [groupTxns, categories]);

  // Who's fronted the bill, in total — the full amount each payer has covered,
  // not "your share" (a different question from the spend chart above).
  const contributionData = useMemo(() => {
    if (!isShared) return [];
    const totals: Record<string, { memberId: string; name: string; total: number }> = {};
    for (const t of groupTxns) {
      const gs = t.groupSplit;
      if (!gs) continue;
      const id = gs.paidByMemberId;
      const name = id === 'me' ? 'You' : (gs.paidByName || 'Member');
      if (!totals[id]) totals[id] = { memberId: id, name, total: 0 };
      totals[id].total += Number(t.amount) || 0;
    }
    const rows = Object.values(totals).filter((r) => r.total > 0);
    const grand = rows.reduce((s, r) => s + r.total, 0) || 1;
    return rows.map((r) => ({ ...r, percent: r.total / grand })).sort((a, b) => b.total - a.total);
  }, [groupTxns, isShared]);

  // Everything scrolls in ONE FlatList — the tab bar row (`__row: 'tabbar'`)
  // pins via `stickyHeaderIndices` instead of nesting a second, independently
  // scrolling list/ScrollView per tab. Members/Summary flatten to a single
  // block item since their content isn't itself a long list.
  const listData = useMemo(() => {
    const out: any[] = [{ __row: 'tabbar' }];
    if (activeTab === 'transactions') {
      if (groupListData.length === 0) out.push({ __row: 'emptyTxns' });
      else out.push(...groupListData);
    } else if (activeTab === 'members') {
      out.push({ __row: 'members' });
    } else {
      out.push({ __row: 'summary' });
    }
    return out;
  }, [activeTab, groupListData]);

  if (!group) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <StatusBar style="dark" />
        <PlainScreenHeader title="Group" onBack={() => navigation.goBack()} bordered />
        <View style={styles.missing}>
          <Text style={styles.missingTxt}>This group is no longer available.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const accent = group.color || theme.primary;

  const handleDeleteGroup = () => {
    setConfirm({
      title: 'Delete group?',
      message: `"${group.name}" will be removed. Transactions tagged to it won't be deleted — just untagged.`,
      primaryText: 'Delete',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => {
        deleteGroup(group.id);
        setConfirm(null);
        toast.success('Group deleted');
        navigation.goBack();
      },
      onSecondary: () => setConfirm(null),
    });
  };

  const handleSettle = (pb: GroupBalanceRow) => {
    if (pb.net < 0) { setSettleTarget(pb); return; }
    setConfirm({
      title: 'Settle up',
      message:
        `${titleCaseName(pb.person)} · ${formatCurrency(Math.abs(pb.net))}\n\n` +
        `Settles this group's portion only — their balance in other groups and direct splits stays untouched.`,
      primaryText: 'Settle',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => {
        settleGroupPersonBalance(group.id, pb.personKey);
        setConfirm(null);
        toast.success('Settled', `${titleCaseName(pb.person)} · ${formatCurrency(Math.abs(pb.net))}`);
      },
      onSecondary: () => setConfirm(null),
    });
  };

  const handleToggleZone = (on: boolean) => {
    setGroupZone(on ? group.id : null);
    toast.info(
      on ? `${group.name} zone on` : `${group.name} zone off`,
      on ? 'New transactions will be added to this group by default.' : `New transactions won't be auto-tagged to this group.`,
    );
  };

  const TABS = isShared
    ? [{ key: 'transactions', label: 'Transactions' }, { key: 'members', label: 'Members' }, { key: 'summary', label: 'Summary' }]
    : [{ key: 'transactions', label: 'Transactions' }, { key: 'summary', label: 'Summary' }];

  const renderListItem = ({ item, index }: { item: any; index: number }) => {
    // The row right after the (sticky) tab bar carries the top gap the old
    // per-tab contentContainerStyle used to add; every later row is edge-only.
    const wrap = index === 1 ? styles.txnList : styles.txnRowWrap;

    if (item.__row === 'tabbar') {
      return (
        <UnderlineTabBar
          tabs={TABS}
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as any)}
          accentColor={theme.primary}
        />
      );
    }

    if (item.__row === 'emptyTxns') {
      return (
        <EmptyState
          icon="receipt-outline"
          title="No transactions yet"
          subtitle="Tap Add Expense to add one, or tag existing transactions from the Activity tab."
        />
      );
    }

    if (item.__row === 'members') {
      return (
        <View style={styles.membersScroll}>
          <View style={styles.cardShell}>
          <View style={styles.memberListCard}>
            {(group.members || []).map((m, i) => {
              const displayName = m.isMe ? 'You' : titleCaseName(m.name);
              return (
                <View key={m.memberId} style={[styles.memberRow, i > 0 && styles.pendingRowDivider]}>
                  <View style={[styles.avatar, { backgroundColor: theme.primary + '22', marginRight: 0 }]}>
                    <Text style={[styles.avatarTxt, { color: theme.primary }]}>{displayName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.memberRowName} numberOfLines={1}>{displayName}</Text>
                  <View style={[styles.memberRoleTag, m.isMe && { backgroundColor: theme.primary + '18' }]}>
                    <Text style={[styles.memberRoleTagTxt, m.isMe && { color: theme.primary }]}>
                      {m.isMe ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          </View>
          <TouchableOpacity
            style={[styles.addMemberBtn, { backgroundColor: theme.primary + '14' }]}
            onPress={() => navigation.navigate('GroupForm', { groupId: group.id })}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={16} color={theme.primary} />
            <Text style={[styles.addMemberTxt, { color: theme.primary }]}>Add Member</Text>
          </TouchableOpacity>

          <SectionHeader
            icon="swap-horizontal-outline"
            title="Pending Settlements"
            accentColor={theme.primary}
            style={[styles.sectionSpacing, styles.sectionGapBelow]}
          />
          {groupBalances.length === 0 ? (
            <Text style={styles.settledAllTxt}>✓ Everyone&apos;s settled up in this group.</Text>
          ) : (
            <View style={[styles.cardShell, styles.sectionBottomGap]}>
            <View style={styles.pendingCard}>
              {groupBalances.map((pb, i) => {
                const owesYou = pb.net > 0;
                return (
                  <View key={pb.personKey} style={[styles.pendingRow, i > 0 && styles.pendingRowDivider]}>
                    <View style={[styles.avatar, { backgroundColor: theme.primary + '22' }]}>
                      <Text style={[styles.avatarTxt, { color: theme.primary }]}>{(pb.person || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pendingAmount, { color: owesYou ? theme.lent : theme.borrowed }]} numberOfLines={1}>
                        {formatCurrency(Math.abs(pb.net))}
                      </Text>
                      <Text style={styles.pendingNameSub} numberOfLines={1}>
                        {owesYou ? `${titleCaseName(pb.person)} owes you` : `You owe ${titleCaseName(pb.person)}`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.settleOutlineBtn, { borderColor: theme.primary }]}
                      onPress={() => handleSettle(pb)}
                    >
                      <Text style={[styles.settleOutlineBtnTxt, { color: theme.primary }]}>Settle</Text>
                    </TouchableOpacity>
                    {owesYou && (
                      <TouchableOpacity
                        style={styles.waBtn}
                        onPress={() => navigation.navigate('WhatsAppReminder', { person: pb.person, phone: pb.phone, amount: pb.net })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <WhatsAppIcon />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
            </View>
          )}
        </View>
      );
    }

    if (item.__row === 'summary') {
      if (groupTxns.length === 0) {
        return (
          <EmptyState
            icon="bar-chart-outline"
            title="No data yet"
            subtitle="Add an expense to this group to see its spending summary."
          />
        );
      }
      return (
        <View style={styles.summaryScroll}>
          <SectionHeader icon="bar-chart-outline" title="Spending Overview" subtitle="Last 6 months" accentColor={theme.primary} />
          <View style={styles.chartCard}>
            <MonthlyBarChart data={monthlySeries} color={accent} />
          </View>

          {topCategories.length > 0 && (
            <>
              <SectionHeader icon="pricetags-outline" title="Top Categories" accentColor={theme.primary} style={[styles.sectionSpacing, styles.sectionGapBelow]} />
              <View style={[styles.cardShell, styles.sectionBottomGap]}>
              <View style={styles.listCard}>
                {(() => {
                  const topFive = topCategories.slice(0, 5);
                  return topFive.map((c: any, i: number) => (
                  <View
                    key={c.id}
                    style={[
                      styles.categoryRow,
                      i > 0 && styles.pendingRowDivider,
                      i === topFive.length - 1 && styles.categoryRowLast,
                    ]}
                  >
                    <Text style={styles.categoryEmoji}>{c.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={styles.categoryTopLine}>
                        <Text style={styles.categoryName} numberOfLines={1}>{c.name}</Text>
                        <Text style={styles.categoryAmt} numberOfLines={1}>{formatCurrency(c.total)}</Text>
                      </View>
                      <ProgressBar progress={c.percent / 100} color={c.color} height={6} style={styles.categoryBar} />
                    </View>
                  </View>
                  ));
                })()}
              </View>
              </View>
            </>
          )}

          {isShared && contributionData.length > 0 && (
            <>
              <SectionHeader icon="people-outline" title="Contributions" subtitle="Who's paid for the group" accentColor={theme.primary} style={styles.sectionSpacing} />
              <View style={[styles.cardShell, styles.sectionBottomGap]}>
              <View style={styles.listCard}>
                {contributionData.map((c, i) => (
                  <View
                    key={c.memberId}
                    style={[
                      styles.categoryRow,
                      i > 0 && styles.pendingRowDivider,
                      i === contributionData.length - 1 && styles.categoryRowLast,
                    ]}
                  >
                    <View style={[styles.avatar, { backgroundColor: theme.primary + '22' }]}>
                      <Text style={[styles.avatarTxt, { color: theme.primary }]}>{(c.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    {/* Fixed to the AVATAR's own height and split top/bottom
                        with `space-between`, instead of trusting flexbox to
                        centre a text line's natural (font-dependent) height
                        against a fixed-size avatar — that's what was landing
                        the avatar visibly off-centre. */}
                    <View style={{ flex: 1, height: 32, justifyContent: 'space-between' }}>
                      <View style={styles.categoryTopLine}>
                        <Text style={styles.categoryName} numberOfLines={1}>{c.name}</Text>
                        <Text style={styles.contribPercent}>{Math.round(c.percent * 100)}%</Text>
                      </View>
                      <ProgressBar progress={c.percent} color={theme.primary} height={6} />
                    </View>
                    <Text style={[styles.categoryAmt, { marginLeft: spacing.sm }]} numberOfLines={1}>{formatCurrency(c.total)}</Text>
                  </View>
                ))}
              </View>
              </View>
            </>
          )}
        </View>
      );
    }

    if (item._divider) {
      return <View style={wrap}><MonthDivider monthKey={item.monthKey} total={item.total} /></View>;
    }

    return (
      <View style={wrap}>
        <TransactionItem
          txn={item}
          hideGroupChip
          onPress={() => setDetailTxn(item)}
          onPressCategory={() => setCategoryTxn(item)}
        />
      </View>
    );
  };

  // FlatList's own cell wrapper doesn't inherit `flex:1` from the item it
  // renders, so a centred `EmptyState` (which sets `flex:1` on itself) has no
  // room to grow into — the cell around it still sizes to content. Only the
  // empty-transactions row and an empty Summary tab need to fill the
  // remaining height; every other row keeps its natural size.
  const renderCell = ({ item, style, children, ...rest }: any) => {
    const fill = item?.__row === 'emptyTxns' || (item?.__row === 'summary' && groupTxns.length === 0);
    return (
      <View style={[style, fill && { flex: 1 }]} {...rest}>
        {children}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="dark" />

      <PlainScreenHeader
        title=""
        onBack={() => navigation.goBack()}
        bordered
        right={
          <TouchableOpacity onPress={() => navigation.navigate('GroupForm', { groupId: group.id })} hitSlop={8} style={styles.headerIconBtn}>
            <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      />

      <View style={styles.body}>
        <FlatList
          data={listData}
          keyExtractor={(item: any) => item.__row || item.id}
          renderItem={renderListItem}
          CellRendererComponent={renderCell}
          // Everything above the tab row (top card, actions, zone) is the
          // header; the tab row is `listData[0]`, which lands at overall
          // index 1 once the header cell is counted — that's the index that
          // needs to stick.
          ListHeaderComponent={
            <View style={styles.headerArea}>
              {/* Top card — the pre-revamp GroupsScreen "expense summary card"
                  look (tinted-to-white header strip, bottom accent border in
                  the group's own colour). Emoji/name stay on the LEFT;
                  Edit/Delete moved to the top-RIGHT of the strip; Settings
                  moved out entirely, into the screen's own header bar. No
                  tappable balances footer — Total Expense/Your Balance are
                  back as the two plain figures instead. Group Zone stays OUT
                  of this card, as its own row below the actions. */}
              <View style={[styles.expenseCard, { borderWidth: 1, borderColor: accent }]}>
                {/* Gradient tint commented out for now — plain surface + a
                    1px group-colour border instead:
                <LinearGradient
                  colors={[lightenHex(accent, 0.72), lightenHex(accent, 0.82), '#FFFFFF']}
                  locations={[0, 0.55, 1]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={styles.expenseCard}
                >
                */}
                <View style={styles.cardHeaderGrad}>
                  <Text style={styles.cardEmoji}>{group.emoji || (isShared ? '👥' : '📁')}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName} numberOfLines={1}>{group.name}</Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {isShared ? memberNamesLabel : 'Personal group'}
                      {group.excludeFromTotals ? ' · excluded from totals' : ''}
                    </Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={handleDeleteGroup} hitSlop={8} style={styles.cardActionBtn}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.cardSummary}>
                  {isShared ? (
                    <View style={styles.statsRow}>
                      <View style={styles.statCell}>
                        <Text style={styles.statLabel}>TOTAL EXPENSE</Text>
                        <Text style={styles.statValue} numberOfLines={1}>{formatCurrency(group.totalSpend || 0)}</Text>
                      </View>
                      <View style={styles.statDivider} />
                      <View style={styles.statCell}>
                        <Text style={styles.statLabel}>
                          {netBalance > 0.005 ? 'YOU LENT' : netBalance < -0.005 ? 'YOU BORROWED' : 'SETTLED'}
                        </Text>
                        <Text style={[styles.statValue, { color: netColor }]} numberOfLines={1}>
                          {formatCurrency(Math.abs(netBalance))}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.amountRow}>
                      <Text style={styles.amountBig}>{formatCurrency(currentMonthTotal)}</Text>
                      <Text style={styles.amountSub}>this month</Text>
                    </View>
                  )}
                </View>
                {/* </LinearGradient> */}
              </View>

              {/* Actions */}
              <View style={styles.actionsRow}>
                {isShared && (
                  <TouchableOpacity
                    style={[styles.secondaryBtn, { borderColor: theme.primary }]}
                    onPress={() => setActiveTab('members')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="swap-horizontal-outline" size={18} color={theme.primary} />
                    <Text style={[styles.secondaryBtnTxt, { color: theme.primary }]}>Settle Up</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: theme.primary }]}
                  onPress={() => navigation.navigate('AddGroupExpense', { groupId: group.id })}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.primaryBtnTxt}>Add Expense</Text>
                </TouchableOpacity>
              </View>

              {/* Group Zone — back below the actions row. */}
              <View style={styles.zoneRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zoneTitle}>🧭 Group Zone</Text>
                  <Text style={styles.zoneSub}>Auto-add new transactions to this group</Text>
                </View>
                <Switch
                  value={activeGroupZoneId === group.id}
                  onValueChange={handleToggleZone}
                  trackColor={{ true: accent, false: '#D1D5DB' }}
                  thumbColor="#fff"
                  ios_backgroundColor="#D1D5DB"
                />
              </View>
            </View>
          }
          stickyHeaderIndices={[1]}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + spacing.xl }}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <GroupTxnDetailSheet
        txn={detailTxn}
        onClose={() => setDetailTxn(null)}
        onEdit={(t: any) => {
          setDetailTxn(null);
          navigation.navigate('AddGroupExpense', { groupId: t.groupId, editTxnId: t.id });
        }}
      />

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
        onSelectCategory={(categoryId: string) => {
          if (categoryId === 'cc_bill') {
            const t = categoryTxn;
            setCategoryTxn(null);
            setCcBillTxn(t);
            return;
          }
          if (categoryTxn) updateTransactionCategory(categoryTxn.id, categoryId);
          setCategoryTxn(null);
        }}
        onSelectTwoTier={(parent: string, child: string) => {
          if (categoryTxn) updateTwoTierCategory(categoryTxn.id, parent, child);
          setCategoryTxn(null);
        }}
        onToggleHidden={(hidden: boolean) => {
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

      <CCBillPaymentSheet txn={ccBillTxn} onClose={() => setCcBillTxn(null)} />

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

      <AccountPickerSheet
        visible={!!settleTarget}
        title="Repay from which account?"
        subtitle={settleTarget
          ? `${titleCaseName(settleTarget.person)} · ${formatCurrency(Math.abs(settleTarget.net))} — records a Repayment expense`
          : undefined}
        accounts={accounts}
        onSelect={(accountId: string) => {
          if (settleTarget) {
            settleGroupPersonBalance(group.id, settleTarget.personKey, { accountId });
            toast.success('Settled', `${titleCaseName(settleTarget.person)} · ${formatCurrency(Math.abs(settleTarget.net))}`);
          }
          setSettleTarget(null);
        }}
        skipLabel="Just mark repaid (no expense)"
        onSkip={() => {
          if (settleTarget) {
            settleGroupPersonBalance(group.id, settleTarget.personKey);
            toast.success('Settled', `${titleCaseName(settleTarget.person)} · ${formatCurrency(Math.abs(settleTarget.net))}`);
          }
          setSettleTarget(null);
        }}
        onClose={() => setSettleTarget(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.card },
  body: { flex: 1, backgroundColor: colors.background },
  // Covers just the ListHeaderComponent (top card/actions/zone) in white — the
  // FlatList itself only has ONE background (`body`, the page grey, for
  // everything at/below the sticky tab bar), so the header needs its own
  // opaque wrapper to read as a distinct white block above it.
  headerArea: { backgroundColor: colors.card },

  // Settings now lives in the screen's own header bar, not the card.
  headerIconBtn: { padding: 4 },

  // Pre-revamp "expense summary card" shell — the bottom accent border it
  // used to carry was dropped on request; the header strip's own tint is the
  // only colour cue now.
  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginHorizontal: spacing.md,
    ...shadows.card,
  },
  // Icon/name/actions row — plain layout now; the colour comes from the
  // outer `expenseCard` gradient, not a separate inset strip.
  cardHeaderGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  cardEmoji: { fontSize: 26 },
  cardName: { ...typography.h3, color: colors.textPrimary },
  cardMeta: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  cardActionBtn: { padding: 4 },
  cardSummary: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  amountRow: {},
  amountBig: { ...typography.display, color: colors.textPrimary },
  amountSub: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  // Total Expense / Your Balance — the two plain figures a shared group shows
  // instead of a single "your share" amount (no tappable footer any more; the
  // Members tab and the Settle Up button below are the settle entry points).
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginHorizontal: spacing.md },
  statLabel: { ...typography.tiny, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.6 },
  statValue: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700', marginTop: 3 },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.md },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: BUTTON_H, paddingVertical: spacing.xs, borderRadius: radius.lg,
  },
  primaryBtnTxt: { ...typography.body, color: '#fff', fontWeight: '700' },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: BUTTON_H, paddingVertical: spacing.xs, borderRadius: radius.lg, borderWidth: 1.5,
  },
  secondaryBtnTxt: { ...typography.body, fontWeight: '700' },

  zoneRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  zoneTitle: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  zoneSub: { ...typography.tiny, color: colors.textMuted, marginTop: 1 },

  txnList: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  txnRowWrap: { paddingHorizontal: spacing.md },

  membersScroll: { padding: spacing.md, paddingBottom: spacing.xl },
  sectionSpacing: { marginTop: spacing.lg },
  // Extra gap below a heading that has NO subtitle line — a subtitle already
  // gives the heading breathing room before its card, so this is only added
  // where the title sits alone (Pending Settlements/Top Categories).
  sectionGapBelow: { marginBottom: spacing.sm },
  // One row per member — a role tag (Admin/Member) leads, then the name.
  memberListCard: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  memberRoleTag: {
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  memberRoleTagTxt: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700' },
  memberRowName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  // Light fill, no border — an inline affordance, not an outlined CTA.
  addMemberBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md, minHeight: BUTTON_H, borderRadius: radius.lg,
  },
  addMemberTxt: { ...typography.body, fontWeight: '700' },

  settledAllTxt: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  // Shared shadow shell for any card whose CONTENT needs `overflow:'hidden'`
  // (to clip row dividers to the rounded corner) — shadow and clip never share
  // a view (ui-consistency §6b). backgroundColor is required alongside
  // `elevation` too, or Android paints a default grey surface instead of a
  // real shadow.
  cardShell: { backgroundColor: colors.card, borderRadius: radius.lg, ...shadows.card },
  // Extra gap below a SECTION's card (Pending Settlements/Top Categories/
  // Contribution) — not the member list, which flows straight into the Add
  // Member button right below it and already has its own `marginTop`.
  sectionBottomGap: { marginBottom: spacing.lg },
  pendingCard: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  pendingRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  avatarTxt: { fontWeight: '800', fontSize: 13 },
  // Amount leads (the headline figure); "{name} owes you"/"You owe {name}"
  // is the smaller descriptive line below it.
  pendingAmount: { ...typography.h3, fontWeight: '800' },
  pendingNameSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  settleOutlineBtn: {
    height: 28, paddingHorizontal: spacing.sm + 2, borderRadius: radius.pill, borderWidth: 1,
    marginLeft: spacing.sm, alignItems: 'center', justifyContent: 'center',
  },
  settleOutlineBtnTxt: { ...typography.small, fontWeight: '700' },
  waBtn: {
    width: 28, height: 28, borderRadius: 14, marginLeft: spacing.sm,
    backgroundColor: '#25D36618', borderWidth: 1, borderColor: '#25D36633',
    alignItems: 'center', justifyContent: 'center',
  },

  summaryScroll: { padding: spacing.md, paddingBottom: spacing.xl },
  chartCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, ...shadows.card },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', height: 96 + 36 },
  chartCol: { flex: 1, alignItems: 'center' },
  chartValue: { ...typography.tiny, color: colors.textSecondary, marginBottom: 4 },
  chartBarTrack: { flex: 1, justifyContent: 'flex-end' },
  chartBar: { width: 18, borderRadius: 4 },
  chartLabel: { ...typography.tiny, color: colors.textMuted, marginTop: 6 },

  listCard: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  // The last Contribution row's progress bar sat right against the card's
  // rounded bottom edge with only the standard row padding — a bit more
  // breathing room below it specifically.
  categoryRowLast: { paddingBottom: spacing.lg },
  categoryEmoji: { fontSize: 20 },
  categoryTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryName: { ...typography.body, color: colors.textPrimary, flexShrink: 1, marginRight: spacing.sm },
  categoryAmt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  categoryBar: { marginTop: 6 },
  // Contribution row: avatar leads, top line pairs name (left) with the
  // percentage (right) via `categoryTopLine`, the bar sits below spanning the
  // full column, and the full ₹ amount sits outside the column on the row's
  // own right (via `categoryRow`'s flexDirection) — the avatar/trailing-figure
  // shape Pending Settlements/Members rows already use.
  contribPercent: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700' },

  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingTxt: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
