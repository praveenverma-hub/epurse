// =============================================================================
// AddTransactionScreen — opened by the FAB on the dashboard.
// Supports manual cash entries plus pasting an SMS to be auto-parsed.
// =============================================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useEPurseStore } from '../store/ePurseStore';
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from '../constants/categories';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import GradientButton from '../components/GradientButton';
import { parseMessageDetailed } from '../utils/messageParser';

const AddTransactionScreen = ({ navigation }) => {
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
  const [isSplit, setIsSplit] = useState(false);
  const [note, setNote] = useState('');

  // sms field
  const [smsBody, setSmsBody] = useState('');

  const handleSave = () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      Alert.alert('Invalid amount', 'Please enter an amount greater than zero.');
      return;
    }
    if (!merchant.trim()) {
      Alert.alert('Missing merchant', 'Please enter who you paid / received from.');
      return;
    }
    addTransaction({
      amount: num,
      type,
      accountType,
      categoryId,
      merchant: merchant.trim(),
      note: note.trim(),
      isSplit,
      splitWith: [],
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
              <Field label="Amount (₹)">
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
                    <Seg key={opt.key} label={opt.label} active={type === opt.key} onPress={() => setType(opt.key)} />
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {categories.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setCategoryId(c.id)}
                      style={[
                        styles.catPill,
                        categoryId === c.id && {
                          backgroundColor: c.color + '22',
                          borderColor: c.color,
                        },
                      ]}
                    >
                      <Text style={{ fontSize: 16 }}>{c.emoji}</Text>
                      <Text
                        style={[
                          styles.catText,
                          categoryId === c.id && { color: c.color, fontWeight: '700' },
                        ]}
                      >
                        {c.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
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

              <TouchableOpacity
                style={[styles.splitToggle, isSplit && styles.splitToggleActive]}
                onPress={() => setIsSplit((v) => !v)}
              >
                <Text style={styles.splitEmoji}>👥</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.splitTitle}>Split with friends?</Text>
                  <Text style={styles.splitHelp}>
                    Tag this transaction so you can settle it later.
                  </Text>
                </View>
                <View style={[styles.checkbox, isSplit && styles.checkboxOn]}>
                  {isSplit && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </TouchableOpacity>

              <GradientButton title="Save transaction" onPress={handleSave} style={{ marginTop: spacing.xl }} />
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
    </KeyboardAvoidingView>
  );
};

const Field = ({ label, children }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
);

const Tab = ({ label, active, onPress }) => (
  <TouchableOpacity onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
    {active ? (
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
      />
    ) : null}
    <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
  </TouchableOpacity>
);

const Seg = ({ label, active, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.seg, active && { backgroundColor: colors.primary + '15', borderColor: colors.primary }]}
  >
    <Text style={[styles.segText, active && { color: colors.primary, fontWeight: '700' }]}>
      {label}
    </Text>
  </TouchableOpacity>
);

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

  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    marginRight: spacing.sm,
    gap: 6,
  },
  catText: { ...typography.small, color: colors.textSecondary },

  splitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  splitToggleActive: { borderColor: colors.primary, borderWidth: 1 },
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
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontWeight: '700' },

  smsHelp: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
});

export default AddTransactionScreen;
