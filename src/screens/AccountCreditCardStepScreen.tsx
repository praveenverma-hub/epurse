// =============================================================================
// AccountCreditCardStepScreen — step 2 of adding a NEW Credit Card.
//
// AccountFormScreen collects type/bank/mask/name/primary/net-worth on step 1
// and, for a Credit Card, does NOT create the account itself — it hands those
// fields here as route params. This screen asks for the credit limit/billing
// day/due day/minimum due (all optional, per the app's own field spec) and is
// the one that actually calls `addAccount`, with whatever of these was filled
// in — a blank field already resolves to `null`, so there is no separate
// "skip this step" action to offer: an empty field IS skipping it. (A first
// pass had a second "Skip" button beside "Add Account"; it did the identical
// thing whenever nothing was typed, and silently discarded anything that WAS
// typed otherwise — removed as a redundant/confusing second button for the
// same one commit.) `navigation.pop(2)` returns past both steps to wherever
// Add Account was started from (AccountsScreen).
//
// EDIT mode never reaches this screen — an existing Credit Card keeps its
// limit/billing/due/minimum fields on ONE screen (AccountFormScreen itself).
//
// Route params (all required, forwarded from AccountFormScreen):
//   type, name, bankName, mask, includeInNetWorth, primary
// =============================================================================

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, typography as typographyBase, BUTTON_H } from '../constants/theme';
import { sanitizeAmount, parseAmount, sanitizeDay } from '../utils/validation';
import PlainScreenHeader from '../components/PlainScreenHeader';
import SectionHeader from '../components/SectionHeader';
import { FormField, FormAmountInput } from '../components/FormField';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { hapticLight } from '../utils/haptics';
import { useToast } from '../components/Toast';
import { validateCardDetails } from '../utils/ccStatement';
import { paymentGapDays, isUnusualPaymentGap } from '../utils/dueDate';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const AccountCreditCardStepScreen = ({ navigation, route }: any) => {
  const theme = useTheme();
  const { submit, submitting } = useSubmitGuard();

  const { type, name, bankName, mask, includeInNetWorth, primary, colorKey } = route?.params ?? {};

  const addAccount        = useEPurseStore((s: any) => s.addAccount);
  const setPrimaryAccount = useEPurseStore((s: any) => s.setPrimaryAccount);

  const [creditLimit, setCreditLimit]   = useState('');
  const [minimumDue, setMinimumDue]     = useState('');
  const [statementDay, setStatementDay] = useState('');
  const [dueDay, setDueDay]             = useState('');

  const toast = useToast();
  // Warn (never block) on an unusual statement → due distance — usually a typo.
  const gapDays = paymentGapDays(parseInt(statementDay, 10) || null, parseInt(dueDay, 10) || null);
  const gapUnusual = isUnusualPaymentGap(gapDays);

  const finish = () => {
    // No statement exists yet on a brand-new card, so only the limit/minimum
    // rules that don't need one apply here.
    const problem = validateCardDetails({
      creditLimit: creditLimit ? parseAmount(creditLimit) : null,
      minimumDue: minimumDue ? parseAmount(minimumDue) : null,
    });
    if (problem) { toast.warning('Check card details', problem); return; }
    submit(() => {
      const newId = addAccount({
        type, name, bankName, mask, includeInNetWorth, colorKey,
        creditLimit: creditLimit ? parseAmount(creditLimit) : null,
        minimumDue: minimumDue ? parseAmount(minimumDue) : null,
        ...(statementDay ? { statementDay: parseInt(statementDay, 10) } : {}),
        ...(dueDay ? { dueDay: parseInt(dueDay, 10) } : {}),
      });
      if (primary) setPrimaryAccount(newId);
      navigation.pop(2);
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.root, { backgroundColor: theme.card }]} edges={['top']}>
        <PlainScreenHeader
          title="Card Details"
          onBack={() => { hapticLight(); navigation.goBack(); }}
          tint={theme.textPrimary}
          titleColor={theme.textPrimary}
          bordered
          surfaceColor={theme.card}
          dividerColor={theme.divider}
        />

        <ScrollView
          style={{ backgroundColor: theme.background }}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <SectionHeader
            icon="card-outline"
            title="Card Details"
            subtitle="Optional — helps us track your available credit and remind you before payments are due."
            accentColor={theme.primary}
            style={styles.ccSectionHeader}
          />

          <View style={styles.ccCard}>
            <FormField label="Credit Limit">
              <FormAmountInput
                value={creditLimit}
                onChangeText={(t) => setCreditLimit(sanitizeAmount(t))}
                placeholder="e.g. 100000"
                compact
                style={{ borderColor: theme.inputBorder, color: theme.textPrimary }}
              />
            </FormField>
            <View style={styles.dayRow}>
              <FormField label="Billing Day" style={styles.dayField}>
                <TextInput
                  value={statementDay}
                  onChangeText={(t) => setStatementDay(sanitizeDay(t))}
                  placeholder="1-31"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  maxLength={2}
                  style={[styles.input, { color: theme.textPrimary, borderColor: theme.inputBorder }]}
                />
              </FormField>
              <FormField label="Due Day" style={styles.dayField}>
                <TextInput
                  value={dueDay}
                  onChangeText={(t) => setDueDay(sanitizeDay(t))}
                  placeholder="1-31"
                  placeholderTextColor={theme.textMuted}
                  keyboardType="numeric"
                  maxLength={2}
                  style={[styles.input, { color: theme.textPrimary, borderColor: theme.inputBorder }]}
                />
              </FormField>
            </View>
            {gapUnusual ? (
              <Text style={[styles.gapHint, { color: theme.textSecondary }]}>
                That's {gapDays} days from statement to due date — unusual, so worth a quick check.
              </Text>
            ) : null}
            <FormField label="Minimum Due" style={styles.ccLastField}>
              <FormAmountInput
                value={minimumDue}
                onChangeText={(t) => setMinimumDue(sanitizeAmount(t))}
                placeholder="e.g. 2500"
                compact
                style={{ borderColor: theme.inputBorder, color: theme.textPrimary }}
              />
            </FormField>
          </View>
        </ScrollView>

        {/* ONE button — same "Add Account" copy step 1 would have used had
            this card not needed a second step, not a new synonym for the same
            commit. Leaving every field blank IS the skip. */}
        <View style={[styles.footer, { borderTopColor: theme.divider }]}>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: theme.primary }]}
            onPress={() => { hapticLight(); finish(); }}
            disabled={submitting}
            activeOpacity={0.85}
          >
            <Text style={[styles.saveTxt, { color: '#fff' }]}>Add Account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

export default AccountCreditCardStepScreen;

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl },

  // SectionHeader's OWN subtitle carries a baked-in marginBottom: spacing.md
  // (12px, `components/SectionHeader.tsx`) — the negative value here claws
  // most of that back for this ONE usage rather than changing it globally.
  ccSectionHeader: { marginBottom: -spacing.sm },
  // No border here (unlike AccountFormScreen's own inline CC card) — this
  // whole screen IS the one section, so an inner box is redundant chrome. No
  // horizontal padding either — same reasoning as AccountFormScreen's own
  // `ccCard`: with no border, a side inset just narrowed these fields
  // against the screen's own body gutter for no visual reason.
  ccCard: {
    paddingBottom: spacing.sm,
    marginBottom: spacing.lg,
  },
  ccLastField: { marginBottom: 0 },

  input: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    borderWidth: 1,
  },
  dayRow: { flexDirection: 'row', gap: spacing.md },
  // Sits under the day fields (their own marginBottom already spaces them).
  gapHint: { ...typography.tiny, marginTop: -spacing.sm, marginBottom: spacing.md },
  dayField: { flex: 1 },

  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    minHeight: BUTTON_H,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  saveTxt: { ...typography.bodyBold, fontWeight: '700', fontSize: 16 },
});
