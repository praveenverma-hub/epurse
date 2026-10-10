// =============================================================================
// GroupDetailScreen — level 2 of the Groups feature (pushed from GroupsScreen's
// list). Top card is the pre-revamp GroupsScreen's own "expense summary card"
// shell — icon/name strip + a 1px group-colour border (the card's own gradient
// tint is currently commented out, see `expenseCard` below) — a Total
// Expense/Your Balance stat row (⋮ menu: Add Expense / Edit / Delete), a Group Zone
// toggle, then three text tabs (Transactions / Members / Summary — Members is
// skipped for a personal group, which has no split).
// =============================================================================
import React, { useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { TabView } from 'react-native-tab-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { colors, radius, spacing, typography as typographyBase, shadows, BUTTON_H, withAlpha, DIVIDER_W } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, monthKey, titleCaseName } from '../utils/format';
import { countsForSpend, spendContribution } from '../utils/split';
import { buildCategoryBreakdown } from '../analytics/behavioralSelectors';
import EmptyState from '../components/EmptyState';
import SectionHeader from '../components/SectionHeader';
import ProgressBar from '../components/ProgressBar';
import UnderlineTabBar from '../components/UnderlineTabBar';
import TransactionItemRaw from '../components/TransactionItem';
import TxnDetailSheet from '../components/TxnDetailSheet';
import CategoryPickerModal from '../components/CategoryPickerModal';
import { applyCategoryPickerDraft } from '../utils/manageTransactionDraft';
import CCBillPaymentSheet from '../components/CCBillPaymentSheet';
import CenterModal from '../components/CenterModal';
import EditIcon from '../components/EditIcon';
import OverflowMenu from '../components/OverflowMenu';
import ReminderBell from '../components/ReminderBell';
import { groupBalanceLine, groupHeroFigures } from '../utils/groupHero';
import AccountPickerSheet from '../components/AccountPickerSheet';
import MonthDivider from '../components/MonthDivider';
import WhatsAppIcon from '../components/WhatsAppIcon';
import MonthlyBarChart from '../components/MonthlyBarChart';
import { useToast } from '../components/Toast';
import type { Group } from '../types/group';

const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any;
  context?: 'default' | 'account' | 'group';
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

const SHARED_TABS = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'members', label: 'Members' },
  { key: 'summary', label: 'Summary' },
];
const PERSONAL_TABS = SHARED_TABS.filter((t) => t.key !== 'members');

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
  const activeGroupZoneId = useEPurseStore((s: any) => s.activeGroupZoneId) as string | null;
  const setGroupZone = useEPurseStore((s: any) => s.setGroupZone) as (id: string | null) => void;

  const group = useMemo(() => groups.find((g) => g.id === groupId) || null, [groups, groupId]);
  const isShared = group?.type === 'shared';

  const [activeTab, setActiveTab] = useState<'transactions' | 'members' | 'summary'>('transactions');
  // Page scroll + pager (see renderScene): the pager's height follows the active
  // tab's measured content, floored at whatever space is left on screen.
  const [sceneH, setSceneH] = useState<Record<string, number>>({});
  const [viewportH, setViewportH] = useState(0);
  const [tabBarH, setTabBarH] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const [headerH, setHeaderH] = useState(0);
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

  // Top card (utils/groupHero.ts): totals from the same live list as the rows
  // below, plus the outstanding balance in one line.
  const heroFigures = useMemo(() => groupHeroFigures(groupTxns), [groupTxns]);
  const balanceLine = useMemo(
    () => (isShared ? groupBalanceLine(groupBalances.map((b) => ({ person: titleCaseName(b.person), net: b.net })), groupTxns.length > 0) : null),
    [isShared, groupBalances, groupTxns.length],
  );

  const memberNamesLabel = useMemo(() => {
    if (!isShared || !group) return '';
    const names = (group.members || []).map((m) => (m.isMe ? 'You' : titleCaseName(m.name)));
    if (names.length <= 3) return names.join(', ');
    return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
  }, [group, isShared]);

  // Last 6 calendar months, your share (same basis as the card and the month dividers).
  const monthlySeries = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: monthKey(d), label: MONTH_LABEL(d), total: Math.max(0, groupMonthTotals[monthKey(d)] || 0) };
    });
  }, [groupMonthTotals]);

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
      // The group's CURRENT member name (renames show), not the one stamped on the txn.
      const member = (group?.members || []).find((m) => m.memberId === id);
      const name = id === 'me' ? 'You' : titleCaseName(member?.name || gs.paidByName || 'Member');
      if (!totals[id]) totals[id] = { memberId: id, name, total: 0 };
      totals[id].total += Number(t.amount) || 0;
    }
    const rows = Object.values(totals).filter((r) => r.total > 0);
    const grand = rows.reduce((s, r) => s + r.total, 0) || 1;
    return rows.map((r) => ({ ...r, percent: r.total / grand })).sort((a, b) => b.total - a.total);
  }, [groupTxns, isShared, group]);

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
  const zoneOn = activeGroupZoneId === group.id;

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

  const TABS = isShared ? SHARED_TABS : PERSONAL_TABS;

  const renderMembers = () => (
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
                    {/* You owe: a nudge to yourself (same bell as Lent/Borrowed). */}
                    {!owesYou && (
                      <ReminderBell personKey={pb.personKey} person={titleCaseName(pb.person)} amount={pb.net} style={styles.bellGap} />
                    )}
                  </View>
                );
              })}
            </View>
            </View>
          )}
        </View>
  );

  const renderSummary = () => {
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
          <SectionHeader icon="bar-chart-outline" title={isShared ? 'Your Share by Month' : 'Spend by Month'} subtitle="Last 6 months" accentColor={theme.primary} />
          <View style={styles.chartCard}>
            <MonthlyBarChart data={monthlySeries} color={accent} />
          </View>

          {topCategories.length > 0 && (
            <>
              <SectionHeader icon="pricetags-outline" title={isShared ? 'Where Your Share Went' : 'Top Categories'} accentColor={theme.primary} style={[styles.sectionSpacing, styles.sectionGapBelow]} />
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
              <SectionHeader icon="people-outline" title="Who Paid the Bills" subtitle={`${formatCurrency(heroFigures.totalBills)} in total`} accentColor={theme.primary} style={styles.sectionSpacing} />
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
  };

  const renderTxnRow = ({ item, index }: { item: any; index: number }) => {
    // The first row carries the top gap; every later row is edge-only.
    const wrap = index === 0 ? styles.txnList : styles.txnRowWrap;

    if (item._divider) {
      return <View style={wrap}><MonthDivider monthKey={item.monthKey} total={item.total} /></View>;
    }

    return (
      <View style={wrap}>
        <TransactionItem
          txn={item}
          context="group"
          onPress={() => setDetailTxn(item)}
          onPressCategory={() => setCategoryTxn(item)}
        />
      </View>
    );
  };

  // Switching tabs while scrolled past the top block keeps the bar pinned and
  // starts the new page at its top (its height differs, so the old offset is meaningless).
  const goTab = (key: string) => {
    setActiveTab(key as typeof activeTab);
    if (scrollY.current > headerH) scrollRef.current?.scrollTo({ y: headerH, animated: false });
  };

  // ONE page scroll (top block scrolls away, tab bar sticks) with a real swipe
  // pager inside it. The pages don't scroll themselves — each measures its
  // content and the pager takes the active one's height. Rows aren't virtualized
  // (a group's list is short; retention prunes it).
  // Floor = the screen left below the top block + bar, so short content fills it
  // without making the page scrollable; only longer content scrolls.
  const bottomPad = insets.bottom + spacing.xl;
  const minPageH = Math.max(0, viewportH - headerH - tabBarH - bottomPad);
  const pageH = Math.max(sceneH[activeTab] || 0, minPageH);
  const measureScene = (key: string) => (e: LayoutChangeEvent) => {
    const h = Math.ceil(e.nativeEvent.layout.height);
    setSceneH((prev) => (Math.abs((prev[key] || 0) - h) < 1 ? prev : { ...prev, [key]: h }));
  };
  // An empty tab gets a DEFINITE height (the space left on screen) — a minHeight
  // alone gives EmptyState's flex:1 nothing to fill, so it sat at the top.
  const txnsEmpty = groupListData.length === 0;
  const summaryEmpty = groupTxns.length === 0;
  const renderScene = ({ route }: { route: { key: string } }) => {
    const empty = (route.key === 'transactions' && txnsEmpty) || (route.key === 'summary' && summaryEmpty);
    return (
      <View style={empty ? { height: minPageH } : { minHeight: minPageH }} onLayout={measureScene(route.key)}>
        {route.key === 'members' ? renderMembers()
          : route.key === 'summary' ? renderSummary()
          : txnsEmpty ? (
            <EmptyState
              icon="receipt-outline"
              title="No transactions yet"
              subtitle="Add one from the ⋮ menu above, or tag existing transactions from the Activity tab."
            />
          ) : (
            groupListData.map((item: any, index: number) => <React.Fragment key={item.id}>{renderTxnRow({ item, index })}</React.Fragment>)
          )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <StatusBar style="dark" />

      {/* No `right` any more — the edit action moved into the hero card itself,
          beside Delete (was a lone settings gear here). */}
      <PlainScreenHeader title="" onBack={() => navigation.goBack()} />

      <View style={styles.body} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
        <ScrollView
          ref={scrollRef}
          stickyHeaderIndices={[1]}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerArea} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
            {/* Top card — the pre-revamp GroupsScreen "expense summary card"
                shell. Its gradient tint is currently commented out (plain
                surface + a 1px group-colour border instead — see below).
                Emoji/name stay on the LEFT; Delete + Edit sit top-RIGHT of
                the strip (Edit was on the screen's own header as a settings
                gear; now it's the app's canonical pencil, moved in here
                beside Delete instead). No tappable balances footer — Total
                Expense/Your Balance are the two plain figures instead.
                Group Zone stays OUT of this card, as its own row below the
                actions. */}
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
              <View style={[styles.cardHeaderGrad, { backgroundColor: withAlpha(accent, 0.08) }]}>
                <Text style={styles.cardEmoji}>{group.emoji || (isShared ? '👥' : '📁')}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName} numberOfLines={1}>{group.name}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {isShared ? memberNamesLabel : 'Personal group'}
                    {group.excludeFromTotals ? ' · Excluded from totals' : ''}
                  </Text>
                </View>
                {/* One ⋮ for the group's actions — Add Expense, Edit, Delete. Frees the
                    row below the card for the Group Zone tile. */}
                <OverflowMenu
                  style={[styles.cardActionBtn, { backgroundColor: withAlpha(colors.textSecondary, 0.12) }]}
                  actions={[
                    { key: 'add', label: 'Add Expense', icon: 'add-circle-outline', onPress: () => navigation.navigate('AddGroupExpense', { groupId: group.id }) },
                    { key: 'edit', label: 'Edit Group', icon: <EditIcon size={16} color={colors.textSecondary} />, onPress: () => navigation.navigate('GroupForm', { groupId: group.id }) },
                    { key: 'delete', label: 'Delete Group', icon: 'trash-outline', destructive: true, onPress: handleDeleteGroup },
                  ]}
                />
              </View>

              <View style={[styles.cardSummary, balanceLine && styles.cardSummaryTight]}>
                <View style={styles.statsRow}>
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>TOTAL SPENT</Text>
                    <Text style={styles.statValue} numberOfLines={1}>
                      {formatCurrency(isShared ? heroFigures.totalBills : heroFigures.yourShare)}
                    </Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statCell}>
                    <Text style={styles.statLabel}>{isShared ? 'YOUR SHARE' : 'THIS MONTH'}</Text>
                    <Text style={styles.statValue} numberOfLines={1}>
                      {formatCurrency(isShared ? heroFigures.yourShare : currentMonthTotal)}
                    </Text>
                  </View>
                </View>
              </View>
              {/* What's still outstanding, in "owe" words; the Members tab has it per person. */}
              {balanceLine ? (
                <TouchableOpacity
                  style={styles.balanceLine}
                  onPress={() => goTab('members')}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityHint="Opens Members"
                >
                  {balanceLine.kind === 'settled' ? <Ionicons name="checkmark-circle" size={16} color={theme.success} /> : null}
                  <Text style={[styles.balanceText, balanceLine.kind === 'settled' && styles.balanceSettled, balanceLine.kind === 'settled' && { color: theme.success }]} numberOfLines={1}>
                    {balanceLine.segments.map((seg, i) => ('text' in seg ? seg.text : (
                      <Text key={i} style={[styles.balanceAmt, { color: seg.tone === 'lent' ? theme.lent : theme.borrowed }]}>
                        {formatCurrency(seg.amount)}
                      </Text>
                    )))}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
              {/* </LinearGradient> */}
            </View>

            {/* Group Zone — full-width tile under the card (Add Expense lives in the ⋮). */}
            <View style={styles.zoneRow}>
              <View style={[styles.zoneIcon, { backgroundColor: withAlpha(accent, 0.12) }]}>
                <Ionicons name="compass-outline" size={18} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.zoneTitle}>Group Zone</Text>
                <Text style={styles.zoneSub}>Auto-add new transactions to this group</Text>
              </View>
              <Switch
                value={zoneOn}
                onValueChange={handleToggleZone}
                trackColor={{ true: accent, false: '#D1D5DB' }}
                thumbColor="#fff"
                ios_backgroundColor="#D1D5DB"
              />
            </View>
          </View>
          <View onLayout={(e) => setTabBarH(e.nativeEvent.layout.height)}>
            <UnderlineTabBar
              tabs={TABS}
              activeKey={activeTab}
              onChange={goTab}
              accentColor={theme.primary}
              topBorder={false}
            />
          </View>
          <TabView
            navigationState={{ index: Math.max(0, TABS.findIndex((t) => t.key === activeTab)), routes: TABS }}
            renderScene={renderScene}
            renderTabBar={() => null}
            onIndexChange={(i) => goTab(TABS[i].key)}
            initialLayout={{ width: Dimensions.get('window').width }}
            swipeEnabled
            style={{ height: pageH }}
          />
        </ScrollView>
      </View>

      <TxnDetailSheet
        txn={detailTxn}
        context="group"
        onClose={() => setDetailTxn(null)}
        onEdit={(t: any) => {
          setDetailTxn(null);
          navigation.navigate('AddTransaction', { editTxnId: t.id });
        }}
      />

      <CategoryPickerModal
        visible={!!categoryTxn}
        categoryOnly
        categories={categories}
        selectedCategoryId={categoryTxn?.categoryId}
        selectedParent={categoryTxn?.parentCategory}
        selectedChild={categoryTxn?.childCategory}
        isHidden={!!categoryTxn?.isHidden}
        isIgnored={!!categoryTxn?.isIgnored}
        canRefund={categoryTxn?.type === 'credit'}
        isRefund={!!categoryTxn?.isRefund}
        canSplit={false}
        isSplitTxn={!!(categoryTxn?.isSplit || categoryTxn?.isSplitMemo)}
        categoryLocked={!!categoryTxn?.lbLocked}
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
        onDone={(draft) => {
          if (!categoryTxn) return;
          try {
            applyCategoryPickerDraft(useEPurseStore, categoryTxn, draft);
            setCategoryTxn(null);
          } catch (error: any) {
            toast.error('Could not save', error?.message || 'Please try again.');
          }
        }}
        onSelectLentBorrow={() => {
          toast.warning('Use a separate entry', 'Lending and repayments need a person and cannot be assigned to a group expense.');
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
  // One page grey behind everything (header included, flat) — the white surfaces
  // (group card, zone tile, tab bar, list cards) are what separate the sections.
  root: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, backgroundColor: colors.background },
  headerArea: { paddingTop: spacing.xs, paddingBottom: spacing.md },

  // Pre-revamp "expense summary card" shell — the bottom accent border it
  // used to carry was dropped on request, replaced by the `borderWidth`/
  // `borderColor: accent` set inline where this is used. Its gradient tint
  // is currently commented out (see the JSX below) — right now the 1px
  // border is the card's only colour cue.
  expenseCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginHorizontal: spacing.md,
    ...shadows.card,
  },
  // Icon/name/actions row layout. Named `cardHeaderGrad` from when this WAS
  // the LinearGradient itself (now commented out above the outer
  // `expenseCard`) — kept the name since the commented block still refers
  // to it, so a revert doesn't need a rename too.
  // Tinted with the group colour at the call site; inner radius = card radius − its 1px border.
  cardHeaderGrad: {
    borderTopLeftRadius: radius.lg - 1,
    borderTopRightRadius: radius.lg - 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  cardEmoji: { fontSize: 26 },
  cardName: { ...typography.h3, color: colors.textPrimary },
  cardMeta: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  // Icon-in-tinted-circle, same idiom as AccountDetailsScreen's stat tiles —
  // the background colour itself (danger/neutral) is set per button at the
  // call site, not here (each icon carries its own tint).
  cardActionBtn: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  cardSummary: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  cardSummaryTight: { paddingBottom: spacing.md },
  balanceLine: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    borderTopWidth: DIVIDER_W, borderTopColor: colors.divider,
  },
  // Words quiet, amount loud: the sentence is context, the coloured figure is the
  // point — same lent/borrowed ink as every other money figure in the app.
  balanceText: { ...typography.body, color: colors.textSecondary, fontWeight: '500', flex: 1 },
  balanceAmt: { fontWeight: '800' },
  balanceSettled: { fontWeight: '700' },
  // Total Spent │ Your Share (shared) or │ This Month (personal).
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  statCell: { flex: 1 },
  statDivider: { width: DIVIDER_W, backgroundColor: colors.divider, marginHorizontal: spacing.md },
  statLabel: { ...typography.tiny, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.6 },
  // One figure size for the card — shared (2 stats) and personal (1) alike.
  statValue: { ...typography.h2, color: colors.textPrimary, fontWeight: '700', marginTop: 3 },


  // Its own white tile on the page grey — a setting of the group.
  zoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.md, marginTop: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2,
    backgroundColor: colors.card, borderRadius: radius.lg,
    ...shadows.card,
  },
  zoneIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  zoneTitle: { ...typography.bodyBold, color: colors.textPrimary },
  zoneSub: { ...typography.small, color: colors.textSecondary, marginTop: 1 },

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
  memberRowName: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  // Light fill, no border — an inline affordance, not an outlined CTA.
  addMemberBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: spacing.md, minHeight: BUTTON_H, borderRadius: radius.lg,
  },
  addMemberTxt: { ...typography.body, fontWeight: '700' },

  settledAllTxt: { ...typography.small, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
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
  pendingRowDivider: { borderTopWidth: DIVIDER_W, borderTopColor: colors.divider },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  avatarTxt: { fontWeight: '800', fontSize: 13 },
  // Amount leads (the headline figure); "{name} owes you"/"You owe {name}"
  // is the smaller descriptive line below it.
  pendingAmount: { ...typography.bodyBold, fontWeight: '700' },
  pendingNameSub: { ...typography.small, color: colors.textSecondary, marginTop: 2 },
  settleOutlineBtn: {
    height: 28, paddingHorizontal: spacing.sm + 2, borderRadius: radius.pill, borderWidth: 1,
    marginLeft: spacing.sm, alignItems: 'center', justifyContent: 'center',
  },
  settleOutlineBtnTxt: { ...typography.small, fontWeight: '700' },
  bellGap: { marginLeft: spacing.sm },
  waBtn: {
    width: 28, height: 28, borderRadius: 14, marginLeft: spacing.sm,
    backgroundColor: '#25D36618', borderWidth: 1, borderColor: '#25D36633',
    alignItems: 'center', justifyContent: 'center',
  },

  summaryScroll: { padding: spacing.md, paddingBottom: spacing.xl },
  chartCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg, ...shadows.card },

  listCard: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  categoryRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  // The last Contribution row's progress bar sat right against the card's
  // rounded bottom edge with only the standard row padding — a bit more
  // breathing room below it specifically.
  categoryRowLast: { paddingBottom: spacing.lg },
  categoryEmoji: { fontSize: 20 },
  categoryTopLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryName: { ...typography.bodyBold, color: colors.textPrimary, flexShrink: 1, marginRight: spacing.sm },
  categoryAmt: { ...typography.bodyBold, color: colors.textPrimary, fontWeight: '700' },
  categoryBar: { marginTop: 6 },
  // Contribution row: avatar leads, top line pairs name (left) with the
  // percentage (right) via `categoryTopLine`, the bar sits below spanning the
  // full column, and the full ₹ amount sits outside the column on the row's
  // own right (via `categoryRow`'s flexDirection) — the avatar/trailing-figure
  // shape Pending Settlements/Members rows already use.
  contribPercent: { ...typography.small, color: colors.textSecondary, fontWeight: '600' },

  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingTxt: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
