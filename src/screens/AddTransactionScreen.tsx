// =============================================================================
// AddTransactionScreen — opened by the FAB on the dashboard.
// Supports manual entries with a two-tier (Parent › Child) category picker.
// =============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { INPUT_LIMITS, sanitizeName, sanitizeAmount } from '../utils/validation';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useCategoryTree, useCategoryMaps } from '../hooks/useCategoryTree';
import GradientButtonBase from '../components/GradientButton';
import SheetCloseButton from '../components/SheetCloseButton';
import DateField from '../components/DateField';
import {
  FormField,
  FormTextInput,
  FormAmountInput,
  FormSelectRow,
  FormChipRow,
  FormChip,
} from '../components/FormField';

// Cast to typed interface — GradientButton.js has no TS declarations
const GradientButton: React.FC<{
  title: string;
  onPress: () => void;
  style?: object;
  loading?: boolean;
  disabled?: boolean;
  colors?: string[];
  textStyle?: any;
  icon?: React.ReactNode;
}> = GradientButtonBase as any;
import SplitConfigModal from '../components/SplitConfigModal';
import LinkContactModal from '../components/LinkContactModal';
import CenterModal from '../components/CenterModal';
import { useToast } from '../components/Toast';
import { parseMessageDetailed } from '../utils/messageParser';
import { canSplitTransaction, SPLIT_BLOCKED_CATEGORY_IDS } from '../utils/split';
import { formatCurrency } from '../utils/format';
import {
  ParentCat,
  ChildCat,
  twoTierToLegacyCatId,
  LB_ALL_CATS,
  SPLIT_BLOCKED_CHILD_LABELS,
} from '../constants/twoTierCategories';
import { requestAndGetLocation } from '../services/locationService';

// Two-tier → legacy category conversion is centralised in twoTierCategories.ts
// (twoTierToLegacyCatId / LB_ALL_CATS / SPLIT_BLOCKED_CHILD_LABELS).

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
  const budget         = useEPurseStore((s: any) => s.budget);
  const transactions   = useEPurseStore((s: any) => s.transactions);
  const getBudgetUsage = useEPurseStore((s: any) => s.getBudgetUsage);
  const toast          = useToast();

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
  const [mySplitPercent, setMySplitPercent] = useState<number | null>(null);
  const [mySplitAmount,  setMySplitAmount]  = useState<number | null>(null);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
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
  const defaultAccountId = useMemo(() => {
    const cash = accounts.find((a: any) => a.type === ACCOUNT_TYPES.CASH);
    return cash?.id || accounts[0]?.id || null;
  }, [accounts]);

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
   * the modal to compute shares: a non-zero amount, a merchant label, and a
   * resolved child category (which in turn implies a parent).
   */
  const splitReady =
    canSplitHere &&
    (parseFloat(amount) || 0) > 0 &&
    merchant.trim().length > 0 &&
    !!childCategory;

  const splitAmountNum = parseFloat(amount) || 0;

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

  /**
   * Feeds SplitConfigModal when it's reopened to add/remove people (the "+"
   * button on the inline editor below). Real shares, not zeros: an earlier
   * version hardcoded `shareAmount: 0` here, so every time the picker reopened
   * it saw an "existing split" with everyone at ₹0, threw away whatever
   * percentages had just been typed inline, and reset You to a default 50%.
   * Deriving from the CURRENT mode/values is what makes "add one more person"
   * actually preserve the split you were mid-editing.
   */
  const splitDraftTxn = useMemo(
    () => ({
      amount: splitAmountNum,
      merchant: merchant.trim(),
      type,
      categoryId: legacyCategoryId,
      parentCategory,
      childCategory,
      isIgnored: false,
      isSplit,
      myShareAmount:
        splitMode === 'amount'
          ? mySplitAmount ?? 0
          : (splitAmountNum * (mySplitPercent ?? 0)) / 100,
      splitWith: splitPicks.map((p) => ({
        contactId: p.contactId,
        name: p.name,
        shareAmount:
          splitMode === 'amount'
            ? Number(p.shareAmount) || 0
            : (splitAmountNum * (Number(p.percent) || 0)) / 100,
      })),
    }),
    [
      splitAmountNum, merchant, type, legacyCategoryId, parentCategory, childCategory,
      isSplit, splitPicks, splitMode, mySplitPercent, mySplitAmount,
    ],
  );

  /**
   * Inline share editor state — lets amount/%/₹ per person be adjusted right on
   * this screen instead of reopening SplitConfigModal for every tweak. The modal
   * is kept only for picking WHO is in the split (it needs a contacts search,
   * which doesn't belong inline); once people are chosen, their shares live here.
   */
  const setMyShareRaw = (raw: string) => {
    if (splitMode === 'amount') {
      setMySplitAmount(Math.max(0, parseFloat(String(raw || '').replace(/[^\d.]/g, '')) || 0));
    } else {
      setMySplitPercent(Math.max(0, Math.min(100, parseInt(String(raw || '').replace(/[^\d]/g, ''), 10) || 0)));
    }
  };

  const setPickRaw = (idx: number, raw: string) => {
    if (splitMode === 'amount') {
      const v = Math.max(0, parseFloat(String(raw || '').replace(/[^\d.]/g, '')) || 0);
      setSplitPicks((prev) => prev.map((p, i) => (i === idx ? { ...p, shareAmount: v } : p)));
    } else {
      const v = Math.max(0, Math.min(100, parseInt(String(raw || '').replace(/[^\d]/g, ''), 10) || 0));
      setSplitPicks((prev) => prev.map((p, i) => (i === idx ? { ...p, percent: v } : p)));
    }
  };

  const removeSplitPick = (idx: number) => {
    setSplitPicks((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Last person removed → nothing left to split, snap the whole thing off
      // rather than leave an empty "0 friends" card on screen.
      if (next.length === 0) {
        setIsSplit(false);
        setMySplitPercent(null);
        setMySplitAmount(null);
      }
      return next;
    });
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
      parentCategory,
      childCategory,
      merchant:        merchant.trim(),
      cleanMerchant:   merchant.trim(),
      rawMerchant:     merchant.trim(),
      note:            note.trim(),
      isReviewed:      true,
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
    if (!parentCategory) {
      toast.warning('Missing category', 'Please select a category.');
      return;
    }
    if (!childCategory) {
      toast.warning(
        'Missing sub-category',
        `Tap "${parentCategory}" to expand and pick a sub-category.`,
      );
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
      commitEdit();
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

    commitTransaction();
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
  const catDisplayLabel =
    parentCategory && childCategory
      ? `${parentCategory}  ›  ${childCategory}`
      : parentCategory || 'Select category';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{isEdit ? 'Edit transaction' : 'Add transaction'}</Text>
          {/* Balances the back button so the title lands on true centre. */}
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <>
            <FormField
              label="Amount (₹)"
              hint={amountLocked ? 'From your bank SMS — not editable' : 'Up to 10 crore'}
            >
              <FormAmountInput
                value={amount}
                onChangeText={(t: string) => setAmount(sanitizeAmount(t))}
                placeholder="0"
                locked={amountLocked}
                maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
              />
            </FormField>

            <FormField label="Date" hint={amountLocked ? 'From your bank SMS' : undefined}>
              <DateField
                value={date}
                onChange={setDate}
                maximumDate={new Date()}
                disabled={amountLocked}
                accentColor={theme.primary}
              />
            </FormField>

            <FormField label="Type">
              <FormChipRow>
                {[
                  { key: TRANSACTION_TYPES.DEBIT,  label: 'Expense' },
                  { key: TRANSACTION_TYPES.CREDIT, label: 'Income'  },
                ].map((opt) => (
                  <FormChip
                    key={opt.key}
                    label={opt.label}
                    active={type === opt.key}
                    onPress={() => handleTypeChange(opt.key)}
                    accentColor={theme.primary}
                  />
                ))}
              </FormChipRow>
            </FormField>

            <FormField label="Merchant / Person">
              <FormTextInput
                value={merchant}
                onChangeText={(t: string) => setMerchant(sanitizeName(t, INPUT_LIMITS.MERCHANT_MAX))}
                placeholder="e.g. Zomato / Rohit"
                maxLength={INPUT_LIMITS.MERCHANT_MAX}
              />
            </FormField>

            {/* ── Category selector ───────────────────────────────── */}
            <FormField label="Category">
              <>
                <FormSelectRow
                  leading={selectedParentDef?.emoji ?? '📌'}
                  value={catDisplayLabel}
                  isPlaceholder={!selectedParentDef}
                  resolved={!!childCategory}
                  accentColor={selectedParentDef?.color ?? theme.primary}
                  onPress={() => setCatPickerOpen(true)}
                />

                {/* Budget breach preview */}
                {breachPreview ? (
                  <View
                    style={[
                      styles.breachChip,
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
            </FormField>

            <FormField label="Account">
              <FormChipRow>
                {/* Plain `a.name` — same as the group form's account chips. It already
                    reads "HDFC ··1234"; the old label dropped the mask whenever
                    `bankName` was set, so two accounts at one bank looked identical. */}
                {accounts.map((a: any) => (
                  <FormChip
                    key={a.id}
                    label={a.name}
                    active={(accountId ?? defaultAccountId) === a.id}
                    onPress={() => setAccountId(a.id)}
                    accentColor={theme.primary}
                  />
                ))}
              </FormChipRow>
            </FormField>

            {/* ── Split ───────────────────────────────────────────────────
                Behaviour:
                • Row is disabled (greyed, non-interactive) until amount,
                  merchant, and child category are all set.
                • Tapping the enabled row immediately opens the picker modal
                  — no second tap. Re-tapping while open is a no-op.
                • Unchecking clears picks and resets share state.            */}
            {/* Shown in EDIT mode too. Hiding it there was the root of the silent
                data loss: the split existed on the transaction but nothing on this
                screen revealed it, so changing the amount discarded it invisibly. */}
            {/* Wrapped in the SAME FormField every other control uses, so "Split"
                gets the standard section-label treatment instead of its own ad hoc
                heading inside the box — and the box itself is outlined in the
                shared neutral OUTLINE colour (colors.inputBorder), not a
                theme-primary-tinted border that no other field on this screen has. */}
            <FormField label="Split">
            {(canSplitHere ? (
              isSplit && splitPicks.length > 0 ? (
                /* ── Confirmed split: every share editable right here — %/₹ per
                       person, no modal hop for a plain number tweak. The picker
                       modal is kept for ONE thing only: adding or removing people,
                       which genuinely needs a contacts search and doesn't belong
                       inline (see the "+" button below). */
                <View style={styles.splitCard}>
                  <View style={styles.splitCardHeader}>
                    <Text style={styles.splitFriendCount}>
                      {splitPicks.length} friend{splitPicks.length === 1 ? '' : 's'}
                    </Text>
                    <View style={styles.splitHeaderActions}>
                      <TouchableOpacity
                        style={styles.splitIconBtn}
                        onPress={() => setSplitModalOpen(true)}
                        hitSlop={8}
                      >
                        <Ionicons name="person-add-outline" size={16} color={theme.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.splitClearBtn}
                        onPress={() => {
                          const n = splitPicks.length;
                          setConfirm({
                            title: 'Remove split?',
                            message: `This removes ${n} friend${n === 1 ? '' : 's'} from the split — their share${n === 1 ? '' : 's'} will be taken off Lent too.`,
                            primaryText: 'Remove',
                            destructive: true,
                            secondaryText: 'Cancel',
                            onConfirm: () => {
                              setIsSplit(false);
                              setSplitPicks([]);
                              setMySplitPercent(null);
                              setMySplitAmount(null);
                              setConfirm(null);
                            },
                          });
                        }}
                        hitSlop={8}
                      >
                        <Text style={styles.splitClearIcon}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* ── Who paid? — same control, same semantics as a shared group's
                         payer. Locked to You for a bank-SMS txn: that money has
                         already left the account, so a memo would reverse a real
                         outflow (mirrors GroupExpenseForm's lockPayerToMe). */}
                  <View style={styles.payerBlock}>
                    <Text style={styles.payerLabel}>Who paid?</Text>
                    {payerLockedToMe ? (
                      <Text style={styles.payerLockedNote}>
                        👤 You — the money already left your account, so this can&apos;t change.
                      </Text>
                    ) : (
                      <>
                        <FormChipRow>
                          <FormChip
                            label="👤 You"
                            active={!effectivePayer}
                            onPress={() => setSplitPaidBy(null)}
                            accentColor={theme.primary}
                          />
                          {splitPicks.map((p: any, idx: number) => (
                            <FormChip
                              key={p.contactId || `pick_${idx}`}
                              label={p.name}
                              active={samePick(p, effectivePayer)}
                              onPress={() => setSplitPaidBy({ contactId: p.contactId ?? null, name: p.name })}
                              accentColor={theme.primary}
                            />
                          ))}
                        </FormChipRow>
                        {effectivePayer ? (
                          <Text style={styles.payerMemoNote}>
                            {effectivePayer.name} paid — Your share
                            becomes money you owe them.
                          </Text>
                        ) : null}
                      </>
                    )}
                  </View>

                  <FormChipRow>
                    <FormChip
                      label="% Percent"
                      active={splitMode === 'percent'}
                      onPress={() => handleSplitModeChange('percent')}
                      accentColor={theme.primary}
                    />
                    <FormChip
                      label="₹ Amount"
                      active={splitMode === 'amount'}
                      onPress={() => handleSplitModeChange('amount')}
                      accentColor={theme.primary}
                    />
                  </FormChipRow>

                  {/* You */}
                  <View style={styles.shareRow}>
                    <Text style={styles.shareName}>👤 You</Text>
                    {splitMode === 'percent' && splitAmountNum > 0 ? (
                      <Text style={styles.shareAmt} numberOfLines={1}>
                        {formatCurrency((splitAmountNum * (mySplitPercent ?? 0)) / 100)}
                      </Text>
                    ) : null}
                    <View style={styles.shareInputWrap}>
                      <TextInput
                        style={styles.shareInput}
                        value={
                          splitMode === 'percent'
                            ? mySplitPercent != null ? String(mySplitPercent) : ''
                            : mySplitAmount != null ? String(mySplitAmount) : ''
                        }
                        onChangeText={setMyShareRaw}
                        keyboardType={splitMode === 'percent' ? 'number-pad' : 'decimal-pad'}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                      />
                      <Text style={styles.shareSuffix}>{splitMode === 'percent' ? '%' : '₹'}</Text>
                    </View>
                  </View>

                  {/* Everyone else */}
                  {splitPicks.map((p: any, idx: number) => (
                    <View key={p.contactId ?? idx} style={[styles.shareRow, styles.shareRowDivider]}>
                      <Text style={styles.shareName} numberOfLines={1}>{p.name}</Text>
                      {splitMode === 'percent' && splitAmountNum > 0 ? (
                        <Text style={styles.shareAmt} numberOfLines={1}>
                          {formatCurrency((splitAmountNum * (Number(p.percent) || 0)) / 100)}
                        </Text>
                      ) : null}
                      <View style={styles.shareInputWrap}>
                        <TextInput
                          style={styles.shareInput}
                          value={
                            splitMode === 'percent'
                              ? p.percent != null ? String(p.percent) : ''
                              : p.shareAmount != null ? String(p.shareAmount) : ''
                          }
                          onChangeText={(v) => setPickRaw(idx, v)}
                          keyboardType={splitMode === 'percent' ? 'number-pad' : 'decimal-pad'}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                        />
                        <Text style={styles.shareSuffix}>{splitMode === 'percent' ? '%' : '₹'}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.shareRemoveBtn}
                        onPress={() => removeSplitPick(idx)}
                        hitSlop={8}
                      >
                        <Text style={styles.shareRemoveTxt}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}

                  <Text style={[styles.splitSumHint, splitValid ? styles.sumOk : styles.sumBad]}>
                    {splitMode === 'amount'
                      ? `Total: ${formatCurrency(splitSumAll)} ${splitValid ? '✓' : `(must be ${formatCurrency(splitAmountNum)})`}`
                      : `Total: ${splitSumAll}% ${splitValid ? '✓' : '(must be 100%)'}`}
                  </Text>
                </View>
              ) : (
                /* ── Not yet split: standard toggle row ── */
                <TouchableOpacity
                  style={[
                    styles.splitToggle,
                    !splitReady && { opacity: 0.5 },
                  ]}
                  disabled={!splitReady}
                  activeOpacity={0.85}
                  onPress={() => {
                    setIsSplit(true);
                    setSplitModalOpen(true);
                  }}
                >
                  <Text style={styles.splitEmoji}>👥</Text>
                  <View style={{ flex: 1 }}>
                    {/* This is the row's own CTA copy, not a section heading — the
                        "Split" label above the box already names the section. */}
                    <Text style={styles.splitTitle}>Split with friends?</Text>
                    <Text style={styles.splitHelp}>
                      {splitReady
                        ? 'Your share is tracked; others appear in Lent from this split.'
                        : 'Fill amount, merchant, and category first to enable split.'}
                    </Text>
                  </View>
                </TouchableOpacity>
              )
            ) : (
              <Text style={styles.splitUnavailable}>
                Not available for income or lend / borrow categories.
              </Text>
            ))}
            </FormField>

            {/* Note — last field, same position as on the group form. */}
            <FormField label="Note (optional)" style={styles.noteField}>
              <FormTextInput
                value={note}
                onChangeText={setNote}
                placeholder="What else should we know?"
                multiline
                maxLength={INPUT_LIMITS.NOTE_MAX}
              />
            </FormField>

            {/* Rendered in EDIT mode too — it used to be add-only, which meant the
                only way to change a split was the row → CategoryPickerModal → Split
                path, and the edit screen silently dropped it on an amount change. */}
            {<SplitConfigModal
              visible={splitModalOpen}
              transaction={splitDraftTxn}
              onClose={() => {
                setSplitModalOpen(false);
                // If the user closes the picker without ever confirming
                // anyone, snap the checkbox back to OFF — the toggle should
                // never sit in a "checked but no friends" limbo.
                if (splitPicks.length === 0) {
                  setIsSplit(false);
                  setMySplitPercent(null);
                  setMySplitAmount(null);
                }
              }}
              onApply={(others: any, meta: any) => {
                if (!others?.length) {
                  setSplitPicks([]);
                  setMySplitPercent(null);
                  setMySplitAmount(null);
                  setSplitMode('percent');
                  setIsSplit(false);
                } else {
                  setSplitMode(meta?.mode || 'percent');
                  if ((meta?.mode || 'percent') === 'amount') {
                    setSplitPicks(others);
                    setMySplitAmount(typeof meta?.myAmount === 'number' ? meta.myAmount : null);
                    setMySplitPercent(null);
                  } else {
                    setSplitPicks(others);
                    setMySplitPercent(typeof meta?.myPercent === 'number' ? meta.myPercent : null);
                    setMySplitAmount(null);
                  }
                }
                setSplitModalOpen(false);
              }}
            />}

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
                commitTransaction({
                  person:    contactInfo?.person || '',
                  phone:     contactInfo?.phone || null,
                  contactId: contactInfo?.contactId || null,
                });
              }}
              onSkip={() => {
                setLbPickerOpen(false);
                // Save without a contact — store leaves no LB entry, txn
                // still lands in the list. User can attach a contact later
                // via the re-categorise flow.
                commitTransaction();
              }}
              onClose={() => setLbPickerOpen(false)}
            />}
          </>
        </ScrollView>

        {/* Pinned bottom bar — single primary action. */}
        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          <GradientButton
            title={isEdit ? 'Save changes' : 'Add transaction'}
            onPress={handleSave}
            style={{ width: '100%' }}
          />
        </View>
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
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────
// Field-level styles (labels, inputs, select rows, chips) live in
// components/FormField.tsx so this screen and GroupExpenseForm stay identical.

const styles = StyleSheet.create({
  // Gray body, kept deliberately (tried white Jul-31, reverted): it separates the
  // scrolling form from the white header/footer bands. The outlined controls
  // (FormField.tsx) read correctly on gray AND on the white GroupExpenseSheet, which
  // is the point of them being unfilled — the surface can differ per shell.
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
  // Sits after the split block, which has its own bottom margin.
  noteField: { marginTop: spacing.lg },
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

  // ── Split ──────────────────────────────────────────────────────────────────
  // Outlined like the fields above it — a shadowed card here would be the only
  // floating surface left in the form and would read as a separate section.
  splitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  splitEmoji: { fontSize: 22 },
  splitTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  splitHelp: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Confirmed-split card — every share editable inline (see the render). Outlined
  // the SAME way as every other control on this screen (colors.inputBorder via
  // FormField's own input style) — no theme-primary border singling this field out.
  splitCard: {
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  splitCardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  // Auxiliary count, not a heading — the "Split" FormField label above the card
  // already names the section.
  splitFriendCount: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
  payerBlock: { gap: spacing.xs },
  // Sub-label INSIDE the split card — deliberately the smaller field-label weight,
  // not typography.h3, so it can't compete with the "Split" heading above the card.
  payerLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: colors.textSecondary,
  },
  payerLockedNote: {
    ...typography.tiny,
    fontWeight: '500' as const,
    color: colors.textSecondary,
  },
  payerMemoNote: {
    ...typography.tiny,
    fontWeight: '500' as const,
    color: colors.info,
  },
  splitHeaderActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
  },
  splitIconBtn: {
    padding: 4,
  },
  splitClearBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger + '18',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  splitClearIcon: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: colors.danger,
  },
  shareRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingVertical: 8,
  },
  shareRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  shareName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  shareAmt: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textSecondary,
  },
  shareInputWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  shareInput: {
    width: 54,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    textAlign: 'right' as const,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700' as const,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  shareSuffix: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.textSecondary,
  },
  shareRemoveBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.danger + '14',
  },
  shareRemoveTxt: {
    fontSize: 14,
    fontWeight: '900' as const,
    color: colors.danger,
    lineHeight: 14,
  },
  splitSumHint: {
    fontSize: 11,
    fontWeight: '700' as const,
    marginTop: 2,
  },
  sumOk: { color: colors.success },
  sumBad: { color: colors.warning },
  splitUnavailable: {
    fontSize: 13,
    fontWeight: '400' as const,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },

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
  breachIcon: { fontSize: 14, lineHeight: 18 },
  breachText: {
    fontSize: 13,
    flex: 1,
    fontWeight: '600' as const,
    lineHeight: 18,
  },
});

export default AddTransactionScreen;
