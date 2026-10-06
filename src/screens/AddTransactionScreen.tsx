// =============================================================================
// AddTransactionScreen — opened by the FAB on the dashboard.
// Supports manual entries with a two-tier (Parent › Child) category picker.
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Modal from "../components/AppModal";
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useEPurseStore } from '../store/ePurseStore';
import { TRANSACTION_TYPES } from '../constants/categories';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { INPUT_LIMITS, sanitizeName, sanitizeAmount } from '../utils/validation';
import { colors, radius, spacing, typography, DIVIDER_W } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree, useCategoryMaps } from '../hooks/useCategoryTree';
import GradientButtonBase from '../components/GradientButton';
import SheetCloseButton from '../components/SheetCloseButton';
import DateField from '../components/DateField';
import {
  FormField,
  FormTextInput,
  FormAmountInput,
  FormNoteField,
  FormValueRow,
  FormValueCard,
} from '../components/FormField';
import { useSplitEditorRoute } from '../store/useSplitEditorRoute';
import { SPLIT_MODE_LABEL, type SplitMode, type SplitPageRow } from '../components/SplitPage';
import { evenPercents, fullOwedShares } from '../utils/splitShares';
import SplitBreakdownLines from '../components/SplitBreakdownLines';
import FormFooterActions from '../components/FormFooterActions';
import CategoryValueRow from '../components/CategoryValueRow';
import EmptyState from '../components/EmptyState';
import AccountField from '../components/AccountField';
import UnderlineTabBar from '../components/UnderlineTabBar';
import { TabView } from 'react-native-tab-view';
import { defaultAccountId as pickDefaultAccountId } from '../utils/defaultAccount';

// Cast to typed interface — GradientButton.js has no TS declarations
const GradientButton: React.FC<{
  title: string;
  onPress: () => void;
  style?: object;
  loading?: boolean;
  disabled?: boolean;
  flat?: boolean;
  colors?: string[];
  textStyle?: any;
  icon?: React.ReactNode;
}> = GradientButtonBase as any;
import InlineContactPicker from '../components/InlineContactPicker';
import GroupPickerSheet from '../components/GroupPickerSheet';
import { useGroupSplit } from '../hooks/useGroupSplit';
import { useAutoCategory } from '../hooks/useAutoCategory';
import type { Group } from '../types/group';
import LinkContactModal from '../components/LinkContactModal';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { parseMessageDetailed } from '../utils/messageParser';
import { SPLIT_BLOCKED_CATEGORY_IDS } from '../utils/split';
import { formatCurrency } from '../utils/format';
import {
  ParentCat,
  ChildCat,
  twoTierToLegacyCatId,
  LB_ALL_CATS,
  SPLIT_BLOCKED_CHILD_LABELS,
} from '../constants/twoTierCategories';
import { requestAndGetLocation } from '../services/locationService';
import { useSubmitGuard } from '../hooks/useSubmitGuard';

// Two-tier → legacy category conversion is centralised in twoTierCategories.ts
// (twoTierToLegacyCatId / LB_ALL_CATS / SPLIT_BLOCKED_CHILD_LABELS).

const TYPE_ROUTES = [
  { key: TRANSACTION_TYPES.DEBIT,  label: 'Expense' },
  { key: TRANSACTION_TYPES.CREDIT, label: 'Income'  },
];

// ─── AddTxnParentRow (local accordion component) ─────────────────────────────

interface AddTxnParentRowProps {
  parent: ParentCat;
  isExpanded: boolean;
  selectedParent: string;
  selectedChild: string;
  onParentPress: () => void;
  onChildPress: (parent: ParentCat, child: ChildCat) => void;
}

const AddTxnParentRow: React.FC<AddTxnParentRowProps> = ({
  parent,
  isExpanded,
  selectedParent,
  selectedChild,
  onParentPress,
  onChildPress,
}) => {
  const maxH = useSharedValue(0);
  const opacity = useSharedValue(0);
  const isActive = selectedParent === parent.label;

  useEffect(() => {
    if (isExpanded) {
      maxH.value = withSpring(280, { damping: 24, stiffness: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    } else {
      maxH.value = withTiming(0, { duration: 200 });
      opacity.value = withTiming(0, { duration: 140 });
    }
  }, [isExpanded]);

  const childContainerStyle = useAnimatedStyle(() => ({
    maxHeight: maxH.value,
    opacity: opacity.value,
  }));

  return (
    <View>
      <TouchableOpacity
        style={[
          styles.catModalRow,
          isActive && {
            borderWidth: 1.5,
            borderColor: parent.color + '55',
            backgroundColor: parent.color + '0D',
          },
          isExpanded && styles.catModalRowExpanded,
        ]}
        onPress={onParentPress}
        activeOpacity={0.72}
      >
        <Text style={styles.catModalEmoji}>{parent.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.catModalName,
              isActive && { color: parent.color, fontWeight: '700' },
            ]}
          >
            {parent.label}
          </Text>
          {isActive && selectedChild && !isExpanded && (
            <Text style={[styles.catModalChildHint, { color: parent.color }]}>
              {selectedChild}
            </Text>
          )}
        </View>
        <Text style={[styles.catModalChevron, isExpanded && { color: parent.color }]}>
          {isExpanded ? '▲' : '▼'}
        </Text>
      </TouchableOpacity>

      <Animated.View style={[{ overflow: 'hidden' }, childContainerStyle]}>
        <View style={styles.childGrid}>
          {parent.children.map((child) => {
            const childActive = isActive && selectedChild === child.label;
            return (
              <TouchableOpacity
                key={child.id}
                style={[
                  styles.childChip,
                  childActive && {
                    backgroundColor: parent.color,
                    borderColor: parent.color,
                  },
                ]}
                onPress={() => onChildPress(parent, child)}
                activeOpacity={0.72}
              >
                <Text style={styles.chipEmoji}>{child.emoji}</Text>
                <Text
                  style={[
                    styles.childChipLabel,
                    childActive && styles.childChipLabelActive,
                  ]}
                >
                  {child.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
};

// ─── AddTransactionScreen ─────────────────────────────────────────────────────

/**
 * Identity for a split participant across re-renders. Contacts have a stable
 * contactId; manually-named people only have a name, so fall back to that.
 */
const samePick = (
  a: { contactId?: string | null; name?: string } | null,
  b: { contactId?: string | null; name?: string } | null,
) => {
  if (!a || !b) return false;
  if (a.contactId && b.contactId) return a.contactId === b.contactId;
  return (a.name || '').trim() === (b.name || '').trim();
};

/** Stable row key for a split participant (contacts have an id; named people fall back to position). */
const pickKey = (p: any, idx: number) => p?.contactId || `pick_${idx}`;

interface NavigationProp {
  goBack: () => void;
  navigate: (screen: string) => void;
}

interface RouteProp {
  params?: { editTxnId?: string };
}

const AddTransactionScreen = ({ navigation, route }: { navigation: NavigationProp; route?: RouteProp }) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const categoryTree = useCategoryTree();   // built-ins + user's custom categories
  const categoryMaps = useCategoryMaps();   // custom-aware legacy lookup maps
  const categories  = useEPurseStore((s: any) => s.categories);
  const accounts    = useEPurseStore((s: any) => s.accounts);
  const addTransaction  = useEPurseStore((s: any) => s.addTransaction);
  const updateTransaction = useEPurseStore((s: any) => s.updateTransaction);
  const setTransactionSplit = useEPurseStore((s: any) => s.setTransactionSplit);
  const ingestMessage  = useEPurseStore((s: any) => s.ingestMessage);
  const groups         = useEPurseStore((s: any) => s.groups);
  const addGroupExpense = useEPurseStore((s: any) => s.addGroupExpense);
  const budget         = useEPurseStore((s: any) => s.budget);
  const transactions   = useEPurseStore((s: any) => s.transactions);
  const getBudgetUsage = useEPurseStore((s: any) => s.getBudgetUsage);
  const toast          = useToast();
  const { submit, submitting } = useSubmitGuard();

  // ── Edit mode ────────────────────────────────────────────────────────────────
  const editTxnId = route?.params?.editTxnId;
  const isEdit = !!editTxnId;
  const editTxn = useEPurseStore((s: any) =>
    (editTxnId ? s.transactions.find((t: any) => t.id === editTxnId) : null) || null,
  );
  // A tagged SMS amount is bank-verified — lock it, same rule the group edit form uses.
  const amountLocked = isEdit && editTxn?.source !== 'manual';

  // ── Form state ──────────────────────────────────────────────────────────────
  const [amount,         setAmount]         = useState('');
  const [date,           setDate]           = useState(() => new Date());
  const [merchant,       setMerchant]       = useState('');
  const [type,           setType]           = useState(TRANSACTION_TYPES.DEBIT);
  const [accountId,      setAccountId]      = useState<string | null>(null);
  const [parentCategory, setParentCategory] = useState('');
  const [childCategory,  setChildCategory]  = useState('');
  const [catPickerOpen,  setCatPickerOpen]  = useState(false);
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [isSplit,        setIsSplit]        = useState(false);
  const [splitPicks,     setSplitPicks]     = useState<any[]>([]);
  const [splitMode,      setSplitMode]      = useState<'percent' | 'amount'>('percent');
  // Which Method chip is lit — explicit, like the group form. `splitMode` stays the
  // unit the inputs edit (equal / full owed are both stored as percents).
  const [splitMethod,    setSplitMethod]    = useState<SplitMode>('equal');
  const [mySplitPercent, setMySplitPercent] = useState<number | null>(null);
  const [mySplitAmount,  setMySplitAmount]  = useState<number | null>(null);
  // Optional group for a NEW expense. Starts on the active Group Zone (the zone's
  // whole point is "everything I add goes here"), and None is always one tap away.
  const [groupId,        setGroupId]        = useState<string | null>(() =>
    route?.params?.editTxnId ? null : useEPurseStore.getState().activeGroupZoneId ?? null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  // Contact search shown inline on the split page (no nested modal).
  const [addingPerson,  setAddingPerson]  = useState(false);
  // null = I paid. Otherwise the split participant whose money paid the bill.
  const [splitPaidBy,    setSplitPaidBy]    = useState<{ contactId: string | null; name: string } | null>(null);
  const [note,           setNote]           = useState('');
  const [smsBody,        setSmsBody]        = useState('');
  // LB contact-picker state — opened mid-save when an LB category is chosen.
  const [lbPickerOpen,   setLbPickerOpen]   = useState(false);
  // Generic confirm dialog — currently just "remove split?" (see the clear-X below),
  // same one-slot pattern BudgetScreen/LentBorrowedScreen use for their own confirms.
  const [confirm, setConfirm] = useState<any>(null);

  // ── Edit-mode prefill (once the txn loads) ──────────────────────────────────
  useEffect(() => {
    if (!editTxn) return;
    setAmount(String(editTxn.amount ?? ''));
    setDate(editTxn.createdAt ? new Date(editTxn.createdAt) : new Date());
    setMerchant(editTxn.merchant || '');
    setType(editTxn.type || TRANSACTION_TYPES.DEBIT);
    setAccountId(editTxn.accountId || null);
    setParentCategory(editTxn.parentCategory || '');
    setChildCategory(editTxn.childCategory || '');
    setNote(editTxn.note || '');

    // Restore the split too. Without this the toggle read OFF on a split transaction,
    // so the user couldn't see it — and couldn't tell that changing the amount was
    // about to discard it (updateTransaction's mustClearSplit).
    //
    // Normalised to PERCENT even if it was entered as amounts: proportions are what
    // survive an amount change, and re-applying percentages against the new total is
    // what lets the split be preserved pro-rata instead of destroyed. It's also what
    // SplitConfigModal itself does when it restores an existing split.
    const amt = Number(editTxn.amount) || 0;
    const others = Array.isArray(editTxn.splitWith) ? editTxn.splitWith : [];
    if (editTxn.isSplit && others.length > 0 && amt > 0) {
      const myAmt = Number(editTxn.myShareAmount) || 0;
      setIsSplit(true);
      setSplitMode('percent');
      setSplitMethod('percent');
      setMySplitPercent(Math.round((myAmt / amt) * 100));
      setMySplitAmount(myAmt);
      setSplitPicks(
        others.map((o: any) => ({
          contactId:   o.contactId ?? null,
          name:        o.name || 'Friend',
          percent:     Math.round(((Number(o.shareAmount) || 0) / amt) * 100),
          shareAmount: Number(o.shareAmount) || 0,
        })),
      );
      // Restore who paid, so an edit doesn't silently flip a memo back to "I paid"
      // (which would re-apply a debit that never happened).
      setSplitPaidBy(editTxn.splitPaidBy ?? null);
    } else {
      setIsSplit(false);
      setSplitPicks([]);
      setMySplitPercent(null);
      setMySplitAmount(null);
      setSplitPaidBy(null);
    }
  }, [editTxn?.id]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  // The store guarantees exactly one active account is `primary` whenever any
  // account exists (see `ensurePrimary` in ePurseStore.js) — that's the one
  // real default for a manual entry, not an arbitrary "first Cash account".
  const defaultAccountId = useMemo(() => pickDefaultAccountId(accounts), [accounts]);

  const resolvedAccountId = accountId ?? defaultAccountId;

  const selectedParentDef = useMemo(
    () => categoryTree.find((p) => p.label === parentCategory) ?? null,
    [parentCategory, categoryTree],
  );

  // Two-tier → legacy categoryId (for budget, split validation, backward compat)
  const legacyCategoryId = useMemo(
    () => twoTierToLegacyCatId(parentCategory, childCategory, categoryMaps) ?? 'other',
    [parentCategory, childCategory, categoryMaps],
  );

  const canSplitHere =
    type === TRANSACTION_TYPES.DEBIT &&
    !SPLIT_BLOCKED_CHILD_LABELS.has(childCategory) &&
    !SPLIT_BLOCKED_CATEGORY_IDS.has(legacyCategoryId);

  /**
   * Split is only meaningful once the user has supplied enough context for
   * the page to compute shares: the mandatory fields — a non-zero amount and a merchant label. Category is
   * optional, so it doesn't gate this (an uncategorised entry splits fine).
   */
  const splitReady =
    canSplitHere &&
    (parseFloat(amount) || 0) > 0 &&
    merchant.trim().length > 0;

  const splitAmountNum = parseFloat(amount) || 0;

  // A group applies to a NEW expense that could be split — not income, not
  // Lent/Borrowed, not an edit (group txns have their own edit flow).
  const group = (groups as Group[]).find((g) => g.id === groupId) ?? null;
  const activeGroup = !isEdit && canSplitHere ? group : null;
  const groupSplit = useGroupSplit({ group: activeGroup, amount: splitAmountNum });

  /**
   * Who paid — the plain-split mirror of a shared group's payer, chosen from
   * {You} ∪ splitPicks. `null` = me (the default and the only option until
   * someone's been added to the split).
   *
   * Locked to me when the amount came from a bank SMS: that money has already
   * left the account, so flipping to a memo would reverse a real outflow.
   * Exactly the group form's `lockPayerToMe` rule.
   */
  const payerLockedToMe = amountLocked;
  const payerValid = !!splitPaidBy && splitPicks.some((p) => samePick(p, splitPaidBy));
  const effectivePayer = payerLockedToMe || !payerValid ? null : splitPaidBy;
  // Index of the payer into [You, ...splitPicks].
  const payerIdxNow = effectivePayer ? 1 + splitPicks.findIndex((p) => samePick(p, effectivePayer)) : 0;

  /**
   * Inline share editor state — lets amount/%/₹ per person be adjusted right on
   * this screen. People are picked with the inline contact search on the split page.
   */
  const setMyShareRaw = (raw: string) => {
    if (splitMode === 'amount') {
      setMySplitAmount(Math.min(MAX_ALLOWED_AMOUNT, Math.max(0, parseFloat(String(raw || '').replace(/[^\d.]/g, '')) || 0)));
    } else {
      setMySplitPercent(Math.max(0, Math.min(100, parseInt(String(raw || '').replace(/[^\d]/g, ''), 10) || 0)));
    }
  };

  const setPickRaw = (idx: number, raw: string) => {
    if (splitMode === 'amount') {
      const v = Math.min(MAX_ALLOWED_AMOUNT, Math.max(0, parseFloat(String(raw || '').replace(/[^\d.]/g, '')) || 0));
      setSplitPicks((prev) => prev.map((p, i) => (i === idx ? { ...p, shareAmount: v } : p)));
    } else {
      const v = Math.max(0, Math.min(100, parseInt(String(raw || '').replace(/[^\d]/g, ''), 10) || 0));
      setSplitPicks((prev) => prev.map((p, i) => (i === idx ? { ...p, percent: v } : p)));
    }
  };

  const removeSplitPick = (idx: number) => {
    const removed = splitPicks[idx];
    const next = splitPicks.filter((_, i) => i !== idx);
    // Last person removed → nothing left to split, snap the whole thing off
    // rather than leave an empty "0 friends" card on screen.
    if (next.length === 0) {
      setSplitPicks([]);
      setIsSplit(false);
      setMySplitPercent(null);
      setMySplitAmount(null);
      setSplitPaidBy(null);
      setSplitMethod('equal');
      return;
    }
    // The payer left → it's you again.
    const payerGone = !!effectivePayer && samePick(removed, effectivePayer);
    if (payerGone) setSplitPaidBy(null);
    // Auto methods re-calculate for the smaller group; Percent / Amount keep what was typed.
    if (splitMethod === 'equal' || splitMethod === 'fullOwed') {
      const payerIdx = payerGone || !effectivePayer ? 0 : 1 + next.findIndex((p) => samePick(p, effectivePayer));
      const pct =
        splitMethod === 'equal'
          ? evenPercents(next.length + 1)
          : fullOwedShares(100, next.length + 1, payerIdx, { whole: true });
      setSplitMode('percent');
      setMySplitPercent(pct[0]);
      setMySplitAmount(null);
      setSplitPicks(next.map((p, i) => ({ ...p, percent: pct[i + 1] })));
    } else {
      setSplitPicks(next);
    }
  };

  /** Converts existing values across the %/₹ toggle so switching modes never discards
   *  what was already typed — mirrors SplitConfigModal's own `setModeSafe`. */
  const handleSplitModeChange = (next: 'percent' | 'amount') => {
    if (next === splitMode) return;
    if (next === 'amount') {
      setMySplitAmount(splitAmountNum ? (splitAmountNum * (mySplitPercent ?? 0)) / 100 : 0);
      setSplitPicks((prev) =>
        prev.map((p) => ({
          ...p,
          shareAmount: splitAmountNum ? (splitAmountNum * (Number(p.percent) || 0)) / 100 : 0,
        })),
      );
    } else {
      setMySplitPercent(splitAmountNum > 0 ? Math.round(((mySplitAmount ?? 0) / splitAmountNum) * 100) : 0);
      setSplitPicks((prev) =>
        prev.map((p) => ({
          ...p,
          percent: splitAmountNum > 0 ? Math.round(((Number(p.shareAmount) || 0) / splitAmountNum) * 100) : 0,
        })),
      );
    }
    setSplitMode(next);
  };

  /**
   * Same contract SplitConfigModal enforces before letting Apply through — shares
   * are taken LITERALLY by the store (computePercentSplit does not renormalise a
   * sum that isn't 100), so an unchecked inline edit could silently save a split
   * whose parts don't add up to the whole. Gate Save on this, same as the modal
   * gates Apply.
   */
  const splitSumOthers = splitPicks.reduce(
    (s, p) => s + (splitMode === 'amount' ? Number(p.shareAmount) || 0 : Number(p.percent) || 0),
    0,
  );
  const splitSumAll = splitSumOthers + (splitMode === 'amount' ? mySplitAmount ?? 0 : mySplitPercent ?? 0);
  const splitValid =
    splitPicks.length === 0 ||
    (splitMode === 'amount'
      ? Math.abs(splitSumAll - splitAmountNum) <= 0.01
      : splitSumAll === 100);

  // ── Split summary (the one-line row on the main form) ───────────────────────
  const splitActive = isSplit && splitPicks.length > 0;
  // ₹ a share comes to: percent mode scales by the bill, amount mode is the ₹ itself.
  const rsOf = (v: number) =>
    splitMode === 'percent' ? (splitAmountNum * (Number(v) || 0)) / 100 : Number(v) || 0;

  const splitPageRows: SplitPageRow[] = [
    {
      id: 'me',
      name: 'You',
      isMe: true,
      isPayer: !effectivePayer,
      percent: mySplitPercent ?? 0,
      amount: rsOf(splitMode === 'percent' ? mySplitPercent ?? 0 : mySplitAmount ?? 0),
      // Equal is auto-calculated (locked); Full Owed locks only the payer at 0.
      editable: splitMethod !== 'equal' && !(splitMethod === 'fullOwed' && !effectivePayer),
      onChange: (v) => setMyShareRaw(String(v)),
    },
    ...splitPicks.map((p: any, idx: number) => {
      const isPayer = samePick(p, effectivePayer);
      return {
        id: pickKey(p, idx),
        name: p.name,
        isPayer,
        percent: Number(p.percent) || 0,
        amount: rsOf(splitMode === 'percent' ? p.percent : p.shareAmount),
        editable: splitMethod !== 'equal' && !(splitMethod === 'fullOwed' && isPayer),
        onChange: (v: number) => setPickRaw(idx, String(v)),
        onRemove: () => removeSplitPick(idx),
      };
    }),
  ];

  const splitSummary = `${effectivePayer ? `${effectivePayer.name} paid` : 'You paid'} · ${SPLIT_MODE_LABEL[splitMethod]}`;

  /** Evens the shares out in percent mode ("You" absorbs the remainder). */
  const applyEqualSplit = () => {
    const pct = evenPercents(splitPicks.length + 1);
    setSplitMode('percent');
    setMySplitPercent(pct[0]);
    setMySplitAmount(null);
    setSplitPicks((prev) => prev.map((p, i) => ({ ...p, percent: pct[i + 1] })));
  };

  /** Payer covers the whole bill (takes 0%); everyone else owes an equal share.
   *  `payerIdx` is into [You, ...picks]. */
  const applyFullOwed = (payerIdx: number) => {
    const pct = fullOwedShares(100, splitPicks.length + 1, payerIdx, { whole: true });
    setSplitMode('percent');
    setMySplitPercent(pct[0]);
    setMySplitAmount(null);
    setSplitPicks((prev) => prev.map((p, i) => ({ ...p, percent: pct[i + 1] })));
  };

  const selectPayer = (id: string) => {
    const idx = id === 'me' ? -1 : splitPicks.findIndex((p, i) => pickKey(p, i) === id);
    setSplitPaidBy(idx < 0 ? null : { contactId: splitPicks[idx].contactId ?? null, name: splitPicks[idx].name });
    if (splitMethod === 'fullOwed') applyFullOwed(idx + 1);
  };

  const handleSplitMethod = (m: SplitMode) => {
    setSplitMethod(m);
    if (m === 'equal') applyEqualSplit();
    else if (m === 'fullOwed') applyFullOwed(payerIdxNow);
    else handleSplitModeChange(m);
  };

  /** Adds a contact and re-evens the shares (same behaviour the old picker modal had). */
  const addPerson = (c: { id: string; name: string }) => {
    if (splitPicks.some((p) => p.contactId === c.id)) return;
    const n = splitPicks.length + 2; // existing + new + You
    const pct =
      splitMethod === 'fullOwed'
        ? fullOwedShares(100, n, payerIdxNow, { whole: true })
        : evenPercents(n);
    if (splitMethod === 'amount') setSplitMethod('percent');
    setIsSplit(true);
    setSplitMode('percent');
    setMySplitPercent(pct[0]);
    setMySplitAmount(null);
    setSplitPicks((prev) => [
      ...prev.map((p, i) => ({ ...p, percent: pct[i + 1] })),
      { contactId: c.id, name: c.name, percent: pct[pct.length - 1], shareAmount: 0 },
    ]);
    setAddingPerson(false);
  };

  // Per-person rupee amounts, shown read-only under the Split row.
  const splitBreakdownRows = [
    { name: 'You', amount: rsOf(splitMode === 'percent' ? mySplitPercent ?? 0 : mySplitAmount ?? 0), tag: !effectivePayer ? 'Paid' : undefined },
    ...splitPicks.map((p) => ({
      name: p.name as string,
      amount: rsOf(splitMode === 'percent' ? p.percent : p.shareAmount),
      tag: samePick(p, effectivePayer) ? 'Paid' : undefined,
    })),
  ];

  const removeSplitMessage = `This removes ${splitPicks.length} friend${splitPicks.length === 1 ? '' : 's'} from the split — their share${splitPicks.length === 1 ? '' : 's'} will be taken off Lent too.`;
  const removeSplit = () => {
    setIsSplit(false);
    setSplitPicks([]);
    setMySplitPercent(null);
    setMySplitAmount(null);
    setSplitPaidBy(null);
    setSplitMethod('equal');
    setAddingPerson(false);
  };

  // Leaving the page with nobody added means there's no split after all.
  const closeSplitPage = () => {
    setAddingPerson(false);
    if (splitPicks.length === 0) {
      setIsSplit(false);
      setMySplitPercent(null);
      setMySplitAmount(null);
      setSplitMethod('equal');
    }
  };

  const handleSplitDone = () => {
    if (!splitValid) {
      toast.warning(
        splitMode === 'percent' ? 'Fix percentages' : 'Fix amounts',
        splitMode === 'percent'
          ? 'The % shares must add up to 100.'
          : 'The ₹ shares must add up to the total amount.',
      );
      return false;
    }
  };

  // Category follows the merchant as it's typed, until picked by hand.
  const autoCategory = useAutoCategory({
    merchant,
    isIncome: type === TRANSACTION_TYPES.CREDIT,
    enabled: !isEdit,
    apply: (p, c) => {
      setParentCategory(p);
      setChildCategory(c);
    },
  });

  // ── Budget breach preview ────────────────────────────────────────────────────
  const breachPreview = useMemo(() => {
    if (type !== TRANSACTION_TYPES.DEBIT) return null;
    // Budgets are keyed by first-level (parent) category — a Groceries spend
    // counts against the Food & Dining budget.
    const budgetKey = selectedParentDef?.id;
    if (!budgetKey || !budget?.perCategory?.[budgetKey]) return null;
    const proposed = parseFloat(amount) || 0;
    if (proposed <= 0) return null;

    const usage = getBudgetUsage();
    const cat   = usage?.perCategory?.[budgetKey];
    if (!cat) return null;

    const projectedActual = cat.actual + proposed;
    const projectedPct    = cat.cap > 0 ? (projectedActual / cat.cap) * 100 : 0;
    if (projectedPct < 90) return null;

    return {
      cap: cat.cap,
      actualBefore: cat.actual,
      projectedActual,
      projectedPct,
      over:      projectedActual > cat.cap,
      overshoot: Math.max(0, projectedActual - cat.cap),
    };
  }, [type, selectedParentDef, amount, budget, transactions, getBudgetUsage]);

  // ── Open/close accordion sync ────────────────────────────────────────────────
  // Auto-expand the currently selected parent each time the modal opens
  useEffect(() => {
    if (catPickerOpen) {
      const match = categoryTree.find((p) => p.label === parentCategory);
      setExpandedParentId(match?.id ?? null);
    }
  }, [catPickerOpen]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleParentPress = (parentId: string) => {
    setExpandedParentId((prev) => (prev === parentId ? null : parentId));
  };

  const handleChildPress = (parent: ParentCat, child: ChildCat) => {
    // Lend/Borrow categories need a linked contact — that flow lives in the
    // category-manage sheet on the transaction card, not this full edit form.
    if (isEdit && LB_ALL_CATS.has(twoTierToLegacyCatId(parent.label, child.label, categoryMaps) ?? '')) {
      toast.info('Use the category menu', 'Link this to a Lent/Borrowed contact from the transaction card instead.');
      return;
    }
    setParentCategory(parent.label);
    setChildCategory(child.label);
    autoCategory.markManual();
    // Clear split if moving to an LB/blocked child
    if (SPLIT_BLOCKED_CHILD_LABELS.has(child.label)) {
      setIsSplit(false);
      setSplitPicks([]);
    }
    setExpandedParentId(null);
    setCatPickerOpen(false);
  };

  const handleTypeChange = (newType: string) => {
    setType(newType);
    if (newType === TRANSACTION_TYPES.CREDIT) {
      setIsSplit(false);
      setSplitPicks([]);
    }
  };

  /**
   * Commit the transaction to the store. Pulled out of `handleSave` so the
   * LB contact-picker flow can call it AFTER the user picks a contact
   * (passing the contactInfo through so the store can spawn an LB entry).
   */
  const commitTransaction = async (contactInfo?: { person: string; phone: string | null; contactId: string | null }) => {
    const num = parseFloat(amount);
    const wantSplit = isSplit && canSplitHere;
    // Manual add → you're at the point of purchase; capture the current point
    // (prompts for permission the first time). Optional, never blocks the save.
    const location = await requestAndGetLocation();
    addTransaction({
      amount: num,
      type,
      accountId: resolvedAccountId,
      createdAt: date.toISOString(),
      ...(location ? { location } : {}),
      categoryId:      legacyCategoryId,
      ...(parentCategory ? { parentCategory, childCategory } : {}),
      merchant:        merchant.trim(),
      cleanMerchant:   merchant.trim(),
      rawMerchant:     merchant.trim(),
      note:            note.trim(),
      isReviewed:      !!parentCategory,
      // The Group row already offered the zone group; "None" here must stay None.
      skipGroupZone:   true,
      source:          'manual',
      isSplit:         wantSplit,
      splitOthers: wantSplit
        ? splitMode === 'amount'
          ? splitPicks.map((p) => ({
              contactId:   p.contactId,
              name:        p.name,
              shareAmount: Number(p.shareAmount) || 0,
            }))
          : splitPicks
        : undefined,
      ...(wantSplit && splitMode === 'percent' && typeof mySplitPercent === 'number'
        ? { myPercent: mySplitPercent }
        : {}),
      ...(wantSplit && splitMode === 'amount' && typeof mySplitAmount === 'number'
        ? { myShareAmount: mySplitAmount }
        : {}),
      // Someone else paid → the store books it as a memo (no balance change) and
      // owes them my share instead of lending out theirs.
      ...(wantSplit && effectivePayer ? { splitPaidBy: effectivePayer } : {}),
      // Pass contactInfo through so the store can spawn the matching LB
      // entry alongside the transaction. Ignored when categoryId is not LB.
      ...(contactInfo ? { contactInfo } : {}),
    });
    toast.success(
      'Transaction added',
      wantSplit && effectivePayer
        ? `${effectivePayer.name} paid · ${formatCurrency(num)}`
        : `${merchant.trim()} · ${formatCurrency(num)}`,
    );
    navigation.goBack();
  };

  /**
   * Save changes to an existing transaction.
   *
   * The split is re-applied AFTER the core update, not passed into it. That ordering
   * is deliberate: `updateTransaction` clears a split whenever the amount changes
   * (its `mustClearSplit` guard) because the stored shares were computed against the
   * old total — and it drops the matching lentBorrowed rows with it. Previously that
   * was the end of the story: edit the amount, lose the split, no warning, no way to
   * see it had gone. Re-applying the picks here rebuilds both the shares and the LB
   * rows against the NEW amount, so the proportions survive instead.
   *
   * `setTransactionSplit` is the same action the Activity/Dashboard split flow uses,
   * so both doors now go through one code path.
   */
  const commitEdit = () => {
    if (!editTxnId) return;
    updateTransaction(editTxnId, {
      amount:  amountLocked ? editTxn.amount : parseFloat(amount),
      type,
      accountId: resolvedAccountId,
      merchant: merchant.trim(),
      categoryId: legacyCategoryId,
      parentCategory,
      childCategory,
      note: note.trim(),
      createdAt: amountLocked ? editTxn.createdAt : date.toISOString(),
    });

    const wantSplit = isSplit && canSplitHere && splitPicks.length > 0;
    if (wantSplit) {
      // Must branch on the CURRENT splitMode, not always assume percent: the inline
      // editor lets shares be typed directly in ₹ now, and reading `.percent` while
      // the user has been editing `.shareAmount` (or vice versa, after a stale mode
      // switch) would apply the wrong — or a zeroed — split.
      setTransactionSplit(
        editTxnId,
        splitMode === 'amount'
          ? splitPicks.map((p) => ({
              contactId:   p.contactId ?? null,
              name:        p.name,
              shareAmount: Number(p.shareAmount) || 0,
            }))
          : splitPicks.map((p) => ({
              contactId: p.contactId ?? null,
              name:      p.name,
              percent:   Number(p.percent) || 0,
            })),
        {
          ...(splitMode === 'amount'
            ? { mode: 'amount', myAmount: mySplitAmount ?? 0 }
            : { mode: 'percent', myPercent: mySplitPercent ?? 0 }),
          // null → I paid. Non-null flips the txn to a memo (and back), which is what
          // re-settles the account balance inside setTransactionSplit.
          paidBy: effectivePayer,
        },
      );
    } else if (editTxn?.isSplit) {
      // Toggled off during the edit → clear the split and its LB rows explicitly.
      // (An empty `others` list is how setTransactionSplit spells "no split".)
      setTransactionSplit(editTxnId, [], {});
    }
    toast.success('Changes saved');
    navigation.goBack();
  };

  /** Picking a group replaces any people added by hand with the group's members. */
  const applyGroup = (id: string | null) => {
    setGroupId(id);
    setIsSplit(false);
    setSplitPicks([]);
    setMySplitPercent(null);
    setMySplitAmount(null);
    setSplitPaidBy(null);
    setSplitMethod('equal');
  };

  const pickGroup = (id: string | null) => {
    setGroupPickerOpen(false);
    if (id && splitPicks.length > 0) {
      // Let the picker sheet finish dismissing — iOS won't present a second
      // native modal while the first is still animating out.
      setTimeout(() => setConfirm({
        title: 'Use the group split?',
        message: `The ${splitPicks.length === 1 ? 'person' : 'people'} you added will be replaced by the group's members.`,
        primaryText: 'Use Group',
        destructive: true,
        secondaryText: 'Cancel',
        onConfirm: () => {
          applyGroup(id);
          setConfirm(null);
        },
      }), 350);
      return;
    }
    applyGroup(id);
  };

  /** A group expense books through the group path (shares, group total, member debts). */
  const commitGroupExpense = async (res: { paidByMemberId: string; paidByName: string; shares: any[] }) => {
    if (!activeGroup) return;
    const location = await requestAndGetLocation();
    addGroupExpense(activeGroup.id, {
      amount: parseFloat(amount),
      merchant: merchant.trim(),
      ...(parentCategory ? { parentCategory, childCategory } : {}),
      paidByMemberId: res.paidByMemberId,
      paidByName: res.paidByName,
      shares: res.shares,
      // Someone else paid → a memo, no account touched.
      accountId: res.paidByMemberId === 'me' ? resolvedAccountId : null,
      date: date.toISOString(),
      note: note.trim(),
      ...(location ? { location } : {}),
    });
    toast.success('Expense added', `${merchant.trim()} · ${activeGroup.name}`);
    navigation.goBack();
  };

  const handleSave = () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      toast.warning('Invalid amount', 'Please enter an amount greater than zero.');
      return;
    }
    if (num > MAX_ALLOWED_AMOUNT) {
      toast.error('Amount too large', 'Maximum allowed amount is ₹10,00,00,000 (10 crore).');
      return;
    }
    if (!merchant.trim()) {
      toast.warning('Missing merchant', 'Please enter who you paid / received from.');
      return;
    }
    // No category is allowed: the entry saves as uncategorised ('other') and lands
    // in the review queue, rather than blocking a fast entry on a choice.
    if (parentCategory && !childCategory) {
      toast.warning(
        'Missing sub-category',
        `Tap "${parentCategory}" to expand and pick a sub-category.`,
      );
      return;
    }

    if (activeGroup) {
      const res = groupSplit.resolveShares();
      if (!res.ok) {
        toast.warning(res.title, res.message);
        return;
      }
      submit(() => commitGroupExpense(res));
      return;
    }

    // Shares are taken literally by the store — an inline edit that leaves the parts
    // not adding up to the whole would otherwise save silently wrong LB amounts.
    if (isSplit && canSplitHere && splitPicks.length > 0 && !splitValid) {
      toast.warning(
        splitMode === 'percent' ? 'Fix percentages' : 'Fix amounts',
        splitMode === 'percent'
          ? 'The % shares must add up to 100.'
          : 'The ₹ shares must add up to the total amount.',
      );
      return;
    }

    if (isEdit) {
      submit(() => commitEdit());
      return;
    }

    const wantSplit = isSplit && canSplitHere;
    if (wantSplit && splitPicks.length === 0) {
      toast.warning('Choose people', 'Pick at least one person to split this expense with.');
      return;
    }

    // LB categories (lent / borrowed / lent_settled / borrow_repaid) must
    // also link to a contact — otherwise the lent/borrow ledger drifts.
    // Split-mode transactions already carry per-friend records, so the
    // contact picker is skipped there.
    if (LB_ALL_CATS.has(legacyCategoryId) && !wantSplit) {
      setLbPickerOpen(true);
      return;
    }

    submit(() => commitTransaction());
  };

  const handleParseSMS = () => {
    if (!smsBody.trim()) {
      toast.warning('Empty message', 'Paste an SMS to parse.');
      return;
    }
    const diagnostic = parseMessageDetailed(smsBody.trim());
    if (!diagnostic?.ok) {
      toast.error(
        'Could not parse',
        diagnostic?.error?.message || 'Message format not recognised.',
      );
      return;
    }
    const parsedItems = (diagnostic as any).transactions || [diagnostic.transaction];
    if (parsedItems.some((item: any) => (item?.amount || 0) > MAX_ALLOWED_AMOUNT)) {
      toast.error('Amount too large', 'Maximum allowed amount is ₹10,00,00,000 (10 crore).');
      return;
    }
    const parsed = ingestMessage(smsBody.trim());
    if (!parsed) {
      toast.info('Not added', 'Looks like this SMS was already imported (duplicate).');
      return;
    }
    toast.success(
      'Transaction added',
      `${parsed.merchant} — ₹${parsed.amount} (${parsed.parentCategory ?? parsed.categoryId})`,
    );
    navigation.goBack();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const renderFormBody = (active: boolean) => (
    <>
            <FormField
              label="Amount (₹)"
              hint={amountLocked ? 'From your bank SMS — not editable' : undefined}
            >
              <FormAmountInput
                value={amount}
                onChangeText={(t: string) => setAmount(sanitizeAmount(t))}
                placeholder="0"
                locked={amountLocked}
                maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
                autoFocus={!isEdit && active}
              />
            </FormField>

            <FormField label="Merchant / Description">
              <FormTextInput
                value={merchant}
                onChangeText={(t: string) => setMerchant(sanitizeName(t, INPUT_LIMITS.MERCHANT_MAX))}
                placeholder="e.g. Zomato, Petrol, Salary"
                maxLength={INPUT_LIMITS.MERCHANT_MAX}
              />
            </FormField>

            {/* The OPTIONAL fields as one card of already-filled values — defaults in
                place, tap one only to change it — so the form doesn't read as a big
                list to fill in. Only Amount + Merchant are mandatory. */}
            <FormValueCard>
              <CategoryValueRow
                parentCategory={parentCategory}
                childCategory={childCategory}
                isAuto={autoCategory.isAuto}
                accentColor={theme.primary}
                onPress={() => setCatPickerOpen(true)}
              />

              {/* Group — optional, new expenses only. Picking one turns the Split row
                  into the group's member split and books through the group path. */}
              {!isEdit && canSplitHere ? (
                <FormValueRow
                  icon="people-outline"
                  label="Group"
                  value={activeGroup ? activeGroup.name : 'None'}
                  isPlaceholder={!activeGroup}
                  accentColor={theme.primary}
                  onPress={() => setGroupPickerOpen(true)}
                />
              ) : null}

              {activeGroup ? (
                groupSplit.isShared ? (
                  <FormValueRow
                    icon="pie-chart-outline"
                    label="Split"
                    value={groupSplit.summary}
                    accentColor={theme.primary}
                    onPress={splitRoute.open}
                  >
                    <SplitBreakdownLines rows={groupSplit.breakdownRows} />
                  </FormValueRow>
                ) : null
              ) : (
              <>
              {/* Split: a one-line SUMMARY + the breakdown. The editor lives on its
                  own page. Hidden for income / Lent / Borrowed, where a split is
                  meaningless. Shown in EDIT mode too — hiding it there was the root
                  of a silent data loss (changing the amount discarded a split
                  nothing on screen revealed). */}
              {canSplitHere ? (
                <FormValueRow
                  icon="pie-chart-outline"
                  label="Split"
                  value={splitActive ? splitSummary : 'None'}
                  isPlaceholder={!splitActive}
                  accentColor={theme.primary}
                  onPress={() => {
                    // Never a disabled row (same as Group) — shares need the
                    // mandatory fields, so say which one is missing instead.
                    if (!splitActive && !splitReady) {
                      toast.warning(
                        'Add the basics first',
                        splitAmountNum > 0 ? 'Enter the merchant, then split it.' : 'Enter the amount, then split it.',
                      );
                      return;
                    }
                    // Always the split page — people are added THERE ("Add Person").
                    setIsSplit(true);
                    splitRoute.open();
                  }}
                >
                  {splitActive ? <SplitBreakdownLines rows={splitBreakdownRows} /> : null}
                </FormValueRow>
              ) : null}
              </>
              )}

              {/* Account — unless someone else paid the group bill (a memo touches no account). */}
              {!activeGroup || groupSplit.payerIsMe ? (
              <AccountField
                accounts={accounts}
                value={resolvedAccountId}
                onChange={setAccountId}
                accentColor={theme.primary}
              />
              ) : null}

              <DateField
                variant="value"
                value={date}
                onChange={setDate}
                maximumDate={new Date()}
                disabled={amountLocked}
                accentColor={theme.primary}
              />

              <FormNoteField
                value={note}
                onChangeText={setNote}
                maxLength={INPUT_LIMITS.NOTE_MAX}
                accentColor={theme.primary}
              />
            </FormValueCard>

            {/* Budget breach preview */}
            {breachPreview ? (
              <View
                style={[
                  styles.breachChip,
                  styles.breachBelowCard,
                  breachPreview.over ? styles.breachChipOver : styles.breachChipWarn,
                ]}
              >
                <Text style={styles.breachIcon}>{breachPreview.over ? '🚨' : '⚠'}</Text>
                <Text
                  style={[
                    styles.breachText,
                    { color: breachPreview.over ? '#991B1B' : '#92400E' },
                  ]}
                >
                  {breachPreview.over
                    ? `Puts you ₹${Math.round(breachPreview.overshoot).toLocaleString('en-IN')} over your ${parentCategory} budget`
                    : `You'll be at ${Math.round(breachPreview.projectedPct)}% of your ${parentCategory} budget after this`}
                </Text>
              </View>
            ) : null}
    </>
  );

  // The plain split editor's content (rendered by the SplitEditor route).
  const plainSplitPage = {
    accentColor: theme.primary,
    payer: (
      splitPicks.length > 0
        ? {
            options: [
              { id: 'me', label: 'You' },
              ...splitPicks.map((p: any, idx: number) => ({ id: pickKey(p, idx), label: p.name })),
            ],
            selectedId: effectivePayer ? pickKey(effectivePayer, splitPicks.findIndex((p) => samePick(p, effectivePayer))) : 'me',
            onSelect: selectPayer,
            lockedNote: payerLockedToMe
              ? "You — the money already left your account, so this can't change."
              : undefined,
            memoNote: effectivePayer
              ? `${effectivePayer.name} paid — your share becomes money you owe them.`
              : undefined,
          }
        : undefined
    ),
    mode: splitMethod,
    onModeChange: handleSplitMethod,
    valueUnit: splitMode,
    total: splitAmountNum,
    rows: splitPageRows,
    peopleAction: (
      <TouchableOpacity
        style={styles.addPersonBtn}
        onPress={() => setAddingPerson((v) => !v)}
        activeOpacity={0.8}
        hitSlop={8}
      >
        <Ionicons name={addingPerson ? 'close' : 'person-add-outline'} size={16} color={theme.primary} />
        <Text style={[styles.addPersonText, { color: theme.primary }]}>
          {addingPerson ? 'Cancel' : 'Add Person'}
        </Text>
      </TouchableOpacity>
    ),
    peopleFooter: (
      addingPerson ? (
        <View style={styles.contactSearchBlock}>
          <InlineContactPicker
            onPick={addPerson}
            excludeIds={splitPicks.map((p) => p.contactId).filter(Boolean)}
            accentColor={theme.primary}
            autoFocus
          />
        </View>
      ) : null
    ),
    empty: (
      splitPicks.length === 0 ? (
        <>
          <EmptyState
            compact
            icon="people-outline"
            iconSize={64}
            title="Split This Expense"
            subtitle="Search for the people you're sharing it with. You can divide it equally or set each share."
            style={styles.splitEmpty}
          />
          <InlineContactPicker onPick={addPerson} accentColor={theme.primary} />
        </>
      ) : undefined
    ),
  };

  // The split editor is its own stack route; its state stays here (see useSplitEditorRoute).
  const splitRoute = useSplitEditorRoute(
    activeGroup
      ? groupSplit.isShared
        ? { page: { ...groupSplit.pageProps, title: activeGroup.name, accentColor: theme.primary } }
        : null
      : canSplitHere
        ? {
            page: plainSplitPage,
            onDone: handleSplitDone,
            onClose: closeSplitPage,
            remove: splitPicks.length > 0 ? { message: removeSplitMessage, onConfirm: removeSplit } : undefined,
          }
        : null,
  );

  const canSubmit = (parseFloat(amount) || 0) > 0 && merchant.trim().length > 0;
  const typeIndex = type === TRANSACTION_TYPES.CREDIT ? 1 : 0;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{isEdit ? 'Edit Transaction' : 'Add Transaction'}</Text>
          {/* Balances the back button so the title lands on true centre. */}
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Expense / Income — the app's swipeable TabView (same one Lent/Borrowed
            uses). Both scenes render the SAME form off shared state, so a swipe
            only flips the type; nothing is typed into a page that then vanishes. */}
        <UnderlineTabBar
          tabs={TYPE_ROUTES}
          activeKey={type}
          onChange={handleTypeChange}
          accentColor={type === TRANSACTION_TYPES.CREDIT ? colors.income : colors.expense}
        />
        <TabView
          navigationState={{ index: typeIndex, routes: TYPE_ROUTES }}
          renderScene={({ route: r }) => (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.scroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {renderFormBody(r.key === type)}
            </ScrollView>
          )}
          renderTabBar={() => null}
          onIndexChange={(i) => handleTypeChange(TYPE_ROUTES[i].key)}
          initialLayout={{ width: Dimensions.get('window').width }}
          swipeEnabled
          style={{ flex: 1 }}
        />

        {/* Pinned bottom bar — Cancel always; the submit appears once the mandatory
            fields (amount + merchant) are filled. Category is optional. */}
        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          <FormFooterActions
            onCancel={() => navigation.goBack()}
            submit={canSubmit ? {
              title: isEdit ? 'Save Changes' : type === TRANSACTION_TYPES.CREDIT ? 'Add Income' : 'Add Expense',
              onPress: handleSave,
              loading: submitting,
            } : null}
          />
        </View>

            <CenterModal
              visible={!!confirm}
              title={confirm?.title}
              message={confirm?.message}
              primaryText={confirm?.primaryText || 'OK'}
              secondaryText={confirm?.secondaryText}
              destructive={!!confirm?.destructive}
              onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
              onSecondary={confirm?.onSecondary || (() => setConfirm(null))}
              onClose={() => setConfirm(null)}
            />

            {!isEdit && <LinkContactModal
              visible={lbPickerOpen}
              categoryId={legacyCategoryId}
              suggestedPersons={[]}
              onConfirm={(contactInfo: any) => {
                setLbPickerOpen(false);
                submit(() => commitTransaction({
                  person:    contactInfo?.person || '',
                  phone:     contactInfo?.phone || null,
                  contactId: contactInfo?.contactId || null,
                }));
              }}
              onSkip={() => {
                setLbPickerOpen(false);
                // Save without a contact — store leaves no LB entry, txn
                // still lands in the list. User can attach a contact later
                // via the re-categorise flow.
                submit(() => commitTransaction());
              }}
              onClose={() => setLbPickerOpen(false)}
            />}
      </KeyboardAvoidingView>

      {/* ── Two-tier category picker sheet ──────────────────────────────── */}
      <Modal
        visible={catPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setCatPickerOpen(false)}
      >
        <View style={styles.catModalBackdrop}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setCatPickerOpen(false)}
          />
          <View style={styles.catModalSheet}>
            <SheetCloseButton onPress={() => setCatPickerOpen(false)} variant="absolute" />
            <View style={styles.catModalHandle} />
            <Text style={styles.catModalTitle}>Choose category</Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {categoryTree.map((parent) => (
                <AddTxnParentRow
                  key={parent.id}
                  parent={parent}
                  isExpanded={expandedParentId === parent.id}
                  selectedParent={parentCategory}
                  selectedChild={childCategory}
                  onParentPress={() => handleParentPress(parent.id)}
                  onChildPress={handleChildPress}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>


      <GroupPickerSheet
        visible={groupPickerOpen}
        txn={splitAmountNum > 0 ? { merchant: merchant.trim() || 'New expense', amount: splitAmountNum } : null}
        selectedId={groupId}
        onClear={() => pickGroup(null)}
        onPick={(id: string) => pickGroup(id)}
        onClose={() => setGroupPickerOpen(false)}
        onCreateNew={() => {
          setGroupPickerOpen(false);
          navigation.navigate('GroupForm');
        }}
      />

    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────
// Field-level styles (labels, inputs, select rows, chips) live in
// components/FormField.tsx so this screen and GroupExpenseForm stay identical.

const styles = StyleSheet.create({
  // Gray body, kept deliberately (tried white Jul-31, reverted): it separates the
  // scrolling form from the white header/footer bands. The outlined controls
  // (FormField.tsx) read correctly on any surface, which is the point of them
  // being unfilled — the surface can differ per shell.
  root: { flex: 1, backgroundColor: colors.background },
  headerSafe: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  // Fixed 40×40 box (same convention as Categories / AccountDetails) so an empty
  // spacer of the same style balances it and the centred title is truly centred.
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: {
    ...typography.h2,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },

  scroll: { padding: spacing.lg, paddingBottom: spacing.lg },
  // Covers the whole screen (header included).
  // Hairline + gap so the contact search reads as its own block, not part of the shares card.
  contactSearchBlock: { marginTop: spacing.lg, paddingTop: spacing.lg, borderTopWidth: DIVIDER_W, borderTopColor: colors.divider },
  splitEmpty: { paddingVertical: spacing.xl },
  addPersonBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  addPersonText: { fontSize: 13, fontWeight: '600' as const },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },

  // ── Category bottom-sheet modal ────────────────────────────────────────────
  catModalBackdrop: {
    flex: 1,
    backgroundColor: '#0006',
    justifyContent: 'flex-end',
  },
  catModalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '75%',
  },
  catModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  catModalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },

  // Parent row
  catModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  catModalRowExpanded: {
    marginBottom: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  catModalEmoji: { fontSize: 20, marginRight: spacing.sm },
  catModalName: {
    fontSize: 15,
    fontWeight: '400' as const,
    color: colors.textPrimary,
  },
  catModalChildHint: {
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  catModalChevron: {
    fontSize: 11,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },

  // Child chip grid
  childGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.cardAlt,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    marginBottom: spacing.sm,
  },
  childChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: 'transparent',
  },
  chipEmoji: { fontSize: 14 },
  childChipLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  childChipLabelActive: { color: '#FFFFFF' },


  // ── Budget breach chip ─────────────────────────────────────────────────────
  breachChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
  },
  breachChipWarn: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  breachChipOver: { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' },
  // Sits under the value card, whose own bottom margin already spaces it.
  breachBelowCard: { marginTop: -spacing.sm, marginBottom: spacing.lg },
  breachIcon: { fontSize: 14, lineHeight: 18 },
  breachText: {
    fontSize: 13,
    flex: 1,
    fontWeight: '600' as const,
    lineHeight: 18,
  },
});

export default AddTransactionScreen;
