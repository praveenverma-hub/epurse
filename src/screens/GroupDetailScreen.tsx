// =============================================================================
// GroupDetailScreen — level 2 of the Groups feature (pushed from GroupsScreen's
// list). Top card is the pre-revamp GroupsScreen's own "expense summary card"
// shell — icon/name strip + a 1px group-colour border (the card's own gradient
// tint is currently commented out, see `expenseCard` below) — a Total
// Expense/Your Balance stat row (⋮ menu: Add Expense / Edit / Delete), a Group Zone
// toggle, then three text tabs (Transactions / Members / Summary — Members is
// skipped for a personal group, which has no split).
// =============================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { Text } from '../components/AppText';
import type { LayoutChangeEvent } from 'react-native';
import { TabView } from 'react-native-tab-view';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore, selectAccountsHidden } from '../store/ePurseStore';
import { defaultAccountId, hiddenBookingAccountId } from '../utils/defaultAccount';
import PlainScreenHeader from '../components/PlainScreenHeader';
import { colors, radius, spacing, typography as typographyBase, shadows, BUTTON_H, withAlpha, DIVIDER_W } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import { useTheme } from '../hooks/useTheme';
import { formatCurrency, formatDate, monthKey, titleCaseName } from '../utils/format';
import { openSettleParts } from '../utils/settleAllocation';
import { groupSyncStatus, GROUP_SYNC_LABEL, syncDotTone } from '../utils/groupSyncStatus';
import { LB_NO_ACCOUNT, lbLinkedLine, lbTagLocked, lbTxnMerchant } from '../utils/lbEntryDisplay';
import { categoryFieldsFor } from '../constants/twoTierCategories';
import { countsForSpend, isSharedBill, memberName, spendContribution } from '../utils/split';
import { autoLinkGroupMembers, suggestByName, unlinkedMembers, type LinkCandidate } from '../sync/contactLink';
import { fetchContactsForPicker } from '../services/contactsService';
import { normalizePhone } from '../utils/validation';
import ContactPickerSheet, { type PickedContact } from '../components/ContactPickerSheet';
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
import InfoSheet from '../components/InfoSheet';
import InfoIcon from '../components/InfoIcon';
import { cashShortfall, NOT_ENOUGH_CASH, notEnoughCashText } from '../utils/cashBalance';
import QrCode from '../components/QrCode';
import EditIcon from '../components/EditIcon';
import OverflowMenu from '../components/OverflowMenu';
import FAB, { FAB_CLEARANCE } from '../components/FAB';
import ReminderBell from '../components/ReminderBell';
import { groupBalanceLine, groupHeroFigures } from '../utils/groupHero';
import AccountPickerSheetBase from '../components/AccountPickerSheet';
import MonthDivider from '../components/MonthDivider';
import WhatsAppIcon from '../components/WhatsAppIcon';
import MonthlyBarChart from '../components/MonthlyBarChart';
import { useToast } from '../components/Toast';

// AccountPickerSheet.js has no TS declarations — its optional props read as required.
const AccountPickerSheet = AccountPickerSheetBase as React.FC<any>;
import type { Group, GroupMember } from '../types/group';
import { useSyncEnabled } from '../sync/config';
import { addBackMember, createInviteLink, flushGroup, leaveSharedGroup, removeSharedMember } from '../sync/groupSync';
import { memberBalancePaise, memberStatus } from '../sync/localGroup';

const TransactionItem = TransactionItemRaw as React.ComponentType<{
  txn: any;
  context?: 'default' | 'account' | 'group';
  onPress?: () => void;
  onPressCategory?: () => void;
}>;

interface GroupBalanceRow {
  personKey: string; person: string; phone?: string | null; net: number;
  /** A settlement recorded OUTSIDE this group that overpaid their direct balance — likely this group's. */
  outside?: { entryId: string; amount: number; date: string };
}
interface ConfirmState {
  title?: string; message?: string; primaryText?: string; secondaryText?: string;
  destructive?: boolean; onPrimary?: () => void | Promise<void>; onSecondary?: () => void;
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
  const liveAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);
  const accountsHidden = useEPurseStore(selectAccountsHidden) as boolean;
  const deleteGroup = useEPurseStore((s: any) => s.deleteGroup) as (id: string) => void;
  const getPersonBalances = useEPurseStore((s: any) => s.getPersonBalances) as () => any[];
  const applySettleToGroup = useEPurseStore((s: any) => s.applySettleToGroup) as (entryId: string, groupId: string, max?: number) => boolean;
  const settleGroupPersonBalance = useEPurseStore((s: any) => s.settleGroupPersonBalance) as (id: string, personKey: string, opts?: { accountId?: string | null }) => { linkedTxn: any } | null;
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
  const [pastOpen, setPastOpen] = useState(false);
  // Linking members to MY contacts (sync/contactLink.ts): the reminder's sheet, the member
  // being picked for, and the contacts its one-tap suggestions come from.
  const linkGroupMemberContact = useEPurseStore((s: any) => s.linkGroupMemberContact) as (g: string, m: string, link: any) => void;
  const snoozeContactLinks = useEPurseStore((s: any) => s.snoozeContactLinks) as (g: string) => void;
  const [linkSheetOpen, setLinkSheetOpen] = useState(false);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [deviceContacts, setDeviceContacts] = useState<PickedContact[]>([]);
  const unlinkedNow = unlinkedMembers(group);
  const phoneKeyCount = group?.shared ? Object.keys(group.shared.fold.phoneKeys || {}).length : 0;
  // Fingerprint matches link on their own (contacts permission already given — never asks).
  // The first run per open also re-reads linked contacts' names (renamed on this phone).
  // ONE effect: autoLink drops a call while another for the same group is running.
  const namesRefreshedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!group?.shared) return;
    const refreshNames = namesRefreshedFor.current !== group.id;
    if (!refreshNames && !(phoneKeyCount > 0 && unlinkedNow.length > 0)) return;
    namesRefreshedFor.current = group.id;
    autoLinkGroupMembers(group.id, { refreshNames });
  }, [group?.id, phoneKeyCount, unlinkedNow.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (linkSheetOpen) fetchContactsForPicker().then(setDeviceContacts).catch(() => {});
  }, [linkSheetOpen]);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const [headerH, setHeaderH] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [invite, setInvite] = useState<{ link: string; title: string } | null>(null);
  const [pickInvite, setPickInvite] = useState(false);
  const [totalsInfo, setTotalsInfo] = useState(false);
  const [settleTarget, setSettleTarget] = useState<GroupBalanceRow | null>(null);
  const [detailTxn, setDetailTxn] = useState<any | null>(null);
  const [categoryTxn, setCategoryTxn] = useState<any | null>(null);
  const [ccBillTxn, setCcBillTxn] = useState<any | null>(null);

  const syncOn = useSyncEnabled();
  const live = !!group?.shared && group.shared.status !== 'ended';
  // Sharing ended: a read-only record — new entries here would never reach anyone.
  const closed = !!group?.shared && !live;
  // Send anything queued and catch up whenever the screen comes into view; offline stays quiet.
  useEffect(() => {
    if (!live || !groupId) return undefined;
    const refresh = () => { flushGroup(groupId).catch(() => {}); };
    refresh();
    return navigation.addListener('focus', refresh);
  }, [live, groupId, navigation]);

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

  // Settlements belong to the group's story but aren't expenses (their txn carries no
  // groupId, so totals never see them). One card each, built from the ledger row — a
  // ledger-only settle has no txn, and one txn can settle several groups (only this
  // group's part is shown). Tap opens the real txn when there is one.
  const groupSettles = useMemo(() => {
    const txnById = new Map(transactions.map((t) => [t.id, t]));
    return lentBorrowed
      .filter((l) => l.groupId === groupId && (l.kind === 'lent_settled' || l.kind === 'borrow_repaid'))
      .map((l) => {
        const txn = l.sourceTxnId ? txnById.get(l.sourceTxnId) || null : null;
        return {
          id: `settle_${l.id}`,
          settleTxn: txn,
          isSettleRow: true,
          type: l.kind === 'lent_settled' ? 'credit' : 'debit',
          amount: l.amount,
          ...categoryFieldsFor(l.kind),
          merchant: lbTxnMerchant(l.kind, titleCaseName(l.person)),
          createdAt: l.date,
          accountId: txn?.accountId,
          accountMask: txn?.accountMask,
          bankName: txn?.bankName,
          accountType: txn?.accountType,
          note: txn?.note,
          syncRejected: !!l.syncRejected,
        };
      });
  }, [lentBorrowed, transactions, groupId]);

  const groupListData = useMemo(() => {
    const out: any[] = [];
    let lastMonth: string | null = null;
    const rows = [...groupTxns, ...groupSettles]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const t of rows) {
      const mk = monthKey(t.createdAt);
      if (lastMonth !== null && mk !== lastMonth) {
        out.push({ _divider: true, id: `div-${mk}`, monthKey: mk, total: groupMonthTotals[mk] || 0 });
      }
      lastMonth = mk;
      out.push(t);
    }
    return out;
  }, [groupTxns, groupSettles, groupMonthTotals]);

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
      if (Math.abs(net) <= 0.005) continue;
      // Paid outside the group: their direct balance went the OTHER way (overpaid) by at
      // least something — offer to move that much here (never more, so a real direct debt
      // can't re-open). Only when this group can still take it (open, not a past member).
      const settleKind = net > 0 ? 'lent_settled' : 'borrow_repaid';
      const dir = net > 0 ? 1 : -1;
      const direct = (p.entries || []).filter((e: any) => !e.groupId);
      const directSum = direct.reduce((acc: number, e: any) => acc + (e.kind === 'lent' || e.kind === 'borrow_repaid' ? 1 : e.kind === 'borrowed' || e.kind === 'lent_settled' ? -1 : 0) * e.amount, 0);
      const overpaid = Math.round(-dir * directSum * 100) / 100;
      const last = direct.filter((e: any) => e.kind === settleKind).sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))[0];
      const canTake = openSettleParts(p.entries || [], settleKind, groups).some((x) => x.groupId === groupId);
      const outside = overpaid >= 0.5 && last && canTake
        ? { entryId: last.id, amount: Math.round(Math.min(Math.abs(net), overpaid, last.amount) * 100) / 100, date: last.date }
        : undefined;
      rows.push({ personKey: p.personKey, person: p.person, phone: p.phone, net, outside });
    }
    return rows.sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }, [getPersonBalances, isShared, groupId, lentBorrowed, groups]);

  // Top card (utils/groupHero.ts): totals from the same live list as the rows
  // below, plus the outstanding balance in one line.
  const heroFigures = useMemo(() => groupHeroFigures(groupTxns), [groupTxns]);
  const balanceLine = useMemo(
    () => (isShared ? groupBalanceLine(groupBalances.map((b) => ({ person: titleCaseName(b.person), net: b.net })), groupTxns.length > 0) : null),
    [isShared, groupBalances, groupTxns.length],
  );

  const memberNamesLabel = useMemo(() => {
    if (!isShared || !group) return '';
    const names = (group.members || []).map((m) => (m.isMe ? 'You' : titleCaseName(memberName(m))));
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
      // The member's CURRENT name (my contact name if linked), not the one stamped on the txn.
      const member = (group?.members || []).find((m) => m.memberId === id);
      const name = id === 'me' ? 'You' : titleCaseName(memberName(member) || gs.paidByName || 'Member');
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
    // Only at ₹0 with everyone — deleting would otherwise erase what's owed (deleteGroup).
    if (groupBalances.length) {
      setConfirm({
        title: 'Settle Up First',
        message: groupBalances
          .map((b) => (b.net > 0 ? `${titleCaseName(b.person)} owes you ${formatCurrency(b.net)}` : `You owe ${titleCaseName(b.person)} ${formatCurrency(-b.net)}`))
          .join('\n') + '\n\nYou can delete the group once everyone is at ₹0.',
        primaryText: 'View Members',
        secondaryText: 'Cancel',
        onPrimary: () => { setConfirm(null); goTab('members'); },
        onSecondary: () => setConfirm(null),
      });
      return;
    }
    // Live: Delete = Leave (₹0 only — leaveSharedGroup refuses otherwise, and the toast
    // says so) + remove it here. The others keep the group and its history.
    if (live) {
      setConfirm({
        title: `Delete ${group.name}?`,
        message: 'You\'ll leave the group and it\'s removed from this phone. The others keep it. Your expenses and settlements stay in Activity, marked with its name.',
        primaryText: 'Delete',
        secondaryText: 'Cancel',
        destructive: true,
        onPrimary: runShared(async () => {
          await leaveSharedGroup(group.id);
          deleteGroup(group.id);
          toast.success('Group deleted');
          navigation.goBack();
        }, 'Couldn\'t delete'),
      });
      return;
    }
    setConfirm({
      title: 'Delete group?',
      message: `"${group.name}" will be removed. `
        + (isShared ? 'Your expenses and settlements stay in Activity, marked with its name. Ones someone else paid are removed.' : 'Its transactions stay in Activity, marked with its name.'),
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

  // Sharing actions run inside the confirm modal, which shows its own spinner while they work.
  const runShared = (task: () => Promise<void>, failTitle: string) => async () => {
    try {
      await task();
      setConfirm(null);
    } catch (e) {
      setConfirm(null);
      toast.error(failTitle, (e as Error).message);
    }
  };

  // Inviting is how a group goes live: the first invite puts it on the server.
  const canInvite = isShared && syncOn && (live || !group.shared);
  const myPhone = useEPurseStore((s: any) => s.userPhones?.[0] || '') as string;
  const handleInvite = (forMember?: Pick<GroupMember, 'memberId' | 'name' | 'contactName'>) => (!myPhone ? setConfirm({
    title: 'Add Your Number First',
    message: 'Everyone in the group sees you under the name they saved for you, and that needs your number. It goes on your profile.',
    primaryText: 'Add Number',
    secondaryText: 'Not Now',
    onPrimary: () => { setConfirm(null); navigation.navigate('MyProfile', { focusPhone: true }); },
  }) : setConfirm({
    title: forMember ? `Invite ${titleCaseName(memberName(forMember))}` : 'Invite People',
    message: (live ? '' : 'Inviting makes this group live: people you invite see its expenses and balances, and add their own. Everything else stays on your phone.\n\n')
      + `The invite works once, for 48 hours. Share it only with ${forMember ? titleCaseName(memberName(forMember)) : 'the person you\'re inviting'}.`,
    primaryText: 'Create Invite',
    secondaryText: 'Cancel',
    onPrimary: runShared(async () => {
      const link = await createInviteLink(group.id, forMember?.memberId);
      setConfirm(null);
      setInvite({ link, title: forMember ? `Invite ${titleCaseName(memberName(forMember))}` : 'Invite People' });
    }, 'Couldn\'t create the invite'),
  }));
  // In person: they scan the QR (it holds the same link). Remote: Share Link.
  const shareInvite = (link: string) => { void Share.share({ message: `Join "${group.name}" on ePurse: ${link}` }); };

  // Each person's tag and what I may do about them (sync/localGroup.ts, tested).
  const status = (m: GroupMember) => memberStatus(group.shared, m);

  // Who an invite is for is the inviter's call (they know); the joiner is never asked.
  const notJoined = (group.members || []).filter((m) => !m.isMe && !m.archived && !status(m).joined);
  const startInvite = () => (notJoined.length ? setPickInvite(true) : handleInvite());
  const inviteFor = (m?: GroupMember) => { setPickInvite(false); setTimeout(() => handleInvite(m), 350); };

  const handleAddBack = (m: Pick<GroupMember, 'memberId' | 'name' | 'contactName'>) => {
    const name = titleCaseName(memberName(m));
    setConfirm({
      title: `Add ${name} Back?`,
      message: `${name} sees this group again, including what was added meanwhile, and can be in new expenses.`,
      primaryText: 'Add Back',
      secondaryText: 'Cancel',
      onPrimary: runShared(async () => {
        await addBackMember(group.id, m.memberId);
        toast.success(`${name} added back`);
      }, 'Couldn\'t add them back'),
    });
  };

  const handleRemoveMember = (m: GroupMember) => {
    const name = titleCaseName(memberName(m));
    if (memberBalancePaise(group.shared!, m.memberId) !== 0) {
      toast.info(`${name} isn't settled up`, 'Someone can be removed once their balance in this group is ₹0.');
      return;
    }
    setConfirm({
      title: `Remove ${name}?`,
      message: `${name} stays in past expenses but can't be added to new ones`
        + (status(m).joined ? ', and stops getting this group\'s updates.' : '.'),
      primaryText: 'Remove',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: runShared(async () => {
        await removeSharedMember(group.id, m.memberId);
        toast.success(`${name} removed`);
      }, 'Couldn\'t remove'),
    });
  };

  const handleSyncNow = () => {
    flushGroup(group.id).then(
      () => toast.success('Synced'),
      (e) => toast.error('Couldn\'t sync', (e as Error).message),
    );
  };

  const handleLeave = () => setConfirm({
    title: `Leave ${group.name}?`,
    message: 'You\'ll stop getting updates. The group and its history stay on your phone.',
    primaryText: 'Leave',
    secondaryText: 'Cancel',
    destructive: true,
    onPrimary: runShared(async () => {
      await leaveSharedGroup(group.id);
      toast.success('You left the group');
    }, 'Couldn\'t leave'),
  });

  const applyOutside = (pb: GroupBalanceRow) => {
    if (!pb.outside) return;
    if (applySettleToGroup(pb.outside.entryId, group.id, pb.outside.amount)) {
      toast.success('Applied to this group', `${titleCaseName(pb.person)} · ${formatCurrency(pb.outside.amount)}`);
    }
  };

  /** Both exits of the settle picker — through an account (links or books a transaction), or ledger-only. */
  const commitSettle = (pb: GroupBalanceRow, accountId: string | null) => {
    // Repaying from Cash can't take it below ₹0 — the picker stays open to choose again.
    const short = pb.net < 0 && accountId ? cashShortfall(accounts.find((a: any) => a.id === accountId), Math.abs(pb.net)) : null;
    if (short != null) {
      toast.error(NOT_ENOUGH_CASH, notEnoughCashText(short, formatCurrency));
      return;
    }
    const res = settleGroupPersonBalance(group.id, pb.personKey, { accountId });
    toast.success('Settled', res?.linkedTxn
      ? lbLinkedLine(res.linkedTxn)
      : `${titleCaseName(pb.person)} · ${formatCurrency(Math.abs(pb.net))}`);
    setSettleTarget(null);
  };

  const handleSettle = (pb: GroupBalanceRow) => {
    // Either direction asks which account the money moved through (the picker IS the
    // confirmation). No picker when there's nothing to pick (no accounts → ledger-only) or
    // tracking is off in Settings (→ the primary quietly, or none if that's Cash): a confirm.
    if (liveAccounts.length && !accountsHidden) { setSettleTarget(pb); return; }
    setConfirm({
      title: 'Settle Up',
      message:
        `${titleCaseName(pb.person)} · ${formatCurrency(Math.abs(pb.net))}\n\n` +
        `Settles this group's portion only — their balance in other groups and direct splits stays untouched.`,
      primaryText: 'Settle',
      secondaryText: 'Cancel',
      destructive: true,
      onPrimary: () => {
        setConfirm(null);
        commitSettle(pb, hiddenBookingAccountId(liveAccounts));
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

  // People who left or were removed sit under "Past Members", out of the way of the active list.
  const currentMembers = (group.members || []).filter((m) => !m.archived);
  const pastMembers = (group.members || []).filter((m) => m.archived);
  const renderMemberRow = (m: GroupMember, i: number) => {
    const displayName = m.isMe ? 'You' : titleCaseName(memberName(m));
    const st = status(m);
    const linked = !!(m.contactId || m.phone);
    const menu = [
      ...(m.isMe ? [] : [{ key: 'link', label: linked ? 'Change Contact' : 'Link Contact', icon: 'link-outline' as const, onPress: () => setPickFor(m.memberId) }]),
      ...(linked && !m.isMe ? [{ key: 'unlink', label: 'Unlink Contact', icon: 'unlink-outline' as const, onPress: () => linkGroupMemberContact(group.id, m.memberId, null) }] : []),
      ...(st.canAddBack ? [{ key: 'addBack', label: 'Add Back', icon: 'person-add-outline' as const, onPress: () => handleAddBack(m) }] : []),
      ...(st.canRemove && !st.canAddBack ? [{ key: 'remove', label: 'Remove', icon: 'person-remove-outline' as const, destructive: true, onPress: () => handleRemoveMember(m) }] : []),
    ];
    return (
      <View key={m.memberId} style={[styles.memberRow, i > 0 && styles.pendingRowDivider]}>
        <View style={[styles.avatar, { backgroundColor: theme.primary + '22', marginRight: 0 }]}>
          <Text style={[styles.avatarTxt, { color: theme.primary }]}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.memberRowName} numberOfLines={1}>{displayName}</Text>
        {canInvite && !m.isMe && !m.archived && !st.joined ? (
          <TouchableOpacity
            style={[styles.memberInviteBtn, { borderColor: theme.primary }]}
            onPress={() => handleInvite(m)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Invite ${displayName}`}
          >
            <Text style={[styles.memberInviteTxt, { color: theme.primary }]}>Invite</Text>
          </TouchableOpacity>
        ) : st.tag ? (
          <View style={styles.memberRoleTag}>
            <Text style={styles.memberRoleTagTxt}>{st.tag}</Text>
          </View>
        ) : null}
        {menu.length ? (
          <OverflowMenu
            style={styles.memberMenuBtn}
            accessibilityLabel={`More for ${displayName}`}
            actions={menu}
          />
        ) : null}
      </View>
    );
  };

  // One-tap suggestions: an exact name match among my contacts / ledger people (never silent).
  const linkCandidates = (): LinkCandidate[] => {
    const out: LinkCandidate[] = deviceContacts.map((c) => ({ name: c.name, contactId: c.id, phone: normalizePhone(c.phones[0] || '') || null }));
    const seen = new Set(out.map((c) => c.contactId));
    for (const p of getPersonBalances()) {
      if (!p.contactId && !p.phone) continue;
      if (p.contactId && seen.has(p.contactId)) continue;
      out.push({ name: p.person, contactId: p.contactId || null, phone: p.phone || null });
    }
    return out;
  };
  const linkTo = (memberId: string, c: { contactId: string | null; phone: string | null; name: string }) =>
    linkGroupMemberContact(group.id, memberId, c);
  const onPicked = (c: PickedContact) => {
    if (pickFor) linkTo(pickFor, { contactId: c.id, phone: normalizePhone(c.phones[0] || '') || null, name: c.name });
    setPickFor(null);
  };

  const renderMembers = () => (
        <View style={styles.membersScroll}>
          {live && group.shared!.fold.checkpointMismatch != null ? (
            <View style={[styles.mismatchNote, { borderColor: theme.warning + '66' }]}>
              <Ionicons name="warning-outline" size={18} color={theme.warning} />
              <Text style={styles.mismatchTxt}>
                Balances on this phone don&apos;t match another member&apos;s. Compare with the group before settling up.
              </Text>
            </View>
          ) : null}
          {isShared && unlinkedNow.length > 0 && !group.contactLinksSnoozed ? (
            <View style={[styles.linkBanner, { backgroundColor: theme.primary + '10', borderColor: theme.primary + '33' }]}>
              <View style={styles.linkBannerTop}>
                <Ionicons name="link-outline" size={16} color={theme.primary} />
                <Text style={[styles.linkBannerTxt, { color: theme.textSecondary }]}>
                  {unlinkedNow.length === 1
                    ? `${titleCaseName(memberName(unlinkedNow[0]))} isn't linked to your contacts, so their balance doesn't join your Lent/Borrowed.`
                    : `${unlinkedNow.length} people aren't linked to your contacts, so their balances don't join your Lent/Borrowed.`}
                </Text>
              </View>
              <View style={styles.linkBannerActions}>
                <TouchableOpacity onPress={() => snoozeContactLinks(group.id)} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.linkBannerAction, { color: theme.textSecondary }]}>Not Now</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setLinkSheetOpen(true)} hitSlop={8} accessibilityRole="button">
                  <Text style={[styles.linkBannerAction, { color: theme.primary }]}>Link</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
          <View style={styles.cardShell}>
          <View style={styles.memberListCard}>
            {currentMembers.map(renderMemberRow)}
            {pastMembers.length ? (
              <TouchableOpacity
                style={[styles.memberRow, styles.pendingRowDivider]}
                onPress={() => setPastOpen((o) => !o)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ expanded: pastOpen }}
              >
                <Text style={[styles.memberRowName, styles.pastToggleTxt]}>Past Members · {pastMembers.length}</Text>
                <Ionicons name={pastOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
            {pastOpen ? pastMembers.map((m) => renderMemberRow(m, 1)) : null}
          </View>
          </View>
          {closed ? null : (
          <TouchableOpacity
            style={[styles.addMemberBtn, { backgroundColor: theme.primary + '14' }]}
            onPress={() => navigation.navigate('GroupForm', { groupId: group.id, addMember: true })}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={16} color={theme.primary} />
            <Text style={[styles.addMemberTxt, { color: theme.primary }]}>Add Member</Text>
          </TouchableOpacity>
          )}

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
                  <View key={pb.personKey} style={i > 0 ? styles.pendingRowDivider : undefined}>
                  <View style={styles.pendingRow}>
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
                  {pb.outside && !closed ? (
                    <View style={styles.outsideRow}>
                      <Text style={[styles.outsideTxt, { color: theme.textSecondary }]}>
                        {owesYou
                          ? `${titleCaseName(pb.person)} paid you ${formatCurrency(pb.outside.amount)} on ${formatDate(pb.outside.date)} outside this group.`
                          : `You paid ${titleCaseName(pb.person)} ${formatCurrency(pb.outside.amount)} on ${formatDate(pb.outside.date)} outside this group.`}
                      </Text>
                      <TouchableOpacity onPress={() => applyOutside(pb)} hitSlop={8} accessibilityRole="button">
                        <Text style={[styles.outsideAction, { color: theme.primary }]}>Apply Here</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
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
          onPress={() => setDetailTxn(item.settleTxn || item)}
          onPressCategory={item.isSettleRow ? undefined : () => setCategoryTxn(item)}
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
  // The last row scrolls clear of the Add Expense "+".
  const bottomPad = insets.bottom + spacing.xl + (closed ? 0 : FAB_CLEARANCE);
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
              subtitle="Add one with the + button, or tag existing transactions from the Activity tab."
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
                  {/* Names truncate; the status after them never does (many members used to
                      push "Live" off the end). Same status + dot as the Groups list card. */}
                  {(() => {
                    const sync = groupSyncStatus(group);
                    const tone = syncDotTone(sync);
                    const dot = tone ? theme[tone] : null;
                    return (
                      <View style={styles.cardMetaRow}>
                        <Text style={[styles.cardMeta, styles.cardMetaNames]} numberOfLines={1}>
                          {isShared ? memberNamesLabel : 'Personal group'}
                        </Text>
                        {sync !== 'personal' ? (
                          <>
                            <Text style={styles.cardMeta}> · </Text>
                            {dot ? <View style={[styles.cardSyncDot, { backgroundColor: dot }]} /> : null}
                            <Text style={[styles.cardMeta, dot ? { color: theme.textPrimary, fontWeight: '600' } : null]} numberOfLines={1}>
                              {GROUP_SYNC_LABEL[sync]}
                            </Text>
                          </>
                        ) : null}
                        {group.excludeFromTotals ? <Text style={styles.cardMeta} numberOfLines={1}> · Excluded</Text> : null}
                      </View>
                    );
                  })()}
                </View>
                {/* One ⋮ for the group's actions — Add Expense, Edit, Delete. Frees the
                    row below the card for the Group Zone tile. */}
                <OverflowMenu
                  style={[styles.cardActionBtn, { backgroundColor: withAlpha(colors.textSecondary, 0.12) }]}
                  actions={[
                    ...(closed ? [] : [
                      { key: 'add', label: 'Add Expense', icon: 'add-circle-outline' as const, onPress: () => navigation.navigate('AddGroupExpense', { groupId: group.id }) },
                      { key: 'edit', label: 'Edit Group', icon: <EditIcon size={16} color={colors.textSecondary} />, onPress: () => navigation.navigate('GroupForm', { groupId: group.id }) },
                    ]),
                    ...(canInvite ? [{ key: 'invite', label: 'Invite People', icon: 'person-add-outline' as const, onPress: startInvite }] : []),
                    ...(group.shared ? [{ key: 'history', label: 'History', icon: 'time-outline' as const, onPress: () => navigation.navigate('GroupHistory', { groupId: group.id }) }] : []),
                    ...(live ? [{ key: 'sync', label: 'Sync Now', icon: 'sync-outline' as const, onPress: handleSyncNow }] : []),
                    // Live: Leave keeps a read-only copy here; Delete leaves AND removes it. Both ₹0 only.
                    ...(live ? [{ key: 'leave', label: 'Leave Group', icon: 'exit-outline' as const, destructive: true, onPress: handleLeave }] : []),
                    { key: 'delete', label: 'Delete Group', icon: 'trash-outline' as const, destructive: true, onPress: handleDeleteGroup },
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
                    {isShared ? (
                      <TouchableOpacity
                        style={styles.statLabelRow}
                        onPress={() => setTotalsInfo(true)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel="What these totals mean"
                      >
                        <Text style={styles.statLabel}>YOUR SHARE</Text>
                        <InfoIcon size={13} color={colors.textSecondary} />
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.statLabel}>THIS MONTH</Text>
                    )}
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
            {closed ? null : (
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
            )}
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

      {/* The group's main action within thumb reach (also in the ⋮ menu). */}
      {closed ? null : (
        <FAB
          onPress={() => navigation.navigate('AddGroupExpense', { groupId: group.id })}
          accessibilityLabel="Add Expense"
          bottomInset={insets.bottom}
        />
      )}

      <TxnDetailSheet
        txn={detailTxn}
        context="group"
        onClose={() => setDetailTxn(null)}
        // A group's settle is fixed from the group (lbTagLocked); a ledger-only one has no txn.
        onEdit={detailTxn?.isSettleRow || lbTagLocked(detailTxn, lentBorrowed) ? undefined : (t: any) => {
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
        sharedBill={isSharedBill(categoryTxn)}
        txnType={categoryTxn?.type}
        categoryLocked={lbTagLocked(categoryTxn, lentBorrowed)}
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

      <InfoSheet
        visible={totalsInfo}
        onClose={() => setTotalsInfo(false)}
        icon={<Ionicons name="pie-chart-outline" size={36} color={theme.primary} />}
        title="Group Totals"
        bullets={[
          { label: 'Total Spent', value: 'Every bill in this group, whoever paid.' },
          { label: 'Your Share', value: 'Your part of those bills, whoever paid. This is what counts as your spending.' },
          { label: 'Balance', value: 'What\'s still owed between you and the others after settle-ups.' },
        ]}
      />
      <InfoSheet
        visible={pickInvite}
        variant="center"
        title="Who's This Invite For?"
        body="They join as that person, with nothing to choose on their phone."
        content={(
          <View style={styles.pickList}>
            {[...notJoined.map((m) => ({ key: m.memberId, label: titleCaseName(memberName(m)), icon: 'person-outline' as const, m })),
              { key: 'new', label: 'Someone New', icon: 'person-add-outline' as const, m: undefined }].map((row, i) => (
              <TouchableOpacity
                key={row.key}
                style={[styles.pickRow, i > 0 && styles.pendingRowDivider]}
                onPress={() => inviteFor(row.m)}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <Ionicons name={row.icon} size={18} color={theme.primary} />
                <Text style={styles.memberRowName} numberOfLines={1}>{row.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        ctaText="Cancel"
        onClose={() => setPickInvite(false)}
      />
      <InfoSheet
        visible={!!invite}
        variant="center"
        title={invite?.title ?? ''}
        body="Let them scan this with their phone's camera, or share the link instead."
        content={invite ? (
          <View style={styles.qrWrap}>
            <QrCode value={invite.link} size={232} accessibilityLabel="Invite QR code" />
          </View>
        ) : null}
        ctaText="Share Link"
        onCtaPress={() => { if (invite) shareInvite(invite.link); }}
        onClose={() => setInvite(null)}
      />

      <CenterModal
        visible={linkSheetOpen && unlinkedNow.length > 0}
        title="Link to Contacts"
        message="Linked people's group balances join your Lent/Borrowed."
        primaryText="Done"
        onPrimary={() => setLinkSheetOpen(false)}
        secondaryText={undefined}
        onSecondary={undefined}
        onClose={() => setLinkSheetOpen(false)}
      >
        {(() => {
          const candidates = linkCandidates();
          return unlinkedNow.map((m) => {
            const hit = suggestByName(m, candidates);
            return (
              <View key={m.memberId} style={styles.linkRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.linkRowName, { color: theme.textPrimary }]} numberOfLines={1}>{titleCaseName(memberName(m))}</Text>
                  <TouchableOpacity onPress={() => linkGroupMemberContact(group.id, m.memberId, { noContact: true })} hitSlop={6}>
                    <Text style={[styles.linkRowHint, { color: theme.textMuted }]}>Not in My Contacts</Text>
                  </TouchableOpacity>
                </View>
                {hit ? (
                  <TouchableOpacity onPress={() => linkTo(m.memberId, hit)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Link to ${hit.name}`}>
                    <Text style={[styles.linkRowAction, { color: theme.primary }]} numberOfLines={1}>Link {titleCaseName(hit.name)}</Text>
                  </TouchableOpacity>
                ) : (
                  // The picker is its own sheet — close this one so the two never stack.
                  <TouchableOpacity onPress={() => { setLinkSheetOpen(false); setPickFor(m.memberId); }} hitSlop={6} accessibilityRole="button">
                    <Text style={[styles.linkRowAction, { color: theme.primary }]}>Pick Contact</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          });
        })()}
      </CenterModal>

      <ContactPickerSheet
        visible={!!pickFor}
        title="Link to Contact"
        onSelect={onPicked}
        onClose={() => setPickFor(null)}
      />

      <AccountPickerSheet
        visible={!!settleTarget}
        title={settleTarget && settleTarget.net < 0 ? 'Repay from which account?' : 'Received in which account?'}
        subtitle={settleTarget
          ? `${titleCaseName(settleTarget.person)} · ${formatCurrency(Math.abs(settleTarget.net))}`
          : undefined}
        accounts={liveAccounts}
        selectedId={defaultAccountId(liveAccounts)}
        onSelect={(accountId: string) => { if (settleTarget) commitSettle(settleTarget, accountId); }}
        skipLabel={LB_NO_ACCOUNT}
        onSkip={() => { if (settleTarget) commitSettle(settleTarget, null); }}
        // Dismissing cancels outright — nothing is committed until a choice is made.
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
  cardMeta: { ...typography.small, color: colors.textSecondary },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, minWidth: 0 },
  cardMetaNames: { flexShrink: 1 },
  cardSyncDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
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
  // Hugs the label + ⓘ: the cell stretches its children, which made the whole width tappable.
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
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
  // One row per member — avatar, name, then their tag (Joined/Not Joined/Left…) or Invite.
  memberListCard: { backgroundColor: colors.card, borderRadius: radius.lg, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  memberRoleTag: {
    paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill,
    backgroundColor: colors.divider,
  },
  memberRoleTagTxt: { ...typography.tiny, color: colors.textSecondary, fontWeight: '700' },
  // Outlined (secondary) — the row's only action, never a filled primary.
  memberInviteBtn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  mismatchNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderRadius: radius.md, backgroundColor: colors.card },
  mismatchTxt: { ...typography.small, flex: 1, color: colors.textSecondary },
  memberMenuBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.xs, marginRight: -spacing.xs },
  // The QR's own white quiet zone sits on the white card; the hairline shows its edge.
  pickList: { marginTop: spacing.md, borderWidth: DIVIDER_W, borderColor: colors.divider, borderRadius: radius.md },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  qrWrap: { alignSelf: 'center', marginTop: spacing.md, padding: spacing.xs, borderRadius: radius.md, borderWidth: DIVIDER_W, borderColor: colors.divider },
  memberInviteTxt: { ...typography.small, fontWeight: '700' },
  memberRowName: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  linkBanner: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  linkBannerTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  linkBannerTxt: { ...typography.small, flex: 1 },
  linkBannerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  linkBannerAction: { ...typography.small, fontWeight: '700' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  linkRowName: { ...typography.bodyBold },
  linkRowHint: { ...typography.small, fontSize: 12, marginTop: 2 },
  linkRowAction: { ...typography.small, fontWeight: '700' },
  pastToggleTxt: { color: colors.textSecondary },
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
  outsideRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, marginTop: -spacing.xs,
  },
  outsideTxt: { ...typography.small, fontSize: 12, flex: 1 },
  outsideAction: { ...typography.small, fontWeight: '700' },
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
