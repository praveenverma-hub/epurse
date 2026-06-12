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
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { LinearGradient } from 'expo-linear-gradient';
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
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButtonBase from '../components/GradientButton';

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
import { useToast } from '../components/Toast';
import { parseMessageDetailed } from '../utils/messageParser';
import { canSplitTransaction, SPLIT_BLOCKED_CATEGORY_IDS } from '../utils/split';
import { PARENT_CATEGORIES, ParentCat, ChildCat } from '../constants/twoTierCategories';

// ─── Category mappings (two-tier → legacy) ───────────────────────────────────
// Used to derive categoryId for budget checks and split validation.

const PARENT_TO_LEGACY: Record<string, string> = {
  'Food & Dining':    'food',
  'Travel & Commute': 'travel',
  'Bills & Utilities':'bills',
  'Shopping':         'shopping',
  'Entertainment':    'entertainment',
  'Health & Fitness': 'health',
  'Fuel':             'fuel',
  'Investments':      'investments',
  'Transfers':        'transfer',
  'Income':           'salary',
};

// Child overrides take precedence over parent (e.g. Lent must map to 'lent', not 'transfer')
const CHILD_TO_LEGACY: Record<string, string> = {
  Lent:             'lent',
  Borrowed:         'borrowed',
  'P2P Transfer':   'transfer',
  Salary:           'salary',
  Freelance:        'freelance',
  'Stocks & Trading':'investments',
  'Mutual Funds':   'investments',
};

// Children that block split (same set as SPLIT_BLOCKED_CATEGORY_IDS, two-tier side)
const LB_BLOCKED_CHILDREN = new Set(['Lent', 'Borrowed']);

// LB categoryIds whose save flow must prompt for a contact (so the lent/borrow
// books stay in sync). Mirrors the store's LB_ALL_CATS.
const LB_CATEGORY_IDS = new Set(['lent', 'borrowed', 'lent_settled', 'borrow_repaid']);

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

interface NavigationProp {
  goBack: () => void;
  navigate: (screen: string) => void;
}

const AddTransactionScreen = ({ navigation }: { navigation: NavigationProp }) => {
  const theme = useTheme();
  const categories  = useEPurseStore((s: any) => s.categories);
  const accounts    = useEPurseStore((s: any) => s.accounts);
  const addTransaction = useEPurseStore((s: any) => s.addTransaction);
  const ingestMessage  = useEPurseStore((s: any) => s.ingestMessage);
  const budget         = useEPurseStore((s: any) => s.budget);
  const transactions   = useEPurseStore((s: any) => s.transactions);
  const getBudgetUsage = useEPurseStore((s: any) => s.getBudgetUsage);
  const toast          = useToast();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [amount,         setAmount]         = useState('');
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
  const [note,           setNote]           = useState('');
  const [smsBody,        setSmsBody]        = useState('');
  // LB contact-picker state — opened mid-save when an LB category is chosen.
  const [lbPickerOpen,   setLbPickerOpen]   = useState(false);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const defaultAccountId = useMemo(() => {
    const cash = accounts.find((a: any) => a.type === ACCOUNT_TYPES.CASH);
    return cash?.id || accounts[0]?.id || null;
  }, [accounts]);

  const resolvedAccountId = accountId ?? defaultAccountId;

  const selectedParentDef = useMemo(
    () => PARENT_CATEGORIES.find((p) => p.label === parentCategory) ?? null,
    [parentCategory],
  );

  // Two-tier → legacy categoryId (for budget, split validation, backward compat)
  const legacyCategoryId = useMemo(
    () => CHILD_TO_LEGACY[childCategory] ?? PARENT_TO_LEGACY[parentCategory] ?? 'other',
    [parentCategory, childCategory],
  );

  const canSplitHere =
    type === TRANSACTION_TYPES.DEBIT &&
    !LB_BLOCKED_CHILDREN.has(childCategory) &&
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

  const splitDraftTxn = useMemo(
    () => ({
      amount: parseFloat(amount) || 0,
      merchant: merchant.trim(),
      type,
      categoryId: legacyCategoryId,
      parentCategory,
      childCategory,
      isIgnored: false,
      isSplit,
      splitWith: splitPicks.map((p) => ({
        contactId: p.contactId,
        name: p.name,
        shareAmount: 0,
      })),
    }),
    [amount, merchant, type, legacyCategoryId, parentCategory, childCategory, isSplit, splitPicks],
  );

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
      const match = PARENT_CATEGORIES.find((p) => p.label === parentCategory);
      setExpandedParentId(match?.id ?? null);
    }
  }, [catPickerOpen]);

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleParentPress = (parentId: string) => {
    setExpandedParentId((prev) => (prev === parentId ? null : parentId));
  };

  const handleChildPress = (parent: ParentCat, child: ChildCat) => {
    setParentCategory(parent.label);
    setChildCategory(child.label);
    // Clear split if moving to an LB/blocked child
    if (LB_BLOCKED_CHILDREN.has(child.label)) {
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
  const commitTransaction = (contactInfo?: { person: string; phone: string | null; contactId: string | null }) => {
    const num = parseFloat(amount);
    const wantSplit = isSplit && canSplitHere;
    addTransaction({
      amount: num,
      type,
      accountId: resolvedAccountId,
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
      // Pass contactInfo through so the store can spawn the matching LB
      // entry alongside the transaction. Ignored when categoryId is not LB.
      ...(contactInfo ? { contactInfo } : {}),
    });
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
    const wantSplit = isSplit && canSplitHere;
    if (wantSplit && splitPicks.length === 0) {
      toast.warning('Choose people', 'Pick at least one person to split this expense with.');
      return;
    }

    // LB categories (lent / borrowed / lent_settled / borrow_repaid) must
    // also link to a contact — otherwise the lent/borrow ledger drifts.
    // Split-mode transactions already carry per-friend records, so the
    // contact picker is skipped there.
    if (LB_CATEGORY_IDS.has(legacyCategoryId) && !wantSplit) {
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
          <Text style={styles.title}>Add transaction</Text>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <>
            <Field label="Amount (₹) · Max 10 crore">
              <TextInput
                value={amount}
                onChangeText={(t) => setAmount(sanitizeAmount(t))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                style={styles.amountInput}
                maxLength={INPUT_LIMITS.AMOUNT_MAX_LEN}
              />
            </Field>

            <Field label="Type">
              <View style={styles.segRow}>
                {[
                  { key: TRANSACTION_TYPES.DEBIT,  label: 'Expense' },
                  { key: TRANSACTION_TYPES.CREDIT, label: 'Income'  },
                ].map((opt) => (
                  <Seg
                    key={opt.key}
                    label={opt.label}
                    active={type === opt.key}
                    onPress={() => handleTypeChange(opt.key)}
                  />
                ))}
              </View>
            </Field>

            <Field label="Account">
              <View style={styles.segRow}>
                {accounts.map((a: any) => {
                  const emoji = ({ bank: '🏦', credit_card: '💳', wallet: '👛', cash: '💵' } as any)[a.type] ?? '💳';
                  const shortName = a.bankName
                    ? a.bankName
                    : a.mask
                    ? `${a.name.split('··')[0].trim()} ··${a.mask.slice(-4)}`
                    : a.name;
                  const isActive = (accountId ?? defaultAccountId) === a.id;
                  return (
                    <Seg
                      key={a.id}
                      label={`${emoji} ${shortName}`}
                      active={isActive}
                      onPress={() => setAccountId(a.id)}
                    />
                  );
                })}
              </View>
            </Field>

            <Field label="Merchant / Person">
              <TextInput
                value={merchant}
                onChangeText={(t) => setMerchant(sanitizeName(t, INPUT_LIMITS.MERCHANT_MAX))}
                placeholder="e.g. Zomato / Rohit"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                maxLength={INPUT_LIMITS.MERCHANT_MAX}
              />
            </Field>

            {/* ── Category selector ───────────────────────────────── */}
            <Field label="Category">
              <>
                <TouchableOpacity
                  style={[
                    styles.catSelector,
                    selectedParentDef && {
                      borderColor: selectedParentDef.color + '99',
                      borderWidth: 1.5,
                    },
                  ]}
                  onPress={() => setCatPickerOpen(true)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.catSelectorEmoji}>
                    {selectedParentDef?.emoji ?? '📌'}
                  </Text>
                  <Text
                    style={[
                      styles.catSelectorName,
                      selectedParentDef
                        ? { color: selectedParentDef.color, fontWeight: '700' }
                        : { color: colors.textMuted },
                    ]}
                    numberOfLines={1}
                  >
                    {catDisplayLabel}
                  </Text>
                  {childCategory ? (
                    <Text style={[styles.catSelectorCheck, { color: selectedParentDef?.color }]}>
                      ✓
                    </Text>
                  ) : (
                    <Text style={styles.catSelectorArrow}>›</Text>
                  )}
                </TouchableOpacity>

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
            </Field>

            <Field label="Note (optional)">
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="What was this for?"
                placeholderTextColor={colors.textMuted}
                multiline
                style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              />
            </Field>

            {/* ── Split ───────────────────────────────────────────────────
                Behaviour:
                • Row is disabled (greyed, non-interactive) until amount,
                  merchant, and child category are all set.
                • Tapping the enabled row immediately opens the picker modal
                  — no second tap. Re-tapping while open is a no-op.
                • Unchecking clears picks and resets share state.            */}
            {canSplitHere ? (
              isSplit && splitPicks.length > 0 ? (
                /* ── Confirmed split: show who's in + edit/clear actions ── */
                <View style={[styles.splitToggle, { borderColor: theme.primary, borderWidth: 1 }]}>
                  <Text style={styles.splitEmoji}>👥</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.splitTitle}>
                      Split with {splitPicks.length} friend{splitPicks.length === 1 ? '' : 's'}
                    </Text>
                    <View style={styles.splitAvatarRow}>
                      {splitPicks.map((p: any, i: number) => (
                        <View key={p.contactId ?? i} style={[styles.splitAvatar, { backgroundColor: theme.primary + '22', borderColor: theme.primary + '55' }]}>
                          <Text style={[styles.splitAvatarText, { color: theme.primary }]}>
                            {(p.name || '?').charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      ))}
                      <Text style={styles.splitAvatarNames} numberOfLines={1}>
                        {splitPicks.map((p: any) => p.name?.split(' ')[0] || '?').join(', ')}
                      </Text>
                    </View>
                  </View>
                  {/* Edit */}
                  <TouchableOpacity
                    style={styles.splitEditBtn}
                    onPress={() => setSplitModalOpen(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                  >
                    <Text style={styles.splitEditIcon}>✏️</Text>
                  </TouchableOpacity>
                  {/* Clear */}
                  <TouchableOpacity
                    style={styles.splitClearBtn}
                    onPress={() => {
                      setIsSplit(false);
                      setSplitPicks([]);
                      setMySplitPercent(null);
                      setMySplitAmount(null);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  >
                    <Text style={styles.splitClearIcon}>✕</Text>
                  </TouchableOpacity>
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
                Split is available for expenses only (not income or lend / borrow categories).
              </Text>
            )}

            <GradientButton
              title="Save transaction"
              onPress={handleSave}
              style={{ marginTop: spacing.xl }}
            />

            <SplitConfigModal
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
            />

            <LinkContactModal
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
            />
          </>
        </ScrollView>
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
            <View style={styles.catModalHandle} />
            <Text style={styles.catModalTitle}>Choose category</Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {PARENT_CATEGORIES.map((parent) => (
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

// ─── Small shared sub-components ─────────────────────────────────────────────

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);

const Tab = ({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) => {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      {active ? (
        <LinearGradient
          colors={[theme.gradientStart, theme.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
        />
      ) : null}
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
};

const Seg = ({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) => {
  const { primary } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.seg, active && { backgroundColor: primary + '15', borderColor: primary }]}
    >
      <Text
        style={[styles.segText, active && { color: primary, fontWeight: '700' }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
  backBtn: { padding: 4 },
  title: { ...typography.h2, fontWeight: '700' as const, color: colors.textPrimary },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    padding: 4,
    ...shadows.card,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    overflow: 'hidden',
  },
  tabActive: {},
  tabText: { ...typography.bodyBold, fontWeight: '600' as const, color: colors.textSecondary },
  tabTextActive: { color: '#fff' },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xl },

  field: { marginBottom: spacing.lg },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },

  input: {
    ...(shadows.card as object),
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '400' as const,
  },
  amountInput: {
    ...(shadows.card as object),
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800' as const,
  },

  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  seg: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    maxWidth: '100%',
  },
  segText: {
    fontSize: 13,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },

  // ── Category selector button ───────────────────────────────────────────────
  catSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.divider,
    gap: spacing.sm,
    ...shadows.card,
  },
  catSelectorEmoji: { fontSize: 20 },
  catSelectorName: { flex: 1, fontSize: 15, fontWeight: '400' as const },
  catSelectorArrow: { fontSize: 20, color: colors.textMuted },
  catSelectorCheck: { fontSize: 16, fontWeight: '700' as const },

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
  catModalCheck: { fontWeight: '800' as const, fontSize: 16 },

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
    borderColor: colors.divider,
    backgroundColor: colors.card,
  },
  chipEmoji: { fontSize: 14 },
  childChipLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  childChipLabelActive: { color: '#FFFFFF' },

  // ── Split ──────────────────────────────────────────────────────────────────
  splitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
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
  splitAvatarRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 6,
    flexWrap: 'wrap' as const,
  },
  splitAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  splitAvatarText: {
    fontSize: 11,
    fontWeight: '800' as const,
  },
  splitAvatarNames: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  splitEditBtn: {
    paddingHorizontal: 4,
  },
  splitEditIcon: { fontSize: 16 },
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
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: { color: '#fff', fontWeight: '700' as const },
  splitPickBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    ...shadows.card,
  },
  splitPickBtnTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  splitPickBtnHint: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: colors.textSecondary,
    marginTop: 4,
  },
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
