// =============================================================================
// TransactionsScreen  ("Activity" tab)
// -----------------------------------------------------------------------------
// UI layers:
//   1. Header row — title + Export pill
//   2. Full-width search bar with embedded filter trigger
//   3. Horizontal quick-filter chip ribbon (All / Bank / CC / This Month)
//   4. Reanimated dual-panel filter bottom sheet:
//        Left 35%  — Method / Type / Categories / Status / Groups / Date Range
//        Right 65% — checkbox / radio options for the active panel
//   5. FlatList of transactions
//
// All interactive modals (CategoryPicker, Split, LB linking, CenterModal) are
// preserved unchanged from the previous implementation.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButton from '../components/GradientButton';
import TransactionItem from '../components/TransactionItem';
import MonthDivider from '../components/MonthDivider';
import TxnDebugSheet from '../components/TxnDebugSheet';
import { IS_PREVIEW_BUILD } from '../constants/buildVariant';
import CategoryPickerModal from '../components/CategoryPickerModal';
import LinkContactModal from '../components/LinkContactModal';
import ExportSheet from '../components/ExportSheet';
import SplitConfigModal from '../components/SplitConfigModal';
import SplitDetailsModal from '../components/SplitDetailsModal';
import CenterModal from '../components/CenterModal';
import GroupPickerSheet from '../components/GroupPickerSheet';
import GroupExpenseSheet from '../components/GroupExpenseSheet';
import { canSplitTransaction, debitDisplayAmount, isGroupExcluded } from '../utils/split';
import { formatCurrency, monthKey } from '../utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = SCREEN_H * 0.84;

const SPRING_CFG   = { damping: 22, stiffness: 220 };
const DISMISS_VEL  = 600;
const DISMISS_DIST = 130;

// Map Dashboard D/W/M/Y keys → quick chip
const PERIOD_TO_CHIP = { D: 'all', W: 'all', M: 'month', Y: 'all' };

const QUICK_CHIPS = [
  { id: 'all',   label: 'All Transactions', icon: 'list-outline'     },
  { id: 'month', label: 'This Month',       icon: 'calendar-outline' },
  { id: 'bank',  label: 'Bank Accounts',    icon: 'business-outline' },
  { id: 'cc',    label: 'Credit Cards',     icon: 'card-outline'     },
];

const FILTER_PANELS = [
  { id: 'method',     label: 'Method',        icon: 'wallet-outline'           },
  { id: 'type',       label: 'Type',          icon: 'swap-vertical-outline'    },
  { id: 'categories', label: 'Categories',    icon: 'grid-outline'             },
  { id: 'status',     label: 'Status',        icon: 'checkmark-circle-outline' },
  { id: 'groups',     label: 'Groups',        icon: 'folder-outline'           },
  { id: 'dateRange',  label: 'Date Range',    icon: 'calendar-outline'         },
];

const STATIC_OPTIONS = {
  type: [
    { id: 'credit', label: 'Income / Inflow',   sublabel: 'Money received into account' },
    { id: 'debit',  label: 'Expense / Outflow',  sublabel: 'Money spent or withdrawn'   },
  ],
  // Mirrors the status chips rendered on TransactionItem (getStatusChip + tags).
  status: [
    { id: 'self',          label: 'Self Transfer', sublabel: 'Between your own accounts' },
    { id: 'lent',          label: 'Lent',          sublabel: 'Money you lent out'        },
    { id: 'borrowed',      label: 'Borrowed',      sublabel: 'Money you borrowed'        },
    { id: 'lent_settled',  label: 'Settled',       sublabel: 'Lent money returned'       },
    { id: 'borrow_repaid', label: 'Repaid',        sublabel: 'Borrowed money repaid'     },
    { id: 'split',         label: 'Split',         sublabel: 'Shared with others'        },
    { id: 'private',       label: 'Private',       sublabel: 'Hidden from default views' },
    { id: 'ignored',       label: 'Ignored',       sublabel: 'Excluded from all totals'  },
  ],
  // `groups` is dynamic — built from the store, see groupOptions.
  dateRange: [
    { id: 'week',   label: 'Last Week',     sublabel: 'Past 7 days'   },
    { id: 'month1', label: 'Last 1 Month',  sublabel: 'Past 30 days'  },
    { id: 'month3', label: 'Last 3 Months', sublabel: 'Past 90 days'  },
    { id: 'month6', label: 'Last 6 Months', sublabel: 'Past 180 days' },
    { id: 'year1',  label: 'Last 1 Year',   sublabel: 'Past 365 days' },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyDraft() {
  return {
    method:     new Set(),
    type:       new Set(),
    categories: new Set(),
    status:     new Set(),
    groups:     new Set(),
    dateRange:  new Set(),
  };
}

function pastDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function resolveRangeCutoff(rangeId) {
  const map = { week: 7, month1: 30, month3: 90, month6: 180, year1: 365 };
  const days = map[rangeId];
  return days ? pastDate(days) : null;
}

/** True if a txn matches ANY selected status chip (union). Mirrors getStatusChip + tags. */
function matchesStatus(t, statusSet) {
  if (statusSet.has('private')       && t.isHidden) return true;
  if (statusSet.has('ignored')       && t.isIgnored) return true;
  if (statusSet.has('self')          && (t.categoryId === 'self' || t.childCategory === 'Self')) return true;
  if (statusSet.has('lent')          && t.categoryId === 'lent') return true;
  if (statusSet.has('borrowed')      && t.categoryId === 'borrowed') return true;
  if (statusSet.has('lent_settled')  && t.categoryId === 'lent_settled') return true;
  if (statusSet.has('borrow_repaid') && t.categoryId === 'borrow_repaid') return true;
  if (statusSet.has('split')         && t.isSplit) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const TransactionsScreen = ({ navigation, route }) => {
  const theme = useTheme();

  // ── Store ──────────────────────────────────────────────────────────────────
  const transactions = useEPurseStore((s) => s.transactions);
  const accounts     = useEPurseStore((s) => s.accounts);
  const categories   = useEPurseStore((s) => s.categories);
  const groups       = useEPurseStore((s) => s.groups);
  const userName     = useEPurseStore((s) => s.userName);
  const lentBorrowed = useEPurseStore((s) => s.lentBorrowed);

  const updateTransactionCategory            = useEPurseStore((s) => s.updateTransactionCategory);
  const updateTwoTierCategory                = useEPurseStore((s) => s.updateTwoTierCategory);
  const updateTransactionCategoryWithContact = useEPurseStore((s) => s.updateTransactionCategoryWithContact);
  const setTransactionHidden                 = useEPurseStore((s) => s.setTransactionHidden);
  const deleteTransaction                    = useEPurseStore((s) => s.deleteTransaction);
  const ignoreTransaction                    = useEPurseStore((s) => s.ignoreTransaction);
  const unignoreTransaction                  = useEPurseStore((s) => s.unignoreTransaction);
  const setTransactionSplit                  = useEPurseStore((s) => s.setTransactionSplit);
  const tagTransactionToGroup    = useEPurseStore((s) => s.tagTransactionToGroup);
  const updateGroupExpense       = useEPurseStore((s) => s.updateGroupExpense);
  const untagTransactionFromGroup = useEPurseStore((s) => s.untagTransactionFromGroup);

  // ── Route params ───────────────────────────────────────────────────────────
  const routePeriod    = route?.params?.initialPeriod;
  const routeAccountId = route?.params?.accountId ?? null;

  // ── UI state ───────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState('');
  const [quickChip,     setQuickChip]     = useState(
    routePeriod ? (PERIOD_TO_CHIP[routePeriod] ?? 'all') : 'all',
  );
  const [sheetVisible,  setSheetVisible]  = useState(false);
  const [exportVisible, setExportVisible] = useState(false);

  // Applied (committed) filters; pre-seed accountId if navigated from AccountDetails
  const [applied, setApplied] = useState(() => {
    const d = emptyDraft();
    if (routeAccountId) d.method = new Set([routeAccountId]);
    return d;
  });

  // Draft (in-sheet, not committed until Apply)
  const [draft,         setDraft]         = useState(emptyDraft);
  const [activePanelId, setActivePanelId] = useState('method');

  // Transaction interaction modals
  const [activeTxn,       setActiveTxn]       = useState(null);
  const [lbLinkTxn,       setLbLinkTxn]       = useState(null);
  const [splitTxn,        setSplitTxn]        = useState(null);
  const [splitDetailsTxn, setSplitDetailsTxn] = useState(null);
  const [confirm,         setConfirm]         = useState(null);
  const [debugTxn,        setDebugTxn]        = useState(null);
  const [groupPickerTxn,  setGroupPickerTxn]  = useState(null);
  const [groupExpenseTxn, setGroupExpenseTxn] = useState(null); // { txn, group } — tag NEW into group
  const [editGroupTxn,    setEditGroupTxn]    = useState(null); // { txn, group } — set/edit split

  // ── Route param reactivity ─────────────────────────────────────────────────
  useEffect(() => {
    const id = route?.params?.accountId;
    if (id) {
      setApplied((prev) => ({ ...prev, method: new Set([id]) }));
      setQuickChip('all');
    }
  }, [route?.params?.accountId]);

  useEffect(() => {
    const p = route?.params?.initialPeriod;
    if (p) setQuickChip(PERIOD_TO_CHIP[p] ?? 'all');
  }, [route?.params?.initialPeriod]);

  // ── StatusBar ──────────────────────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('dark-content');
      StatusBar.setBackgroundColor?.('#FFFFFF');
      return () => {
        StatusBar.setBarStyle('light-content');
        StatusBar.setBackgroundColor?.('transparent');
        setSearch('');
      };
    }, []),
  );

  // ── LB net balance (for suggestedPersons in LinkContactModal) ─────────────
  const lbNetByPerson = useMemo(() => {
    const map = {};
    (lentBorrowed || []).forEach((e) => {
      if (!map[e.person]) {
        map[e.person] = { person: e.person, phone: e.phone ?? null, contactId: e.contactId ?? null, net: 0 };
      }
      const sign = (e.kind === 'lent' || e.kind === 'borrow_repaid') ? 1 : -1;
      map[e.person].net += sign * e.amount;
    });
    return map;
  }, [lentBorrowed]);

  // ── Sticky chip bar (Swiggy-style) ────────────────────────────────────────
  // Chips live inside the FlatList (scroll away naturally). A fixed copy sits
  // above the list at opacity 0. It only appears when the user scrolls back DOWN
  // after the inline chips have left the viewport, and hides again once the
  // inline chips scroll back into view.
  const CHIP_RIBBON_H  = 50; // chip 34 + paddingVertical 8×2
  const stickyOpa      = useSharedValue(0);
  const [stickyActive, setStickyActive] = useState(false);
  const lastScrollY    = React.useRef(0);

  const stickyChipStyle = useAnimatedStyle(() => ({
    opacity: stickyOpa.value,
  }));

  const handleScroll = useCallback((e) => {
    const y    = e.nativeEvent.contentOffset.y;
    const prev = lastScrollY.current;
    lastScrollY.current = y;

    if (y <= 2) {
      // Inline chips fully back in view — hide sticky
      stickyOpa.value = withTiming(0, { duration: 200 });
      setStickyActive(false);
    } else if (y > prev) {
      // Scrolling up (deeper into list) — hide sticky
      stickyOpa.value = withTiming(0, { duration: 180 });
      setStickyActive(false);
    } else if (y < prev && y > CHIP_RIBBON_H) {
      // Scrolling down, chips still off-screen — show sticky
      stickyOpa.value = withTiming(1, { duration: 180 });
      setStickyActive(true);
    }
    // Scrolling down while 2 < y <= CHIP_RIBBON_H: inline chips travelling back
    // into view — keep sticky as-is so there's no gap while they emerge
  }, []);

  // ── Reanimated sheet ───────────────────────────────────────────────────────
  const sheetY      = useSharedValue(SHEET_H);
  const backdropOpa = useSharedValue(0);

  const openSheet = useCallback(() => {
    setDraft({
      method:     new Set(applied.method),
      type:       new Set(applied.type),
      categories: new Set(applied.categories),
      status:     new Set(applied.status),
      groups:     new Set(applied.groups),
      dateRange:  new Set(applied.dateRange),
    });
    setActivePanelId('method');
    setSheetVisible(true);
    sheetY.value      = SHEET_H;
    backdropOpa.value = 0;
    sheetY.value      = withSpring(0, SPRING_CFG);
    backdropOpa.value = withTiming(0.52, { duration: 280 });
  }, [applied, sheetY, backdropOpa]);

  const closeSheet = useCallback(() => {
    sheetY.value = withTiming(
      SHEET_H,
      { duration: 260, easing: Easing.out(Easing.cubic) },
      (finished) => { if (finished) runOnJS(setSheetVisible)(false); },
    );
    backdropOpa.value = withTiming(0, { duration: 240 });
  }, [sheetY, backdropOpa]);

  const sheetStyle    = useAnimatedStyle(() => ({ transform: [{ translateY: sheetY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpa.value }));

  const panGesture = Gesture.Pan()
    .activeOffsetY(6)
    .onUpdate((e) => {
      if (e.translationY > 0) {
        sheetY.value      = e.translationY;
        backdropOpa.value = Math.max(0, 0.52 * (1 - e.translationY / SHEET_H));
      }
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DIST || e.velocityY > DISMISS_VEL) {
        runOnJS(closeSheet)();
      } else {
        sheetY.value      = withSpring(0, SPRING_CFG);
        backdropOpa.value = withTiming(0.52, { duration: 200 });
      }
    });

  // ── Dynamic panel options ─────────────────────────────────────────────────
  const methodOptions = useMemo(
    () => accounts.map((a) => ({
      id:       a.id,
      label:    a.name ?? a.type,
      sublabel: a.type + (a.mask ? ` ··${a.mask}` : ''),
    })),
    [accounts],
  );

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ id: c.id, label: c.name, sublabel: c.emoji })),
    [categories],
  );

  // Auto-fed from the store — every group the user creates shows up here.
  const groupOptions = useMemo(
    () => (groups ?? []).map((g) => ({
      id:       g.id,
      label:    `${g.emoji ? g.emoji + ' ' : ''}${g.name}`,
      sublabel: g.type === 'shared' ? `${g.members?.length ?? 0} members` : 'Personal',
    })),
    [groups],
  );

  const panelOptions = useMemo(() => {
    if (activePanelId === 'method')     return methodOptions;
    if (activePanelId === 'categories') return categoryOptions;
    if (activePanelId === 'groups')     return groupOptions;
    return STATIC_OPTIONS[activePanelId] ?? [];
  }, [activePanelId, methodOptions, categoryOptions, groupOptions]);

  // ── Filtered transaction list ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const statusSet    = applied.status;
    const statusActive = statusSet.size > 0;

    // Base visibility: private (hidden) and ignored rows only surface when their
    // status chip is explicitly selected; otherwise they stay out of the list.
    let list = [...(transactions ?? [])].filter((t) => {
      if (t.isIgnored) return statusSet.has('ignored');
      if (t.isHidden)  return statusSet.has('private');
      return true;
    });

    // Quick chip pre-filter. NOTE: accountType values come from ACCOUNT_TYPES —
    // the bank type is 'Bank' (NOT 'Bank Account'); the old string matched nothing.
    // A debit card draws from a bank, so it counts under "Bank" too.
    if (quickChip === 'bank')  list = list.filter((t) => t.accountType === 'Bank' || t.accountType === 'Debit Card');
    if (quickChip === 'cc')    list = list.filter((t) => t.accountType === 'Credit Card');
    if (quickChip === 'month') list = list.filter((t) => new Date(t.createdAt) >= startOfMonth);

    // Inline search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.merchant || '').toLowerCase().includes(q) ||
          (t.note || '').toLowerCase().includes(q),
      );
    }

    // Applied sheet filters
    // Primary match: accountId (UUID). Fallback for transactions that were ingested
    // from SMS without a 4-digit mask (accountId stays null): try mask match, then
    // accountType match so those transactions still surface under the right account.
    if (applied.method.size > 0) {
      const selAccts  = accounts.filter((a) => applied.method.has(a.id));
      // Include linked debit-card masks (aliasMasks) so filtering a bank also
      // surfaces its merged card's transactions (mirrors matchAccount).
      const selMasks  = new Set(selAccts.flatMap((a) => [a.mask, ...(a.aliasMasks || [])]).filter(Boolean));
      const selTypes  = new Set(selAccts.map((a) => a.type));
      list = list.filter((t) => {
        if (t.accountId && applied.method.has(t.accountId))   return true;
        if (t.accountMask && selMasks.has(t.accountMask))      return true;
        if (!t.accountId && selTypes.has(t.accountType))       return true;
        return false;
      });
    }
    if (applied.type.size > 0)       list = list.filter((t) => applied.type.has(t.type));
    if (applied.categories.size > 0) list = list.filter((t) => applied.categories.has(t.categoryId));
    if (applied.groups.size > 0)     list = list.filter((t) => t.groupId && applied.groups.has(t.groupId));

    // Status — union (OR) across the selected chips.
    if (statusActive) list = list.filter((t) => matchesStatus(t, statusSet));

    if (applied.dateRange.size > 0) {
      const cutoff = resolveRangeCutoff([...applied.dateRange][0]);
      if (cutoff) list = list.filter((t) => new Date(t.createdAt) >= cutoff);
    }

    return list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [transactions, quickChip, search, applied]);

  // Interleave month dividers into the (date-desc) list. A divider is inserted
  // only at a month BOUNDARY — never above the first group, and never at all when
  // every transaction is in one month. It labels the older month starting below it
  // (i.e. it appears right after the previous month ends).
  const listData = useMemo(() => {
    const out = [];
    let lastMonth = null;
    for (const t of filtered) {
      const mk = monthKey(t.createdAt);
      if (lastMonth !== null && mk !== lastMonth) {
        out.push({ _divider: true, id: `div-${mk}`, monthKey: mk });
      }
      lastMonth = mk;
      out.push(t);
    }
    return out;
  }, [filtered]);

  // Debit (spend) + credit (inflow) totals across the filtered list — shown
  // alongside the count. Debit uses the user's share (split-aware), like each row.
  const filteredTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const t of filtered) {
      // Memos (someone else paid → you owe) and "excluded from totals" group rows
      // aren't your own money movement — keep them out of the spend/inflow figures
      // (matches Home's selectExpenseStats). They still appear in the list.
      if (isGroupExcluded(t, groups)) continue;
      if (t.type === 'credit') credit += t.amount || 0;
      else debit += debitDisplayAmount(t);
    }
    return { debit, credit };
  }, [filtered, groups]);

  const activeFilterCount = useMemo(
    () => Object.values(applied).reduce((n, s) => n + s.size, 0),
    [applied],
  );

  // Export filter context (mirrors expected ExportSheet contract)
  const exportFilterCtx = useMemo(() => ({
    timeframe:   quickChip,
    catIds:      [...applied.categories],
    acctIds:     [...applied.method],
    showHidden:  false,
    showIgnored: false,
    searchQuery: search,
    advanced:    {},
  }), [quickChip, applied, search]);

  // ── Draft helpers ─────────────────────────────────────────────────────────
  const toggleDraft = useCallback((panelId, id) => {
    setDraft((prev) => {
      const next = new Set(prev[panelId]);
      if (panelId === 'dateRange') {
        if (next.has(id)) { next.clear(); } else { next.clear(); next.add(id); }
      } else {
        if (next.has(id)) next.delete(id); else next.add(id);
      }
      return { ...prev, [panelId]: next };
    });
  }, []);

  const applyFilters = useCallback(() => {
    setApplied({
      method:     new Set(draft.method),
      type:       new Set(draft.type),
      categories: new Set(draft.categories),
      status:     new Set(draft.status),
      groups:     new Set(draft.groups),
      dateRange:  new Set(draft.dateRange),
    });
    closeSheet();
  }, [draft, closeSheet]);

  const clearAllDraft   = useCallback(() => setDraft(emptyDraft()), []);
  const clearAllApplied = useCallback(() => setApplied(emptyDraft()), []);

  // ── Transaction interaction handlers ──────────────────────────────────────
  const handleSelectTwoTier = (parentCategory, childCategory) => {
    if (!activeTxn) return;
    updateTwoTierCategory(activeTxn.id, parentCategory, childCategory);
    setActiveTxn(null);
  };

  const handleSelectCategory = (categoryId) => {
    if (!activeTxn) return;
    updateTransactionCategory(activeTxn.id, categoryId);
    setActiveTxn(null);
  };

  const handleSelectLentBorrow = (categoryId) => {
    if (!activeTxn) return;
    const t = activeTxn;
    setActiveTxn(null);
    let suggestedPersons = [];
    if (categoryId === 'lent_settled') {
      suggestedPersons = Object.values(lbNetByPerson)
        .filter((p) => p.net > 0)
        .sort((a, b) => b.net - a.net);
    } else if (categoryId === 'borrow_repaid') {
      suggestedPersons = Object.values(lbNetByPerson)
        .filter((p) => p.net < 0)
        .sort((a, b) => a.net - b.net)
        .map((p) => ({ ...p, net: Math.abs(p.net) }));
    }
    setLbLinkTxn({ txn: t, categoryId, suggestedPersons });
  };

  const handleToggleHidden = (hidden) => {
    if (!activeTxn) return;
    const t = activeTxn;
    setActiveTxn(null);
    setConfirm({
      title:       hidden ? 'Mark as Private?' : 'Make Public?',
      message:     hidden
        ? 'Hidden from default views but still counted in totals.'
        : 'This transaction will be visible again in all default views.',
      primaryText: hidden ? 'Mark Private' : 'Make Public',
      destructive: hidden,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm:   () => { setTransactionHidden(t.id, hidden); setConfirm(null); },
    });
  };

  const handleDelete = () => {
    if (!activeTxn) return;
    const t = activeTxn;
    setActiveTxn(null);
    setConfirm({
      title:       'Delete transaction?',
      message:     'This action cannot be undone.',
      primaryText: 'Delete',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm:   () => { deleteTransaction(t.id); setConfirm(null); },
    });
  };

  const handleIgnore = () => {
    if (!activeTxn) return;
    const t = activeTxn;
    setActiveTxn(null);
    setConfirm({
      title:       'Ignore transaction?',
      message:     'Removes it from all balances, totals, and charts.',
      primaryText: 'Ignore',
      destructive: true,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm:   () => { ignoreTransaction(t.id); setConfirm(null); },
    });
  };

  const handleRestore = () => {
    if (!activeTxn) return;
    const t = activeTxn;
    setActiveTxn(null);
    setConfirm({
      title:       'Restore transaction?',
      message:     'Adds it back to balances, totals, and charts.',
      primaryText: 'Restore',
      destructive: false,
      secondaryText: 'Cancel',
      onSecondary: () => setConfirm(null),
      onConfirm:   () => { unignoreTransaction(t.id); setConfirm(null); },
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top']}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={styles.headerSection}>

        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>Activity</Text>
          <Pressable
            style={styles.exportPill}
            onPress={() => setExportVisible(true)}
            android_ripple={{ color: theme.primary + '22', radius: 24 }}
          >
            <Ionicons name="share-outline" size={14} color={theme.primary} />
            <Text style={[styles.exportPillText, { color: theme.primary }]}>Export</Text>
          </Pressable>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={17} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search transactions…"
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <Pressable
            onPress={openSheet}
            style={[
              styles.filterTrigger,
              activeFilterCount > 0 && { backgroundColor: theme.primary, borderColor: theme.primary },
            ]}
          >
            <Ionicons
              name="options-outline"
              size={17}
              color={activeFilterCount > 0 ? '#fff' : colors.textSecondary}
            />
            {activeFilterCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

      </View>

      <View style={{ flex: 1 }}>
      {/* ── Sticky chip bar — absolute overlay, fades in once inline chips scroll off ── */}
      <Animated.View
        style={[styles.stickyChipRibbon, stickyChipStyle]}
        pointerEvents={stickyActive ? 'auto' : 'none'}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          bounces={false}
        >
          {QUICK_CHIPS.map((chip) => {
            const active = quickChip === chip.id;
            return (
              <Pressable
                key={chip.id}
                onPress={() => setQuickChip(chip.id)}
                style={[
                  styles.chip,
                  active && { backgroundColor: theme.primary, borderColor: theme.primary },
                ]}
              >
                <Ionicons
                  name={chip.icon}
                  size={13}
                  color={active ? '#fff' : colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* ── Transaction list ────────────────────────────────────────────── */}
      <FlatList
        data={listData}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) =>
          item._divider ? (
            <MonthDivider monthKey={item.monthKey} />
          ) : (
            <TransactionItem
              txn={item}
              onPressCategory={() => setActiveTxn(item)}
              onPressSplitChip={() => setSplitDetailsTxn(item)}
              onLongPress={IS_PREVIEW_BUILD ? () => setDebugTxn(item) : undefined}
            />
          )
        }
        ListHeaderComponent={
          <>
            {/* Inline chip ribbon — scrolls away with the list */}
            <View style={styles.chipRibbon}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                bounces={false}
              >
                {QUICK_CHIPS.map((chip) => {
                  const active = quickChip === chip.id;
                  return (
                    <Pressable
                      key={chip.id}
                      onPress={() => setQuickChip(chip.id)}
                      style={[
                        styles.chip,
                        active && { backgroundColor: theme.primary, borderColor: theme.primary },
                      ]}
                    >
                      <Ionicons
                        name={chip.icon}
                        size={13}
                        color={active ? '#fff' : colors.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {chip.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Active filter summary */}
            {activeFilterCount > 0 && (
              <View style={styles.activeFilterBar}>
                <Text style={styles.activeFilterLabel}>
                  {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                </Text>
                <Pressable onPress={clearAllApplied}>
                  <Text style={styles.activeFilterClear}>Clear all</Text>
                </Pressable>
              </View>
            )}

            {filtered.length > 0 && (
              <View style={styles.listCountRow}>
                <Text style={styles.listCountTxt}>
                  {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
                </Text>
                <Text style={styles.listCountTxt}>
                  {formatCurrency(filteredTotals.debit)} out · {formatCurrency(filteredTotals.credit)} in
                </Text>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No transactions found</Text>
            <Text style={styles.emptyHelp}>Try adjusting your search or filters.</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        windowSize={12}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
      </View>

      {/* ── Dual-panel filter sheet ──────────────────────────────────────── */}
      <Modal
        visible={sheetVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetOverlay}>

          <Animated.View style={[styles.backdrop, backdropStyle]}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} />
          </Animated.View>

          <GestureDetector gesture={panGesture}>
            <Animated.View style={[styles.sheet, sheetStyle]}>

              <View style={styles.handleArea}>
                <View style={styles.handle} />
              </View>

              <View style={styles.sheetTitleRow}>
                <Text style={styles.sheetTitle}>Filter Transactions</Text>
                <Pressable style={styles.closeBtn} onPress={closeSheet}>
                  <Ionicons name="close" size={19} color={colors.textSecondary} />
                </Pressable>
              </View>

              <View style={styles.dualPanel}>

                {/* LEFT: master category sidebar */}
                <View style={styles.leftPanel}>
                  <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
                    {FILTER_PANELS.map((panel) => {
                      const isActive   = activePanelId === panel.id;
                      const draftCount = draft[panel.id].size;
                      return (
                        <Pressable
                          key={panel.id}
                          onPress={() => setActivePanelId(panel.id)}
                          style={[
                            styles.leftItem,
                            isActive && [styles.leftItemActive, { borderLeftColor: theme.primary }],
                          ]}
                          android_ripple={{ color: theme.primary + '18' }}
                        >
                          <Ionicons
                            name={panel.icon}
                            size={15}
                            color={isActive ? theme.primary : colors.textSecondary}
                            style={{ marginBottom: 3 }}
                          />
                          <Text
                            style={[
                              styles.leftLabel,
                              isActive && { color: theme.primary, fontWeight: '700' },
                            ]}
                          >
                            {panel.label}
                          </Text>
                          {draftCount > 0 && (
                            <View style={[styles.leftBadge, { backgroundColor: theme.primary }]}>
                              <Text style={styles.leftBadgeText}>{draftCount}</Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* RIGHT: dynamic option list */}
                <View style={styles.rightPanel}>
                  {panelOptions.length === 0 ? (
                    <View style={styles.rightEmpty}>
                      <Ionicons name="folder-open-outline" size={36} color={colors.textMuted} />
                      <Text style={styles.rightEmptyText}>
                        {activePanelId === 'groups'
                          ? 'No groups yet — create one from the Groups tab.'
                          : 'No options available'}
                      </Text>
                    </View>
                  ) : (
                    <ScrollView
                      showsVerticalScrollIndicator={false}
                      bounces={false}
                      contentContainerStyle={{ paddingBottom: spacing.xl }}
                    >
                      {panelOptions.map((opt) => {
                        const checked = draft[activePanelId].has(opt.id);
                        const isRadio = activePanelId === 'dateRange';
                        return (
                          <Pressable
                            key={opt.id}
                            onPress={() => toggleDraft(activePanelId, opt.id)}
                            style={[styles.rightItem, checked && styles.rightItemChecked]}
                            android_ripple={{ color: theme.primary + '18' }}
                          >
                            <View style={styles.rightItemText}>
                              <Text
                                style={[
                                  styles.rightItemLabel,
                                  checked && { color: '#0F172A', fontWeight: '600' },
                                ]}
                              >
                                {opt.label}
                              </Text>
                              {opt.sublabel ? (
                                <Text style={styles.rightItemSub}>{opt.sublabel}</Text>
                              ) : null}
                            </View>
                            {isRadio ? (
                              <View style={[styles.radioOuter, checked && { borderColor: theme.primary }]}>
                                {checked && <View style={[styles.radioDot, { backgroundColor: theme.primary }]} />}
                              </View>
                            ) : (
                              <View
                                style={[
                                  styles.checkbox,
                                  checked && { borderColor: theme.primary, backgroundColor: theme.primary },
                                ]}
                              >
                                {checked && <Ionicons name="checkmark" size={11} color="#fff" />}
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>

              </View>

              {/* Sticky footer */}
              <View style={styles.sheetFooter}>
                <Pressable style={styles.clearAllBtn} onPress={clearAllDraft}>
                  <Text style={styles.clearAllText}>Clear All</Text>
                </Pressable>
                <View style={{ flex: 1 }}>
                  <GradientButton title="Apply Filters" onPress={applyFilters} />
                </View>
              </View>

            </Animated.View>
          </GestureDetector>
        </View>
      </Modal>

      {/* ── Transaction interaction modals ───────────────────────────────── */}
      <CategoryPickerModal
        visible={!!activeTxn}
        categories={categories}
        selectedCategoryId={activeTxn?.categoryId}
        selectedParent={activeTxn?.parentCategory}
        selectedChild={activeTxn?.childCategory}
        isHidden={!!activeTxn?.isHidden}
        isIgnored={!!activeTxn?.isIgnored}
        canSplit={!!activeTxn && canSplitTransaction(activeTxn)}
        isSplitTxn={!!activeTxn?.isSplit}
        categoryLocked={!!activeTxn?.lbLocked}
        currentGroupId={activeTxn?.groupId || null}
        onPressAddToGroup={() => {
          const t = activeTxn;
          setActiveTxn(null);
          setGroupPickerTxn(t);
        }}
        onPressRemoveFromGroup={() => {
          if (!activeTxn) return;
          untagTransactionFromGroup(activeTxn.id);
          setActiveTxn(null);
        }}
        onPressEditGroup={
          activeTxn?.groupId && groups.find((g) => g.id === activeTxn.groupId)?.type === 'shared'
            ? () => {
                const group = groups.find((g) => g.id === activeTxn.groupId);
                const fresh = useEPurseStore.getState().transactions.find((t) => t.id === activeTxn.id) || activeTxn;
                setActiveTxn(null);
                setEditGroupTxn({ txn: fresh, group });
              }
            : undefined
        }
        groupHasSplit={!!activeTxn?.groupSplit}
        onPressSplit={() => {
          const t = activeTxn;
          setActiveTxn(null);
          setSplitTxn(t);
        }}
        onClose={() => setActiveTxn(null)}
        onSelectTwoTier={handleSelectTwoTier}
        onSelectCategory={handleSelectCategory}
        onSelectLentBorrow={handleSelectLentBorrow}
        onToggleHidden={handleToggleHidden}
        onDelete={handleDelete}
        onIgnore={handleIgnore}
        onRestore={handleRestore}
      />

      <LinkContactModal
        visible={!!lbLinkTxn}
        categoryId={lbLinkTxn?.categoryId}
        suggestedPersons={lbLinkTxn?.suggestedPersons || []}
        onConfirm={(contactInfo) => {
          if (!lbLinkTxn) return;
          updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, contactInfo);
          setLbLinkTxn(null);
        }}
        onSkip={() => {
          if (!lbLinkTxn) return;
          updateTransactionCategoryWithContact(lbLinkTxn.txn.id, lbLinkTxn.categoryId, { person: 'Unlinked', phone: null, contactId: null });
          setLbLinkTxn(null);
        }}
        onClose={() => setLbLinkTxn(null)}
      />

      <SplitConfigModal
        visible={!!splitTxn}
        transaction={splitTxn}
        onClose={() => setSplitTxn(null)}
        onApply={(others, meta) => {
          if (splitTxn) setTransactionSplit(splitTxn.id, others, meta);
          setSplitTxn(null);
        }}
      />

      <SplitDetailsModal
        visible={!!splitDetailsTxn}
        txn={splitDetailsTxn}
        myName={userName ? `You (${userName})` : 'You'}
        onClose={() => setSplitDetailsTxn(null)}
        onEdit={() => {
          const t = splitDetailsTxn;
          setSplitDetailsTxn(null);
          setSplitTxn(t);
        }}
      />

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        destructive={!!confirm?.destructive}
        secondaryText={confirm?.secondaryText}
        onSecondary={confirm?.onSecondary}
        onClose={() => setConfirm(null)}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
      />

      <ExportSheet
        visible={exportVisible}
        onClose={() => setExportVisible(false)}
        filteredTransactions={filtered}
        filterCtx={exportFilterCtx}
      />

      {IS_PREVIEW_BUILD && (
        <TxnDebugSheet txn={debugTxn} onClose={() => setDebugTxn(null)} />
      )}

      <GroupPickerSheet
        visible={!!groupPickerTxn}
        txn={groupPickerTxn}
        onClose={() => setGroupPickerTxn(null)}
        onCreateNew={() => setGroupPickerTxn(null)}
        onPick={(groupId, group) => {
          const txn = groupPickerTxn;
          setGroupPickerTxn(null);
          if (group?.type === 'shared') {
            setGroupExpenseTxn({ txn, group });
          } else {
            tagTransactionToGroup(txn.id, groupId);
          }
        }}
      />

      {groupExpenseTxn && (
        <GroupExpenseSheet
          visible={!!groupExpenseTxn}
          group={groupExpenseTxn.group}
          presetAmount={groupExpenseTxn.txn?.amount}
          onClose={() => setGroupExpenseTxn(null)}
          onAdd={(expenseData) => {
            tagTransactionToGroup(groupExpenseTxn.txn.id, groupExpenseTxn.group.id, expenseData.shares?.length ? {
              paidByMemberId: expenseData.paidByMemberId,
              paidByName: expenseData.paidByName,
              shares: expenseData.shares,
            } : null);
            setGroupExpenseTxn(null);
          }}
        />
      )}

      {editGroupTxn && (
        <GroupExpenseSheet
          visible={!!editGroupTxn}
          group={editGroupTxn.group}
          editTxn={editGroupTxn.txn}
          presetAmount={editGroupTxn.txn?.amount}
          showCategory
          lockPayerToMe={!editGroupTxn.txn?.isGroupMemo && !!editGroupTxn.txn?.accountId}
          onClose={() => setEditGroupTxn(null)}
          onAdd={(expenseData) => {
            updateGroupExpense(editGroupTxn.txn.id, expenseData);
            setEditGroupTxn(null);
          }}
        />
      )}

    </SafeAreaView>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // ── Header ──────────────────────────────────────────────────────────────────
  headerSection: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    ...shadows.card,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: '#0F172A',
  },
  exportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  exportPillText: { fontSize: 13, fontWeight: '700' },

  // ── Search bar ─────────────────────────────────────────────────────────────
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    ...shadows.card,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '400',
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  filterTrigger: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    flexShrink: 0,
  },
  filterBadge: {
    position: 'absolute',
    top: -5, right: -5,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  // ── Chip ribbon ────────────────────────────────────────────────────────────
  chipRibbon: {
    backgroundColor: colors.background,
    marginHorizontal: -spacing.lg, // break out of FlatList's contentContainerStyle padding
  },
  stickyChipRibbon: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 10,
    backgroundColor: colors.card,
    ...shadows.card,
  },
  chipRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  // ── Active filter bar ──────────────────────────────────────────────────────
  activeFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  activeFilterLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
  activeFilterClear: { fontSize: 12, color: colors.danger, fontWeight: '700' },

  // ── List ───────────────────────────────────────────────────────────────────
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },
  listCount: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  // Count + debit/credit totals share one row, same muted styling.
  listCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  listCountTxt: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
  },
  empty: { alignItems: 'center', paddingTop: 64, gap: spacing.sm },
  emptyTitle: { ...typography.h3, color: colors.textPrimary },
  emptyHelp:  { ...typography.small, color: colors.textMuted, textAlign: 'center' },

  // ── Sheet overlay ──────────────────────────────────────────────────────────
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  sheet: {
    height: SHEET_H,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    ...shadows.elevated,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  handle:     { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.divider },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A', letterSpacing: -0.2 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Dual panel ─────────────────────────────────────────────────────────────
  dualPanel: { flex: 1, flexDirection: 'row' },
  leftPanel: {
    width: '35%',
    backgroundColor: '#F8FAFC',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.divider,
  },
  leftItem: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    position: 'relative',
  },
  leftItemActive: { backgroundColor: colors.card, borderLeftWidth: 3, borderLeftColor: colors.primary },
  leftLabel: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, lineHeight: 15 },
  leftBadge: {
    position: 'absolute', top: spacing.sm, right: spacing.sm,
    minWidth: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  leftBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  rightPanel: { flex: 1, backgroundColor: colors.card },
  rightEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  rightEmptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  rightItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
    gap: spacing.sm,
  },
  rightItemChecked: { backgroundColor: '#F5F7FF' },
  rightItemText:    { flex: 1 },
  rightItemLabel:   { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  rightItemSub:     { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  checkbox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: colors.divider,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.divider,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioDot: { width: 9, height: 9, borderRadius: 4.5 },

  // ── Sheet footer ───────────────────────────────────────────────────────────
  sheetFooter: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
    backgroundColor: colors.card,
  },
  clearAllBtn:  { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  clearAllText: { fontSize: 15, color: colors.textSecondary, fontWeight: '600' },
});

export default TransactionsScreen;
