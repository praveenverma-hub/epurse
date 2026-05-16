// =============================================================================
// AddTransactionScreen — opened by the FAB on the dashboard.
// Supports manual cash entries plus pasting an SMS to be auto-parsed.
// =============================================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';
import { MAX_ALLOWED_AMOUNT } from '../constants/limits';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import GradientButton from '../components/GradientButton';
import SplitConfigModal from '../components/SplitConfigModal';
import { parseMessageDetailed } from '../utils/messageParser';
import { canSplitTransaction } from '../utils/split';

const AddTransactionScreen = ({ navigation }) => {
  const theme = useTheme();
  const categories = useEPurseStore((s) => s.categories);
  const addTransaction = useEPurseStore((s) => s.addTransaction);
  const ingestMessage = useEPurseStore((s) => s.ingestMessage);

  const [mode, setMode] = useState('manual'); // 'manual' | 'sms'

  // manual fields
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [type, setType] = useState(TRANSACTION_TYPES.DEBIT);
  const [accountType, setAccountType] = useState(ACCOUNT_TYPES.CASH);
  const [categoryId, setCategoryId] = useState('food');
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [isSplit, setIsSplit] = useState(false);
  const [splitPicks, setSplitPicks] = useState([]);
  const [splitMode, setSplitMode] = useState('percent'); // 'percent' | 'amount'
  const [mySplitPercent, setMySplitPercent] = useState(null);
  const [mySplitAmount, setMySplitAmount] = useState(null);
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [note, setNote] = useState('');

  // sms field
  const [smsBody, setSmsBody] = useState('');

  const splitDraftTxn = useMemo(
    () => ({
      amount: parseFloat(amount) || 0,
      merchant: merchant.trim(),
      type,
      categoryId,
      isIgnored: false,
      isSplit,
      splitWith: splitPicks.map((p) => ({
        contactId: p.contactId,
        name: p.name,
        shareAmount: 0,
      })),
    }),
    [amount, merchant, type, categoryId, isSplit, splitPicks]
  );

  const canSplitHere = canSplitTransaction({
    type,
    categoryId,
    isIgnored: false,
  });

  const handleSave = () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than zero.');
      return;
    }
    if (num > MAX_ALLOWED_AMOUNT) {
      Alert.alert('Amount too large', 'Maximum allowed amount is ₹10,00,00,000 (10 crore).');
      return;
    }
    if (!merchant.trim()) {
      Alert.alert('Missing merchant', 'Please enter who you paid / received from.');
      return;
    }
    const wantSplit = isSplit && canSplitHere;
    if (wantSplit && splitPicks.length === 0) {
      Alert.alert('Choose people', 'Pick at least one person to split this expense with.');
      return;
    }
    addTransaction({
      amount: num,
      type,
      accountType,
      categoryId,
      merchant: merchant.trim(),
      note: note.trim(),
      isSplit: wantSplit,
      splitOthers: wantSplit
        ? splitMode === 'amount'
          ? splitPicks.map((p) => ({
              contactId: p.contactId,
              name: p.name,
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
      source: 'manual',
    });
    navigation.goBack();
  };

  const handleParseSMS = () => {
    if (!smsBody.trim()) {
      Alert.alert('Empty message', 'Paste an SMS to parse.');
      return;
    }
    const diagnostic = parseMessageDetailed(smsBody.trim());
    if (!diagnostic?.ok) {
      Alert.alert('Could not parse', diagnostic?.error?.message || 'Message format not recognised.');
      return;
    }
    const parsedItems = diagnostic.transactions || [diagnostic.transaction];
    if (parsedItems.some((item) => (item?.amount || 0) > MAX_ALLOWED_AMOUNT)) {
      Alert.alert('Amount too large', 'Maximum allowed amount is ₹10,00,00,000 (10 crore).');
      return;
    }

    const parsed = ingestMessage(smsBody.trim());
    if (!parsed) {
      Alert.alert('Not added', 'Looks like this SMS was already imported (duplicate).');
      return;
    }
    Alert.alert(
      'Transaction added',
      `${parsed.merchant} — ₹${parsed.amount} (${parsed.categoryId})`,
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Add transaction</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.tabs}>
          <Tab label="Manual" active={mode === 'manual'} onPress={() => setMode('manual')} />
          <Tab label="From SMS" active={mode === 'sms'} onPress={() => setMode('sms')} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {mode === 'manual' ? (
            <>
              <Field label="Amount (₹) · Max 10 crore">
                <TextInput
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  style={styles.amountInput}
                />
              </Field>

              <Field label="Type">
                <View style={styles.segRow}>
                  {[
                    { key: TRANSACTION_TYPES.DEBIT, label: 'Expense' },
                    { key: TRANSACTION_TYPES.CREDIT, label: 'Income' },
                  ].map((opt) => (
                    <Seg
                      key={opt.key}
                      label={opt.label}
                      active={type === opt.key}
                      onPress={() => {
                        setType(opt.key);
                        if (opt.key === TRANSACTION_TYPES.CREDIT) {
                          setIsSplit(false);
                          setSplitPicks([]);
                        }
                      }}
                    />
                  ))}
                </View>
              </Field>

              <Field label="Account">
                <View style={styles.segRow}>
                  {Object.values(ACCOUNT_TYPES).map((a) => (
                    <Seg key={a} label={a} active={accountType === a} onPress={() => setAccountType(a)} />
                  ))}
                </View>
              </Field>

              <Field label="Merchant / Person">
                <TextInput
                  value={merchant}
                  onChangeText={setMerchant}
                  placeholder="e.g. Zomato / Rohit"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                />
              </Field>

              <Field label="Category">
                {(() => {
                  const activeCat = categories.find((c) => c.id === categoryId);
                  return (
                    <TouchableOpacity
                      style={[styles.catSelector, activeCat && { borderColor: activeCat.color }]}
                      onPress={() => setCatPickerOpen(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.catSelectorEmoji}>{activeCat?.emoji ?? '📌'}</Text>
                      <Text style={[styles.catSelectorName, activeCat && { color: activeCat.color, fontWeight: '700' }]}>
                        {activeCat?.name ?? 'Select category'}
                      </Text>
                      <Text style={styles.catSelectorArrow}>›</Text>
                    </TouchableOpacity>
                  );
                })()}
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

              {canSplitHere ? (
                <>
                  <TouchableOpacity
                    style={[styles.splitToggle, isSplit && { borderColor: theme.primary, borderWidth: 1 }]}
                    onPress={() => {
                      setIsSplit((v) => {
                        const next = !v;
                        if (!next) setSplitPicks([]);
                        return next;
                      });
                    }}
                  >
                    <Text style={styles.splitEmoji}>👥</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.splitTitle}>Split with friends?</Text>
                      <Text style={styles.splitHelp}>
                        Your share is tracked; others appear in Lent from this split.
                      </Text>
                    </View>
                    <View style={[styles.checkbox, isSplit && { backgroundColor: theme.primary, borderColor: theme.primary }]}>
                      {isSplit && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </TouchableOpacity>

                  {isSplit ? (
                    <TouchableOpacity
                      style={[styles.splitPickBtn, { borderColor: theme.primary + '44' }]}
                      onPress={() => setSplitModalOpen(true)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.splitPickBtnTitle, { color: theme.primary }]}>
                        {splitPicks.length === 0
                          ? 'Tap to choose people'
                          : `${splitPicks.length} friend${splitPicks.length === 1 ? '' : 's'} · equal split`}
                      </Text>
                      <Text style={styles.splitPickBtnHint}>Uses your contacts</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : (
                <Text style={styles.splitUnavailable}>
                  Split is available for expenses only (not income or lend / borrow categories).
                </Text>
              )}

              <GradientButton title="Save transaction" onPress={handleSave} style={{ marginTop: spacing.xl }} />

              <SplitConfigModal
                visible={splitModalOpen}
                transaction={splitDraftTxn}
                onClose={() => setSplitModalOpen(false)}
                onApply={(others, meta) => {
                  if (!others?.length) {
                    setSplitPicks([]);
                    setMySplitPercent(null);
                    setMySplitAmount(null);
                    setSplitMode('percent');
                    setIsSplit(false);
                  } else {
                    setSplitMode(meta?.mode || 'percent');
                    if ((meta?.mode || 'percent') === 'amount') {
                      // others come in as { shareAmount }
                      setSplitPicks(others);
                      setMySplitAmount(typeof meta?.myAmount === 'number' ? meta.myAmount : null);
                      setMySplitPercent(null);
                    } else {
                      // others come in as { percent }
                      setSplitPicks(others);
                      setMySplitPercent(typeof meta?.myPercent === 'number' ? meta.myPercent : null);
                      setMySplitAmount(null);
                    }
                  }
                  setSplitModalOpen(false);
                }}
              />
            </>
          ) : (
            <>
              <Text style={styles.smsHelp}>
                Paste a bank or wallet SMS below. We'll detect the amount, account and merchant
                automatically.
              </Text>
              <TextInput
                value={smsBody}
                onChangeText={setSmsBody}
                placeholder="e.g. Rs.450 debited from A/c xx1234 to SWIGGY..."
                placeholderTextColor={colors.textMuted}
                multiline
                style={[styles.input, { minHeight: 160, textAlignVertical: 'top' }]}
              />
              <GradientButton title="Parse & save" onPress={handleParseSMS} style={{ marginTop: spacing.xl }} />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
      {/* Category bottom-sheet picker */}
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
            <ScrollView showsVerticalScrollIndicator={false}>
              {categories.map((c) => {
                const active = categoryId === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.catModalRow, active && { backgroundColor: c.color + '18', borderColor: c.color, borderWidth: 1 }]}
                    onPress={() => {
                      setCategoryId(c.id);
                      const draft = { type, categoryId: c.id, isIgnored: false };
                      if (!canSplitTransaction(draft)) {
                        setIsSplit(false);
                        setSplitPicks([]);
                      }
                      setCatPickerOpen(false);
                    }}
                  >
                    <Text style={styles.catModalEmoji}>{c.emoji}</Text>
                    <Text style={[styles.catModalName, active && { color: c.color, fontWeight: '700' }]}>
                      {c.name}
                    </Text>
                    {active && <Text style={[styles.catModalCheck, { color: c.color }]}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const Field = ({ label, children }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);

const Tab = ({ label, active, onPress }) => {
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

const Seg = ({ label, active, onPress }) => {
  const { primary } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.seg, active && { backgroundColor: primary + '15', borderColor: primary }]}
    >
      <Text style={[styles.segText, active && { color: primary, fontWeight: '700' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  backText: { fontSize: 22, color: colors.textPrimary },
  title: { ...typography.h2, color: colors.textPrimary },

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
  tabText: { ...typography.bodyBold, color: colors.textSecondary },
  tabTextActive: { color: '#fff' },

  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },

  field: { marginBottom: spacing.lg },
  fieldLabel: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.xs, fontWeight: '600' },

  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
    ...shadows.card,
  },
  amountInput: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    ...shadows.card,
  },

  segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  seg: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  segText: { ...typography.small, color: colors.textSecondary },

  // Category inline selector (compact single row)
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
  catSelectorName: { flex: 1, ...typography.body, color: colors.textPrimary },
  catSelectorArrow: { fontSize: 20, color: colors.textMuted },

  // Category bottom-sheet modal
  catModalBackdrop: { flex: 1, backgroundColor: '#0006', justifyContent: 'flex-end' },
  catModalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '70%',
  },
  catModalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  catModalTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.md },
  catModalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  catModalEmoji: { fontSize: 20, marginRight: spacing.sm },
  catModalName: { flex: 1, ...typography.body, color: colors.textPrimary },
  catModalCheck: { fontWeight: '800', fontSize: 16 },

  splitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  splitToggleActive: {},
  splitEmoji: { fontSize: 22 },
  splitTitle: { ...typography.bodyBold, color: colors.textPrimary },
  splitHelp: { ...typography.tiny, color: colors.textSecondary, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {},
  checkmark: { color: '#fff', fontWeight: '700' },

  splitPickBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderWidth: 1,
    ...shadows.card,
  },
  splitPickBtnTitle: { ...typography.bodyBold, fontWeight: '700' },
  splitPickBtnHint: { ...typography.tiny, color: colors.textSecondary, marginTop: 4 },
  splitUnavailable: {
    ...typography.small,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginBottom: spacing.sm,
  },

  smsHelp: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
});

export default AddTransactionScreen;
